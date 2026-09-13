import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Candle } from "@/lib/bybit/types";
import { checkExit, computeFee, simulateExitFill } from "./paper";

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

      await admin
        .from("trades")
        .update({
          status: "CLOSED",
          exit_price: exitPrice,
          pnl,
          r_multiple: rMultiple,
          fees: (trade.fees ?? 0) + exitFee,
          closed_at: new Date(candle.openTime).toISOString(),
        })
        .eq("id", trade.id);

      await admin.from("trade_events").insert({
        trade_id: trade.id,
        event_type: check.outcome === "STOP" ? "STOP_HIT" : "TARGET_HIT",
        payload: { exitPrice, pnl, rMultiple },
      });

      const { data: lastSnapshot } = await admin
        .from("portfolio_snapshots")
        .select("equity")
        .eq("trading_mode", "PAPER")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const priorEquity = lastSnapshot?.equity ?? 10;
      const newEquity = priorEquity + pnl;

      await admin.from("portfolio_snapshots").insert({
        trading_mode: "PAPER",
        equity: newEquity,
        balance: newEquity,
        open_risk: 0,
        taken_at: new Date().toISOString(),
      });

      closedCount += 1;
      break; // one exit per trade per scan
    }
  }

  return closedCount;
}
