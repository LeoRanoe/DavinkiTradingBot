import { calculateLongExcursions } from "./outcomes";
import type { CandidatePlan, CounterfactualOutcome, OutcomeCandle } from "./types";

/**
 * Research-only long outcome simulation. A range touch is not automatically
 * an entry at an attractive price: a gap/touch is filled at the least
 * favourable permitted long entry (the range's upper boundary). If target and
 * stop touch in one bar, STOP wins. This intentionally matches the backtester's
 * conservative intra-candle assumption.
 */
export function calculateCounterfactualOutcome(
  plan: CandidatePlan,
  candles: OutcomeCandle[],
): CounterfactualOutcome {
  const closed = candles.filter((c) => c.isClosed && c.openTime <= plan.expiresAt);
  let entryIndex = -1;
  let entryPrice: number | null = null;

  for (let i = 0; i < closed.length; i += 1) {
    const bar = closed[i];
    if (bar.low <= plan.allowedEntryMax && bar.high >= plan.allowedEntryMin) {
      entryIndex = i;
      // A long may only enter inside the approved range. Use the worse of an
      // in-range open and the upper boundary when the range was merely crossed.
      entryPrice = bar.open >= plan.allowedEntryMin && bar.open <= plan.allowedEntryMax
        ? bar.open
        : plan.allowedEntryMax;
      break;
    }
  }

  if (entryIndex === -1 || entryPrice === null) {
    return {
      kind: "NO_ENTRY", isHypothetical: true, entryTime: null, exitTime: null,
      entryPrice: null, exitPrice: null, rMultiple: null, excursions: null,
      conservativeAmbiguousCandle: false,
    };
  }

  const path: OutcomeCandle[] = [];
  for (let i = entryIndex; i < closed.length; i += 1) {
    const bar = closed[i];
    path.push(bar);
    const hitStop = bar.low <= plan.stopPrice;
    const hitTarget = bar.high >= plan.targetPrice;
    if (hitStop || hitTarget) {
      const ambiguous = hitStop && hitTarget;
      const exitPrice = hitStop ? plan.stopPrice : plan.targetPrice;
      const risk = entryPrice - plan.stopPrice;
      return {
        kind: hitStop ? "STOP" : "TARGET", isHypothetical: true,
        entryTime: closed[entryIndex].openTime, exitTime: bar.openTime, entryPrice, exitPrice,
        rMultiple: risk > 0 ? (exitPrice - entryPrice) / risk : null,
        excursions: calculateLongExcursions(entryPrice, plan.stopPrice, path),
        conservativeAmbiguousCandle: ambiguous,
      };
    }
  }

  return {
    kind: "EXPIRED", isHypothetical: true, entryTime: closed[entryIndex].openTime,
    exitTime: null, entryPrice, exitPrice: null, rMultiple: null,
    excursions: calculateLongExcursions(entryPrice, plan.stopPrice, path),
    conservativeAmbiguousCandle: false,
  };
}
