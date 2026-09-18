import { findSwingHighs, findSwingLows } from "@/lib/indicators/swings";
import type { CanonicalCandle } from "@/lib/strategy-platform/types";

/**
 * JeanFX swing detection - SOURCE RULE: liquidity is built from swing
 * highs/lows (see docs/strategies/jeanfx-v1-spec.md S5.1). The fractal
 * left/right-bar lookback and its value (2/2) are an
 * IMPLEMENTATION ASSUMPTION, not a number the brief specifies.
 *
 * Reuses lib/indicators/swings.ts rather than reimplementing fractal
 * detection - that module already only flags a bar once `lookback` bars on
 * each side have closed, which is exactly the confirmation JeanFX's
 * closed-candle invariant requires: called with an array that only ever
 * contains CLOSED candles, a swing can never be "confirmed" using data
 * that wasn't available yet.
 */
export type SwingPoint = { kind: "SWING_HIGH" | "SWING_LOW"; candleTime: number; price: number; index: number };

export function detectSwingHighs(candles: CanonicalCandle[], leftRightBars: number): SwingPoint[] {
  const indices = findSwingHighs(candles, leftRightBars);
  return indices.map((i) => ({ kind: "SWING_HIGH" as const, candleTime: candles[i].openTime, price: candles[i].high, index: i }));
}

export function detectSwingLows(candles: CanonicalCandle[], leftRightBars: number): SwingPoint[] {
  const indices = findSwingLows(candles, leftRightBars);
  return indices.map((i) => ({ kind: "SWING_LOW" as const, candleTime: candles[i].openTime, price: candles[i].low, index: i }));
}

/** Most recent confirmed swing high/low as of the whole candle array, or null if none. */
export function latestSwingHigh(candles: CanonicalCandle[], leftRightBars: number): SwingPoint | null {
  const swings = detectSwingHighs(candles, leftRightBars);
  return swings.length ? swings[swings.length - 1] : null;
}

export function latestSwingLow(candles: CanonicalCandle[], leftRightBars: number): SwingPoint | null {
  const swings = detectSwingLows(candles, leftRightBars);
  return swings.length ? swings[swings.length - 1] : null;
}

/**
 * A series aligned to `candles`, forward-filled: value at index i is the
 * most recently confirmed swing high/low price as of candle i - i.e. the
 * latest swing whose confirmation index (swingIndex + leftRightBars) is
 * <= i. NaN before the first confirmed swing. Used by the SWING_HIGH/
 * SWING_LOW DSL VALUE primitives and the BELOW_SWING/ABOVE_SWING stop
 * builder.
 *
 * A swing at index j is confirmed the moment candle j+leftRightBars closes
 * and never changes afterward, so computing the swing list once over the
 * whole array and forward-filling by confirmation index reproduces exactly
 * what incremental (candle-by-candle, no-lookahead) confirmation would
 * have produced - just in one O(n) pass instead of O(n^2).
 */
export function swingHighSeries(candles: CanonicalCandle[], leftRightBars: number): number[] {
  return forwardFillFromSwings(candles, detectSwingHighs(candles, leftRightBars), leftRightBars);
}

export function swingLowSeries(candles: CanonicalCandle[], leftRightBars: number): number[] {
  return forwardFillFromSwings(candles, detectSwingLows(candles, leftRightBars), leftRightBars);
}

function forwardFillFromSwings(candles: CanonicalCandle[], swings: SwingPoint[], leftRightBars: number): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  let ptr = -1;
  for (let i = 0; i < candles.length; i++) {
    while (ptr + 1 < swings.length && swings[ptr + 1].index + leftRightBars <= i) ptr++;
    result[i] = ptr >= 0 ? swings[ptr].price : NaN;
  }
  return result;
}
