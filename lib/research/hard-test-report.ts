import type { PerformanceMetrics } from "@/lib/learning/analytics";
import type { EvidenceLevel } from "@/lib/learning/types";
import type { HistoricalResearchResult } from "./run";
import type { ResearchReport } from "./report";
import type { ShadowSummary } from "./shadow";

/**
 * The 14-day hard-test report.
 *
 * THE ORGANISING RULE: the tracks are never blended. An in-sample development
 * figure, an untouched holdout figure, a hypothetical counterfactual and 14
 * days of actual PAPER results mean completely different things, and a single
 * combined "performance" number would destroy exactly the information this
 * exercise exists to produce. They are reported side by side, each labelled.
 */

export type HardTestRecommendation =
  | "KEEP_DRAFT"
  | "CONTINUE_PAPER_RESEARCH"
  | "OWNER_REVIEW_FOR_PAPER_APPROVAL";

export type RobustnessGate = {
  name: string;
  passed: boolean;
  detail: string;
  /** A failed blocking gate forces KEEP_DRAFT regardless of headline P/L. */
  blocking: boolean;
};

export type HardTestReport = {
  generatedAt: string;
  /** Actual PAPER results from the window. The only track that moved equity. */
  actualPaper: ResearchReport | null;
  historical: HistoricalSummary | null;
  counterfactual: ShadowSummary | null;
  gates: RobustnessGate[];
  recommendation: HardTestRecommendation;
  rationale: string[];
  headline: string;
};

export type HistoricalSummary = {
  coverage: HistoricalResearchResult["coverage"];
  baseline: PerformanceMetrics;
  perSymbol: Record<string, { metrics: PerformanceMetrics; trades: number }>;
  development: PerformanceMetrics;
  validation: PerformanceMetrics;
  holdout: PerformanceMetrics;
  walkForwardUnseen: PerformanceMetrics | null;
  walkForwardWindows: number;
  scoreBandNote: string;
  scoreBandMonotonic: boolean;
  stability: Record<string, { stableAcrossRange: boolean; suspectedOutlier: boolean; note: string }>;
  costStressSurvivesAll: boolean;
  costStress: Array<{ label: string; expectancyR: number | null; survives: boolean }>;
  entryDelay: Array<{ label: string; expectancyR: number | null; survives: boolean }>;
  stopTarget: Array<{ label: string; expectancyR: number | null; trades: number }>;
  excursionObservations: string[];
  componentHypotheses: string[];
  concentrationWarning: string | null;
  warnings: string[];
};

export function summarizeHistoricalResearch(result: HistoricalResearchResult): HistoricalSummary {
  return {
    coverage: result.coverage,
    baseline: result.baseline.combined,
    perSymbol: Object.fromEntries(
      Object.entries(result.baseline.perSymbol).map(([k, v]) => [k, { metrics: v.metrics, trades: v.trades }]),
    ),
    development: result.splits.development,
    validation: result.splits.validation,
    holdout: result.splits.holdout,
    walkForwardUnseen: result.walkForward?.unseen ?? null,
    walkForwardWindows: result.walkForward?.windows ?? 0,
    scoreBandNote: result.scoreBands.correlationNote,
    scoreBandMonotonic: result.scoreBands.monotonic,
    stability: Object.fromEntries(
      Object.entries(result.robustness.stability).map(([k, v]) => [
        k,
        { stableAcrossRange: v.stableAcrossRange, suspectedOutlier: v.suspectedOutlier, note: v.note },
      ]),
    ),
    costStressSurvivesAll: result.costStress.survivesAll,
    costStress: result.costStress.outcomes.map((o) => ({
      label: o.label,
      expectancyR: o.metrics.expectancyR,
      survives: o.survives,
    })),
    entryDelay: result.entryDelay.outcomes.map((o) => ({
      label: o.label,
      expectancyR: o.metrics.expectancyR,
      survives: o.survives,
    })),
    stopTarget: result.stopTarget.map((o) => ({
      label: o.label,
      expectancyR: o.metrics.expectancyR,
      trades: o.trades,
    })),
    excursionObservations: result.excursions.observations,
    componentHypotheses: result.components.hypotheses,
    concentrationWarning: result.regimes.concentrationWarning,
    warnings: result.warnings,
  };
}


/**
 * Assembles the historical summary from separately-executed stages.
 *
 * A missing stage is reported as missing rather than defaulted to something
 * benign: an absent robustness run must never look like a passed one, so the
 * gates that depend on it fail closed.
 */
