import { describe, expect, it } from "vitest";
import type { PerformanceMetrics } from "@/lib/learning/analytics";
import { buildHardTestReport, formatHardTestReport, type HistoricalSummary } from "./hard-test-report";
import type { ResearchReport } from "./report";

function metrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    sampleCount: 30, wins: 18, losses: 12, breakeven: 0, winRate: 0.6,
    averageWin: 2, averageLoss: -1, averageR: 0.4, medianR: 0.5,
    expectancyR: 0.4, profitFactor: 1.8, grossProfit: 36, grossLoss: 12,
    netPnl: 24, fees: 1.2, slippage: 0.6, maxDrawdown: 5, maxLosingStreak: 3,
    averageMfeR: 1.5, averageMaeR: 0.4, averageDurationMinutes: 90,
    evidenceLevel: "INITIAL_EVIDENCE",
    ...overrides,
  };
}

function paperReport(overrides: Partial<ResearchReport> = {}): ResearchReport {
  const overall = overrides.overall ?? metrics();
  return {
    windowId: "w1",
    startedAt: "2026-09-14T00:00:00Z",
    endsAt: "2026-09-28T00:00:00Z",
    plannedDays: 14,
    startingEquity: 20,
    targetEquity: 50,
    endingEquity: 24,
    symbols: ["BTCUSDT", "ETHUSDT"],
    funnel: { candidates: 60, riskValidCandidates: 40, executed: 30, executedAutomatically: 30 },
    overall,
    byScoreBand: {}, bySymbol: {}, byRegime: {}, byVolatility: {}, byNewsRisk: {},
    evidenceLevel: overall.evidenceLevel,
    recommendation: "KEEP_DRAFT",
    evidenceStatement: "stub",
    ...overrides,
  };
}

function historical(overrides: Partial<HistoricalSummary> = {}): HistoricalSummary {
  return {
    coverage: [{ symbol: "BTCUSDT", candles15m: 35039, candles1h: 8759, from: null, to: null }],
    baseline: metrics(),
    perSymbol: { BTCUSDT: { metrics: metrics(), trades: 30 } },
    development: metrics(),
    validation: metrics(),
    holdout: metrics({ sampleCount: 25 }),
    walkForwardUnseen: metrics({ sampleCount: 40 }),
    walkForwardWindows: 4,
    scoreBandNote: "monotonic",
    scoreBandMonotonic: true,
    stability: { minCandidateScore: { stableAcrossRange: true, suspectedOutlier: false, note: "stable" } },
    costStressSurvivesAll: true,
    costStress: [{ label: "1.5x", expectancyR: 0.25, survives: true }],
    entryDelay: [{ label: "1 bar", expectancyR: 0.3, survives: true }],
    stopTarget: [{ label: "V1", expectancyR: 0.4, trades: 30 }],
    excursionObservations: [],
    componentHypotheses: [],
    concentrationWarning: null,
    warnings: [],
    ...overrides,
  };
}

describe("the recommendation can never approve a strategy", () => {
  it("only ever emits one of the three permitted values", () => {
    const permitted = ["KEEP_DRAFT", "CONTINUE_PAPER_RESEARCH", "OWNER_REVIEW_FOR_PAPER_APPROVAL"];
    const cases = [
      { actualPaper: paperReport(), historical: historical(), counterfactual: null },
      { actualPaper: null, historical: null, counterfactual: null },
      { actualPaper: paperReport({ overall: metrics({ expectancyR: -2 }) }), historical: historical(), counterfactual: null },
    ];
    for (const c of cases) {
      expect(permitted).toContain(buildHardTestReport(c).recommendation);
    }
  });

  it("reaches OWNER_REVIEW only when every hostile gate passes", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport(),
      historical: historical(),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("OWNER_REVIEW_FOR_PAPER_APPROVAL");
    // Even then it is explicitly a request, not an approval.
    expect(report.headline).toContain("NOT an approval");
    expect(report.headline).toContain("remains DRAFT");
  });
});

