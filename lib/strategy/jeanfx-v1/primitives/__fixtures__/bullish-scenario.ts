import { candle } from "./candle";
import type { CanonicalCandle } from "../../types";

/** Shared across state-machine.test.ts and orchestrator.e2e.test.ts - a hand-built, fully valid JeanFX bullish (and mirrored bearish) scenario. */

export const M15_MS = 15 * 60_000;
export const M5_MS = 5 * 60_000;

function m15(index: number, v: number, overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return candle({ openTime: index * M15_MS, timeframe: "M15", open: v, close: v, high: v + 1, low: v - 1, ...overrides });
}

/** Long, monotonically rising close prices - guarantees EMA50 > EMA200 and close > EMA50 (bullish bias). */
export function bullishBiasCandles(count = 260): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) =>
    candle({ openTime: i * 60 * 60_000, timeframe: "H1", open: 100 + i * 0.5, close: 100.3 + i * 0.5, high: 101 + i * 0.5, low: 99.5 + i * 0.5 }),
  );
}

export function bearishBiasCandles(count = 260): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) =>
    candle({ openTime: i * 60 * 60_000, timeframe: "H1", open: 5000 - i * 0.5, close: 4999.7 - i * 0.5, high: 5000.5 - i * 0.5, low: 4999 - i * 0.5 }),
  );
}

export function flatBiasCandles(count = 260): CanonicalCandle[] {
  return Array.from({ length: count }, (_, i) => candle({ openTime: i * 60 * 60_000, timeframe: "H1", open: 100, close: 100, high: 101, low: 99 }));
}

/**
 * A hand-built bullish JeanFX sequence: an early untouched swing high at
 * 251 (the eventual target), a flat ATR-seeding baseline, a swing low at
 * 89 (sell-side liquidity), a swing high at 109 (the MSS level), a sweep
 * of the 89 low, an MSS breaking 109, and a displacement leg containing a
 * bullish FVG [106, 116].
 */
export function bullishStructureCandles(): CanonicalCandle[] {
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

export function mirroredBearishStructureCandles(): CanonicalCandle[] {
  // Exact mirror of bullishStructureCandles() around price 200 (v' = 400 - v).
  return bullishStructureCandles().map((original) => {
    const mirror = (v: number) => 400 - v;
    return { ...original, open: mirror(original.open), close: mirror(original.close), high: mirror(original.low), low: mirror(original.high) };
  });
}

export function bullishEntryCandles(fvgFormedAtOpenTime: number): CanonicalCandle[] {
  const touch = candle({ openTime: fvgFormedAtOpenTime + M5_MS, timeframe: "M5", open: 118, high: 119, low: 111, close: 112 });
  const confirm = candle({ openTime: fvgFormedAtOpenTime + 2 * M5_MS, timeframe: "M5", open: 111, high: 120, low: 110, close: 119 });
  return [touch, confirm];
}

export function bearishEntryCandles(fvgFormedAtOpenTime: number): CanonicalCandle[] {
  const mirror = (v: number) => 400 - v;
  const touch = candle({ openTime: fvgFormedAtOpenTime + M5_MS, timeframe: "M5", open: mirror(118), low: mirror(119), high: mirror(111), close: mirror(112) });
  const confirm = candle({ openTime: fvgFormedAtOpenTime + 2 * M5_MS, timeframe: "M5", open: mirror(111), low: mirror(120), high: mirror(110), close: mirror(119) });
  return [touch, confirm];
}
