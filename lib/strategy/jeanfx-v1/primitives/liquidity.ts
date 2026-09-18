import type { CanonicalCandle } from "@/lib/strategy-platform/types";
import type { LiquidityPool } from "../types";
import type { SwingPoint } from "./swings";
import type { EqualLevelCluster } from "./equal-levels";
import { classifySession, type SessionWindow } from "./sessions";
import { isSweepCandle } from "./sweep";

/**
 * Liquidity pool assembly - SOURCE RULE: the brief names equal highs/lows,
 * previous highs/lows, and session highs/lows as liquidity (spec S5.3).
 * "Obvious support/resistance" is explicitly NOT implemented as its own
 * category here - see spec S5.3 / "Unresolved ambiguities" for why.
 */

export function poolsFromEqualLevels(clusters: EqualLevelCluster[]): LiquidityPool[] {
  return clusters.map((c) => ({
    side: c.kind === "EQUAL_HIGH" ? "BUY_SIDE" : "SELL_SIDE",
    level: c.level,
    sourceCandleTimes: c.members.map((m) => m.candleTime),
    kind: "EQUAL_HIGH_LOW",
    swept: false,
  }));
}

/** Every confirmed swing not already represented by an equal-level cluster becomes its own "previous high/low" pool. */
export function poolsFromUnclusteredSwings(swings: SwingPoint[], clusters: EqualLevelCluster[], side: "BUY_SIDE" | "SELL_SIDE"): LiquidityPool[] {
  const clustered = new Set(clusters.flatMap((c) => c.members.map((m) => m.candleTime)));
  return swings
    .filter((s) => !clustered.has(s.candleTime))
    .map((s) => ({ side, level: s.price, sourceCandleTimes: [s.candleTime], kind: "PRIOR_SWING" as const, swept: false }));
}

/**
 * Session high/low pools for the most recently COMPLETED instance of each
 * session window (the currently-forming session, if any, is excluded -
 * its high/low isn't final liquidity yet). Scoped to one completed
 * instance per session for this checkpoint rather than full session
 * history, to keep the primitive's cost and behavior easy to reason about.
 */
export function sessionHighLowPools(candles: CanonicalCandle[], windows: SessionWindow[]): LiquidityPool[] {
  if (candles.length === 0) return [];
  const pools: LiquidityPool[] = [];

  for (const window of windows) {
    type Group = { key: string; candles: CanonicalCandle[] };
    const groups: Group[] = [];
    for (const c of candles) {
      const inSession = classifySession(c.openTime, [window]).length > 0;
      if (!inSession) continue;
      const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: window.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(c.openTime));
      const last = groups[groups.length - 1];
      if (last && last.key === dayKey) last.candles.push(c);
      else groups.push({ key: dayKey, candles: [c] });
    }
    if (groups.length < 2) continue; // need at least one fully completed instance before the current one

    const completed = groups[groups.length - 2];
    const high = completed.candles.reduce((best, c) => (c.high > best.high ? c : best));
    const low = completed.candles.reduce((best, c) => (c.low < best.low ? c : best));
    pools.push({ side: "BUY_SIDE", level: high.high, sourceCandleTimes: [high.openTime], kind: "SESSION_HIGH_LOW", swept: false });
    pools.push({ side: "SELL_SIDE", level: low.low, sourceCandleTimes: [low.openTime], kind: "SESSION_HIGH_LOW", swept: false });
  }

  return pools;
}

/** Marks pools whose level has already been swept by ANY candle up to and including `upToIndex`, per the sweep definition in sweep.ts. */
export function markSweptPools(pools: LiquidityPool[], candles: CanonicalCandle[], upToIndex: number): LiquidityPool[] {
  return pools.map((pool) => {
    for (let i = 0; i <= upToIndex; i++) {
      if (isSweepCandle(candles[i], pool)) return { ...pool, swept: true };
    }
    return pool;
  });
}
