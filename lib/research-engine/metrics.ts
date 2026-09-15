import type { EquityCurvePoint, ResearchTradeRecord } from "./engine";

/**
 * Research metrics (Checkpoint 3A §17). Computed ONLY from CLOSED trades —
 * an OPEN_AT_END position is unrealized and must never be counted as a
 * win, a loss, or contribute to any R statistic (it has no pnl/rMultiple
 * to count). `openPositionsAtEnd` reports how many there were, separately.
 *
 * Win rate is deliberately not the primary ranking signal anywhere this
 * type is consumed (CLAUDE.md / Checkpoint 3A §17) - it's reported because
 * it's informative, not because it should drive comparisons.
 */
export type ResearchMetrics = {
  tradeCount: number; // CLOSED trades only
  openPositionsAtEnd: number;
  wins: number;
  losses: number;
  winRate: number | null;

  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  medianR: number | null;

  profitFactor: number | null;

  grossReturn: number; // sum of pnl before costs are separated out (pnl already includes costs - see totalCosts for the cost component alone)
  netReturn: number; // finalEquity - initialEquity

  maxDrawdownPct: number; // on the realized equity curve
  maxDrawdownR: number | null; // on the cumulative-R curve, in chronological trade order

  maxLosingStreak: number;

  finalEquity: number;

  averageHoldingBars: number | null;
  medianHoldingBars: number | null;

  totalCosts: number; // sum of all fee + slippage cost across every trade (closed and open-at-end's entry side)
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function maxDrawdownFromCurve(values: readonly number[]): number {
  let peak = values.length > 0 ? values[0] : 0;
  let maxDrawdown = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    // Guard against peak <= 0 (degenerate normalized equity, shouldn't
    // happen with a sane initialEquity, but never divide by zero).
    const drawdown = peak > 0 ? (peak - v) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

export function computeResearchMetrics(
  trades: readonly ResearchTradeRecord[],
  initialEquity: number,
  equityCurve: readonly EquityCurvePoint[],
): ResearchMetrics {
  const closed = trades.filter((t) => t.outcome === "CLOSED");
  const openAtEnd = trades.length - closed.length;

  const rValues = closed.map((t) => t.rMultiple!);
  const wins = closed.filter((t) => t.pnl! > 0);
  const losses = closed.filter((t) => t.pnl! <= 0);

  const winRs = wins.map((t) => t.rMultiple!);
  const lossRs = losses.map((t) => t.rMultiple!);

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl!, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl!, 0));

  const holdingBars = closed.map((t) => t.holdingBars!);

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialEquity;
  const netReturn = finalEquity - initialEquity;
  const grossReturn = closed.reduce((sum, t) => sum + t.pnl!, 0);

  const totalCosts = trades.reduce(
    (sum, t) => sum + t.entryFee + t.entrySlippageCost + t.exitFee + t.exitSlippageCost,
    0,
  );

  // Max losing streak: longest consecutive run of CLOSED trades (in
  // chronological/array order — engine always pushes trades in the order
  // they were realized) with pnl <= 0.
  let maxLosingStreak = 0;
  let currentStreak = 0;
  for (const t of closed) {
    if (t.pnl! <= 0) {
      currentStreak++;
      maxLosingStreak = Math.max(maxLosingStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  // Cumulative-R drawdown: starts at 0, adds each closed trade's R in
  // chronological order.
  let cumulativeR = 0;
  const cumulativeRCurve: number[] = [0];
  for (const t of closed) {
    cumulativeR += t.rMultiple!;
    cumulativeRCurve.push(cumulativeR);
  }
  const maxDrawdownR = closed.length > 0 ? maxDrawdownFromRCurve(cumulativeRCurve) : null;

  return {
    tradeCount: closed.length,
    openPositionsAtEnd: openAtEnd,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? wins.length / closed.length : null,

    avgWinR: mean(winRs),
    avgLossR: mean(lossRs),
    expectancyR: mean(rValues),
    medianR: median(rValues),

    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,

    grossReturn,
    netReturn,

    maxDrawdownPct: maxDrawdownFromCurve(equityCurve.map((p) => p.equity)),
    maxDrawdownR,

    maxLosingStreak,

    finalEquity,

    averageHoldingBars: mean(holdingBars),
    medianHoldingBars: median(holdingBars),

    totalCosts,
  };
}

/** Peak-to-trough drawdown on a cumulative-R curve (not a percentage — an absolute R distance from peak). */
function maxDrawdownFromRCurve(cumulativeRCurve: readonly number[]): number {
  let peak = cumulativeRCurve[0];
  let maxDrawdown = 0;
  for (const v of cumulativeRCurve) {
    peak = Math.max(peak, v);
    maxDrawdown = Math.max(maxDrawdown, peak - v);
  }
  return maxDrawdown;
}
