/**
 * Evidence report for one PAPER research window.
 *
 * This is a MEASUREMENT, not a verdict. It exists to let the owner decide,
 * with the sample size in front of them, whether a strategy has earned a
 * closer look. Two rules are absolute here:
 *
 *   1. Nothing in this file changes a strategy's status. The only outputs are
 *      KEEP_DRAFT and OWNER_REVIEW_FOR_PAPER_APPROVAL - and the second is a
 *      request for a human to look, never an approval.
 *   2. A small sample is reported as a small sample. Fourteen days of a
 *      1-position-at-a-time strategy can easily produce a handful of trades;
 *      calling that "profitable" would be the single most misleading thing
 *      this system could say, so evidence level gates the recommendation
 *      regardless of how good the numbers look.
 *
 * Aggregation reuses lib/learning/analytics.ts rather than reimplementing it,
 * so research numbers and dashboard numbers cannot drift apart.
 */

import { calculatePerformance, evidenceLevel, groupPerformance, type PerformanceMetrics } from "@/lib/learning/analytics";
import type { EvidenceLevel, LearningTrade } from "@/lib/learning/types";
import type { ResearchWindow } from "./window";

/** Score bands from the spec's knowledge-collection questions (section 11). */
export type ScoreBand = "80-84" | "85-89" | "90-94" | "95-100" | "BELOW_80";

export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score === null || score === undefined || score < 80) return "BELOW_80";
  if (score < 85) return "80-84";
  if (score < 90) return "85-89";
  if (score < 95) return "90-94";
  return "95-100";
}

/** Coarse volatility buckets, so ATR effects are visible without curve-fitting. */
export type VolatilityBand = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export function volatilityBand(atrPct: number | null | undefined): VolatilityBand {
  if (atrPct === null || atrPct === undefined || !Number.isFinite(atrPct)) return "UNKNOWN";
  if (atrPct < 0.01) return "LOW";
  if (atrPct < 0.025) return "MEDIUM";
  return "HIGH";
}

export type CandidateFunnel = {
  /** Signals classified CANDIDATE by the strategy during the window. */
  candidates: number;
  /** Of those, the ones that survived the full deterministic risk pipeline. */
  riskValidCandidates: number;
  /** Of those, the ones that actually became positions. */
  executed: number;
  /** Executed automatically (decision_source = AUTO) rather than by the owner. */
  executedAutomatically: number;
};

export type ResearchRecommendation = "KEEP_DRAFT" | "OWNER_REVIEW_FOR_PAPER_APPROVAL";

export type ResearchReport = {
  windowId: string;
  startedAt: string;
  endsAt: string;
  plannedDays: number;
  startingEquity: number;
  targetEquity: number | null;
  /** Equity after the window's realized results. Informational. */
  endingEquity: number | null;
  symbols: string[];
  funnel: CandidateFunnel;
  /** Actual PAPER outcomes only. Counterfactuals are never mixed in here. */
  overall: PerformanceMetrics;
  byScoreBand: Record<string, PerformanceMetrics>;
  bySymbol: Record<string, PerformanceMetrics>;
  byRegime: Record<string, PerformanceMetrics>;
  byVolatility: Record<string, PerformanceMetrics>;
  byNewsRisk: Record<string, PerformanceMetrics>;
  evidenceLevel: EvidenceLevel;
  recommendation: ResearchRecommendation;
  /** Plain-language statement of what the sample does and does not support. */
  evidenceStatement: string;
};

export type ResearchReportInput = {
  window: ResearchWindow;
  /** Actual PAPER trades tagged to this window. Never counterfactual rows. */
  trades: LearningTrade[];
  funnel: CandidateFunnel;
  endingEquity?: number | null;
  /** Per-trade context keyed by trade id, for the breakdowns. */
  context?: Record<string, { atrPct?: number | null }>;
};

/**
 * The minimum number of completed trades before a research window may even be
 * described as worth reviewing. Matches the learning layer's own threshold so
 * "enough evidence" means one thing across the whole application.
 */
