import type { CanonicalCandle } from "@/lib/strategy-platform/types";
import type { StructureEvent } from "../types";
import type { SwingPoint } from "./swings";

/**
 * BOS / MSS - SOURCE RULE, quoted directly from the brief: "closed candle
 * breaks the required prior swing structure" (spec S5.5). The BOS-vs-MSS
 * split (continuation vs reversal relative to the prevailing structure
 * direction) is an IMPLEMENTATION ASSUMPTION - the brief doesn't
 * distinguish them numerically. JeanFX's own bullish/bearish sequence only
 * ever needs the reversal case (MSS) directly after a sweep - see
 * state-machine.ts.
 */
export function breaksStructure(candle: CanonicalCandle, direction: "LONG" | "SHORT", requiredSwing: SwingPoint): boolean {
  return direction === "LONG" ? candle.close > requiredSwing.price : candle.close < requiredSwing.price;
}

export function detectStructureEvent(
  candle: CanonicalCandle,
  direction: "LONG" | "SHORT",
  requiredSwing: SwingPoint,
  kind: "BOS" | "MSS",
): StructureEvent | null {
  if (!breaksStructure(candle, direction, requiredSwing)) return null;
  return { kind, direction, brokenSwing: requiredSwing, confirmingCandleTime: candle.openTime };
}
