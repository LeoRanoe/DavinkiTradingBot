import { computeMetrics, type TradeOutcomeFields } from "@/lib/backtest/metrics";
import type { BacktestMetrics } from "@/lib/backtest/types";
import type { JeanfxGoldPaperTradeRow } from "./db";

/**
 * JeanFX Gold performance view (brief S12): "Show JeanFX Gold separately
 * ... Do not mix with V1 crypto / TRB / custom strategies." Reuses
 * lib/backtest/metrics.ts's computeMetrics UNCHANGED (already generic via
 * TradeOutcomeFields, see that file's own comment) rather than
 * reimplementing expectancyR/profitFactor/drawdown math a second time -
 * the isolation the brief wants is achieved by never mixing trade ROWS
 * across strategies, not by duplicating the metrics function itself.
 */
export type JeanfxGoldPerformance = {
  openTrades: JeanfxGoldPaperTradeRow[];
  closedTrades: JeanfxGoldPaperTradeRow[];
  metrics: BacktestMetrics;
};

export function computeJeanfxGoldPerformance(trades: JeanfxGoldPaperTradeRow[], initialEquity: number): JeanfxGoldPerformance {
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const closedTrades = trades.filter((t) => t.status === "CLOSED");

  const outcomeFields: TradeOutcomeFields[] = closedTrades.map((t) => ({ pnl: t.pnl, rMultiple: t.r_multiple, fees: t.fees }));
  const totalFees = closedTrades.reduce((sum, t) => sum + t.fees, 0);

  return { openTrades, closedTrades, metrics: computeMetrics(outcomeFields, initialEquity, totalFees) };
}
