import { evidenceLevel, groupPerformance, type PerformanceMetrics } from "@/lib/learning/analytics";
import type { EvidenceLevel } from "@/lib/learning/types";
import type { ResearchTrade } from "./harness";
import { metricsFor, toLearningTrades } from "./suite";

/**
 * Descriptive analysis of research trades.
 *
 * EVERYTHING HERE IS A HYPOTHESIS. Nothing in this file changes a parameter,
 * a stop, a target or a weight - it only describes what the data did, always
 * alongside the sample size that produced it, so a pattern drawn from four
 * trades is never presented with the same confidence as one drawn from two
 * hundred.
 */

export type Breakdown = {
  key: string;
  metrics: PerformanceMetrics;
  sampleCount: number;
  evidence: EvidenceLevel;
};

function breakdown(trades: ResearchTrade[], key: (t: ResearchTrade) => string): Breakdown[] {
  // Indexed rather than searched: a linear scan per record would make every
  // breakdown quadratic, and these run over tens of thousands of trades.
  const byId = new Map<string, ResearchTrade>(trades.map((t) => [`${t.symbol}-${t.signalTime}-${t.track}`, t]));
  const grouped = groupPerformance(toLearningTrades(trades), (record) => {
    const match = byId.get(record.id);
    return match ? key(match) : "UNKNOWN";
  });

  return Object.entries(grouped)
    .map(([k, metrics]) => ({
      key: k,
      metrics,
      sampleCount: metrics.sampleCount,
      evidence: evidenceLevel(metrics.sampleCount),
    }))
    .sort((a, b) => b.sampleCount - a.sampleCount);
}

// ---------------------------------------------------------------------------
// C. Score bands
// ---------------------------------------------------------------------------

export type ScoreBandAnalysis = {
  bands: Breakdown[];
  /** Does a higher band actually produce a better expectancy? */
  monotonic: boolean;
  correlationNote: string;
};

/**
 * Tests the assumption the whole scoring system rests on: that a higher score
 * means a better outcome. If it does not, the threshold is arbitrary and that
 * is worth knowing before trusting it further.
 */
