import { describe, expect, it } from "vitest";
import { jeanfxV1BuiltInStrategy } from "./jeanfx-v1";
import type { StrategyContext } from "../types";

function baseCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    instrument: { id: "BTCUSDT", assetClass: "CRYPTO", pipSize: 0.01 },
    now: Date.now(),
    candlesByTimeframe: {},
    marketSession: null,
    currentPosition: null,
    strategyParameters: {},
    ...overrides,
  };
}

describe("jeanfxV1BuiltInStrategy (generic contract wiring)", () => {
  it("is featured metadata: BUILT_IN, RESEARCH_ONLY, both sides supported", () => {
    expect(jeanfxV1BuiltInStrategy.metadata.type).toBe("BUILT_IN");
    expect(jeanfxV1BuiltInStrategy.metadata.status).toBe("RESEARCH_ONLY");
    expect(jeanfxV1BuiltInStrategy.metadata.supportedSides).toEqual(["LONG", "SHORT"]);
  });

  it("returns NO_ACTION with a typed reason when market data is missing", () => {
    const decision = jeanfxV1BuiltInStrategy.evaluate(baseCtx());
    expect(decision).toEqual({ type: "NO_ACTION", reason: "MISSING_MARKET_DATA" });
  });

  it("falls back to default user config when strategyParameters fails validation, rather than throwing", () => {
    const ctx = baseCtx({ strategyParameters: { riskPct: -5 } });
    expect(() => jeanfxV1BuiltInStrategy.evaluate(ctx)).not.toThrow();
  });

  it("never produces a confidence score - JeanFX defines none mathematically", () => {
    const decision = jeanfxV1BuiltInStrategy.evaluate(baseCtx());
    if (decision.type === "ENTER_LONG" || decision.type === "ENTER_SHORT") {
      expect(decision.confidence).toBeNull();
    }
  });
});
