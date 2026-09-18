import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { markSweptPools, poolsFromEqualLevels, poolsFromUnclusteredSwings, sessionHighLowPools } from "./liquidity";
import type { EqualLevelCluster } from "./equal-levels";
import type { SwingPoint } from "./swings";
import type { LiquidityPool } from "../types";
import { JEANFX_DEFAULT_SESSION_WINDOWS } from "./sessions";

describe("poolsFromEqualLevels", () => {
  it("maps EQUAL_HIGH clusters to BUY_SIDE pools and EQUAL_LOW to SELL_SIDE", () => {
    const cluster: EqualLevelCluster = {
      kind: "EQUAL_HIGH",
      level: 110,
      members: [
        { kind: "SWING_HIGH", candleTime: 1, price: 110, index: 1 },
        { kind: "SWING_HIGH", candleTime: 2, price: 110.1, index: 2 },
      ],
    };
    const [pool] = poolsFromEqualLevels([cluster]);
    expect(pool.side).toBe("BUY_SIDE");
    expect(pool.kind).toBe("EQUAL_HIGH_LOW");
    expect(pool.sourceCandleTimes).toEqual([1, 2]);
  });
});

describe("poolsFromUnclusteredSwings", () => {
  it("excludes swings already represented by a cluster", () => {
    const swings: SwingPoint[] = [
      { kind: "SWING_HIGH", candleTime: 1, price: 110, index: 1 },
      { kind: "SWING_HIGH", candleTime: 5, price: 120, index: 5 },
    ];
    const clusters: EqualLevelCluster[] = [{ kind: "EQUAL_HIGH", level: 110, members: [swings[0]] }];
    const pools = poolsFromUnclusteredSwings(swings, clusters, "BUY_SIDE");
    expect(pools).toHaveLength(1);
    expect(pools[0].level).toBe(120);
    expect(pools[0].kind).toBe("PRIOR_SWING");
  });
});

describe("markSweptPools", () => {
  it("marks a pool swept once any candle up to the given index sweeps it", () => {
    const pools: LiquidityPool[] = [{ side: "SELL_SIDE", level: 100, sourceCandleTimes: [0], kind: "PRIOR_SWING", swept: false }];
    const candles = [candle({ openTime: 0, low: 99.5, close: 99.8 }), candle({ openTime: 1, low: 95, close: 101 })];
    const [result] = markSweptPools(pools, candles, 1);
    expect(result.swept).toBe(true);
  });

  it("leaves a pool unswept when no candle triggers it", () => {
    const pools: LiquidityPool[] = [{ side: "SELL_SIDE", level: 100, sourceCandleTimes: [0], kind: "PRIOR_SWING", swept: false }];
    const candles = [candle({ openTime: 0, low: 99, close: 99.5 })];
    const [result] = markSweptPools(pools, candles, 0);
    expect(result.swept).toBe(false);
  });
});

describe("sessionHighLowPools", () => {
  it("produces a BUY_SIDE and SELL_SIDE pool from the most recently completed London session, excluding the currently-forming one", () => {
    const london = JEANFX_DEFAULT_SESSION_WINDOWS.find((w) => w.session === "LONDON")!;
    const candles = [
      // Completed London session, day 1: 2026-01-14 08:00-16:45 UTC
      candle({ openTime: Date.UTC(2026, 0, 14, 9, 0), high: 105, low: 95 }),
      candle({ openTime: Date.UTC(2026, 0, 14, 12, 0), high: 108, low: 98 }),
      // Currently-forming London session, day 2 - should be excluded
      candle({ openTime: Date.UTC(2026, 0, 15, 9, 0), high: 999, low: 1 }),
    ];
    const pools = sessionHighLowPools(candles, [london]);
    const buySide = pools.find((p) => p.side === "BUY_SIDE");
    const sellSide = pools.find((p) => p.side === "SELL_SIDE");
    expect(buySide?.level).toBe(108);
    expect(sellSide?.level).toBe(95);
  });

  it("produces nothing when there is no fully completed session instance yet", () => {
    const london = JEANFX_DEFAULT_SESSION_WINDOWS.find((w) => w.session === "LONDON")!;
    const candles = [candle({ openTime: Date.UTC(2026, 0, 15, 9, 0), high: 105, low: 95 })];
    expect(sessionHighLowPools(candles, [london])).toEqual([]);
  });
});
