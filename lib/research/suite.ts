import type { Candle } from "@/lib/bybit/types";
import { calculatePerformance, type PerformanceMetrics } from "@/lib/learning/analytics";
import { splitChronologically, walkForwardWindows } from "@/lib/learning/experiments";
import type { LearningTrade } from "@/lib/learning/types";
import {
  authoritative,
  runResearchHarness,
  shadow,
  V1_STOP_TARGET,
  type HarnessConfig,
  type ResearchTrade,
  type StopTargetVariant,
} from "./harness";

/**
 * The hostile-testing suite.
 *
 * Its job is to try to DISPROVE Strategy V1, not to find a configuration that
 * looks good. Every function here is built around that: baselines are run
 * unchanged before anything is varied, out-of-sample results are kept
 * separate from in-sample ones, and the parameter sweep reports the stability
 * of a region rather than the value of its best point.
 */

/** Converts harness output into the shared analytics shape. */
export function toLearningTrades(trades: ResearchTrade[]): LearningTrade[] {
  return trades.map((t) => ({
    id: `${t.symbol}-${t.signalTime}-${t.track}`,
    actual: false, // historical simulation is never an actual PAPER outcome
    symbol: t.symbol,
    strategyVersion: "v1",
    score: t.score,
    regime: t.regime,
    newsRisk: "UNKNOWN",
    volatility: t.atrPct,
    plannedRiskReward: null,
    openedAt: t.entryTime,
    closedAt: t.exitTime,
    pnl: t.pnl,
    grossPnl: t.grossPnl,
    fees: t.fees,
    slippage: t.slippage,
    rMultiple: t.rMultiple,
    excursions: {
      mfePrice: t.mfePrice,
      maePrice: t.maePrice,
      mfePct: t.entryPrice > 0 ? t.mfePrice / t.entryPrice : 0,
      maePct: t.entryPrice > 0 ? t.maePrice / t.entryPrice : 0,
      mfeR: t.mfeR,
      maeR: t.maeR,
    },
  }));
}

export function metricsFor(trades: ResearchTrade[]): PerformanceMetrics {
  return calculatePerformance(toLearningTrades(trades));
}

export type MarketHistory = {
  symbol: string;
  candles1h: Candle[];
  candles15m: Candle[];
};

// ---------------------------------------------------------------------------
// F. Baseline: exact, unchanged V1
// ---------------------------------------------------------------------------

export type BaselineResult = {
  perSymbol: Record<string, { metrics: PerformanceMetrics; trades: number; skips: Record<string, number> }>;
  combined: PerformanceMetrics;
  allTrades: ResearchTrade[];
  shadowTrades: ResearchTrade[];
  bandCounts: Record<string, number>;
  skipReasons: Record<string, number>;
};

/**
 * Runs the exact current Strategy V1 over history, with NO tuning. This is
 * deliberately the first thing that happens: every later comparison is
 * meaningless without an untouched reference point.
 */
export function runBaseline(
  histories: readonly MarketHistory[],
  config: Omit<HarnessConfig, "symbol">,
): BaselineResult {
  const perSymbol: BaselineResult["perSymbol"] = {};
  const allTrades: ResearchTrade[] = [];
  const shadowTrades: ResearchTrade[] = [];
  const bandCounts: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};

  for (const history of histories) {
    const result = runResearchHarness(
      { ...config, symbol: history.symbol, stopTarget: V1_STOP_TARGET },
      history.candles1h,
      history.candles15m,
    );

    const auth = authoritative(result.trades);
    const shad = shadow(result.trades);
    allTrades.push(...auth);
    shadowTrades.push(...shad);

    const symbolSkips: Record<string, number> = {};
    for (const skip of result.skips) {
      symbolSkips[skip.reason] = (symbolSkips[skip.reason] ?? 0) + 1;
      skipReasons[skip.reason] = (skipReasons[skip.reason] ?? 0) + 1;
    }
    for (const [band, n] of Object.entries(result.bandCounts)) {
      bandCounts[band] = (bandCounts[band] ?? 0) + n;
    }

    perSymbol[history.symbol] = {
      metrics: metricsFor(auth),
      trades: auth.length,
      skips: symbolSkips,
    };
  }

  return {
    perSymbol,
    combined: metricsFor(allTrades),
    allTrades,
    shadowTrades,
    bandCounts,
    skipReasons,
  };
}

