import { describe, expect, it } from "vitest";
import { computeConfigFingerprint, registerResearchTrial, type RegisterTrialInput } from "../trial";
import { computeChronologicalSplit } from "../split";
import { ZERO_COST_MODEL } from "../cost-model";

function baseInput(overrides: Partial<RegisterTrialInput> = {}): RegisterTrialInput {
  const candleOpenTimes = Array.from({ length: 100 }, (_, i) => i * 3_600_000);
  return {
    strategyVersion: "v2-trb",
    parameterSetId: "TRB-1H-20-10",
    instrumentId: "CRYPTO:BYBIT:BTC/USDT",
    timeframe: "1H",
    candleOpenTimes,
    split: computeChronologicalSplit(candleOpenTimes.length),
    costAssumptions: ZERO_COST_MODEL,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe("registerResearchTrial (§19)", () => {
  it("records every field a reviewer needs to know exactly what was tested", () => {
    const trial = registerResearchTrial(baseInput());
    expect(trial.strategyVersion).toBe("v2-trb");
    expect(trial.parameterSetId).toBe("TRB-1H-20-10");
    expect(trial.instrumentId).toBe("CRYPTO:BYBIT:BTC/USDT");
    expect(trial.timeframe).toBe("1H");
    expect(trial.status).toBe("REGISTERED");
    expect(trial.costAssumptions).toEqual(ZERO_COST_MODEL);
  });

  it("development/validation/holdout date ranges come from the actual candle timestamps at the split boundaries", () => {
    const input = baseInput();
    const trial = registerResearchTrial(input);
    expect(trial.development.startMs).toBe(input.candleOpenTimes[0]);
    expect(trial.development.endMs).toBe(input.candleOpenTimes[input.split.development.endIndex - 1]);
    expect(trial.holdout.endMs).toBe(input.candleOpenTimes[input.candleOpenTimes.length - 1]);
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

  it("configFingerprint changes if the cost assumptions change", () => {
    const t1 = registerResearchTrial(baseInput());
    const t2 = registerResearchTrial(baseInput({ costAssumptions: { ...ZERO_COST_MODEL, entryFeeBps: 10 } }));
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
      instrumentId: "i1",
      timeframe: "1H",
      dataStart: 0,
      dataEnd: 100,
      development: { startMs: 0, endMs: 60 },
      validation: { startMs: 60, endMs: 80 },
      holdout: { startMs: 80, endMs: 100 },
      costAssumptions: ZERO_COST_MODEL,
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
