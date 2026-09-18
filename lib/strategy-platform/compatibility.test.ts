import { describe, expect, it } from "vitest";
import { checkStrategyCompatibility } from "./compatibility";
import type { StrategyMetadata } from "./types";
import type { VenueCapabilities } from "./orchestrator-types";

const jeanfxMetadata: StrategyMetadata = {
  slug: "jeanfx-v1",
  displayName: "JeanFX Liquidity System",
  description: "",
  type: "BUILT_IN",
  status: "RESEARCH_ONLY",
  requiredTimeframes: ["H1", "M15", "M5"],
  supportedAssetClasses: ["CRYPTO", "FOREX", "METAL"],
  supportedSides: ["LONG", "SHORT"],
  minimumHistoryRequirements: { H1: 210, M15: 50, M5: 50 },
  requiredFeatures: [],
};

const bybitSpot: VenueCapabilities = { supportsShort: false, supportedAssetClasses: ["CRYPTO"] };
const forexBroker: VenueCapabilities = { supportsShort: true, supportedAssetClasses: ["FOREX", "METAL"] };
const instrument = { id: "BTCUSDT", assetClass: "CRYPTO" as const, pipSize: 0.01 };
const plentyOfHistory = { H1: 300, M15: 300, M5: 300 };

describe("checkStrategyCompatibility", () => {
  it("LONG JeanFX on Bybit spot with enough history is fully compatible", () => {
    const result = checkStrategyCompatibility({ metadata: jeanfxMetadata, instrument, venue: bybitSpot, side: "LONG", availableHistoryBars: plentyOfHistory });
    expect(result).toEqual({ researchCompatible: true, executionCompatible: true, reasons: [] });
  });

  it("SHORT JeanFX on Bybit spot is research-compatible but not execution-compatible, with the exact example reasoning", () => {
    const result = checkStrategyCompatibility({ metadata: jeanfxMetadata, instrument, venue: bybitSpot, side: "SHORT", availableHistoryBars: plentyOfHistory });
    expect(result.researchCompatible).toBe(true);
    expect(result.executionCompatible).toBe(false);
    expect(result.reasons[0]).toMatch(/SHORT setups cannot currently execute.*long-only/);
  });

  it("SHORT is fully compatible on a venue that supports it", () => {
    const xauusd = { id: "XAUUSD", assetClass: "METAL" as const, pipSize: 0.01 };
    const result = checkStrategyCompatibility({ metadata: jeanfxMetadata, instrument: xauusd, venue: forexBroker, side: "SHORT", availableHistoryBars: plentyOfHistory });
    expect(result).toEqual({ researchCompatible: true, executionCompatible: true, reasons: [] });
  });

  it("unsupported asset class blocks both research and execution", () => {
    const cryptoOnlyMeta: StrategyMetadata = { ...jeanfxMetadata, supportedAssetClasses: ["CRYPTO"] };
    const xauusd = { id: "XAUUSD", assetClass: "METAL" as const, pipSize: 0.01 };
    const result = checkStrategyCompatibility({ metadata: cryptoOnlyMeta, instrument: xauusd, venue: forexBroker, side: "LONG", availableHistoryBars: plentyOfHistory });
    expect(result.researchCompatible).toBe(false);
    expect(result.executionCompatible).toBe(false);
  });

  it("insufficient history blocks both, with a specific bar-count reason", () => {
    const result = checkStrategyCompatibility({ metadata: jeanfxMetadata, instrument, venue: bybitSpot, side: "LONG", availableHistoryBars: { H1: 10, M15: 10, M5: 10 } });
    expect(result.researchCompatible).toBe(false);
    expect(result.reasons.some((r) => /requires 210 closed H1 bars but only 10/.test(r))).toBe(true);
  });

  it("an unsupported side is incompatible outright, not merely execution-blocked", () => {
    const longOnlyMeta: StrategyMetadata = { ...jeanfxMetadata, supportedSides: ["LONG"] };
    const result = checkStrategyCompatibility({ metadata: longOnlyMeta, instrument, venue: forexBroker, side: "SHORT", availableHistoryBars: plentyOfHistory });
    expect(result.researchCompatible).toBe(false);
    expect(result.executionCompatible).toBe(false);
  });
});
