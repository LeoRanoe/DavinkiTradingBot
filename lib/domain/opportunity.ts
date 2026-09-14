import type { InstrumentId } from "./instrument";

/**
 * Generic opportunity shape (CLAUDE.md §17). Strategies generate these;
 * they never place orders. Not used by Strategy V1's frozen production
 * path, which keeps its own SignalEvaluation/score shape.
 */
export interface Opportunity {
  strategyVersion: string;
  instrumentId: InstrumentId;
  timestamp: number;
  side: "LONG" | "SHORT";
  strength?: number;
  entryModel: { price: number };
  initialStop: { price: number };
  exitModel?: Record<string, unknown>;
  reason: string;
  features?: Record<string, unknown>;
}

/**
 * OpportunitySelector (CLAUDE.md §29/§30): receives ALL valid opportunities
 * from one scan cycle and only then ranks/selects, so array iteration order
 * can never act as hidden strategy selection ("first-symbol-wins").
 *
 * RESEARCH-ONLY. Not wired into Strategy V1's production scanner
 * (app/api/jobs/scan/route.ts), which still iterates
 * STRATEGY_V1_PARAMS.symbols directly and is documented as a known,
 * deliberately-unchanged limitation during the active experiment — see
 * docs/BUILD_STATE.md "Known limitation: scanner iteration order".
 */
export function selectOpportunities(
  opportunities: readonly Opportunity[],
  maxSelections: number,
): Opportunity[] {
  // Deterministic, order-independent tie-break: sort by strength desc, then
  // by instrumentId asc so array input order never decides the outcome.
  return [...opportunities]
    .sort((a, b) => {
      const strengthDiff = (b.strength ?? 0) - (a.strength ?? 0);
      if (strengthDiff !== 0) return strengthDiff;
      return a.instrumentId.localeCompare(b.instrumentId);
    })
    .slice(0, Math.max(0, maxSelections));
}