export const RESEARCH_MIN_REVIEWABLE_SAMPLE = 20;

export function buildResearchReport(input: ResearchReportInput): ResearchReport {
  const { window, trades, funnel } = input;

  // Guard the central invariant of this report: only ACTUAL outcomes count.
  // A hypothetical fill from a rejected candidate is research data, but it is
  // not PAPER performance and must never inflate these numbers.
  const actual = trades.filter((t) => t.actual);
  const overall = calculatePerformance(actual);

  const byScoreBand = groupPerformance(actual, (t) => scoreBand(t.score));
  const bySymbol = groupPerformance(actual, (t) => t.symbol);
  const byRegime = groupPerformance(actual, (t) => t.regime ?? "UNKNOWN");
  const byNewsRisk = groupPerformance(actual, (t) => t.newsRisk ?? "UNKNOWN");
  const byVolatility = groupPerformance(actual, (t) =>
    volatilityBand(input.context?.[t.id]?.atrPct ?? t.volatility),
  );

  const level = evidenceLevel(overall.sampleCount);
  const recommendation = recommendFrom(level, overall);

  return {
    windowId: window.id,
    startedAt: window.startedAt,
    endsAt: window.endsAt,
    plannedDays: window.plannedDays,
    startingEquity: window.startingEquity,
    targetEquity: window.targetEquity,
    endingEquity: input.endingEquity ?? null,
    symbols: [...new Set(actual.map((t) => t.symbol))].sort(),
    funnel,
    overall,
    byScoreBand,
    bySymbol,
    byRegime,
    byVolatility,
    byNewsRisk,
    evidenceLevel: level,
    recommendation,
    evidenceStatement: describeEvidence(level, overall),
  };
}

/**
 * The ONLY two outcomes. Note what is absent: there is no branch that marks a
 * strategy approved, and no numeric result - however good - can produce one.
 * A human promotes a strategy, or nobody does.
 */
function recommendFrom(level: EvidenceLevel, metrics: PerformanceMetrics): ResearchRecommendation {
  if (level !== "INITIAL_EVIDENCE") return "KEEP_DRAFT";
  if (metrics.sampleCount < RESEARCH_MIN_REVIEWABLE_SAMPLE) return "KEEP_DRAFT";

  // Even at the review threshold this only asks the owner to LOOK. Requiring
  // both a positive expectancy and a profit factor above 1 keeps us from
  // sending someone to review a clearly losing sample.
  const positiveExpectancy = (metrics.expectancyR ?? 0) > 0;
  const profitable = metrics.profitFactor !== null && metrics.profitFactor > 1;
  return positiveExpectancy && profitable ? "OWNER_REVIEW_FOR_PAPER_APPROVAL" : "KEEP_DRAFT";
}

function describeEvidence(level: EvidenceLevel, metrics: PerformanceMetrics): string {
  const n = metrics.sampleCount;

  if (n === 0) {
    return "No completed PAPER trades in this research window. No conclusion of any kind can be drawn - including that the strategy is bad. No trade is a valid outcome for a selective strategy.";
  }
  if (level === "EXTREMELY_LOW_EVIDENCE") {
    return `Insufficient evidence. ${n} completed trade${n === 1 ? "" : "s"} cannot distinguish skill from luck; these numbers are a record of what happened, not a measurement of the strategy.`;
  }
  if (level === "LOW_EVIDENCE") {
    return `Insufficient evidence. ${n} completed trades is below the ${RESEARCH_MIN_REVIEWABLE_SAMPLE}-trade minimum this system requires before describing a result as anything more than an anecdote.`;
  }
  return `Initial evidence only, from ${n} completed trades. Enough to justify an owner review; not enough to call the strategy profitable, and not a basis for increasing risk.`;
}

