import { describe, expect, it } from "vitest";
import { candle } from "./primitives/__fixtures__/candle";
import {
  M15_MS,
  M5_MS,
  bearishBiasCandles,
  bearishEntryCandles,
  bullishBiasCandles,
  bullishEntryCandles,
  bullishStructureCandles,
  flatBiasCandles,
  mirroredBearishStructureCandles,
} from "./primitives/__fixtures__/bullish-scenario";
import { runJeanfxDirection, determineHtfBias } from "./state-machine";
import { JEANFX_V1_PARAMS } from "./config";
import type { CanonicalCandle } from "./types";

function m15(index: number, v: number, overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return candle({ openTime: index * M15_MS, timeframe: "M15", open: v, close: v, high: v + 1, low: v - 1, ...overrides });
}

const userConfig = { confirmationPatterns: "BOTH" as const, sessionFilter: "ALL" as const };

describe("determineHtfBias", () => {
  it("is BULLISH on a sustained uptrend and BEARISH on a sustained downtrend", () => {
    expect(determineHtfBias(bullishBiasCandles())).toBe("BULLISH");
    expect(determineHtfBias(bearishBiasCandles())).toBe("BEARISH");
  });

  it("is NONE when there's no clear trend or insufficient history", () => {
    expect(determineHtfBias(flatBiasCandles())).toBe("NONE");
    expect(determineHtfBias([])).toBe("NONE");
  });
});

describe("runJeanfxDirection - LONG", () => {
  it("reaches READY with a complete, R:R-valid setup on a full bullish sequence", () => {
    const structure = bullishStructureCandles();
    const fvgFormedAt = structure[structure.length - 1].openTime;
    const entry = bullishEntryCandles(fvgFormedAt);
    const result = runJeanfxDirection(bullishBiasCandles(), structure, entry, "LONG", JEANFX_V1_PARAMS, userConfig);

    expect(result.state).toBe("READY");
    expect(result.setup).not.toBeNull();
    expect(result.setup!.direction).toBe("LONG");
    expect(result.setup!.target.level).toBeGreaterThan(result.setup!.entry);
    expect(result.setup!.rMultiple).toBeGreaterThanOrEqual(JEANFX_V1_PARAMS.rrMinimum);
    expect(result.setup!.stop).toBeLessThan(result.setup!.entry);
    // Every transition carries a reason code, timestamp, and (where applicable) a price level.
    for (const t of result.transitions) {
      expect(t.reasonCode).toBeTruthy();
      expect(typeof t.timestamp).toBe("number");
    }
    expect(result.transitions.map((t) => t.state)).toContain("WAITING_FOR_LIQUIDITY_SWEEP");
    expect(result.transitions.map((t) => t.state)).toContain("WAITING_FOR_STRUCTURE_CONFIRMATION");
    expect(result.transitions.map((t) => t.state)).toContain("WAITING_FOR_FVG");
    expect(result.transitions.map((t) => t.state)).toContain("WAITING_FOR_RETRACE");
    expect(result.transitions.map((t) => t.state)).toContain("READY");
  });

  it("stays at WAITING_FOR_BIAS when the HTF bias does not support the requested direction", () => {
    const structure = bullishStructureCandles();
    const entry = bullishEntryCandles(structure[structure.length - 1].openTime);
    const result = runJeanfxDirection(bearishBiasCandles(), structure, entry, "LONG", JEANFX_V1_PARAMS, userConfig);
    expect(result.state).toBe("WAITING_FOR_BIAS");
    expect(result.setup).toBeNull();
  });

  it("never reaches READY with no sweep/structure/FVG data (flat market)", () => {
    const flatStructure = Array.from({ length: 60 }, (_, i) => m15(i, 100));
    const result = runJeanfxDirection(bullishBiasCandles(), flatStructure, flatStructure, "LONG", JEANFX_V1_PARAMS, userConfig);
    expect(result.state).not.toBe("READY");
    expect(result.setup).toBeNull();
  });
});

describe("runJeanfxDirection - SHORT (mirrored)", () => {
  it("reaches READY on the exact mirror of the bullish sequence", () => {
    const structure = mirroredBearishStructureCandles();
    const fvgFormedAt = structure[structure.length - 1].openTime;
    const entry = bearishEntryCandles(fvgFormedAt);
    const result = runJeanfxDirection(bearishBiasCandles(), structure, entry, "SHORT", JEANFX_V1_PARAMS, userConfig);

    expect(result.state).toBe("READY");
    expect(result.setup!.direction).toBe("SHORT");
    expect(result.setup!.target.level).toBeLessThan(result.setup!.entry);
    expect(result.setup!.stop).toBeGreaterThan(result.setup!.entry);
    expect(result.setup!.rMultiple).toBeGreaterThanOrEqual(JEANFX_V1_PARAMS.rrMinimum);
  });
});

describe("invalidation", () => {
  it("INVALIDATED when price closes fully through the far edge of the FVG before any confirmation", () => {
    const structure = bullishStructureCandles();
    const fvgFormedAt = structure[structure.length - 1].openTime;
    const collapse = candle({ openTime: fvgFormedAt + M5_MS, timeframe: "M5", open: 110, high: 111, low: 90, close: 95 }); // closes well below rangeLow(106)
    const result = runJeanfxDirection(bullishBiasCandles(), structure, [collapse], "LONG", JEANFX_V1_PARAMS, userConfig);
    expect(result.state).toBe("INVALIDATED");
    expect(result.setup).toBeNull();
    expect(result.transitions.at(-1)?.reasonCode).toBe("FVG_INVALIDATED");
  });

  it("INVALIDATED with NO_VALID_TARGET_RR when no liquidity pool clears the minimum R:R", () => {
    const structure = bullishStructureCandles().filter((c) => c.openTime !== 2 * M15_MS && c.openTime !== 1 * M15_MS && c.openTime !== 0); // drop the 251 target swing entirely
    const fvgFormedAt = structure[structure.length - 1].openTime;
    const entry = bullishEntryCandles(fvgFormedAt);
    const result = runJeanfxDirection(bullishBiasCandles(), structure, entry, "LONG", JEANFX_V1_PARAMS, userConfig);
    expect(result.state).toBe("INVALIDATED");
    expect(result.transitions.at(-1)?.reasonCode).toBe("NO_VALID_TARGET_RR");
  });
});

describe("no lookahead", () => {
  it("appending future structure candles never changes an already-reached READY result", () => {
    const structure = bullishStructureCandles();
    const fvgFormedAt = structure[structure.length - 1].openTime;
    const entry = bullishEntryCandles(fvgFormedAt);
    const baseline = runJeanfxDirection(bullishBiasCandles(), structure, entry, "LONG", JEANFX_V1_PARAMS, userConfig);

    const withFuture = [...structure, m15(structure.length, 500, { high: 1000, low: 1 })]; // an absurd future candle
    const withFutureResult = runJeanfxDirection(bullishBiasCandles(), withFuture, entry, "LONG", JEANFX_V1_PARAMS, userConfig);

    expect(withFutureResult.setup?.entry).toBe(baseline.setup?.entry);
    expect(withFutureResult.setup?.stop).toBe(baseline.setup?.stop);
  });
});
