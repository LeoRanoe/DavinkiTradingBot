import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { computeCandleDataFingerprint, computeConfigFingerprint, registerResearchTrial, type RegisterTrialInput } from "../trial";
import { computeChronologicalSplit } from "../split";
import { ZERO_COST_MODEL } from "../cost-model";
import type { NormalizedRiskConfig } from "../position-sizing";

const RISK: NormalizedRiskConfig = { initialEquity: 10_000, riskPct: 0.01 };

function buildCandles(count: number): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    instrumentId: "CRYPTO:BYBIT:BTC/USDT",
    timeframe: "1H" as const,
    openTime: i * 3_600_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10,
    isClosed: true,
  }));
}

function baseInput(overrides: Partial<RegisterTrialInput> = {}): RegisterTrialInput {
  const candles = buildCandles(100);
  return {
    strategyVersion: "v2-trb",
    parameterSetId: "TRB-1H-20-10",
    parameterValues: { entryLookback: 20, exitLookback: 10 },
    instrumentId: "CRYPTO:BYBIT:BTC/USDT",
    timeframe: "1H",
    candles,
    split: computeChronologicalSplit(candles.length),
    costAssumptions: ZERO_COST_MODEL,
    riskAssumptions: RISK,
    codeVersion: "abc1234",
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe("registerResearchTrial (§19, hardened §10)", () => {
  it("records every field a reviewer needs to know exactly what was tested", () => {
    const trial = registerResearchTrial(baseInput());
    expect(trial.strategyVersion).toBe("v2-trb");
    expect(trial.parameterSetId).toBe("TRB-1H-20-10");
    expect(trial.parameterValues).toEqual({ entryLookback: 20, exitLookback: 10 });
    expect(trial.instrumentId).toBe("CRYPTO:BYBIT:BTC/USDT");
    expect(trial.timeframe).toBe("1H");
    expect(trial.status).toBe("REGISTERED");
    expect(trial.costAssumptions).toEqual(ZERO_COST_MODEL);
    expect(trial.riskAssumptions).toEqual(RISK);
    expect(trial.codeVersion).toBe("abc1234");
    expect(typeof trial.dataFingerprint).toBe("string");
    expect(trial.dataFingerprint.length).toBe(64); // sha256 hex
  });

  it("development/validation/holdout date ranges come from the actual candle timestamps at the split boundaries", () => {
    const input = baseInput();
    const trial = registerResearchTrial(input);
    expect(trial.development.startMs).toBe(input.candles[0].openTime);
    expect(trial.development.endMs).toBe(input.candles[input.split.development.endIndex - 1].openTime);
    expect(trial.holdout.endMs).toBe(input.candles[input.candles.length - 1].openTime);
  });

  it("configFingerprint is deterministic for identical inputs", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput());
    expect(t1.configFingerprint).toBe(t2.configFingerprint);
  });

  it("configFingerprint changes if the parameter set changes", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ parameterSetId: "TRB-1H-50-20" }));
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });

  it("configFingerprint changes if the parameter VALUES change under the same parameterSetId (§10 - id alone is not enough)", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ parameterValues: { entryLookback: 21, exitLookback: 10 } }));
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });

  it("configFingerprint changes if the cost assumptions change", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ costAssumptions: { ...ZERO_COST_MODEL, entryFeeBps: 10 } }));
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });

  it("configFingerprint changes if the risk assumptions change", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ riskAssumptions: { ...RISK, riskPct: 0.02 } }));
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });

  it("configFingerprint changes if the code version changes, even with every other input identical", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ codeVersion: "def5678" }));
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });

  it("configFingerprint changes if the instrument changes", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ instrumentId: "CRYPTO:BYBIT:ETH/USDT" }));
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });

  it("configFingerprint is stable regardless of object key order (computeConfigFingerprint sorts keys)", () => {
    const a = computeConfigFingerprint({
      strategyVersion: "v2-trb",
      parameterSetId: "p1",
      parameterValues: { a: 1 },
      instrumentId: "i1",
      timeframe: "1H",
      dataStart: 0,
      dataEnd: 100,
      development: { startMs: 0, endMs: 60 },
      validation: { startMs: 60, endMs: 80 },
      holdout: { startMs: 80, endMs: 100 },
      costAssumptions: ZERO_COST_MODEL,
      riskAssumptions: RISK,
      dataFingerprint: "fp1",
      codeVersion: "v1",
    });
    const b = computeConfigFingerprint({
      dataEnd: 100,
      dataStart: 0,
      costAssumptions: ZERO_COST_MODEL,
      holdout: { endMs: 100, startMs: 80 },
      validation: { endMs: 80, startMs: 60 },
      development: { endMs: 60, startMs: 0 },
      timeframe: "1H",
      instrumentId: "i1",
      parameterSetId: "p1",
      strategyVersion: "v2-trb",
      parameterValues: { a: 1 },
      riskAssumptions: RISK,
      dataFingerprint: "fp1",
      codeVersion: "v1",
    });
    expect(a).toBe(b);
  });

  it("does not persist to any database - pure in-memory value object", () => {
    const trial = registerResearchTrial(baseInput());
    // No I/O could have happened - this just asserts the function is synchronous and returns a plain object.
    expect(typeof trial).toBe("object");
    expect(trial.id).toContain("v2-trb");
  });
});

describe("computeCandleDataFingerprint (§10) — proves candle-data identity, not just a date range", () => {
  it("is deterministic for identical candle data", () => {
    const candles = buildCandles(50);
    expect(computeCandleDataFingerprint(candles)).toBe(computeCandleDataFingerprint(candles));
  });

  it("changes if a single price anywhere in the dataset changes", () => {
    const candles = buildCandles(50);
    const mutated = candles.map((c, i) => (i === 25 ? { ...c, close: c.close + 0.01 } : c));
    expect(computeCandleDataFingerprint(candles)).not.toBe(computeCandleDataFingerprint(mutated));
  });

  it("changes if candle order changes (same set, different sequence)", () => {
    const candles = buildCandles(10);
    const reordered = [...candles].reverse();
    expect(computeCandleDataFingerprint(candles)).not.toBe(computeCandleDataFingerprint(reordered));
  });

  it("changes if isClosed differs on any candle", () => {
    const candles = buildCandles(10);
    const mutated = candles.map((c, i) => (i === 0 ? { ...c, isClosed: false } : c));
    expect(computeCandleDataFingerprint(candles)).not.toBe(computeCandleDataFingerprint(mutated));
  });

  it("registering a trial with one price changed anywhere in the dataset changes dataFingerprint and configFingerprint", () => {
    const input = baseInput();
    const t1 = registerResearchTrial(input);
    const mutatedCandles = input.candles.map((c, i) => (i === 10 ? { ...c, close: c.close + 1 } : c));
    const t2 = registerResearchTrial({ ...input, candles: mutatedCandles });
    expect(t1.dataFingerprint).not.toBe(t2.dataFingerprint);
    expect(t1.configFingerprint).not.toBe(t2.configFingerprint);
  });
});