export function analyzeScoreBands(trades: ResearchTrade[]): ScoreBandAnalysis {
  const bands = breakdown(trades, (t) => t.band);

  const order = ["BELOW_80", "80-84", "85-89", "90-94", "95-100"];
  const ordered = order
    .map((b) => bands.find((x) => x.key === b))
    .filter((b): b is Breakdown => Boolean(b) && (b as Breakdown).sampleCount > 0);

  const expectancies = ordered.map((b) => b.metrics.expectancyR ?? 0);
  let monotonic = expectancies.length >= 2;
  for (let i = 1; i < expectancies.length; i += 1) {
    if (expectancies[i] < expectancies[i - 1]) monotonic = false;
  }

  const thin = ordered.filter((b) => b.sampleCount < 20).map((b) => b.key);

  return {
    bands,
    monotonic,
    correlationNote:
      ordered.length < 2
        ? "Not enough populated bands to say whether score correlates with outcome."
        : monotonic
          ? `Expectancy rises with every band (${ordered.map((b) => b.key).join(" < ")}), which is consistent with the score carrying real information.${thin.length ? ` Thin samples: ${thin.join(", ")}.` : ""}`
          : `Expectancy does NOT rise monotonically with score. The current 80-point threshold is not obviously where the information is.${thin.length ? ` Thin samples: ${thin.join(", ")}.` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// D. Component-level analysis
// ---------------------------------------------------------------------------

export type ComponentObservation = {
  component: string;
  /** Mean points earned by winners vs losers. */
  meanInWins: number | null;
  meanInLosses: number | null;
  difference: number | null;
  sampleWins: number;
  sampleLosses: number;
  evidence: EvidenceLevel;
  note: string;
};

export type ComponentCombinationObservation = {
  label: string;
  sampleCount: number;
  metrics: PerformanceMetrics;
  evidence: EvidenceLevel;
};

export type ComponentAnalysis = {
  perComponent: ComponentObservation[];
  combinations: ComponentCombinationObservation[];
  hypotheses: string[];
};

const COMPONENTS = ["trend", "pullback", "momentum", "volume", "riskReward", "volatility"] as const;

/**
 * Compares how each score component scored in winning versus losing trades,
 * and looks at a few specific combinations the spec calls out.
 *
 * The weights are NOT touched. A component that looks unhelpful here becomes
 * a recorded hypothesis for the owner, never an automatic re-weighting.
 */
export function analyzeComponents(trades: ResearchTrade[]): ComponentAnalysis {
  const resolved = trades.filter((t) => t.pnl !== null);
  const wins = resolved.filter((t) => (t.pnl ?? 0) > 0);
  const losses = resolved.filter((t) => (t.pnl ?? 0) <= 0);

  const perComponent: ComponentObservation[] = COMPONENTS.map((component) => {
    const inWins = wins.map((t) => t.components[component]).filter((v): v is number => typeof v === "number");
    const inLosses = losses.map((t) => t.components[component]).filter((v): v is number => typeof v === "number");

    const meanInWins = inWins.length ? mean(inWins) : null;
    const meanInLosses = inLosses.length ? mean(inLosses) : null;
    const difference = meanInWins !== null && meanInLosses !== null ? meanInWins - meanInLosses : null;
    const evidence = evidenceLevel(Math.min(inWins.length, inLosses.length));

    return {
      component,
      meanInWins,
      meanInLosses,
      difference,
      sampleWins: inWins.length,
      sampleLosses: inLosses.length,
      evidence,
      note: describeComponent(component, difference, evidence),
    };
  });

  // The specific combinations the spec asks about.
  const combinations: ComponentCombinationObservation[] = [
    combination("strong trend + weak volume", resolved, (t) => strong(t, "trend") && weak(t, "volume")),
    combination("strong volume + weak pullback", resolved, (t) => strong(t, "volume") && weak(t, "pullback")),
    combination("high score + weak volatility component", resolved, (t) => t.score >= 85 && weak(t, "volatility")),
    combination("strong trend + strong volume", resolved, (t) => strong(t, "trend") && strong(t, "volume")),
    combination("weak momentum", resolved, (t) => weak(t, "momentum")),
  ].filter((c) => c.sampleCount > 0);

  const hypotheses: string[] = [];
  for (const obs of perComponent) {
    if (obs.difference !== null && obs.evidence !== "NO_DATA" && Math.abs(obs.difference) >= 2) {
      hypotheses.push(
        `${obs.component} scored ${obs.difference > 0 ? "higher" : "lower"} in winners by ${Math.abs(obs.difference).toFixed(1)} points (${obs.sampleWins}W/${obs.sampleLosses}L, ${obs.evidence}). Hypothesis only - weights unchanged.`,
      );
    }
  }

  return { perComponent, combinations, hypotheses };
}

function combination(
  label: string,
  trades: ResearchTrade[],
  predicate: (t: ResearchTrade) => boolean,
): ComponentCombinationObservation {
  const matching = trades.filter(predicate);
  return {
    label,
    sampleCount: matching.length,
    metrics: metricsFor(matching),
    evidence: evidenceLevel(matching.length),
  };
}

const POSSIBLE: Record<string, number> = {
  trend: 25,
  pullback: 20,
  momentum: 15,
  volume: 15,
  riskReward: 15,
  volatility: 10,
};

function strong(trade: ResearchTrade, component: string): boolean {
  const earned = trade.components[component];
  const possible = POSSIBLE[component] ?? 1;
  return typeof earned === "number" && earned >= possible * 0.8;
}

function weak(trade: ResearchTrade, component: string): boolean {
  const earned = trade.components[component];
  const possible = POSSIBLE[component] ?? 1;
  return typeof earned === "number" && earned <= possible * 0.4;
}

function describeComponent(component: string, difference: number | null, evidence: EvidenceLevel): string {
  if (difference === null) return `No resolved wins and losses to compare for ${component}.`;
  if (evidence === "NO_DATA" || evidence === "EXTREMELY_LOW_EVIDENCE") {
    return `Too few trades to say anything about ${component}.`;
  }
  if (Math.abs(difference) < 1) return `${component} scored about the same in winners and losers.`;
  return difference > 0
    ? `${component} scored ${difference.toFixed(1)} points higher in winners.`
    : `${component} scored ${Math.abs(difference).toFixed(1)} points HIGHER in losers - it may not be carrying its weight.`;
}

// ---------------------------------------------------------------------------
// L. Regime / asset / volatility breakdowns
// ---------------------------------------------------------------------------

export type RegimeAnalysis = {
  bySymbol: Breakdown[];
  byRegime: Breakdown[];
  byVolatility: Breakdown[];
  byHour: Breakdown[];
  /** Set when nearly all the profit comes from one narrow environment. */
  concentrationWarning: string | null;
};

export function analyzeRegimes(trades: ResearchTrade[]): RegimeAnalysis {
  const bySymbol = breakdown(trades, (t) => t.symbol);
  const byRegime = breakdown(trades, (t) => t.regime);
  const byVolatility = breakdown(trades, (t) => t.volatility);
  const byHour = breakdown(trades, (t) => `${new Date(t.entryTime).getUTCHours()}h UTC`);

  return {
    bySymbol,
    byRegime,
    byVolatility,
    byHour,
    concentrationWarning: detectConcentration(trades, bySymbol, byVolatility),
  };
}

/**
 * Flags dependence on one narrow environment. A strategy whose entire edge
 * comes from a single asset or a single volatility band has not been shown to
 * work - it has been shown to have worked once, somewhere specific.
 */
function detectConcentration(
  trades: ResearchTrade[],
  bySymbol: Breakdown[],
  byVolatility: Breakdown[],
): string | null {
  const resolved = trades.filter((t) => t.pnl !== null);
  if (resolved.length < 10) return null;

  const totalProfit = resolved.reduce((sum, t) => sum + Math.max(0, t.pnl ?? 0), 0);
  if (totalProfit <= 0) return null;

  const warnings: string[] = [];

  for (const [label, groups] of [
    ["asset", bySymbol],
    ["volatility band", byVolatility],
  ] as const) {
    const positive = groups.filter((g) => (g.metrics.expectancyR ?? 0) > 0);
    if (groups.length > 1 && positive.length === 1) {
      warnings.push(`the only ${label} with positive expectancy is ${positive[0].key}`);
    }
  }

  return warnings.length ? `Possible environment dependence: ${warnings.join("; ")}.` : null;
}

// ---------------------------------------------------------------------------
// M. MFE / MAE deep analysis
// ---------------------------------------------------------------------------

export type ExcursionAnalysis = {
  sampleCount: number;
  evidence: EvidenceLevel;
  averageMfeRWinners: number | null;
  averageMfeRLosers: number | null;
  averageMaeRWinners: number | null;
  averageMaeRLosers: number | null;
  /** Losers that were meaningfully in profit before reversing. */
  losersWithFavourableExcursion: number;
  /** Winners that went deeply against the position before working. */
  winnersWithDeepAdverseExcursion: number;
  /** Winners whose best price ran well past the target. */
  winnersLeavingMfeUnused: number;
  observations: string[];
};

const DEEP_ADVERSE_R = 0.7;
const MEANINGFUL_FAVOURABLE_R = 1.0;

/**
 * Uses MFE/MAE to ask whether the stop is too tight, whether winners survive
 * deep drawdowns, and whether the target is leaving money on the table.
 *
 * Every answer is an observation. This never moves a stop or a target.
 */
export function analyzeExcursions(trades: ResearchTrade[]): ExcursionAnalysis {
  const resolved = trades.filter((t) => t.pnl !== null && t.rMultiple !== null);
  const wins = resolved.filter((t) => (t.pnl ?? 0) > 0);
  const losses = resolved.filter((t) => (t.pnl ?? 0) <= 0);

  const mfeWins = numbers(wins.map((t) => t.mfeR));
  const mfeLosses = numbers(losses.map((t) => t.mfeR));
  const maeWins = numbers(wins.map((t) => t.maeR));
  const maeLosses = numbers(losses.map((t) => t.maeR));

  const losersWithFavourableExcursion = losses.filter((t) => (t.mfeR ?? 0) >= MEANINGFUL_FAVOURABLE_R).length;
  const winnersWithDeepAdverseExcursion = wins.filter((t) => (t.maeR ?? 0) >= DEEP_ADVERSE_R).length;
  const winnersLeavingMfeUnused = wins.filter((t) => (t.mfeR ?? 0) > 2.5).length;

  const evidence = evidenceLevel(resolved.length);
  const observations: string[] = [];

  if (evidence === "NO_DATA") {
    observations.push("No resolved trades: nothing can be said about excursions.");
  } else {
    if (losses.length > 0 && losersWithFavourableExcursion / losses.length > 0.3) {
      observations.push(
        `${losersWithFavourableExcursion} of ${losses.length} losing trades were up at least ${MEANINGFUL_FAVOURABLE_R}R before reversing. Hypothesis: the target may be too far, or the trade gives back too much. Not acted on.`,
      );
    }
    if (wins.length > 0 && winnersWithDeepAdverseExcursion / wins.length > 0.3) {
      observations.push(
        `${winnersWithDeepAdverseExcursion} of ${wins.length} winners first went ${DEEP_ADVERSE_R}R or more against the position. Hypothesis: the stop is close to the noise floor; a slightly wider stop with the SAME risk budget may be worth researching. Not acted on.`,
      );
    }
    if (wins.length > 0 && winnersLeavingMfeUnused / wins.length > 0.4) {
      observations.push(
        `${winnersLeavingMfeUnused} of ${wins.length} winners ran past 2.5R before exiting at the 2R target. Hypothesis: the target may be leaving favourable excursion unused. Not acted on.`,
      );
    }
    if (observations.length === 0) {
      observations.push("No excursion pattern stands out at this sample size.");
    }
  }

  return {
    sampleCount: resolved.length,
    evidence,
    averageMfeRWinners: mfeWins.length ? mean(mfeWins) : null,
    averageMfeRLosers: mfeLosses.length ? mean(mfeLosses) : null,
    averageMaeRWinners: maeWins.length ? mean(maeWins) : null,
    averageMaeRLosers: maeLosses.length ? mean(maeLosses) : null,
    losersWithFavourableExcursion,
    winnersWithDeepAdverseExcursion,
    winnersLeavingMfeUnused,
    observations,
  };
}

function numbers(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export { breakdown };
