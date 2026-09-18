import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { detectFvgAt, isDisplacementCandle, isFvgInvalidated, touchesFvg } from "./fvg";

describe("FVG detection (verbatim brief definition)", () => {
  it("bullish FVG: low[candle3] > high[candle1]", () => {
    const candles = [
      candle({ openTime: 0, high: 100, low: 98 }),
      candle({ openTime: 1, high: 105, low: 101 }),
      candle({ openTime: 2, high: 110, low: 103 }), // low(103) > high[c1](100)
    ];
    const fvg = detectFvgAt(candles, 2);
    expect(fvg).toMatchObject({ direction: "LONG", rangeLow: 100, rangeHigh: 103 });
  });

  it("bearish FVG: high[candle3] < low[candle1]", () => {
    const candles = [
      candle({ openTime: 0, high: 100, low: 98 }),
      candle({ openTime: 1, high: 97, low: 94 }),
      candle({ openTime: 2, high: 96, low: 90 }), // high(96) < low[c1](98)
    ];
    const fvg = detectFvgAt(candles, 2);
    expect(fvg).toMatchObject({ direction: "SHORT", rangeLow: 96, rangeHigh: 98 });
  });

  it("no gap -> null", () => {
    const candles = [candle({ openTime: 0, high: 100, low: 98 }), candle({ openTime: 1, high: 101, low: 97 }), candle({ openTime: 2, high: 99, low: 96 })];
    expect(detectFvgAt(candles, 2)).toBeNull();
  });

  it("touchesFvg is true exactly when a candle's range overlaps the gap", () => {
    const fvg = { direction: "LONG" as const, candleTimes: [0, 1, 2] as [number, number, number], rangeLow: 100, rangeHigh: 103, invalidated: false };
    expect(touchesFvg(fvg, candle({ openTime: 3, high: 102, low: 101 }))).toBe(true);
    expect(touchesFvg(fvg, candle({ openTime: 3, high: 99, low: 95 }))).toBe(false);
  });

  it("isFvgInvalidated fires once price closes fully through the far edge", () => {
    const fvg = { direction: "LONG" as const, candleTimes: [0, 1, 2] as [number, number, number], rangeLow: 100, rangeHigh: 103, invalidated: false };
    const candles = [candle({ openTime: 3, close: 99 })];
    expect(isFvgInvalidated(fvg, candles, 0)).toBe(true);
    const stillValid = [candle({ openTime: 3, close: 101 })];
    expect(isFvgInvalidated(fvg, stillValid, 0)).toBe(false);
  });

  it("isDisplacementCandle requires range >= multiple * ATR", () => {
    const flat = Array.from({ length: 20 }, (_, i) => candle({ openTime: i * 60_000, high: 100.2, low: 99.8, close: 100 }));
    const big = candle({ openTime: 20 * 60_000, high: 110, low: 95, close: 108 });
    const candles = [...flat, big];
    expect(isDisplacementCandle(candles, candles.length - 1, 1.5, 14)).toBe(true);
    expect(isDisplacementCandle(flat, 15, 1.5, 14)).toBe(false);
  });
});
