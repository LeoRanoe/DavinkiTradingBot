/**
 * Checkpoint 3B.0 §13/§14/§15: reporting/comparison shape, locked before
 * any real result exists. These are pure functions over caller-supplied
 * summary numbers (computed from real results LATER, once Bybit access
 * is available) - this module itself never touches market data.
 */

/** §13: comparison priority, most to least important. Trade count/frequency is explicitly NOT a ranking driver - only a sample-adequacy signal (see profitability-rules.ts). */
export type ConfigurationComparisonSummary = {
  configId: string;
  oosNetExpectancyR: number; // (1) primary
  oosProfitFactor: number; // (2)
  /** (3) "cost survival": true if combined OOS expectancy stays > 0 at COST_STRESS. */
  survivesCostStress: boolean;
  maxDrawdownPct: number; // (4) lower is better
  /**
   * (5) temporal stability - the absolute difference between the
   * validation-split and holdout-split expectancyR. Smaller is more
   * stable (the edge didn't merely exist in one split). Documented,
   * explicit choice - not claimed to be the only valid definition.
   */
  temporalInstability: number;
  oosClosedTradeCount: number; // (6) sample adequacy only, never a ranking driver on its own
};

/**
 * §13's priority order as a comparator: net expectancy desc, then profit
 * factor desc, then cost-survival (true first), then drawdown asc, then
 * temporal instability asc (more stable first). Trade count/win rate are
 * deliberately absent from every comparison key.
 */
export function compareConfigurations(a: ConfigurationComparisonSummary, b: ConfigurationComparisonSummary): number {
  if (a.oosNetExpectancyR !== b.oosNetExpectancyR) return b.oosNetExpectancyR - a.oosNetExpectancyR;
  if (a.oosProfitFactor !== b.oosProfitFactor) return b.oosProfitFactor - a.oosProfitFactor;
  if (a.survivesCostStress !== b.survivesCostStress) return a.survivesCostStress ? -1 : 1;
  if (a.maxDrawdownPct !== b.maxDrawdownPct) return a.maxDrawdownPct - b.maxDrawdownPct;
  if (a.temporalInstability !== b.temporalInstability) return a.temporalInstability - b.temporalInstability;
  return 0;
}

export function rankConfigurations(
  summaries: readonly ConfigurationComparisonSummary[],
): ConfigurationComparisonSummary[] {
  return [...summaries].sort(compareConfigurations);
}

/** §14: outlier/concentration reporting - exposed, never used to auto-reject a trend strategy for having a few large winners. */
export type TradeRLike = { rMultiple: number | null; outcome: "CLOSED" | "OPEN_AT_END" };

export type OutlierConcentrationReport = {
  largestWinningTradeR: number | null;
  largestLosingTradeR: number | null;
  top1WinContributionPct: number | null; // top-1 winning trade's R / total positive R, as a fraction [0,1]
  top3WinContributionPct: number | null; // sum of top-3 winning trades' R / total positive R
};

export function computeOutlierConcentration(trades: readonly TradeRLike[]): OutlierConcentrationReport {
  const closedR = trades.filter((t) => t.outcome === "CLOSED" && t.rMultiple !== null).map((t) => t.rMultiple as number);
  const wins = closedR.filter((r) => r > 0).sort((a, b) => b - a);
  const losses = closedR.filter((r) => r <= 0).sort((a, b) => a - b);

  const totalPositiveR = wins.reduce((sum, r) => sum + r, 0);
  const top1 = wins.slice(0, 1).reduce((sum, r) => sum + r, 0);
  const top3 = wins.slice(0, 3).reduce((sum, r) => sum + r, 0);

  return {
    largestWinningTradeR: wins.length > 0 ? wins[0] : null,
    largestLosingTradeR: losses.length > 0 ? losses[0] : null,
    top1WinContributionPct: totalPositiveR > 0 ? top1 / totalPositiveR : null,
    top3WinContributionPct: totalPositiveR > 0 ? top3 / totalPositiveR : null,
  };
}

/** §15: parameter-family evidence, aggregated across all five instruments for one parameter set - losing instruments are never hidden from this aggregate. */
export type InstrumentOosResult = { instrumentId: string; oosBaselineExpectancyR: number | null; oosBaselineProfitFactor: number | null };

export type ParameterFamilyEvidence = {
  parameterSetId: string;
  instrumentsWithPositiveOosExpectancy: number; // out of the full study universe, losers included in the denominator
  totalInstrumentsEvaluated: number;
  medianOosExpectancyR: number | null;
  medianOosProfitFactor: number | null;
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeParameterFamilyEvidence(
  parameterSetId: string,
  results: readonly InstrumentOosResult[],
): ParameterFamilyEvidence {
  const expectancies = results.map((r) => r.oosBaselineExpectancyR).filter((v): v is number => v !== null);
  const profitFactors = results.map((r) => r.oosBaselineProfitFactor).filter((v): v is number => v !== null);
  return {
    parameterSetId,
    instrumentsWithPositiveOosExpectancy: results.filter((r) => r.oosBaselineExpectancyR !== null && r.oosBaselineExpectancyR > 0).length,
    totalInstrumentsEvaluated: results.length,
    medianOosExpectancyR: median(expectancies),
    medianOosProfitFactor: median(profitFactors),
  };
}
