import type { Database } from "@/lib/supabase/database.types";
import type { TradingMode } from "@/lib/types/trading-mode";
import { toCostModel, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import type { MarketDataPort } from "./approval";
import { checkExit } from "./paper";
import { computeSettlement } from "./settlement";
import { calculateLongExcursions } from "@/lib/learning/outcomes";

export type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

export type ClosedPosition = {
  tradeId: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  exitReason: "STOP" | "TARGET";
  qty: number;
  grossPnl: number;
  netPnl: number;
  realizedR: number;
  totalFees: number;
  realizedSlippage: number;
  equityBefore: number;
  equityAfter: number;
  openedAt?: string | null;
  closedAt?: string;
  mfePrice?: number;
  maePrice?: number;
  mfeR?: number | null;
  maeR?: number | null;
};

export interface PositionStore {
  loadOpenTrades(mode: TradingMode): Promise<TradeRow[]>;
  /** ATOMIC compare-and-set OPEN -> CLOSED. Returns false if someone already settled it. */
  closeTrade(args: {
    tradeId: string;
    exitPrice: number;
    exitReason: "STOP" | "TARGET";
    netPnl: number;
    realizedR: number;
    exitFee: number;
    totalFees: number;
    realizedSlippage: number;
    equityAfter: number;
    grossPnl: number;
    equityBefore: number;
    mfePrice: number;
    maePrice: number;
    mfeR: number | null;
    maeR: number | null;
    closedAtIso: string;
  }): Promise<boolean>;
  insertTradeEvent(tradeId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  latestEquity(mode: TradingMode): Promise<number>;
  insertPortfolioSnapshot(args: { mode: TradingMode; equity: number; takenAtIso: string }): Promise<void>;
  recordExcursions?(tradeId: string, values: { mfePrice: number; maePrice: number; mfeR: number | null; maeR: number | null }): Promise<void>;
}

export type ManageResult = { closed: ClosedPosition[]; errors: string[] };

/**
 * Automatic PAPER position management (Task A / Milestone 2).
 *
 * Runs on every scheduled job REGARDLESS of whether a new closed strategy
 * candle exists - an open position must be managed on the job's own cadence,
 * never gated on the arrival of a new 15m setup candle. The owner never has
 * to close a PAPER trade by hand.
 *
 * Settlement is idempotent by construction: the OPEN -> CLOSED transition is
 * an atomic compare-and-set, and the equity snapshot is only written by the
 * caller that actually won that transition. A repeated or overlapping scan
 * therefore cannot double-settle, double-charge fees, or double-count P/L.
 */
export async function manageOpenPositions(deps: {
  store: PositionStore;
  market: MarketDataPort;
  settings: OwnerRiskSettings;
  now?: () => number;
}): Promise<ManageResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const closed: ClosedPosition[] = [];
  const errors: string[] = [];

  const openTrades = await deps.store.loadOpenTrades("PAPER");
  if (openTrades.length === 0) return { closed, errors };

  const costModel = toCostModel(deps.settings);
  const maxDataAgeMs = deps.settings.maxMarketDataAgeSeconds * 1000;
  const candleCache = new Map<string, Awaited<ReturnType<MarketDataPort["candles"]>>>();

  for (const trade of openTrades) {
    try {
      let candles = candleCache.get(trade.symbol);
      if (!candles) {
        candles = await deps.market.candles(trade.symbol, "15M", 100);
        candleCache.set(trade.symbol, candles);
      }

      const closedCandles = candles.filter((c) => c.isClosed);
      if (closedCandles.length === 0) {
        errors.push(`${trade.symbol}: no closed candle available for position management`);
        continue;
      }

      // Freshness: acting on stale data would produce a fill we cannot stand
      // behind, so skip and report rather than settling on bad information.
      //
      // The newest CLOSED 15m candle is normally between 0 and 15 minutes
      // old, so the bound has to allow a full candle interval plus the
      // owner's tolerance on top. One extra interval of slack keeps ordinary
      // exchange/clock jitter from looking like an outage, while a genuinely
      // stalled feed (hours behind) is still caught.
      const newest = closedCandles[closedCandles.length - 1];
      const candleIntervalMs = 15 * 60_000;
      const ageSinceCloseMs = nowMs - (newest.openTime + candleIntervalMs);
      if (ageSinceCloseMs > maxDataAgeMs + 2 * candleIntervalMs) {
        errors.push(
          `${trade.symbol}: market data too stale to manage the open position safely ` +
            `(newest closed candle is ${Math.round(ageSinceCloseMs / 60_000)} minutes old)`,
        );
        continue;
      }

      const openedAtMs = trade.opened_at ? new Date(trade.opened_at).getTime() : 0;
      // Only candles that closed AFTER the position opened can exit it.
      const relevant = closedCandles.filter((c) => c.openTime >= openedAtMs);
      const prior = trade as TradeRow & { mfe_price?: number | null; mae_price?: number | null; mfe_r?: number | null; mae_r?: number | null };
      if (relevant.length > 0) {
        const rolling = calculateLongExcursions(trade.entry_price ?? 0, trade.stop_price ?? 0, relevant);
        await deps.store.recordExcursions?.(trade.id, {
          mfePrice: Math.max(rolling.mfePrice, prior.mfe_price ?? 0), maePrice: Math.max(rolling.maePrice, prior.mae_price ?? 0),
          mfeR: Math.max(rolling.mfeR ?? 0, prior.mfe_r ?? 0), maeR: Math.max(rolling.maeR ?? 0, prior.mae_r ?? 0),
        });
      }

      for (const candle of relevant) {
        const check = checkExit(
          {
            id: trade.id,
            entryPrice: trade.entry_price ?? 0,
            stopPrice: trade.stop_price ?? 0,
            targetPrice: trade.target_price ?? 0,
            qty: trade.qty ?? 0,
          },
          candle,
        );
        if (!check.shouldExit) continue;

        const qty = trade.qty ?? 0;
        const entryFee = trade.entry_fee ?? trade.fees ?? 0;
        const settlement = computeSettlement({
          entryFillPrice: trade.entry_price ?? 0,
          rawExitPrice: check.exitPrice,
          qty,
          entryFee,
          entrySlippageCost: trade.slippage ?? 0,
          costModel,
          // Modeled worst case at open is the R denominator, so a clean
          // stop-out reads about -1.0R after costs.
          riskBasis: trade.modeled_max_loss ?? trade.risk_amount ?? 0,
        });

        const equityBefore = await deps.store.latestEquity("PAPER");
        const equityAfter = equityBefore + settlement.netPnl;
        const closedAtIso = new Date(candle.openTime + candleIntervalMs).toISOString();
        const current = calculateLongExcursions(trade.entry_price ?? 0, trade.stop_price ?? 0, relevant.filter((bar) => bar.openTime <= candle.openTime));
        const excursions = {
          mfePrice: Math.max(current.mfePrice, prior.mfe_price ?? 0), maePrice: Math.max(current.maePrice, prior.mae_price ?? 0),
          mfeR: Math.max(current.mfeR ?? 0, prior.mfe_r ?? 0), maeR: Math.max(current.maeR ?? 0, prior.mae_r ?? 0),
        };

        const won = await deps.store.closeTrade({
          tradeId: trade.id,
          exitPrice: settlement.exitFillPrice,
          exitReason: check.outcome,
          netPnl: settlement.netPnl,
          realizedR: settlement.realizedR,
          exitFee: settlement.exitFee,
          totalFees: settlement.totalFees,
          realizedSlippage: settlement.realizedSlippage,
          equityAfter,
          closedAtIso,
          grossPnl: settlement.grossPnl,
          equityBefore,
          ...excursions,
        });

        // Someone else already settled this position. Do NOT write an equity
        // snapshot or an event - that is what would double-count the result.
        if (!won) break;

        await deps.store.insertTradeEvent(
          trade.id,
          check.outcome === "STOP" ? "STOP_HIT" : "TARGET_HIT",
          {
            exitPrice: settlement.exitFillPrice,
            netPnl: settlement.netPnl,
            realizedR: settlement.realizedR,
            exitFee: settlement.exitFee,
          },
        );

        await deps.store.insertPortfolioSnapshot({
          mode: "PAPER",
          equity: equityAfter,
          takenAtIso: new Date(nowMs).toISOString(),
        });

        closed.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          entryPrice: trade.entry_price ?? 0,
          exitPrice: settlement.exitFillPrice,
          exitReason: check.outcome,
          qty,
          grossPnl: settlement.grossPnl,
          netPnl: settlement.netPnl,
          realizedR: settlement.realizedR,
          totalFees: settlement.totalFees,
          realizedSlippage: settlement.realizedSlippage,
          equityBefore,
          equityAfter,
          openedAt: trade.opened_at,
          closedAt: closedAtIso,
          ...excursions,
        });

        break; // one exit per position per run
      }
    } catch (err) {
      errors.push(`${trade.symbol}: ${(err as Error).message}`);
    }
  }

  return { closed, errors };
}
