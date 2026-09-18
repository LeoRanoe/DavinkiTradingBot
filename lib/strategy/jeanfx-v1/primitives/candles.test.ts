import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { isBearishEngulfing, isBullishEngulfing, isHammer, isShootingStar } from "./candles";

const params = { minWickBodyRatio: 2.0, maxOppositeWickRatio: 0.5 };

describe("candle confirmation patterns", () => {
  it("bullish engulfing: current body fully contains the prior bearish body", () => {
    const prior = candle({ openTime: 0, open: 100, close: 95, high: 101, low: 94 });
    const curr = candle({ openTime: 1, open: 94, close: 102, high: 103, low: 93 });
    expect(isBullishEngulfing(prior, curr)).toBe(true);
  });

  it("a wick-only overlap is not engulfing (body-to-body only)", () => {
    const prior = candle({ openTime: 0, open: 100, close: 95, high: 101, low: 90 });
    const curr = candle({ openTime: 1, open: 96, close: 99, high: 105, low: 92 }); // body 96-99 does not contain 95-100
    expect(isBullishEngulfing(prior, curr)).toBe(false);
  });

  it("bearish engulfing mirrors bullish", () => {
    const prior = candle({ openTime: 0, open: 95, close: 100, high: 101, low: 94 });
    const curr = candle({ openTime: 1, open: 101, close: 93, high: 102, low: 92 });
    expect(isBearishEngulfing(prior, curr)).toBe(true);
  });

  it("hammer: long lower wick, small body, small upper wick", () => {
    const c = candle({ openTime: 0, open: 100, close: 101, high: 101.2, low: 95 }); // body=1, lowerWick=5, upperWick=0.2
    expect(isHammer(c, params)).toBe(true);
    expect(isShootingStar(c, params)).toBe(false);
  });

  it("shooting star: long upper wick, small body, small lower wick", () => {
    const c = candle({ openTime: 0, open: 100, close: 99, high: 106, low: 98.8 });
    expect(isShootingStar(c, params)).toBe(true);
    expect(isHammer(c, params)).toBe(false);
  });

  it("a normal candle with no dominant wick is neither hammer nor shooting star", () => {
    const c = candle({ openTime: 0, open: 100, close: 101, high: 101.5, low: 99.5 });
    expect(isHammer(c, params)).toBe(false);
    expect(isShootingStar(c, params)).toBe(false);
  });
});
