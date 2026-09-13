import { describe, expect, it } from "vitest";
import { ema, latestEma } from "./ema";
import { latestRsi } from "./rsi";
import { atr, trueRange } from "./atr";
import { volumeAverage, relativeVolume } from "./volume";
import { findSwingHighs, findSwingLows } from "./swings";

describe("ema", () => {
  it("seeds with a simple average and then applies exponential smoothing", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = ema(values, 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo((1 + 2 + 3) / 3);
    // k = 2/(3+1) = 0.5 -> ema[3] = 4*0.5 + 2*0.5 = 3
    expect(result[3]).toBeCloseTo(3);
  });

  it("returns all NaN when not enough data", () => {
    expect(latestEma([1, 2], 5)).toBeNull();
  });

  it("tracks an uptrend upward", () => {
    const values = Array.from({ length: 50 }, (_, i) => 100 + i);
    const e20 = latestEma(values, 20)!;
    const e50 = latestEma(values.slice(0, 40), 20)!;
    expect(e20).toBeGreaterThan(e50);
  });
});

describe("rsi", () => {
  it("is 100 when there are no losses", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(latestRsi(closes, 14)).toBe(100);
  });

  it("is 0 when there are no gains", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(latestRsi(closes, 14)).toBe(0);
  });

  it("is near 50 for alternating up/down of equal magnitude", () => {
    const closes: number[] = [100];
    for (let i = 0; i < 30; i++) closes.push(closes[closes.length - 1] + (i % 2 === 0 ? 1 : -1));
    const value = latestRsi(closes, 14)!;
    expect(value).toBeGreaterThan(30);
    expect(value).toBeLessThan(70);
  });

  it("returns null with insufficient data", () => {
    expect(latestRsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("atr", () => {
  it("computes true range correctly with a gap up", () => {
    // prev close 100, bar high 110 low 108 -> TR = max(2, |110-100|, |108-100|) = 10
    expect(trueRange({ high: 110, low: 108, close: 109 }, 100)).toBe(10);
  });

  it("uses high-low when there is no previous close", () => {
    expect(trueRange({ high: 105, low: 100, close: 103 }, null)).toBe(5);
  });

  it("produces a positive smoothed value for volatile data", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({
      high: 100 + i + 2,
      low: 100 + i - 2,
      close: 100 + i,
    }));
    const value = atr(bars, 14)[19];
    expect(value).toBeGreaterThan(0);
  });
});

describe("volume", () => {
  it("computes a 20-period average", () => {
    const volumes = Array.from({ length: 25 }, () => 10);
    const avg = volumeAverage(volumes, 20);
    expect(avg[19]).toBeCloseTo(10);
  });

  it("flags relative volume above 1 on a spike", () => {
    const volumes = [...Array.from({ length: 20 }, () => 10), 50];
    const rv = relativeVolume(volumes, 20)!;
    expect(rv).toBeGreaterThan(1);
  });

  it("returns null with insufficient data", () => {
    expect(relativeVolume([1, 2, 3], 20)).toBeNull();
  });
});

describe("swings", () => {
  it("detects a simple swing high in the middle of the series", () => {
    const bars = [
      { high: 10, low: 5 },
      { high: 11, low: 6 },
      { high: 12, low: 7 },
      { high: 20, low: 15 }, // swing high
      { high: 12, low: 7 },
      { high: 11, low: 6 },
      { high: 10, low: 5 },
    ];
    const idx = findSwingHighs(bars, 3);
    expect(idx).toEqual([3]);
  });

  it("detects a simple swing low", () => {
    const bars = [
      { high: 20, low: 15 },
      { high: 19, low: 14 },
      { high: 18, low: 13 },
      { high: 10, low: 2 }, // swing low
      { high: 18, low: 13 },
      { high: 19, low: 14 },
      { high: 20, low: 15 },
    ];
    const idx = findSwingLows(bars, 3);
    expect(idx).toEqual([3]);
  });

  it("never flags the most recent lookback bars (not enough confirmation)", () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ high: 100 - i, low: 90 - i }));
    const idx = findSwingHighs(bars, 3);
    expect(idx.every((i) => i < bars.length - 3)).toBe(true);
  });
});
