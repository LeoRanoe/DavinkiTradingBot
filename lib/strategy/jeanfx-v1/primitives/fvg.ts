import { atr } from "@/lib/indicators/atr";
import type { CanonicalCandle } from "@/lib/strategy-platform/types";
import type { FairValueGap } from "../types";

/**
 * Fair Value Gap - SOURCE RULE, quoted directly from the brief:
 * "Bullish FVG: low[candle3] > high[candle1]" / "Bearish FVG:
 * high[candle3] < low[candle1]" (classic 3-candle imbalance). Displacement
 * (the impulsive move a genuine FVG should sit inside) and its threshold
 * (1.5x ATR) are an IMPLEMENTATION ASSUMPTION - see
 * docs/strategies/jeanfx-v1-spec.md S5.6/S5.7.
 */

/** Detects an FVG formed by candles[index-2], [index-1], [index] (candle1/2/3). */
export function detectFvgAt(candles: CanonicalCandle[], index: number): FairValueGap | null {
  if (index < 2) return null;
  const c1 = candles[index - 2];
  const c3 = candles[index];

  if (c3.low > c1.high) {
    return { direction: "LONG", candleTimes: [candles[index - 2].openTime, candles[index - 1].openTime, c3.openTime], rangeLow: c1.high, rangeHigh: c3.low, invalidated: false };
  }
  if (c3.high < c1.low) {
    return { direction: "SHORT", candleTimes: [candles[index - 2].openTime, candles[index - 1].openTime, c3.openTime], rangeLow: c3.high, rangeHigh: c1.low, invalidated: false };
  }
  return null;
}

/** Range >= displacementAtrMultiple * ATR at that candle - IMPLEMENTATION ASSUMPTION (spec S5.7). */
export function isDisplacementCandle(candles: CanonicalCandle[], index: number, displacementAtrMultiple: number, atrPeriod: number): boolean {
  const atrSeries = atr(candles, atrPeriod);
  const a = atrSeries[index];
  if (!Number.isFinite(a) || a <= 0) return false;
  const range = candles[index].high - candles[index].low;
  return range >= displacementAtrMultiple * a;
}

/**
 * Scans candles[fromIndex..toIndex] for the first FVG whose 3rd candle is a
 * displacement candle (spec S5.6/S5.7: "required to form as part of the
 * displacement leg"). Returns null if none found.
 */
export function findDisplacementFvg(
  candles: CanonicalCandle[],
  fromIndex: number,
  toIndex: number,
  direction: "LONG" | "SHORT",
  displacementAtrMultiple: number,
  atrPeriod: number,
): FairValueGap | null {
  for (let i = Math.max(fromIndex, 2); i <= toIndex; i++) {
    const fvg = detectFvgAt(candles, i);
    if (fvg && fvg.direction === direction && isDisplacementCandle(candles, i, displacementAtrMultiple, atrPeriod)) {
      return fvg;
    }
  }
  return null;
}

/** True once price on candles[upToIndex] closes fully through the far edge without ever having filled via confirmation - spec S10 invalidation rule. */
export function isFvgInvalidated(fvg: FairValueGap, candles: CanonicalCandle[], upToIndex: number): boolean {
  const c = candles[upToIndex];
  if (fvg.direction === "LONG") return c.close < fvg.rangeLow;
  return c.close > fvg.rangeHigh;
}

/** True when the given candle's price range overlaps the FVG zone (retracement into it, spec S5.8/S10 first-touch). */
export function touchesFvg(fvg: FairValueGap, candle: CanonicalCandle): boolean {
  return candle.low <= fvg.rangeHigh && candle.high >= fvg.rangeLow;
}
