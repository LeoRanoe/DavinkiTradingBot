import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { detectSwingHighs } from "./swings";
import { findEqualHighs } from "./equal-levels";
import type { CanonicalCandle } from "@/lib/strategy-platform/types";

// Build a candle series with two swing highs at nearly the same price (equal
// highs), preceded by enough history to seed a stable ATR.
function buildEqualHighsSeries(): CanonicalCandle[] {
  const base: CanonicalCandle[] = [];
  for (let i = 0; i < 20; i++) {
    base.push(candle({ openTime: i * 60_000, open: 100, high: 100.5, low: 99.5, close: 100 }));
  }
  // First swing high ~110
  base.push(candle({ openTime: 20 * 60_000, open: 101, high: 103, low: 100, close: 101 }));
  base.push(candle({ openTime: 21 * 60_000, open: 105, high: 110, low: 104, close: 106 }));
  base.push(candle({ openTime: 22 * 60_000, open: 106, high: 106.5, low: 105, close: 106 }));
  base.push(candle({ openTime: 23 * 60_000, open: 102, high: 103, low: 101, close: 102 }));
  base.push(candle({ openTime: 24 * 60_000, open: 100, high: 100.5, low: 99, close: 100 }));
  // Pullback
  for (let i = 25; i < 30; i++) base.push(candle({ openTime: i * 60_000, open: 100, high: 100.5, low: 99.5, close: 100 }));
  // Second swing high ~110.2 (within tolerance)
  base.push(candle({ openTime: 30 * 60_000, open: 101, high: 103, low: 100, close: 101 }));
  base.push(candle({ openTime: 31 * 60_000, open: 105, high: 110.2, low: 104, close: 106 }));
  base.push(candle({ openTime: 32 * 60_000, open: 106, high: 106.5, low: 105, close: 106 }));
  base.push(candle({ openTime: 33 * 60_000, open: 102, high: 103, low: 101, close: 102 }));
  base.push(candle({ openTime: 34 * 60_000, open: 100, high: 100.5, low: 99, close: 100 }));
  for (let i = 35; i < 40; i++) base.push(candle({ openTime: i * 60_000, open: 100, high: 100.5, low: 99.5, close: 100 }));
  return base;
}

describe("equal highs/lows clustering", () => {
  it("clusters two swing highs within ATR-relative tolerance into one equal-high pool", () => {
    const candles = buildEqualHighsSeries();
    const swingHighs = detectSwingHighs(candles, 2);
    expect(swingHighs.length).toBeGreaterThanOrEqual(2);
    const clusters = findEqualHighs(candles, swingHighs, 0.5, 14); // generous tolerance for this synthetic series
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].members.length).toBeGreaterThanOrEqual(2);
  });

  it("does not cluster swings far outside tolerance", () => {
    const candles = buildEqualHighsSeries();
    const swingHighs = detectSwingHighs(candles, 2);
    const clusters = findEqualHighs(candles, swingHighs, 0.0001, 14); // near-zero tolerance
    expect(clusters).toEqual([]);
  });

  it("produces nothing with fewer than 2 swings", () => {
    expect(findEqualHighs([], [], 0.1, 14)).toEqual([]);
  });
});
