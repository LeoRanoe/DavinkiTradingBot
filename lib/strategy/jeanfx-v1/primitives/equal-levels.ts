import { atr } from "@/lib/indicators/atr";
import type { CanonicalCandle } from "@/lib/strategy-platform/types";
import type { SwingPoint } from "./swings";

/**
 * Equal highs / equal lows - SOURCE RULE (the brief names "equal highs" and
 * "equal lows" as liquidity pool types; docs/strategies/jeanfx-v1-spec.md
 * S5.2). The ATR-relative tolerance mechanism AND its multiple (0.10x ATR)
 * are an IMPLEMENTATION ASSUMPTION - the brief gives no exact number.
 */
export type EqualLevelCluster = { kind: "EQUAL_HIGH" | "EQUAL_LOW"; level: number; members: SwingPoint[] };

function cluster(swings: SwingPoint[], candles: CanonicalCandle[], atrMultiple: number, atrPeriod: number, kind: "EQUAL_HIGH" | "EQUAL_LOW"): EqualLevelCluster[] {
  if (swings.length < 2) return [];
  const atrSeries = atr(candles, atrPeriod);
  const clusters: EqualLevelCluster[] = [];

  for (const swing of swings) {
    const tolerance = atrMultiple * (atrSeries[swing.index] || 0);
    if (!Number.isFinite(tolerance) || tolerance <= 0) continue;

    const existing = clusters.find((c) => Math.abs(c.level - swing.price) <= tolerance);
    if (existing) {
      existing.members.push(swing);
      // Recompute a stable representative level as the average of members.
      existing.level = existing.members.reduce((s, m) => s + m.price, 0) / existing.members.length;
    } else {
      clusters.push({ kind, level: swing.price, members: [swing] });
    }
  }

  return clusters.filter((c) => c.members.length >= 2);
}

export function findEqualHighs(
  candles: CanonicalCandle[],
  swingHighs: SwingPoint[],
  atrMultiple: number,
  atrPeriod: number,
): EqualLevelCluster[] {
  return cluster(swingHighs, candles, atrMultiple, atrPeriod, "EQUAL_HIGH");
}

export function findEqualLows(
  candles: CanonicalCandle[],
  swingLows: SwingPoint[],
  atrMultiple: number,
  atrPeriod: number,
): EqualLevelCluster[] {
  return cluster(swingLows, candles, atrMultiple, atrPeriod, "EQUAL_LOW");
}
