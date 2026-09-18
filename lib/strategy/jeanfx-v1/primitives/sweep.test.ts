import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { detectSweep, isSweepCandle } from "./sweep";
import type { LiquidityPool } from "../types";

const sellSidePool: LiquidityPool = { side: "SELL_SIDE", level: 100, sourceCandleTimes: [0], kind: "PRIOR_SWING", swept: false };
const buySidePool: LiquidityPool = { side: "BUY_SIDE", level: 100, sourceCandleTimes: [0], kind: "PRIOR_SWING", swept: false };

describe("sweep detection (verbatim brief definition)", () => {
  it("a sell-side sweep trades below the level and closes back above it", () => {
    const c = candle({ openTime: 1, low: 95, close: 101, open: 99, high: 102 });
    expect(isSweepCandle(c, sellSidePool)).toBe(true);
  });

  it("trading below without closing back above is not a sweep", () => {
    const c = candle({ openTime: 1, low: 95, close: 98, open: 99, high: 99.5 });
    expect(isSweepCandle(c, sellSidePool)).toBe(false);
  });

  it("a buy-side sweep trades above the level and closes back below it", () => {
    const c = candle({ openTime: 1, high: 105, close: 99, open: 101, low: 98 });
    expect(isSweepCandle(c, buySidePool)).toBe(true);
  });

  it("detectSweep ignores already-swept pools", () => {
    const candles = [candle({ openTime: 0 }), candle({ openTime: 1, low: 95, close: 101, high: 102 })];
    const already: LiquidityPool = { ...sellSidePool, swept: true };
    expect(detectSweep(candles, 1, [already])).toBeNull();
  });

  it("detectSweep picks the nearest-to-price candidate among multiple swept pools", () => {
    const near: LiquidityPool = { ...sellSidePool, level: 99.5 };
    const far: LiquidityPool = { ...sellSidePool, level: 90 };
    const candles = [candle({ openTime: 0 }), candle({ openTime: 1, low: 85, close: 101, high: 102 })];
    const result = detectSweep(candles, 1, [near, far]);
    expect(result?.pool.level).toBe(99.5);
  });
});