export function historicalSummaryFromStages(
  stages: Partial<Record<string, { payload: unknown; coverage: HistoricalSummary["coverage"] }>>,
): HistoricalSummary | null {
  const baseline = stages.BASELINE?.payload as
    | {
        combined: PerformanceMetrics;
        perSymbol: Record<string, { metrics: PerformanceMetrics; trades: number }>;
        splits: { development: PerformanceMetrics; validation: PerformanceMetrics; holdout: PerformanceMetrics } | null;
        walkForward: { windows: number; unseen: PerformanceMetrics } | null;
        scoreBands: { correlationNote: string; monotonic: boolean };
        components: { hypotheses: string[] };
        regimes: { concentrationWarning: string | null };
        excursions: { observations: string[] };
      }
    | undefined;

  if (!baseline) return null;

  const robustness = stages.ROBUSTNESS?.payload as
    | { stability: Record<string, { stableAcrossRange: boolean; suspectedOutlier: boolean; note: string }> }
    | undefined;
  const cost = stages.COST_STRESS?.payload as
    | { survivesAll: boolean; outcomes: Array<{ label: string; metrics: PerformanceMetrics; survives: boolean }> }
    | undefined;
  const delay = stages.ENTRY_DELAY?.payload as
    | { outcomes: Array<{ label: string; metrics: PerformanceMetrics; survives: boolean }> }
    | undefined;
  const stopTarget = stages.STOP_TARGET?.payload as
    | Array<{ label: string; metrics: PerformanceMetrics; trades: number }>
    | undefined;

  const warnings: string[] = [];
  if (!robustness) warnings.push("Parameter robustness stage has not been run.");
  if (!cost) warnings.push("Cost stress stage has not been run.");
  if (!delay) warnings.push("Entry delay stage has not been run.");
  if (!stopTarget) warnings.push("Stop/target stage has not been run.");

  return {
    coverage: stages.BASELINE?.coverage ?? [],
    baseline: baseline.combined,
    perSymbol: baseline.perSymbol,
    development: baseline.splits?.development ?? emptyMetrics(),
    validation: baseline.splits?.validation ?? emptyMetrics(),
    holdout: baseline.splits?.holdout ?? emptyMetrics(),
    walkForwardUnseen: baseline.walkForward?.unseen ?? null,
    walkForwardWindows: baseline.walkForward?.windows ?? 0,
    scoreBandNote: baseline.scoreBands.correlationNote,
    scoreBandMonotonic: baseline.scoreBands.monotonic,
    stability: robustness?.stability ?? {},
    // Absent means unproven, never proven. The gate fails closed.
    costStressSurvivesAll: cost?.survivesAll ?? false,
    costStress: (cost?.outcomes ?? []).map((o) => ({
      label: o.label,
      expectancyR: o.metrics.expectancyR,
      survives: o.survives,
    })),
    entryDelay: (delay?.outcomes ?? []).map((o) => ({
      label: o.label,
      expectancyR: o.metrics.expectancyR,
      survives: o.survives,
    })),
    stopTarget: (stopTarget ?? []).map((o) => ({
      label: o.label,
      expectancyR: o.metrics.expectancyR,
      trades: o.trades,
    })),
    excursionObservations: baseline.excursions.observations,
    componentHypotheses: baseline.components.hypotheses,
    concentrationWarning: baseline.regimes.concentrationWarning,
    warnings,
  };
}

function emptyMetrics(): PerformanceMetrics {
  return {
    sampleCount: 0, wins: 0, losses: 0, breakeven: 0, winRate: null,
    averageWin: null, averageLoss: null, averageR: null, medianR: null,
    expectancyR: null, profitFactor: null, grossProfit: 0, grossLoss: 0,
    netPnl: 0, fees: 0, slippage: 0, maxDrawdown: 0, maxLosingStreak: 0,
    averageMfeR: null, averageMaeR: null, averageDurationMinutes: null,
    evidenceLevel: "NO_DATA",
  };
}

const MIN_ACTUAL_SAMPLE = 20;

/**
 * Builds the final report and the ONLY recommendation the system may make.
 *
 * The gates below are deliberately hostile. A strategy that fails holdout,
 * fails walk-forward, depends on one narrow score band, or collapses under
 * slightly worse costs stays DRAFT even if the 14-day P/L is positive - two
 * profitable weeks are not proof of anything, and the whole point of the
 * exercise is to find the weakness now while everything is still PAPER.
 *
 * There is no branch that approves a strategy. The best available outcome is
 * a request for a human to look.
 */
