import type { ExcursionMetrics, OutcomeCandle } from "./types";

/**
 * Calculates long-position MFE/MAE using only closed bars supplied by the
 * caller. The entry bar may be included only when its whole interval occurred
 * after the fill; callers must not backfill an in-progress bar. Values are
 * measured from the actual filled entry, before fees/slippage for price
 * excursions, and in R using entry - stop as one planned-risk unit.
 */
export function calculateLongExcursions(
  entryPrice: number,
  stopPrice: number,
  candles: OutcomeCandle[],
): ExcursionMetrics {
  const closed = candles.filter((c) => c.isClosed);
  const highest = closed.reduce((max, c) => Math.max(max, c.high), entryPrice);
  const lowest = closed.reduce((min, c) => Math.min(min, c.low), entryPrice);
  const mfePrice = Math.max(0, highest - entryPrice);
  const maePrice = Math.max(0, entryPrice - lowest);
  const riskUnit = entryPrice - stopPrice;

  return {
    mfePrice,
    maePrice,
    mfePct: entryPrice > 0 ? mfePrice / entryPrice : 0,
    maePct: entryPrice > 0 ? maePrice / entryPrice : 0,
    mfeR: riskUnit > 0 ? mfePrice / riskUnit : null,
    maeR: riskUnit > 0 ? maePrice / riskUnit : null,
  };
}

export type FactualTradeReview = {
  label: "FACT";
  plannedR: number | null;
  realizedR: number | null;
  grossPnl: number;
  netPnl: number;
  fees: number;
  slippage: number;
  durationMinutes: number | null;
  approvalDelayMinutes: number | null;
  entryDriftPct: number | null;
  exitReason: string;
  excursions: ExcursionMetrics;
};

export function createFactualTradeReview(input: {
  plannedEntry: number | null;
  actualEntry: number;
  stopPrice: number;
  targetPrice: number;
  actualExit: number;
  qty: number;
  fees: number;
  slippage: number;
  openedAt: number | null;
  closedAt: number | null;
  approvedAt: number | null;
  exitReason: string;
  excursions: ExcursionMetrics;
}): FactualTradeReview {
  const grossPnl = (input.actualExit - input.actualEntry) * input.qty;
  const netPnl = grossPnl - input.fees;
  const riskPerUnit = input.actualEntry - input.stopPrice;
  const riskAmount = riskPerUnit > 0 ? riskPerUnit * input.qty : 0;
  const plannedR = riskPerUnit > 0 ? (input.targetPrice - input.actualEntry) / riskPerUnit : null;
  return {
    label: "FACT",
    plannedR,
    realizedR: riskAmount > 0 ? netPnl / riskAmount : null,
    grossPnl,
    netPnl,
    fees: input.fees,
    slippage: input.slippage,
    durationMinutes:
      input.openedAt !== null && input.closedAt !== null
        ? Math.max(0, (input.closedAt - input.openedAt) / 60_000)
        : null,
    approvalDelayMinutes:
      input.approvedAt !== null && input.openedAt !== null
        ? Math.max(0, (input.openedAt - input.approvedAt) / 60_000)
        : null,
    entryDriftPct:
      input.plannedEntry && input.plannedEntry > 0
        ? (input.actualEntry - input.plannedEntry) / input.plannedEntry
        : null,
    exitReason: input.exitReason,
    excursions: input.excursions,
  };
}
