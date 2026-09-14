import { describe, expect, it } from "vitest";
import type { ResearchTrade } from "./harness";
import {
  assessStability,
  costStressScenarios,
  defaultParameterVariants,
  entryDelayScenarios,
  metricsFor,
  runSplits,
  runWalkForward,
  stopTargetVariants,
  toLearningTrades,
  type VariantOutcome,
} from "./suite";
import { analyzeComponents, analyzeExcursions, analyzeRegimes, analyzeScoreBands } from "./analysis";

const HOUR = 3_600_000;
const START = Date.parse("2026-01-01T00:00:00Z");

let seq = 0;
function trade(overrides: Partial<ResearchTrade> = {}): ResearchTrade {
  seq += 1;
  const pnl = overrides.pnl ?? 1;
  return {
    symbol: "BTCUSDT",
    track: "AUTHORITATIVE",
    signalTime: START + seq * HOUR,
    entryTime: START + seq * HOUR,
    exitTime: START + seq * HOUR + HOUR,
    entryPrice: 100,
    exitPrice: 102,
    stopPrice: 99,
    targetPrice: 102,
    qty: 1,
    riskBudget: 10,
    plannedRisk: 1,
    fees: 0.02,
    slippage: 0.01,
    grossPnl: pnl,
    pnl,
    rMultiple: pnl,
    outcome: pnl > 0 ? "TARGET" : "STOP",
    score: 88,
    band: "85-89",
    classification: "CANDIDATE",
    regime: "BULLISH",
    atrPct: 0.015,
    volatility: "MEDIUM",
    components: { trend: 25, pullback: 15, momentum: 10, volume: 12, riskReward: 15, volatility: 10 },
    mfeR: 1.2,
    maeR: 0.3,
    mfePrice: 1.2,
    maePrice: 0.3,
    barsHeld: 4,
    ...overrides,
  };
}

function outcome(parameter: string, value: number, expectancyR: number | null, sample = 30): VariantOutcome {
  const trades = expectancyR === null ? [] : Array.from({ length: sample }, () => trade({ pnl: expectancyR }));
  return { label: `${parameter} ${value}`, parameter, value, metrics: metricsFor(trades), trades: trades.length };
}

describe("chronological splits", () => {
  it("never shuffles: every split stays in time order and boundaries are respected", () => {
    const trades = Array.from({ length: 100 }, (_, i) => trade({ signalTime: START + i * HOUR, entryTime: START + i * HOUR }));
    const result = runSplits(trades, 0.6, 0.2);

    expect(result.counts.development).toBe(60);
    expect(result.counts.validation).toBe(20);
    expect(result.counts.holdout).toBe(20);
    // The holdout must lie strictly after the development period.
    expect(result.boundaries.developmentEnd).toBeLessThan(result.boundaries.validationEnd!);
  });

  it("leaves a non-empty holdout, refusing a split that would consume it", () => {
    const trades = Array.from({ length: 50 }, () => trade());
    expect(() => runSplits(trades, 0.9, 0.2)).toThrow();
  });

  it("sorts unordered input before splitting so a shuffled array cannot leak the future", () => {
    const ordered = Array.from({ length: 60 }, (_, i) => trade({ signalTime: START + i * HOUR, entryTime: START + i * HOUR }));
    const shuffled = [...ordered].reverse();

    const a = runSplits(ordered, 0.6, 0.2);
    const b = runSplits(shuffled, 0.6, 0.2);
    expect(b.boundaries.developmentEnd).toBe(a.boundaries.developmentEnd);
  });
});