export function buildHardTestReport(input: {
  actualPaper: ResearchReport | null;
  historical: HistoricalSummary | null;
  counterfactual: ShadowSummary | null;
  now?: string;
}): HardTestReport {
  const { actualPaper, historical, counterfactual } = input;
  const gates: RobustnessGate[] = [];

  // ---- Gates on the ACTUAL PAPER track --------------------------------
  const actualSample = actualPaper?.overall.sampleCount ?? 0;
  gates.push({
    name: "Actual PAPER sample size",
    passed: actualSample >= MIN_ACTUAL_SAMPLE,
    blocking: true,
    detail:
      actualSample >= MIN_ACTUAL_SAMPLE
        ? `${actualSample} completed PAPER trades.`
        : `Only ${actualSample} completed PAPER trades; ${MIN_ACTUAL_SAMPLE} is the minimum before a result is anything more than an anecdote.`,
  });

  gates.push({
    name: "Actual PAPER expectancy",
    passed: (actualPaper?.overall.expectancyR ?? 0) > 0,
    blocking: true,
    detail: describeExpectancy(actualPaper?.overall.expectancyR ?? null, "Actual PAPER"),
  });

  // ---- Gates on HISTORICAL robustness ---------------------------------
  if (historical) {
    gates.push({
      name: "Untouched holdout",
      passed: (historical.holdout.expectancyR ?? 0) > 0 && historical.holdout.sampleCount > 0,
      blocking: true,
      detail:
        historical.holdout.sampleCount === 0
          ? "No trades reached the untouched holdout period."
          : describeExpectancy(historical.holdout.expectancyR, `Holdout (${historical.holdout.sampleCount} trades)`),
    });

    gates.push({
      name: "Walk-forward on unseen periods",
      passed: (historical.walkForwardUnseen?.expectancyR ?? 0) > 0 && historical.walkForwardWindows > 0,
      blocking: true,
      detail:
        historical.walkForwardWindows === 0
          ? "Not enough trades to run walk-forward at all."
          : describeExpectancy(
              historical.walkForwardUnseen?.expectancyR ?? null,
              `Walk-forward unseen (${historical.walkForwardWindows} windows)`,
            ),
    });

    gates.push({
      name: "Transaction-cost stress",
      passed: historical.costStressSurvivesAll,
      blocking: true,
      detail: historical.costStressSurvivesAll
        ? "The edge stayed positive under every hostile cost scenario."
        : `The edge disappears under worse execution: ${historical.costStress
            .filter((c) => !c.survives)
            .map((c) => c.label)
            .join(", ")}.`,
    });

    const outlierParams = Object.entries(historical.stability)
      .filter(([, v]) => v.suspectedOutlier)
      .map(([k]) => k);
    gates.push({
      name: "Parameter robustness",
      passed: outlierParams.length === 0,
      blocking: true,
      detail:
        outlierParams.length === 0
          ? "No swept parameter showed an isolated jackpot setting."
          : `Suspected curve-fitting on: ${outlierParams.join(", ")}. One setting sharply outperforms its neighbours.`,
    });

    gates.push({
      name: "Environment concentration",
      passed: historical.concentrationWarning === null,
      blocking: true,
      detail: historical.concentrationWarning ?? "The edge is not confined to a single asset or volatility band.",
    });

    // Informational, not blocking: a non-monotonic score is a strong reason
    // to reconsider the threshold, but it is not by itself disqualifying.
    gates.push({
      name: "Score band correlation",
      passed: historical.scoreBandMonotonic,
      blocking: false,
      detail: historical.scoreBandNote,
    });
  } else {
    gates.push({
      name: "Historical robustness",
      passed: false,
      blocking: true,
      detail: "No historical research run is available, so none of the robustness questions have been answered.",
    });
  }

  const failedBlocking = gates.filter((g) => g.blocking && !g.passed);
  const recommendation = decide(failedBlocking, actualSample, actualPaper?.overall.evidenceLevel ?? "NO_DATA");

  const rationale = failedBlocking.length
    ? failedBlocking.map((g) => `${g.name}: ${g.detail}`)
    : ["Every blocking robustness gate passed. A human must still review before anything changes."];

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    actualPaper,
    historical,
    counterfactual,
    gates,
    recommendation,
    rationale,
    headline: headlineFor(recommendation, failedBlocking.length, actualSample),
  };
}

