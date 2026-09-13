import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Candle } from "@/lib/bybit/types";
import { checkExit, computeFee, simulateExitFill } from "./paper";
import { calculateLongExcursions, createFactualTradeReview } from "@/lib/learning/outcomes";
import { persistFactualTradeReview, queueAiPostTradeReview } from "@/lib/learning/persistence";

const EXIT_SLIPPAGE_BPS = 5;
const EXIT_FEE_BPS = 10;

/**
 * Checks every OPEN paper trade for a symbol against newly closed candles
 * and closes any that have hit their stop or target, using the same
 * conservative same-candle rule as the backtester (stop wins on a tie).
 * Writes a portfolio_snapshot after each close so equity stays current for
 * the next risk-engine evaluation.
 */
export async function checkAndCloseOpenTrades(
  admin: SupabaseClient<Database>,
  symbol: string,
  candles: Candle[],
): Promise<number> {
  const { data: openTrades } = await admin
    .from("trades")
    .select("*")
    .eq("symbol", symbol)
    .eq("trading_mode", "PAPER")
    .eq("status", "OPEN");

  if (!openTrades || openTrades.length === 0) return 0;

  let closedCount = 0;

  for (const trade of openTrades) {
    const openedAtMs = trade.opened_at ? new Date(trade.opened_at).getTime() : 0;
    const relevantCandles = candles.filter((c) => c.openTime >= openedAtMs && c.isClosed);
    const stored = trade as typeof trade & { mfe_price?: number | null; mae_price?: number | null; mfe_r?: number | null; mae_r?: number | null };
    if (relevantCandles.length) {
      // Persist excursions while the trade remains open so a later bounded
      // market-data fetch cannot lose an earlier favourable/adverse move.
      const rolling = calculateLongExcursions(trade.entry_price ?? 0, trade.stop_price ?? 0, relevantCandles);
      await admin.from("trades").update({
        mfe_price: Math.max(rolling.mfePrice, stored.mfe_price ?? 0),
        mae_price: Math.max(rolling.maePrice, stored.mae_price ?? 0),
        mfe_r: Math.max(rolling.mfeR ?? 0, stored.mfe_r ?? 0),
        mae_r: Math.max(rolling.maeR ?? 0, stored.mae_r ?? 0),
      } as never).eq("id", trade.id).eq("status", "OPEN");
    }

    for (const candle of relevantCandles) {
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

      const exitPrice = simulateExitFill(check.exitPrice, EXIT_SLIPPAGE_BPS);
      const qty = trade.qty ?? 0;
      const exitFee = computeFee(qty * exitPrice, EXIT_FEE_BPS);
      const grossPnl = (exitPrice - (trade.entry_price ?? 0)) * qty;
      const pnl = grossPnl - exitFee; // entry fee already recorded at open
      const riskAmount = trade.risk_amount ?? 0;
      const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

      const { data: lastSnapshot } = await admin
        .from("portfolio_snapshots")
        .select("equity")
        .eq("trading_mode", "PAPER")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const priorEquity = lastSnapshot?.equity ?? 10;
      const newEquity = priorEquity + pnl;
      // Do not use any bar that began before the actual fill. The rolling
      // values retain prior observations if an open trade spans fetch windows.
      const currentExcursions = calculateLongExcursions(
        trade.entry_price ?? 0,
        trade.stop_price ?? 0,
        relevantCandles.filter((bar) => bar.openTime <= candle.openTime),
      );
      const excursions = {
        ...currentExcursions,
        mfePrice: Math.max(currentExcursions.mfePrice, stored.mfe_price ?? 0),
        maePrice: Math.max(currentExcursions.maePrice, stored.mae_price ?? 0),
        mfeR: Math.max(currentExcursions.mfeR ?? 0, stored.mfe_r ?? 0),
        maeR: Math.max(currentExcursions.maeR ?? 0, stored.mae_r ?? 0),
      };
      const { data: signal } = trade.signal_id
        ? await admin.from("signals").select("entry_price, approved_at").eq("id", trade.signal_id).maybeSingle()
        : { data: null };
      const factualReview = createFactualTradeReview({
        plannedEntry: signal?.entry_price ?? null, actualEntry: trade.entry_price ?? 0, stopPrice: trade.stop_price ?? 0,
        targetPrice: trade.target_price ?? 0, actualExit: exitPrice, qty, fees: (trade.fees ?? 0) + exitFee,
        slippage: trade.slippage ?? 0, openedAt: openedAtMs || null, closedAt: candle.openTime,
        approvedAt: signal?.approved_at ? new Date(signal.approved_at).getTime() : null, exitReason: check.outcome, excursions,
      });

      await admin
        .from("trades")
        .update({
          status: "CLOSED", exit_price: exitPrice, pnl, r_multiple: rMultiple,
          fees: (trade.fees ?? 0) + exitFee, closed_at: new Date(candle.openTime).toISOString(),
          gross_pnl: factualReview.grossPnl, exit_reason: check.outcome,
          equity_before: priorEquity, equity_after: newEquity,
          mfe_price: excursions.mfePrice, mae_price: excursions.maePrice, mfe_r: excursions.mfeR, mae_r: excursions.maeR,
        } as never)
        .eq("id", trade.id);

      await admin.from("trade_events").insert({
        trade_id: trade.id,
        event_type: check.outcome === "STOP" ? "STOP_HIT" : "TARGET_HIT",
        payload: { exitPrice, pnl, rMultiple, excursions },
      });

      await admin.from("portfolio_snapshots").insert({
        trading_mode: "PAPER",
        equity: newEquity,
        balance: newEquity,
        open_risk: 0,
        taken_at: new Date().toISOString(),
      });

      // Facts settle first. A Qwen timeout/malformed reply has no impact on
      // the trade, equity, analytics, or ability to review it later.
      await persistFactualTradeReview(admin, trade.id, factualReview);
      void queueAiPostTradeReview(admin, trade.id, {
        symbol: trade.symbol, entryPrice: trade.entry_price ?? 0, exitPrice,
        stopPrice: trade.stop_price ?? 0, targetPrice: trade.target_price ?? 0,
        pnl, rMultiple, outcome: check.outcome, factualReview,
      });

      closedCount += 1;
      break; // one exit per trade per scan
    }
  }

  return closedCount;
}
