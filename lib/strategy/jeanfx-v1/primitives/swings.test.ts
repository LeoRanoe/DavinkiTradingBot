import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { detectSwingHighs, detectSwingLows, latestSwingHigh, swingHighSeries, swingLowSeries } from "./swings";

function bars(highsLows: [number, number][]) {
  return highsLows.map(([high, low], i) => candle({ openTime: i * 60_000, high, low, open: (high + low) / 2, close: (high + low) / 2 }));
}

describe("swing detection", () => {
  it("flags a fractal swing high only once confirmed on both sides", () => {
    // 10,20,30(peak),20,10 with lookback=2
    const candles = bars([[10,9],[20,19],[30,29],[20,19],[10,9]]);
    const highs = detectSwingHighs(candles, 2);
    expect(highs).toHaveLength(1);
    expect(highs[0].index).toBe(2);
    expect(highs[0].price).toBe(30);
  });

  it("never flags a swing within lookback bars of the array end (no lookahead)", () => {
    const candles = bars([[10,9],[20,19],[30,29]]); // peak at index 2 has no right-side confirmation yet
    expect(detectSwingHighs(candles, 2)).toHaveLength(0);
  });

  it("latestSwingHigh returns the most recent confirmed one", () => {
    const candles = bars([[10,9],[20,19],[30,29],[20,19],[10,9],[40,39],[25,24],[15,14]]);
    const latest = latestSwingHigh(candles, 2);
    expect(latest?.price).toBe(40);
  });

  it("swingHighSeries forward-fills from each swing's confirmation index, matching incremental confirmation", () => {
    const candles = bars([[10,9],[20,19],[30,29],[20,19],[10,9]]);
    const series = swingHighSeries(candles, 2);
    // confirmed only once index 4 (2+lookback) is reached
    expect(series[0]).toBeNaN();
    expect(series[3]).toBeNaN();
    expect(series[4]).toBe(30);
  });

  it("swing lows mirror swing highs", () => {
    const candles = bars([[21,20],[11,10],[1,0],[11,10],[21,20]]);
    const lows = detectSwingLows(candles, 2);
    expect(lows).toHaveLength(1);
    expect(lows[0].price).toBe(0);
    expect(swingLowSeries(candles, 2)[4]).toBe(0);
  });
});
