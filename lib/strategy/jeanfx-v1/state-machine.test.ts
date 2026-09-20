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
import { readFile } from "node:fs/promises";
import { runJeanfxDirection, determineHtfBias } from "./state-machine";
import { JEANFX_V1_PARAMS } from "./config";
import type { CanonicalCandle } from "./types";

function m15(index: number, v: number, overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return candle({ openTime: index * M15_MS, timeframe: "M15", open: v, close: v, high: v + 1, low: v - 1, ...overrides });
}

const userConfig = { confirmationPatterns: "BOTH" as const, sessionFilter: "ALL" as const };

describe("determineHtfBias - liquidity-based (SOURCE rule)", () => {
  it("is BULLISH when the nearest unswept liquidity sits BELOW price (sell-side draw)", () => {
    // Rising market: every previously-formed session high/low is now below
    // price, so the only liquidity still in front of price is sell-side.
    // Source: "Determine bias by observing where liquidity sits relative to
    // price" + a sell-side sweep precedes a bullish shift.
    const result = determineHtfBias(bullishBiasCandles(), JEANFX_V1_PARAMS);
    expect(result.bias).toBe("BULLISH");
    expect(result.reasonCode).toBe("DRAW_SELL_SIDE");
    expect(result.draw?.side).toBe("SELL_SIDE");
  });

  it("is BEARISH when the nearest unswept liquidity sits ABOVE price (buy-side draw)", () => {
    const result = determineHtfBias(bearishBiasCandles(), JEANFX_V1_PARAMS);
    expect(result.bias).toBe("BEARISH");
    expect(result.reasonCode).toBe("DRAW_BUY_SIDE");
    expect(result.draw?.side).toBe("BUY_SIDE");
  });

  it("is NONE when the draw is ambiguous or no liquidity is mapped", () => {
    // Perfectly flat: buy-side and sell-side liquidity are equidistant, so
    // the draw is genuinely undecidable and must not be guessed.
    const flat = determineHtfBias(flatBiasCandles(), JEANFX_V1_PARAMS);
    expect(flat.bias).toBe("NONE");
    expect(["AMBIGUOUS_DRAW", "NO_LIQUIDITY_MAPPED"]).toContain(flat.reasonCode);

    const empty = determineHtfBias([], JEANFX_V1_PARAMS);
    expect(empty.bias).toBe("NONE");
    expect(empty.reasonCode).toBe("MISSING_MARKET_DATA");
  });

  it("never consults EMAs - JeanFX bias is a liquidity read, not a trend read", async () => {
    const source = await readFile(new URL("./state-machine.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bema\b/i);
    const biasSource = await readFile(new URL("./primitives/bias.ts", import.meta.url), "utf8");
    expect(biasSource).not.toMatch(/\bema\(/i);
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

  it("INVALIDATED with NO_TARGET_LIQUIDITY when there is no opposing liquidity pool at all", () => {
    const structure = bullishStructureCandles().filter((c) => c.openTime !== 2 * M15_MS && c.openTime !== 1 * M15_MS && c.openTime !== 0); // drop the 251 target swing entirely
    const fvgFormedAt = structure[structure.length - 1].openTime;
    const entry = bullishEntryCandles(fvgFormedAt);
    const result = runJeanfxDirection(bullishBiasCandles(), structure, entry, "LONG", JEANFX_V1_PARAMS, userConfig);
    expect(result.state).toBe("INVALIDATED");
    expect(result.transitions.at(-1)?.reasonCode).toBe("NO_TARGET_LIQUIDITY");
  });

  it("rejects with RR_BELOW_MINIMUM rather than re-targeting a further pool to manufacture 3R", () => {
    // SOURCE: "Targets are placed at the next liquidity pool" AND "Risk
    // Reward Minimum 1:3". Here a NEAR buy-side pool (~156) is planted above
    // the entry (~119) but well inside 3R, while the far 251 pool WOULD
    // clear 3R. The old scan-forward selection skipped past the near pool to
    // the 251 one - manufacturing the required R:R and aiming at a level
    // JeanFX never pointed to. Correct behaviour is to reject.
    const structure = bullishStructureCandles().map((c) => {
      const bump: Record<number, number> = { 5: 120, 6: 155, 7: 120 };
      const v = bump[c.openTime / M15_MS];
      return v === undefined ? c : { ...c, open: v, close: v, high: v + 1, low: v - 1 };
    });
    const entry = bullishEntryCandles(structure[structure.length - 1].openTime);
    const result = runJeanfxDirection(bullishBiasCandles(), structure, entry, "LONG", JEANFX_V1_PARAMS, userConfig);

    expect(result.setup).toBeNull();
    expect(result.state).toBe("INVALIDATED");
    expect(result.transitions.at(-1)?.reasonCode).toBe("RR_BELOW_MINIMUM");
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
