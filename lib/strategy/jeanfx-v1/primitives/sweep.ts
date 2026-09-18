import type { CanonicalCandle } from "@/lib/strategy-platform/types";
import type { LiquidityPool, Sweep } from "../types";

/**
 * Sweep - SOURCE RULE, quoted directly from the brief: "price trades beyond
 * liquidity level and closes back through/inside it." No assumption here;
 * this is the brief's own definition, used verbatim (spec S5.4).
 */
export function isSweepCandle(candle: CanonicalCandle, pool: LiquidityPool): boolean {
  if (pool.side === "SELL_SIDE") return candle.low < pool.level && candle.close > pool.level;
  return candle.high > pool.level && candle.close < pool.level;
}

/** First unswept pool that `candles[index]` sweeps, or null. Deterministic order: pools nearest to price first. */
export function detectSweep(candles: CanonicalCandle[], index: number, pools: LiquidityPool[]): Sweep | null {
  const candle = candles[index];
  const candidates = pools.filter((p) => !p.swept && isSweepCandle(candle, p));
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((best, p) => (Math.abs(p.level - candle.close) < Math.abs(best.level - candle.close) ? p : best));
  return { pool: nearest, sweepCandleTime: candle.openTime, sweepCandleHigh: candle.high, sweepCandleLow: candle.low };
}
