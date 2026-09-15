import type { EquityCurvePoint, ResearchTradeRecord } from "./engine";

/**
 * Research metrics (Checkpoint 3A §17, hardened Checkpoint 3A.1 §7/§8).
 * Computed ONLY from CLOSED trades — an OPEN_AT_END position is
 * unrealized and must never be counted as a win, a loss, or contribute
 * to any R statistic (it has no pnl/rMultiple to count).
 * `openPositionsAtEnd` reports how many there were; `openPositionEntryCosts`
 * reports the entry-side cost they already paid, kept OUT of every
 * return/cost figure below (§8, Convention A — see the field's own doc).
 *
 * Win rate is deliberately not the primary ranking signal anywhere this
 * type is consumed (CLAUDE.md / Checkpoint 3A §17) - it's reported because
 * it's informative, not because it should drive comparisons.
 *
 * §7 gross vs net: `grossReturn` is computed from `rawGrossPnl` per trade
 * (raw execution prices, NO modeled costs) — never from `pnl`, which
 * already has fees/slippage baked in and would silently mislabel a net
 * figure as gross. `totalCosts` is CLOSED-trades-only, so
 * `grossReturn - totalCosts` reconciles to `netReturn` within float
 * tolerance (see the reconciliation test in __tests__/metrics.test.ts).
 *
 * §8 OPEN_AT_END accounting — Convention A (chosen, documented, the only
 * one this module implements): a position still open at the end of a run
 * is excluded ENTIRELY from `grossReturn`/`netReturn`/`totalCosts` — it
 * is unrealized, so it has no gross/net PnL to report. Its entry-side
 * cost (which WAS actually paid) is reported separately, once, as
 * `openPositionEntryCosts` — never silently folded into `totalCosts`
 * (which would break the gross/net/cost reconciliation above) and never
 * silently dropped (which would understate what was actually spent).
 * There is no synthetic final exit / mark-to-market anywhere in this
 * module.
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

  /** Sum of CLOSED trades' rawGrossPnl (raw execution prices, no modeled costs). */
  grossReturn: number;
  /** finalEquity - initialEquity == sum of CLOSED trades' net pnl (equity only ever moves on a CLOSED trade). */
  netReturn: number;

  maxDrawdownPct: number; // on the realized equity curve
  maxDrawdownR: number | null; // on the cumulative-R curve, in chronological trade order

  maxLosingStreak: number;

  finalEquity: number;

  averageHoldingBars: number | null;
  medianHoldingBars: number | null;

  /** Sum of fee + slippage cost across CLOSED trades only (§8 Convention A) - reconciles with grossReturn/netReturn. */
  totalCosts: number;
  /** Entry-side fee + slippage already paid by any still-OPEN_AT_END position, reported separately, never inside totalCosts/grossReturn/netReturn. */
  openPositionEntryCosts: number;
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
  const openAtEnd = trades.filter((t) => t.outcome === "OPEN_AT_END");

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
  // §7: gross is the RAW execution PnL, before any modeled cost - never
  // `pnl` (which is already net of fees/slippage).
  const grossReturn = closed.reduce((sum, t) => sum + t.grossPnl!, 0);

  // §8 Convention A: only CLOSED trades' costs count toward totalCosts,
  // so it reconciles with grossReturn/netReturn (both closed-only too).
  const totalCosts = closed.reduce(
    (sum, t) => sum + t.entryFee + t.entrySlippageCost + t.exitFee + t.exitSlippageCost,
    0,
  );
  const openPositionEntryCosts = openAtEnd.reduce((sum, t) => sum + t.entryFee + t.entrySlippageCost, 0);

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
    openPositionsAtEnd: openAtEnd.length,
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
    openPositionEntryCosts,
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