describe("walk-forward", () => {
  it("aggregates only unseen periods", () => {
    // With a stride equal to the validation size, the validation slices are
    // contiguous and non-overlapping from index `developmentSize` onward, and
    // the FIRST development block is never evaluated. So: make that first
    // block spectacular and everything after it a loser. If development ever
    // leaked into the aggregate, the unseen expectancy would come out
    // positive.
    const trades: ResearchTrade[] = [];
    for (let i = 0; i < 60; i += 1) {
      const isFirstDevelopmentBlock = i < 10;
      const pnl = isFirstDevelopmentBlock ? 5 : -1;
      trades.push(trade({ signalTime: START + i * HOUR, entryTime: START + i * HOUR, pnl, rMultiple: pnl }));
    }

    const result = runWalkForward(trades, 10, 5);
    expect(result.windows).toBeGreaterThan(0);
    expect(result.unseen.sampleCount).toBeGreaterThan(0);
    expect(result.unseen.expectancyR).toBeLessThan(0);
    // The 10 unevaluated development trades are genuinely excluded.
    expect(result.unseen.sampleCount).toBe(50);
  });

  it("reports each window separately so a single lucky period is visible", () => {
    const trades = Array.from({ length: 60 }, () => trade({ pnl: 1 }));
    const result = runWalkForward(trades, 20, 10);
    expect(result.perWindow.length).toBe(result.windows);
    for (const w of result.perWindow) expect(w.development).toBe(20);
  });
});

describe("parameter stability - the anti-curve-fitting check", () => {
  it("calls a broad profitable region stable", () => {
    const stability = assessStability("minCandidateScore", [
      outcome("minCandidateScore", 80, 0.3),
      outcome("minCandidateScore", 85, 0.35),
      outcome("minCandidateScore", 90, 0.28),
    ]);

    expect(stability.stableAcrossRange).toBe(true);
    expect(stability.suspectedOutlier).toBe(false);
    expect(stability.profitableSettings).toBe(3);
  });

  it("flags a lone spectacular setting surrounded by losers as an outlier", () => {
    // The classic curve-fitting signature: one jackpot, poor neighbours.
    const stability = assessStability("minRiskReward", [
      outcome("minRiskReward", 1.5, -0.2),
      outcome("minRiskReward", 1.75, 2.5),
      outcome("minRiskReward", 2.0, -0.15),
    ]);

    expect(stability.suspectedOutlier).toBe(true);
    expect(stability.stableAcrossRange).toBe(false);
    expect(stability.note).toContain("curve-fitting");
  });

  it("does not call a uniformly losing region stable", () => {
    const stability = assessStability("maxAtrPct", [
      outcome("maxAtrPct", 0.03, -0.2),
      outcome("maxAtrPct", 0.05, -0.1),
      outcome("maxAtrPct", 0.07, -0.3),
    ]);

    expect(stability.stableAcrossRange).toBe(false);
    expect(stability.profitableSettings).toBe(0);
  });

  it("says so plainly when there is not enough data", () => {
    const stability = assessStability("minCandidateScore", [outcome("minCandidateScore", 80, null)]);
    expect(stability.stableAcrossRange).toBe(false);
    expect(stability.note).toContain("Not enough");
  });
});

describe("scenario definitions stay small and defensible", () => {
  it("sweeps only a handful of nearby settings, never a brute-force grid", () => {
    const variants = defaultParameterVariants({
      riskBudget: 10,
      equity: 1000,
      instrument: { tickSize: 0.01, qtyStep: 0.001, minOrderQty: 0.001, minOrderAmt: 1, maxOrderQty: null },
      feeBps: 10,
      slippageBps: 5,
      minCandidateScore: 80,
      minRiskReward: 1.5,
      maxAtrPct: 0.05,
    });

    expect(variants.length).toBeLessThanOrEqual(12);
    expect(new Set(variants.map((v) => v.parameter))).toEqual(
      new Set(["minCandidateScore", "minRiskReward", "maxAtrPct"]),
    );
  });

  it("scales cost scenarios from the configured base rather than hardcoding", () => {
    const scenarios = costStressScenarios({
      riskBudget: 10,
      equity: 1000,
      instrument: { tickSize: 0.01, qtyStep: 0.001, minOrderQty: 0.001, minOrderAmt: 1, maxOrderQty: null },
      feeBps: 10,
      slippageBps: 5,
      minCandidateScore: 80,
      minRiskReward: 1.5,
      maxAtrPct: 0.05,
    });

    const oneAndHalf = scenarios.find((s) => s.label.startsWith("1.5x"));
    expect(oneAndHalf?.overrides.feeBps).toBe(15);
    expect(oneAndHalf?.overrides.slippageBps).toBe(7.5);

    const doubleSlip = scenarios.find((s) => s.label === "2x slippage");
    expect(doubleSlip?.overrides.slippageBps).toBe(10);
    expect(doubleSlip?.overrides.feeBps).toBeUndefined();
  });

  it("expresses entry delay in whole bars, not invented tick precision", () => {
    for (const scenario of entryDelayScenarios()) {
      expect(Number.isInteger(scenario.overrides.entryDelayBars)).toBe(true);
    }
  });

  it("includes unchanged V1 among the stop/target variants as the reference", () => {
    const variants = stopTargetVariants();
    const v1 = variants.find((v) => v.label === "V1");
    expect(v1?.stopDistanceMultiple).toBe(1);
    expect(v1?.targetRMultiple).toBe(2);
  });
});