/**
 * The three permitted outcomes.
 *
 * CONTINUE_PAPER_RESEARCH exists for the honest middle case: nothing has
 * failed, but there is simply not enough evidence yet. It is a request for
 * more data, NOT a softened approval.
 */
function decide(
  failedBlocking: RobustnessGate[],
  actualSample: number,
  evidence: EvidenceLevel,
): HardTestRecommendation {
  // Anything substantive failing keeps it DRAFT, whatever the P/L.
  const failedBeyondSample = failedBlocking.filter((g) => g.name !== "Actual PAPER sample size");
  if (failedBeyondSample.length > 0) return "KEEP_DRAFT";

  // Only the sample-size gate failed: the strategy has not been contradicted,
  // it has merely not been measured enough.
  if (failedBlocking.length > 0) return "CONTINUE_PAPER_RESEARCH";

  if (actualSample < MIN_ACTUAL_SAMPLE || evidence !== "INITIAL_EVIDENCE") {
    return "CONTINUE_PAPER_RESEARCH";
  }

  return "OWNER_REVIEW_FOR_PAPER_APPROVAL";
}

function headlineFor(recommendation: HardTestRecommendation, failures: number, sample: number): string {
  switch (recommendation) {
    case "OWNER_REVIEW_FOR_PAPER_APPROVAL":
      return `Every hostile gate passed over ${sample} actual PAPER trades. This is a request for owner review - it is NOT an approval, and the strategy remains DRAFT until a human changes it.`;
    case "CONTINUE_PAPER_RESEARCH":
      return `Nothing was contradicted, but the evidence is not yet sufficient (${sample} actual PAPER trades). More research, not a decision.`;
    default:
      return `${failures} blocking gate${failures === 1 ? "" : "s"} failed. Strategy V1 stays DRAFT regardless of headline P/L.`;
  }
}

function describeExpectancy(expectancyR: number | null, label: string): string {
  if (expectancyR === null) return `${label}: no resolved trades to measure.`;
  return expectancyR > 0
    ? `${label} expectancy ${expectancyR.toFixed(3)}R after costs.`
    : `${label} expectancy ${expectancyR.toFixed(3)}R after costs - not positive.`;
}