describe("blocking gates keep a strategy DRAFT regardless of headline P/L", () => {
  it("fails a strategy that loses on the untouched holdout", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport(), // profitable PAPER fortnight
      historical: historical({ holdout: metrics({ expectancyR: -0.3 }) }),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.rationale.join(" ")).toContain("Holdout");
  });

  it("fails a strategy that does not survive walk-forward", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport(),
      historical: historical({ walkForwardUnseen: metrics({ expectancyR: -0.1 }) }),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
  });

  it("fails a strategy that collapses under slightly worse costs", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport(),
      historical: historical({
        costStressSurvivesAll: false,
        costStress: [{ label: "1.5x fees and slippage", expectancyR: -0.05, survives: false }],
      }),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.rationale.join(" ")).toContain("worse execution");
  });

  it("fails a strategy whose edge is one curve-fitted parameter setting", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport(),
      historical: historical({
        stability: { minRiskReward: { stableAcrossRange: false, suspectedOutlier: true, note: "jackpot" } },
      }),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.rationale.join(" ")).toContain("curve-fitting");
  });

  it("fails a strategy whose edge comes from one narrow environment", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport(),
      historical: historical({ concentrationWarning: "Possible environment dependence: only BTCUSDT is positive." }),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
  });

  it("fails when the actual PAPER track itself is not profitable", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport({ overall: metrics({ expectancyR: -0.4 }) }),
      historical: historical(),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
  });

  it("fails when no historical robustness run exists at all", () => {
    const report = buildHardTestReport({ actualPaper: paperReport(), historical: null, counterfactual: null });
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.rationale.join(" ")).toContain("none of the robustness questions have been answered");
  });
});

describe("CONTINUE_PAPER_RESEARCH is for insufficient evidence, not soft approval", () => {
  it("is chosen when only the sample size is short and nothing was contradicted", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport({ overall: metrics({ sampleCount: 8, evidenceLevel: "LOW_EVIDENCE" }) }),
      historical: historical(),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("CONTINUE_PAPER_RESEARCH");
    expect(report.headline).toContain("not yet sufficient");
  });

  it("is NOT chosen when something actually failed - that stays DRAFT", () => {
    const report = buildHardTestReport({
      actualPaper: paperReport({ overall: metrics({ sampleCount: 8, evidenceLevel: "LOW_EVIDENCE" }) }),
      historical: historical({ costStressSurvivesAll: false, costStress: [{ label: "2x", expectancyR: -0.2, survives: false }] }),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
  });

  it("does not approve on a strong but thin sample", () => {
    // Two profitable weeks are explicitly not proof.
    const report = buildHardTestReport({
      actualPaper: paperReport({ overall: metrics({ sampleCount: 6, expectancyR: 3, evidenceLevel: "EXTREMELY_LOW_EVIDENCE" }) }),
      historical: historical(),
      counterfactual: null,
    });
    expect(report.recommendation).toBe("CONTINUE_PAPER_RESEARCH");
  });
});

describe("the report keeps every track separate", () => {
  it("labels actual, historical, walk-forward and counterfactual as distinct sections", () => {
    const text = formatHardTestReport(
      buildHardTestReport({
        actualPaper: paperReport(),
        historical: historical(),
        counterfactual: { total: 120, settled: 100, bySource: { SCORE_BAND_SHADOW: 90 }, byBand: {}, byOutcome: {} },
      }),
    );

    expect(text).toContain("1. ACTUAL PAPER");
    expect(text).toContain("2. HISTORICAL BACKTEST");
    expect(text).toContain("3. WALK-FORWARD");
    expect(text).toContain("4. STRESS TESTS");
    expect(text).toContain("5. PARAMETER EXPERIMENTS");
    expect(text).toContain("6. COUNTERFACTUAL");
  });

  it("states plainly that counterfactuals never moved equity", () => {
    const text = formatHardTestReport(
      buildHardTestReport({
        actualPaper: paperReport(),
        historical: historical(),
        counterfactual: { total: 10, settled: 10, bySource: {}, byBand: {}, byOutcome: {} },
      }),
    );
    expect(text).toContain("none of them moved equity");
  });

  it("closes by restating that the system cannot approve a strategy", () => {
    const text = formatHardTestReport(
      buildHardTestReport({ actualPaper: paperReport(), historical: historical(), counterfactual: null }),
    );
    expect(text).toContain("cannot approve a strategy");
    expect(text).toContain("Strategy V1 remains DRAFT");
  });

  it("marks which gates are blocking", () => {
    const report = buildHardTestReport({ actualPaper: paperReport(), historical: historical(), counterfactual: null });
    const scoreBandGate = report.gates.find((g) => g.name === "Score band correlation");
    // Informative, but not on its own disqualifying.
    expect(scoreBandGate?.blocking).toBe(false);
    expect(report.gates.filter((g) => g.blocking).length).toBeGreaterThan(4);
  });
});
