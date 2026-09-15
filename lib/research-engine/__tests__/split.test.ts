import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { computeChronologicalSplit, sliceForRange, splitCandles } from "../split";

function candle(openTime: number): CanonicalCandle {
  return { instrumentId: "TEST", timeframe: "1H", openTime, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true };
}

describe("computeChronologicalSplit (§18) — 60/20/20, chronological, no randomness", () => {
  it("splits 100 candles into exactly 60/20/20 by count", () => {
    const split = computeChronologicalSplit(100);
    expect(split.development).toEqual({ startIndex: 0, endIndex: 60 });
    expect(split.validation).toEqual({ startIndex: 60, endIndex: 80 });
    expect(split.holdout).toEqual({ startIndex: 80, endIndex: 100 });
  });

  it("ranges are contiguous and exactly partition the input - no gap, no overlap", () => {
    for (const n of [0, 1, 5, 17, 100, 1001]) {
      const split = computeChronologicalSplit(n);
      expect(split.development.startIndex).toBe(0);
      expect(split.development.endIndex).toBe(split.validation.startIndex);
      expect(split.validation.endIndex).toBe(split.holdout.startIndex);
      expect(split.holdout.endIndex).toBe(n);
    }
  });

  it("is deterministic for the same count", () => {
    expect(computeChronologicalSplit(37)).toEqual(computeChronologicalSplit(37));
  });

  it("rejects a negative or non-integer count", () => {
    expect(() => computeChronologicalSplit(-1)).toThrow();
    expect(() => computeChronologicalSplit(1.5)).toThrow();
  });
});

describe("splitCandles — chronological order preserved, never shuffled", () => {
  it("development/validation/holdout candles stay in original chronological order and partition the input exactly", () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(i));
    const { development, validation, holdout } = splitCandles(candles);
    expect(development.map((c) => c.openTime)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(validation.map((c) => c.openTime)).toEqual([6, 7]);
    expect(holdout.map((c) => c.openTime)).toEqual([8, 9]);
    expect([...development, ...validation, ...holdout]).toEqual(candles);
  });

  it("sliceForRange never reorders", () => {
    const candles = Array.from({ length: 5 }, (_, i) => candle(i));
    const sliced = sliceForRange(candles, { startIndex: 1, endIndex: 4 });
    expect(sliced.map((c) => c.openTime)).toEqual([1, 2, 3]);
  });
});