/** Owner-facing text. Keeps every track visibly separate. */
export function formatHardTestReport(report: HardTestReport): string {
  const lines: string[] = [
    "DAVINKI TRADING - 14-DAY HARD TEST REPORT",
    `Generated ${report.generatedAt}`,
    "",
    report.headline,
    "",
    "=== 1. ACTUAL PAPER (the only track that moved equity) ===",
    "",
  ];

  if (report.actualPaper) {
    const m = report.actualPaper.overall;
    lines.push(
      `Window            ${report.actualPaper.startedAt} -> ${report.actualPaper.endsAt}`,
      `Candidates        ${report.actualPaper.funnel.candidates}`,
      `Risk-valid        ${report.actualPaper.funnel.riskValidCandidates}`,
      `Executed          ${report.actualPaper.funnel.executed} (${report.actualPaper.funnel.executedAutomatically} automatic)`,
      `Trades            ${m.sampleCount}`,
      `Wins / Losses     ${m.wins} / ${m.losses}`,
      `Win rate          ${pct(m.winRate)}`,
      `Average R         ${num(m.averageR)}`,
      `Median R          ${num(m.medianR)}`,
      `Expectancy        ${num(m.expectancyR)}R`,
      `Profit factor     ${num(m.profitFactor)}`,
      `Gross / Net P/L   ${usd(m.grossProfit - m.grossLoss)} / ${usd(m.netPnl)}`,
      `Fees / Slippage   ${usd(m.fees)} / ${usd(m.slippage)}`,
      `Max drawdown      ${usd(m.maxDrawdown)}`,
      `Losing streak     ${m.maxLosingStreak}`,
      `Average MFE/MAE   ${num(m.averageMfeR)}R / ${num(m.averageMaeR)}R`,
      `Equity            ${usd(report.actualPaper.startingEquity)} -> ${report.actualPaper.endingEquity === null ? "n/a" : usd(report.actualPaper.endingEquity)}`,
      `Evidence          ${report.actualPaper.evidenceLevel}`,
      "",
      report.actualPaper.evidenceStatement,
    );
  } else {
    lines.push("No actual PAPER results are available for this window.");
  }

  lines.push("", "=== 2. HISTORICAL BACKTEST (separate track, never blended) ===", "");
  if (report.historical) {
    const h = report.historical;
    lines.push(
      `Coverage          ${h.coverage.map((c) => `${c.symbol} ${c.candles15m} x 15m`).join(", ")}`,
      `Baseline trades   ${h.baseline.sampleCount}`,
      `Baseline expectancy ${num(h.baseline.expectancyR)}R, profit factor ${num(h.baseline.profitFactor)}`,
      "",
      "Chronological splits (in-sample vs out-of-sample):",
      `  Development     ${h.development.sampleCount} trades, expectancy ${num(h.development.expectancyR)}R`,
      `  Validation      ${h.validation.sampleCount} trades, expectancy ${num(h.validation.expectancyR)}R`,
      `  Holdout         ${h.holdout.sampleCount} trades, expectancy ${num(h.holdout.expectancyR)}R`,
      "",
      "=== 3. WALK-FORWARD (unseen periods only) ===",
      "",
      h.walkForwardUnseen
        ? `  ${h.walkForwardWindows} windows, ${h.walkForwardUnseen.sampleCount} unseen trades, expectancy ${num(h.walkForwardUnseen.expectancyR)}R`
        : "  Not enough trades to run walk-forward.",
      "",
      "=== 4. STRESS TESTS ===",
      "",
      "Transaction costs:",
      ...h.costStress.map((c) => `  ${c.survives ? "survives" : "FAILS  "}  ${c.label}: ${num(c.expectancyR)}R`),
      "",
      "Entry delay:",
      ...h.entryDelay.map((c) => `  ${c.survives ? "survives" : "FAILS  "}  ${c.label}: ${num(c.expectancyR)}R`),
      "",
      "=== 5. PARAMETER EXPERIMENTS ===",
      "",
      ...Object.entries(h.stability).map(([k, v]) => `  ${k}: ${v.note}`),
      "",
      "Stop/target variants (all sized from the identical risk budget):",
      ...h.stopTarget.map((s) => `  ${s.label}: ${s.trades} trades, ${num(s.expectancyR)}R`),
      "",
      "Score bands:",
      `  ${h.scoreBandNote}`,
    );

    if (h.excursionObservations.length) {
      lines.push("", "MFE/MAE observations (hypotheses only):", ...h.excursionObservations.map((o) => `  - ${o}`));
    }
    if (h.componentHypotheses.length) {
      lines.push("", "Component observations (hypotheses only):", ...h.componentHypotheses.map((o) => `  - ${o}`));
    }
    if (h.warnings.length) {
      lines.push("", "Warnings:", ...h.warnings.map((w) => `  - ${w}`));
    }
  } else {
    lines.push("No historical research run is available.");
  }

  lines.push("", "=== 6. COUNTERFACTUAL (hypothetical - never affected equity) ===", "");
  if (report.counterfactual) {
    const c = report.counterfactual;
    lines.push(
      `Total shadows     ${c.total} (${c.settled} settled)`,
      `By source         ${JSON.stringify(c.bySource)}`,
      `By score band     ${JSON.stringify(c.byBand)}`,
      `By outcome        ${JSON.stringify(c.byOutcome)}`,
      "",
      "These are setups that were NOT traded. They are evidence about the",
      "filters, not evidence about performance, and none of them moved equity.",
    );
  } else {
    lines.push("No counterfactual data available.");
  }

  lines.push("", "=== 7. ROBUSTNESS GATES ===", "");
  for (const gate of report.gates) {
    lines.push(`  [${gate.passed ? "PASS" : "FAIL"}]${gate.blocking ? " (blocking)" : "          "} ${gate.name}`);
    lines.push(`         ${gate.detail}`);
  }

  lines.push(
    "",
    "=== RECOMMENDATION ===",
    "",
    report.recommendation,
    "",
    ...report.rationale.map((r) => `  - ${r}`),
    "",
    "Strategy V1 remains DRAFT. This system cannot approve a strategy; only",
    "a human can, and this report is at most a request for that review.",
  );

  return lines.join("\n");
}

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}
function num(v: number | null, digits = 3): string {
  return v === null ? "n/a" : v.toFixed(digits);
}
function usd(v: number): string {
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}
