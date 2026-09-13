import { describe, expect, it } from "vitest";
import { calculateCounterfactualOutcome } from "./counterfactual";
import { calculateLongExcursions, createFactualTradeReview } from "./outcomes";
import { calculatePerformance, evidenceLevel } from "./analytics";
import { splitChronologically, validateExperimentDraft, walkForwardWindows } from "./experiments";
import { collectResearchCandles } from "./backfill";
import { settleCounterfactualResearch } from "./counterfactual-research";

const candle = (openTime: number, open: number, high: number, low: number) => ({ openTime, open, high, low, close: open, isClosed: true });

describe("MFE / MAE", () => {
  it("uses only supplied closed candles and normalizes long excursions by planned R", () => {
    const result = calculateLongExcursions(100, 90, [candle(1, 100, 125, 94), { ...candle(2, 100, 200, 1), isClosed: false }]);
    expect(result).toMatchObject({ mfePrice: 25, maePrice: 6, mfeR: 2.5, maeR: 0.6 });
  });
  it("persists factual realized P/L, duration, and equity-neutral review facts", () => {
    const facts = createFactualTradeReview({
      plannedEntry: 100, actualEntry: 101, stopPrice: 91, targetPrice: 121, actualExit: 111, qty: 2,
      fees: 1, slippage: 0.2, openedAt: 60_000, closedAt: 180_000, approvedAt: 0, exitReason: "TARGET",
      excursions: calculateLongExcursions(101, 91, [candle(2, 101, 112, 99)]),
    });
    expect(facts).toMatchObject({ label: "FACT", grossPnl: 20, netPnl: 19, realizedR: 0.95, durationMinutes: 2, approvalDelayMinutes: 1, exitReason: "TARGET" });
  });
});

describe("counterfactual outcomes", () => {
  const plan = { entryPrice: 100, allowedEntryMin: 99, allowedEntryMax: 101, stopPrice: 90, targetPrice: 120, expiresAt: 10 };
  it("records NO_ENTRY instead of assuming a rejected candidate traded", () => expect(calculateCounterfactualOutcome(plan, [candle(1, 105, 110, 103)])).toMatchObject({ kind: "NO_ENTRY", isHypothetical: true }));
  it("uses unfavorable stop-first ordering on an ambiguous candle", () => expect(calculateCounterfactualOutcome(plan, [candle(1, 100, 121, 89)])).toMatchObject({ kind: "STOP", conservativeAmbiguousCandle: true }));
  it("keeps target and expiry results explicitly hypothetical", () => {
    expect(calculateCounterfactualOutcome(plan, [candle(1, 100, 105, 99), candle(2, 102, 121, 101)])).toMatchObject({ kind: "TARGET", isHypothetical: true });
    expect(calculateCounterfactualOutcome(plan, [candle(1, 100, 105, 99)])).toMatchObject({ kind: "EXPIRED", isHypothetical: true });
  });
});

describe("analytics evidence guard", () => {
  it("does not present tiny samples as evidence", () => {
    expect(evidenceLevel(0)).toBe("NO_DATA"); expect(evidenceLevel(3)).toBe("EXTREMELY_LOW_EVIDENCE"); expect(evidenceLevel(19)).toBe("LOW_EVIDENCE"); expect(evidenceLevel(20)).toBe("INITIAL_EVIDENCE");
    const metrics = calculatePerformance([{ id: "a", actual: true, symbol: "BTC", strategyVersion: "v1", openedAt: 0, closedAt: 1, pnl: 1, fees: 0.1, slippage: 0, rMultiple: 1 }]);
    expect(metrics).toMatchObject({ sampleCount: 1, wins: 1, expectancyR: 1, evidenceLevel: "EXTREMELY_LOW_EVIDENCE" });
  });
});

describe("experiment leakage guards", () => {
  it("uses chronological splits, immutable V1, and walk-forward windows", () => {
    expect(splitChronologically([1, 2, 3, 4, 5])).toEqual({ development: [1, 2, 3], validation: [4], holdout: [5] });
    expect(() => validateExperimentDraft({ baseStrategyVersionId: "id", experimentalVersionLabel: "V1", changedParameters: { minimumScore: 85 }, hypothesisId: "h", developmentRange: [1, 2], validationRange: [2, 3], holdoutRange: [3, 4] })).toThrow("immutable");
    expect(walkForwardWindows([1, 2, 3, 4, 5, 6], 3, 2)).toHaveLength(1);
  });
});

describe("research backfill", () => {
  it("deduplicates, excludes unclosed bars, and provides a bounded resume cursor", async () => {
    let calls = 0;
    const result = await collectResearchCandles({ nowMs: 100, maxPages: 1, pageSize: 2, existingOpenTimes: new Set([1]), fetchPage: async () => { calls += 1; return { candles: [candle(1, 1, 1, 1), candle(2, 1, 1, 1), { ...candle(3, 1, 1, 1), isClosed: false }], nextEndMs: 0 }; } });
    expect(calls).toBe(1); expect(result.candles.map((c) => c.openTime)).toEqual([2]); expect(result.resumeEndMs).toBe(0);
  });
});

describe("research isolation", () => {
  it("isolates a counterfactual failure rather than changing actual data", async () => {
    const result = await settleCounterfactualResearch(
      [{ id: "good", plan: { entryPrice: 100, allowedEntryMin: 99, allowedEntryMax: 101, stopPrice: 90, targetPrice: 120, expiresAt: 3 } }, { id: "bad", plan: { entryPrice: 100, allowedEntryMin: 99, allowedEntryMax: 101, stopPrice: 90, targetPrice: 120, expiresAt: 3 } }],
      async (row) => { if (row.id === "bad") throw new Error("missing candles"); return [candle(1, 100, 121, 99)]; },
      async () => undefined,
    );
    expect(result).toEqual({ settled: 1, failures: 1 });
  });
});