describe("historical trades are never counted as actual PAPER outcomes", () => {
  it("marks every converted trade as not actual", () => {
    const converted = toLearningTrades([trade(), trade({ track: "SHADOW" })]);
    expect(converted.every((t) => t.actual === false)).toBe(true);
  });
});

describe("score-band analysis", () => {
  it("detects a monotonic score-outcome relationship", () => {
    const trades = [
      ...Array.from({ length: 25 }, () => trade({ band: "BELOW_80", score: 70, pnl: -0.5, rMultiple: -0.5 })),
      ...Array.from({ length: 25 }, () => trade({ band: "80-84", score: 82, pnl: 0.2, rMultiple: 0.2 })),
      ...Array.from({ length: 25 }, () => trade({ band: "95-100", score: 97, pnl: 0.9, rMultiple: 0.9 })),
    ];

    const result = analyzeScoreBands(trades);
    expect(result.monotonic).toBe(true);
    expect(result.correlationNote).toContain("consistent with the score carrying real information");
  });

  it("says plainly when a higher score does NOT mean a better outcome", () => {
    const trades = [
      ...Array.from({ length: 25 }, () => trade({ band: "80-84", score: 82, pnl: 1.2, rMultiple: 1.2 })),
      ...Array.from({ length: 25 }, () => trade({ band: "95-100", score: 97, pnl: -0.4, rMultiple: -0.4 })),
    ];

    const result = analyzeScoreBands(trades);
    expect(result.monotonic).toBe(false);
    expect(result.correlationNote).toContain("does NOT rise monotonically");
  });

  it("names thin bands rather than reporting them with false confidence", () => {
    const trades = [
      ...Array.from({ length: 25 }, () => trade({ band: "80-84", score: 82, pnl: 0.2, rMultiple: 0.2 })),
      ...Array.from({ length: 3 }, () => trade({ band: "95-100", score: 97, pnl: 3, rMultiple: 3 })),
    ];
    expect(analyzeScoreBands(trades).correlationNote).toContain("Thin samples");
  });
});