/** Owner-facing report text. Deliberately plain, with no casino language. */
export function formatResearchReport(report: ResearchReport): string {
  const m = report.overall;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const num = (v: number | null, digits = 2) => (v === null ? "n/a" : v.toFixed(digits));
  const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;

  const lines = [
    "PAPER RESEARCH EVIDENCE REPORT",
    "",
    `Window       ${report.startedAt} -> ${report.endsAt}`,
    `Duration     ${report.plannedDays} days`,
    `Symbols      ${report.symbols.length > 0 ? report.symbols.join(", ") : "none"}`,
    "",
    "- - - FUNNEL - - -",
    "",
    `Candidates            ${report.funnel.candidates}`,
    `Risk-valid            ${report.funnel.riskValidCandidates}`,
    `Executed              ${report.funnel.executed}`,
    `Executed automatically ${report.funnel.executedAutomatically}`,
    "",
    "- - - ACTUAL PAPER RESULTS - - -",
    "",
    `Trades       ${m.sampleCount}`,
    `Wins         ${m.wins}`,
    `Losses       ${m.losses}`,
    `Win rate     ${pct(m.winRate)}`,
    `Average R    ${num(m.averageR)}`,
    `Expectancy   ${num(m.expectancyR)}R`,
    `Profit factor ${num(m.profitFactor)}`,
    `Net P/L      ${usd(m.netPnl)}`,
    `Fees         ${usd(m.fees)}`,
    `Slippage     ${usd(m.slippage)}`,
    `Max drawdown ${usd(m.maxDrawdown)}`,
    `Max losing streak ${m.maxLosingStreak}`,
    `Average MFE  ${num(m.averageMfeR)}R`,
    `Average MAE  ${num(m.averageMaeR)}R`,
    "",
    `Starting equity ${usd(report.startingEquity)}`,
    ...(report.endingEquity !== null ? [`Current equity  ${usd(report.endingEquity)}`] : []),
    ...(report.targetEquity !== null
      ? [`Target          ${usd(report.targetEquity)} (informational only - never affects risk or filtering)`]
      : []),
    "",
    "- - - EVIDENCE - - -",
    "",
    `Level        ${report.evidenceLevel}`,
    report.evidenceStatement,
    "",
    `Recommendation: ${report.recommendation === "KEEP_DRAFT" ? "KEEP DRAFT" : "OWNER REVIEW FOR PAPER APPROVAL"}`,
    "",
    "Strategy V1 remains DRAFT. This report never changes a strategy's status.",
  ];

  return lines.join("\n");
}

/**
 * The single Telegram notification sent when the window ends (spec section 9).
 * Reuses the same metrics and the same honesty rules as the full report.
 */
export function formatResearchCompletedMessage(report: ResearchReport): string {
  const m = report.overall;
  const num = (v: number | null, digits = 2) => (v === null ? "n/a" : v.toFixed(digits));
  const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;

  return [
    "Davinki Trading",
    `${report.plannedDays}-day automatic PAPER research period completed.`,
    "",
    "Automatic execution has been disabled.",
    "",
    "Execution mode is now:",
    "Approval Required",
    "",
    "- - - RESULTS - - -",
    "",
    `Trades        ${m.sampleCount}`,
    `Wins          ${m.wins}`,
    `Losses        ${m.losses}`,
    `Win rate      ${m.winRate === null ? "n/a" : `${(m.winRate * 100).toFixed(1)}%`}`,
    `Average R     ${num(m.averageR)}`,
    `Expectancy    ${num(m.expectancyR)}R`,
    `Profit factor ${num(m.profitFactor)}`,
    `Net P/L       ${usd(m.netPnl)}`,
    `Max drawdown  ${usd(m.maxDrawdown)}`,
    ...(report.endingEquity !== null ? [`PAPER equity  ${usd(report.endingEquity)}`] : []),
    "",
    `Evidence      ${report.evidenceLevel}`,
    "",
    report.evidenceStatement,
    "",
    `Strategy V1 remains DRAFT. Recommendation: ${
      report.recommendation === "KEEP_DRAFT" ? "KEEP DRAFT" : "OWNER REVIEW FOR PAPER APPROVAL"
    }.`,
  ].join("\n");
}
