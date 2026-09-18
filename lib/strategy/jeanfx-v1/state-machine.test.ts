import { describe, expect, it } from "vitest";
import { candle } from "./primitives/__fixtures__/candle";
import { runJeanfxDirection, determineHtfBias } from "./state-machine";
import { JEANFX_V1_PARAMS } from "./config";
import type { CanonicalCandle } from "./types";

const M15_MS = 15 * 60_000;
const M5_MS = 5 * 60_000;

function m15(index: number, v: number, overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return candle({ openTime: index * M15_MS, timeframe: "M15", open: v, close: v, high: v + 1, low: v - 1, ...overrides });
}

/** Long, monotonically rising close prices - guarantees EMA50 > EMA200 and close > EMA50 (bullish bias). */
function bullishBiasCandles(count = 260): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) =>
    candle({ openTime: i * 60 * 60_000, timeframe: "H1", open: 100 + i * 0.5, close: 100.3 + i * 0.5, high: 101 + i * 0.5, low: 99.5 + i * 0.5 }),
  );
}

function bearishBiasCandles(count = 260): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) =>
    candle({ openTime: i * 60 * 60_000, timeframe: "H1", open: 5000 - i * 0.5, close: 4999.7 - i * 0.5, high: 5000.5 - i * 0.5, low: 4999 - i * 0.5 }),
  );
}

function flatBiasCandles(count = 260): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) => candle({ openTime: i * 60 * 60_000, timeframe: "H1", open: 100, close: 100, high: 101, low: 99 }));
}

/**
 * A hand-built bullish JeanFX sequence: an early untouched swing high at
 * 251 (the eventual target), a flat ATR-seeding baseline, a swing low at
 * 89 (sell-side liquidity), a swing high at 109 (the MSS level), a sweep
 * of the 89 low, an MSS breaking 109, and a displacement leg containing a
 * bullish FVG [106, 116].
 */
function bullishStructureCandles(): CanonicalCandle[] {
  const c: CanonicalCandle[] = [];
  c.push(m15(0, 150));
  c.push(m15(1, 200));
  c.push(m15(2, 250)); // swing high @ 251 (confirmed idx4)
  c.push(m15(3, 200));
  c.push(m15(4, 150));
  for (let i = 5; i <= 24; i++) c.push(m15(i, 100)); // flat baseline, seeds ATR
  c.push(m15(25, 97));
  c.push(m15(26, 94));
  c.push(m15(27, 90)); // swing low @ 89 (confirmed idx29)
  c.push(m15(28, 93));
  c.push(m15(29, 96));
  c.push(m15(30, 100));
  c.push(m15(31, 104));
  c.push(m15(32, 108)); // swing high @ 109 (confirmed idx34)
  c.push(m15(33, 104));
  c.push(m15(34, 100));
  c.push(m15(35, 95));
  c.push(m15(36, 91));
  c.push(m15(37, 90, { high: 90.5, low: 86, close: 89.5 })); // SWEEP of the 89 low
  c.push(m15(38, 95, { open: 90, high: 96, low: 89 }));
  c.push(m15(39, 100, { open: 100, high: 101, low: 99 })); // FVG candle1 (shifted triple)
  c.push(m15(40, 105, { open: 100, high: 106, low: 100 })); // FVG candle1 for the ACTUAL triple used
  c.push(m15(41, 111, { open: 105, high: 112, low: 104 })); // MSS candle (close 111 > 109) + FVG candle2
  c.push(m15(42, 128, { open: 111, high: 130, low: 116 })); // FVG candle3 + displacement
  return c;
}

function mirroredBearishStructureCandles(): CanonicalCandle[] {
  // Exact mirror of bullishStructureCandles() around price 200 (v' = 400 - v).
  return bullishStructureCandles().map((original) => {
    const mirror = (v: number) => 400 - v;
    return { ...original, open: mirror(original.open), close: mirror(original.close), high: mirror(original.low), low: mirror(original.high) };
  });
}

function bullishEntryCandles(fvgFormedAtOpenTime: number): CanonicalCandle[] {
  const touch = candle({ openTime: fvgFormedAtOpenTime + M5_MS, timeframe: "M5", open: 118, high: 119, low: 111, close: 112 });
  const confirm = candle({ openTime: fvgFormedAtOpenTime + 2 * M5_MS, timeframe: "M5", open: 111, high: 120, low: 110, close: 119 });
  return [touch, confirm];
}

function bearishEntryCandles(fvgFormedAtOpenTime: number): CanonicalCandle[] {
  const mirror = (v: number) => 400 - v;
  const touch = candle({ openTime: fvgFormedAtOpenTime + M5_MS, timeframe: "M5", open: mirror(118), low: mirror(119), high: mirror(111), close: mirror(112) });
  const confirm = candle({ openTime: fvgFormedAtOpenTime + 2 * M5_MS, timeframe: "M5", open: mirror(111), low: mirror(120), high: mirror(110), close: mirror(119) });
  return [touch, confirm];
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