describe("component analysis", () => {
  it("notices a component that scores higher in losers", () => {
    const trades = [
      ...Array.from({ length: 25 }, () =>
        trade({ pnl: 1, rMultiple: 1, components: { trend: 25, pullback: 15, momentum: 2, volume: 12, riskReward: 15, volatility: 10 } }),
      ),
      ...Array.from({ length: 25 }, () =>
        trade({ pnl: -1, rMultiple: -1, components: { trend: 25, pullback: 15, momentum: 14, volume: 12, riskReward: 15, volatility: 10 } }),
      ),
    ];

    const result = analyzeComponents(trades);
    const momentum = result.perComponent.find((c) => c.component === "momentum");
    expect(momentum?.difference).toBeLessThan(0);
    expect(momentum?.note).toContain("HIGHER in losers");
  });

  it("emits hypotheses only, never a weight change", () => {
    const trades = [
      ...Array.from({ length: 25 }, () =>
        trade({ pnl: 1, rMultiple: 1, components: { trend: 25, pullback: 18, momentum: 12, volume: 14, riskReward: 15, volatility: 10 } }),
      ),
      ...Array.from({ length: 25 }, () =>
        trade({ pnl: -1, rMultiple: -1, components: { trend: 12, pullback: 5, momentum: 3, volume: 4, riskReward: 15, volatility: 10 } }),
      ),
    ];

    const result = analyzeComponents(trades);
    expect(result.hypotheses.length).toBeGreaterThan(0);
    for (const h of result.hypotheses) expect(h).toContain("weights unchanged");
  });

  it("reports the specific combinations the research asks about", () => {
    const trades = Array.from({ length: 10 }, () =>
      trade({ components: { trend: 25, pullback: 15, momentum: 10, volume: 2, riskReward: 15, volatility: 10 } }),
    );
    const labels = analyzeComponents(trades).combinations.map((c) => c.label);
    expect(labels).toContain("strong trend + weak volume");
  });
});

describe("excursion analysis", () => {
  it("flags winners that routinely survive deep adverse excursion", () => {
    const trades = Array.from({ length: 25 }, () => trade({ pnl: 1, rMultiple: 1, maeR: 0.9, mfeR: 2.1 }));
    const result = analyzeExcursions(trades);
    expect(result.winnersWithDeepAdverseExcursion).toBe(25);
    expect(result.observations.join(" ")).toContain("stop is close to the noise floor");
    // Still only a hypothesis.
    expect(result.observations.join(" ")).toContain("Not acted on");
  });

  it("flags losers that were meaningfully in profit first", () => {
    const trades = Array.from({ length: 25 }, () => trade({ pnl: -1, rMultiple: -1, mfeR: 1.5, maeR: 1 }));
    const result = analyzeExcursions(trades);
    expect(result.losersWithFavourableExcursion).toBe(25);
    expect(result.observations.join(" ")).toContain("before reversing");
  });

  it("flags winners leaving substantial MFE unused", () => {
    const trades = Array.from({ length: 25 }, () => trade({ pnl: 1, rMultiple: 1, mfeR: 3.2, maeR: 0.1 }));
    expect(analyzeExcursions(trades).observations.join(" ")).toContain("leaving favourable excursion unused");
  });

  it("says nothing at all when there are no resolved trades", () => {
    const result = analyzeExcursions([]);
    expect(result.evidence).toBe("NO_DATA");
    expect(result.observations.join(" ")).toContain("nothing can be said");
  });
});

describe("regime analysis", () => {
  it("warns when only one asset carries the edge", () => {
    const trades = [
      ...Array.from({ length: 20 }, () => trade({ symbol: "BTCUSDT", pnl: 1, rMultiple: 1 })),
      ...Array.from({ length: 20 }, () => trade({ symbol: "ETHUSDT", pnl: -1, rMultiple: -1 })),
    ];

    const result = analyzeRegimes(trades);
    expect(result.concentrationWarning).toContain("asset");
    expect(result.bySymbol.map((b) => b.key).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("does not warn when both assets hold up", () => {
    const trades = [
      ...Array.from({ length: 20 }, () => trade({ symbol: "BTCUSDT", pnl: 1, rMultiple: 1 })),
      ...Array.from({ length: 20 }, () => trade({ symbol: "ETHUSDT", pnl: 1, rMultiple: 1 })),
    ];
    expect(analyzeRegimes(trades).concentrationWarning).toBeNull();
  });

  it("breaks results down by regime and volatility band", () => {
    const trades = [
      ...Array.from({ length: 10 }, () => trade({ volatility: "LOW" })),
      ...Array.from({ length: 10 }, () => trade({ volatility: "HIGH" })),
    ];
    expect(analyzeRegimes(trades).byVolatility.map((b) => b.key).sort()).toEqual(["HIGH", "LOW"]);
  });
});
