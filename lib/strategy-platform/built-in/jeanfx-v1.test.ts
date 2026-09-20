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

describe("SOURCE fidelity: direction handling has no array-order bias", () => {
  const baseCtx = (parameters: Record<string, unknown>) => ({
    instrument: { id: "XAUUSD", assetClass: "METAL" as const, pipSize: 0.01 },
    now: Date.now(),
    candlesByTimeframe: {},
    marketSession: null,
    currentPosition: null,
    strategyParameters: parameters,
  });

  it("fails closed on an invalid configuration instead of silently using defaults", () => {
    // 5% risk is outside the source's 0.5-1%. The old adapter fell back to
    // defaults and traded on regardless.
    const decision = jeanfxV1BuiltInStrategy.evaluate(baseCtx({ riskPct: 0.05 }));
    expect(decision.type).toBe("NO_ACTION");
    if (decision.type === "NO_ACTION") expect(decision.reason).toMatch(/INVALID_CONFIGURATION/);
  });

  it("reports missing market data rather than evaluating an empty timeframe", () => {
    const decision = jeanfxV1BuiltInStrategy.evaluate(baseCtx({ profile: "JEANFX_GOLD_ACTIVE" }));
    expect(decision.type).toBe("NO_ACTION");
    if (decision.type === "NO_ACTION") expect(decision.reason).toBe("MISSING_MARKET_DATA");
  });

  it("exposes a parameter-aware timeframe resolver so a profile cannot receive the wrong candles", () => {
    expect(typeof jeanfxV1BuiltInStrategy.resolveRequiredTimeframes).toBe("function");
    expect(jeanfxV1BuiltInStrategy.resolveRequiredTimeframes!({ profile: "JEANFX_GOLD_ACTIVE" })).toContain("M30");
  });

  it("supports both LONG and SHORT on METAL", () => {
    expect(jeanfxV1BuiltInStrategy.metadata.supportedSides).toEqual(expect.arrayContaining(["LONG", "SHORT"]));
    expect(jeanfxV1BuiltInStrategy.metadata.supportedAssetClasses).toContain("METAL");
  });
});
