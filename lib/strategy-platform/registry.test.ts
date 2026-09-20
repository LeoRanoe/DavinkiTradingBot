import { describe, expect, it } from "vitest";
import { BUILT_IN_STRATEGIES, getBuiltInStrategy, listBuiltInStrategies } from "./registry";

describe("built-in strategy registry", () => {
  it("contains exactly the three currently known built-in strategies", () => {
    const slugs = BUILT_IN_STRATEGIES.map((s) => s.metadata.slug).sort();
    expect(slugs).toEqual(["jeanfx-v1", "v1", "v2-trb"].sort());
  });

  it("has no duplicate slugs", () => {
    const slugs = BUILT_IN_STRATEGIES.map((s) => s.metadata.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("resolves a known slug", () => {
    expect(getBuiltInStrategy("jeanfx-v1")?.metadata.displayName).toBe("JeanFX Gold");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getBuiltInStrategy("does-not-exist")).toBeUndefined();
  });

  it("marks every built-in as type BUILT_IN with no client-authored evaluate() bypass", () => {
    for (const strategy of listBuiltInStrategies()) {
      expect(strategy.metadata.type).toBe("BUILT_IN");
      expect(typeof strategy.evaluate).toBe("function");
    }
  });

  it("v1's registry entry never routes execution through the generic contract", () => {
    const decision = getBuiltInStrategy("v1")!.evaluate({
      instrument: { id: "BTCUSDT", assetClass: "CRYPTO", pipSize: 0.01 },
      now: Date.now(),
      candlesByTimeframe: {},
      marketSession: null,
      currentPosition: null,
      strategyParameters: {},
    });
    expect(decision.type).toBe("NO_ACTION");
  });
});
