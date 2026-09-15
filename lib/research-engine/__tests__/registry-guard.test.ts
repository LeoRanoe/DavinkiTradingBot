import { describe, expect, it } from "vitest";
import { assertRegisteredParameterSet } from "../registry-guard";
import { TRB_STRATEGY, getTrbParameterSet } from "../strategies/trb";

describe("assertRegisteredParameterSet (§3) — runtime registry invariant, not just a TypeScript type", () => {
  const real = getTrbParameterSet("TRB-1H-20-10")!;

  it("does not throw for the actual preregistered parameter set", () => {
    expect(() => assertRegisteredParameterSet(TRB_STRATEGY, real)).not.toThrow();
  });

  it("throws when strategyId does not match the strategy being run against", () => {
    const mutated = { ...real, strategyId: "not-v2-trb" };
    expect(() => assertRegisteredParameterSet(TRB_STRATEGY, mutated)).toThrow(/strategyId/);
  });

  it("throws when the id is not registered on the strategy at all", () => {
    const adHoc = { ...real, id: "TRB-MADE-UP" };
    expect(() => assertRegisteredParameterSet(TRB_STRATEGY, adHoc)).toThrow(/not registered/);
  });

  it("throws when params are mutated under an existing, otherwise-valid id", () => {
    const mutated = { ...real, params: { ...real.params, entryLookback: 21 } };
    expect(() => assertRegisteredParameterSet(TRB_STRATEGY, mutated)).toThrow(/params mismatch/);
  });

  it("throws when timeframe is mutated under an existing, otherwise-valid id", () => {
    const mutated = { ...real, timeframe: "4H" as const };
    expect(() => assertRegisteredParameterSet(TRB_STRATEGY, mutated)).toThrow(/timeframe mismatch/);
  });

  it("accepts every one of the six real preregistered TRB parameter sets", () => {
    for (const p of TRB_STRATEGY.parameterSets) {
      expect(() => assertRegisteredParameterSet(TRB_STRATEGY, p)).not.toThrow();
    }
    expect(TRB_STRATEGY.parameterSets).toHaveLength(6);
  });
});