// ---------------------------------------------------------------------------
// G. Chronological splits
// ---------------------------------------------------------------------------

export type SplitResult = {
  development: PerformanceMetrics;
  validation: PerformanceMetrics;
  holdout: PerformanceMetrics;
  counts: { development: number; validation: number; holdout: number };
  boundaries: { developmentEnd: number | null; validationEnd: number | null };
};

/**
 * Splits trades chronologically. Never shuffled: these are time series, and a
 * random split would leak the future into the past and make out-of-sample
 * results fictional.
 */
export function runSplits(trades: ResearchTrade[], developmentRatio = 0.6, validationRatio = 0.2): SplitResult {
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const split = splitChronologically(ordered, developmentRatio, validationRatio);

  return {
    development: metricsFor(split.development),
    validation: metricsFor(split.validation),
    holdout: metricsFor(split.holdout),
    counts: {
      development: split.development.length,
      validation: split.validation.length,
      holdout: split.holdout.length,
    },
    boundaries: {
      developmentEnd: split.development.at(-1)?.entryTime ?? null,
      validationEnd: split.validation.at(-1)?.entryTime ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// H. Walk-forward
// ---------------------------------------------------------------------------

export type WalkForwardResult = {
  windows: number;
  /** Aggregated over UNSEEN periods only - the only honest robustness read. */
  unseen: PerformanceMetrics;
  perWindow: Array<{ index: number; development: number; validation: PerformanceMetrics }>;
};

/**
 * Rolls a development window forward and evaluates only the next unseen
 * period each time. Aggregating the development periods too would be
 * self-congratulatory: those are the periods the parameters already saw.
 */
export function runWalkForward(
  trades: ResearchTrade[],
  developmentSize: number,
  validationSize: number,
): WalkForwardResult {
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const windows = walkForwardWindows(ordered, developmentSize, validationSize);

  const unseenTrades: ResearchTrade[] = [];
  const perWindow = windows.map((w, index) => {
    unseenTrades.push(...w.validation);
    return {
      index,
      development: w.development.length,
      validation: metricsFor(w.validation),
    };
  });

  return { windows: windows.length, unseen: metricsFor(unseenTrades), perWindow };
}

// ---------------------------------------------------------------------------
// I. Parameter robustness
// ---------------------------------------------------------------------------

export type ParameterVariant = {
  label: string;
  parameter: string;
  value: number;
  overrides: Partial<HarnessConfig>;
};

export type VariantOutcome = {
  label: string;
  parameter: string;
  value: number;
  metrics: PerformanceMetrics;
  trades: number;
};

export type RobustnessResult = {
  outcomes: VariantOutcome[];
  /** Per parameter: is the neighbourhood stable, or is one point an outlier? */
  stability: Record<string, ParameterStability>;
};

export type ParameterStability = {
  parameter: string;
  values: number[];
  expectancies: Array<number | null>;
  /** How many settings in the swept range stayed profitable after costs. */
  profitableSettings: number;
  totalSettings: number;
  /** True only when EVERY swept setting held up. */
  stableAcrossRange: boolean;
  /** Set when one setting dwarfs its neighbours - a jackpot, not an edge. */
  suspectedOutlier: boolean;
  note: string;
};

/**
 * Sweeps a SMALL number of sensible nearby settings. Deliberately not a
 * brute-force grid: the goal is to find out whether the edge lives in a broad
 * stable region, and a thousand-combination search would mostly measure how
 * many chances it had to get lucky.
 */
export function runRobustness(
  histories: readonly MarketHistory[],
  base: Omit<HarnessConfig, "symbol">,
  variants: readonly ParameterVariant[],
): RobustnessResult {
  const outcomes: VariantOutcome[] = [];

  for (const variant of variants) {
    const trades: ResearchTrade[] = [];
    for (const history of histories) {
      const result = runResearchHarness(
        { ...base, ...variant.overrides, symbol: history.symbol },
        history.candles1h,
        history.candles15m,
      );
      trades.push(...authoritative(result.trades));
    }
    outcomes.push({
      label: variant.label,
      parameter: variant.parameter,
      value: variant.value,
      metrics: metricsFor(trades),
      trades: trades.length,
    });
  }

  const stability: Record<string, ParameterStability> = {};
  for (const parameter of [...new Set(variants.map((v) => v.parameter))]) {
    stability[parameter] = assessStability(
      parameter,
      outcomes.filter((o) => o.parameter === parameter),
    );
  }

  return { outcomes, stability };
}

/**
 * Judges a swept parameter by the shape of its neighbourhood.
 *
 * A single spectacular setting surrounded by poor ones is the classic
 * signature of curve-fitting, so it is called out as a suspected outlier
 * rather than celebrated as the best value.
 */
export function assessStability(parameter: string, outcomes: VariantOutcome[]): ParameterStability {
  const sorted = [...outcomes].sort((a, b) => a.value - b.value);
  const expectancies = sorted.map((o) => o.metrics.expectancyR);
  const usable = expectancies.filter((e): e is number => e !== null);
  const profitable = usable.filter((e) => e > 0).length;

  let suspectedOutlier = false;
  if (usable.length >= 3) {
    const best = Math.max(...usable);
    const others = usable.filter((e) => e !== best);
    const othersMean = others.reduce((a, b) => a + b, 0) / others.length;
    // One setting more than three times its neighbours' average, while those
    // neighbours are not themselves convincing.
    suspectedOutlier = best > 0 && othersMean <= 0 && best > Math.abs(othersMean) * 3;
  }

  const stableAcrossRange = usable.length === sorted.length && usable.length > 0 && profitable === usable.length;

  return {
    parameter,
    values: sorted.map((o) => o.value),
    expectancies,
    profitableSettings: profitable,
    totalSettings: sorted.length,
    stableAcrossRange,
    suspectedOutlier,
    note: suspectedOutlier
      ? "One setting sharply outperforms its neighbours while the rest do not hold up. That is the signature of curve-fitting, not of an edge."
      : stableAcrossRange
        ? "Every setting in the swept range stayed profitable after costs - a broad stable region rather than an isolated point."
        : usable.length === 0
          ? "Not enough resolved trades to say anything about this parameter."
          : `${profitable} of ${sorted.length} settings stayed profitable after costs.`,
  };
}

// ---------------------------------------------------------------------------
// J / K. Cost and entry-delay stress
// ---------------------------------------------------------------------------

export type StressScenario = {
  label: string;
  overrides: Partial<HarnessConfig>;
  description: string;
};

export type StressOutcome = {
  label: string;
  description: string;
  metrics: PerformanceMetrics;
  trades: number;
  /** Expectancy change against the base scenario. Negative means it degraded. */
  expectancyDeltaR: number | null;
  survives: boolean;
};

export type StressResult = {
  base: PerformanceMetrics;
  outcomes: StressOutcome[];
  /** True only when the edge stayed positive under EVERY hostile scenario. */
  survivesAll: boolean;
};

export const COST_STRESS_SCENARIOS: readonly StressScenario[] = [
  {
    label: "1.5x costs",
    overrides: {},
    description: "Fees and slippage both 1.5x the modelled base.",
  },
  {
    label: "2x slippage",
    overrides: {},
    description: "Slippage doubled; fees unchanged.",
  },
];

/**
 * Runs deliberately pessimistic execution scenarios. The question is not
 * whether the strategy looks good at the modelled costs - it is whether a
 * slightly worse fill erases the whole edge.
 */
export function runStress(
  histories: readonly MarketHistory[],
  base: Omit<HarnessConfig, "symbol">,
  scenarios: readonly StressScenario[],
): StressResult {
  const runScenario = (overrides: Partial<HarnessConfig>): { metrics: PerformanceMetrics; trades: number } => {
    const trades: ResearchTrade[] = [];
    for (const history of histories) {
      const result = runResearchHarness(
        { ...base, ...overrides, symbol: history.symbol },
        history.candles1h,
        history.candles15m,
      );
      trades.push(...authoritative(result.trades));
    }
    return { metrics: metricsFor(trades), trades: trades.length };
  };

  const baseRun = runScenario({});
  const outcomes = scenarios.map((scenario) => {
    const run = runScenario(scenario.overrides);
    const delta =
      run.metrics.expectancyR !== null && baseRun.metrics.expectancyR !== null
        ? run.metrics.expectancyR - baseRun.metrics.expectancyR
        : null;
    return {
      label: scenario.label,
      description: scenario.description,
      metrics: run.metrics,
      trades: run.trades,
      expectancyDeltaR: delta,
      survives: (run.metrics.expectancyR ?? -1) > 0 && (run.metrics.profitFactor ?? 0) > 1,
    };
  });

  return {
    base: baseRun.metrics,
    outcomes,
    survivesAll: outcomes.length > 0 && outcomes.every((o) => o.survives),
  };
}

/** Builds the cost scenarios from the base config, scaling its actual values. */
export function costStressScenarios(base: Omit<HarnessConfig, "symbol">): StressScenario[] {
  return [
    {
      label: "1.5x fees and slippage",
      description: "Both modelled costs raised 50%.",
      overrides: { feeBps: base.feeBps * 1.5, slippageBps: base.slippageBps * 1.5 },
    },
    {
      label: "2x slippage",
      description: "Slippage doubled, fees unchanged - a thinner book.",
      overrides: { slippageBps: base.slippageBps * 2 },
    },
    {
      label: "2x fees and slippage",
      description: "Both modelled costs doubled - a deliberately hostile fill.",
      overrides: { feeBps: base.feeBps * 2, slippageBps: base.slippageBps * 2 },
    },
  ];
}

/**
 * Entry-delay scenarios. Manual approval introduces real latency, and these
 * are expressed in whole 15m bars because that is the resolution the data
 * actually supports - inventing tick-level precision would be fabrication.
 */
export function entryDelayScenarios(): StressScenario[] {
  return [
    { label: "1 bar delay", description: "Entry one 15m bar later than the production assumption.", overrides: { entryDelayBars: 1 } },
    { label: "2 bar delay", description: "Entry two 15m bars later - roughly half an hour.", overrides: { entryDelayBars: 2 } },
    { label: "4 bar delay", description: "Entry a full hour later, modelling slow manual approval.", overrides: { entryDelayBars: 4 } },
  ];
}

/** Stop/target shapes, all sized from the identical risk budget. */
export function stopTargetVariants(): StopTargetVariant[] {
  return [
    V1_STOP_TARGET,
    { label: "tighter stop, 2R", stopDistanceMultiple: 0.75, targetRMultiple: 2 },
    { label: "wider stop, 2R", stopDistanceMultiple: 1.25, targetRMultiple: 2 },
    { label: "V1 stop, 1.5R", stopDistanceMultiple: 1, targetRMultiple: 1.5 },
    { label: "V1 stop, 3R", stopDistanceMultiple: 1, targetRMultiple: 3 },
  ];
}

export function runStopTargetResearch(
  histories: readonly MarketHistory[],
  base: Omit<HarnessConfig, "symbol">,
  variants: readonly StopTargetVariant[] = stopTargetVariants(),
): Array<{ label: string; metrics: PerformanceMetrics; trades: number; stopDistanceMultiple: number; targetRMultiple: number }> {
  return variants.map((variant) => {
    const trades: ResearchTrade[] = [];
    for (const history of histories) {
      const result = runResearchHarness(
        { ...base, symbol: history.symbol, stopTarget: variant },
        history.candles1h,
        history.candles15m,
      );
      trades.push(...authoritative(result.trades));
    }
    return {
      label: variant.label,
      metrics: metricsFor(trades),
      trades: trades.length,
      stopDistanceMultiple: variant.stopDistanceMultiple,
      targetRMultiple: variant.targetRMultiple,
    };
  });
}

/** The small, defensible parameter neighbourhood from the spec. */
export function defaultParameterVariants(base: Omit<HarnessConfig, "symbol">): ParameterVariant[] {
  const variants: ParameterVariant[] = [];

  for (const score of [80, 85, 90]) {
    variants.push({
      label: `minScore ${score}`,
      parameter: "minCandidateScore",
      value: score,
      overrides: { minCandidateScore: score },
    });
  }
  for (const rr of [1.5, 1.75, 2.0]) {
    variants.push({
      label: `minRR ${rr}`,
      parameter: "minRiskReward",
      value: rr,
      overrides: { minRiskReward: rr },
    });
  }
  for (const factor of [0.6, 1, 1.4]) {
    variants.push({
      label: `maxAtrPct x${factor}`,
      parameter: "maxAtrPct",
      value: Number((base.maxAtrPct * factor).toFixed(6)),
      overrides: { maxAtrPct: base.maxAtrPct * factor },
    });
  }

  return variants;
}
