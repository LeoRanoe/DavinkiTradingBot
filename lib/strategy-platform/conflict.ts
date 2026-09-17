import type { Opportunity } from "./types";

/**
 * Strategy conflict policy - see docs/architecture/strategy-platform.md
 * "Strategy conflicts". Applied AFTER every enabled strategy assignment has
 * been evaluated and has produced its opportunities (never during
 * evaluation, and never by iteration order - see S9/S10 of the prompt this
 * implements).
 */
export type ConflictPolicy = "ALLOW_SAME_DIRECTION" | "HIGHEST_PRIORITY" | "PORTFOLIO_SELECTOR" | "BLOCK_OPPOSING_SIGNALS";

export type ConflictResolutionResult = {
  instrumentId: string;
  /** Opportunities cleared to proceed to risk/portfolio sizing. Never guarantees execution. */
  executable: Opportunity[];
  /** Opportunities withheld from execution because of an unresolved conflict. */
  blocked: Opportunity[];
  /** Every opportunity considered for this instrument, unmodified - always == executable + blocked, in original order. Kept so a conflict is never "netted" away silently. */
  allOpportunities: Opportunity[];
};

function groupByInstrument(opportunities: Opportunity[]): Map<string, Opportunity[]> {
  const groups = new Map<string, Opportunity[]>();
  for (const opp of opportunities) {
    const list = groups.get(opp.instrumentId);
    if (list) list.push(opp);
    else groups.set(opp.instrumentId, [opp]);
  }
  return groups;
}

function resolveGroup(instrumentId: string, group: Opportunity[], policy: ConflictPolicy): ConflictResolutionResult {
  const sides = new Set(group.map((o) => o.side));
  const opposing = sides.size > 1;

  if (!opposing) {
    // Same-direction (or single) signals always coexist as research evidence
    // and are cleared for downstream risk/portfolio selection - selection
    // among them (e.g. one per instrument) is a portfolio-policy concern,
    // not a conflict-policy concern.
    return { instrumentId, executable: group, blocked: [], allOpportunities: group };
  }

  switch (policy) {
    case "ALLOW_SAME_DIRECTION":
    case "BLOCK_OPPOSING_SIGNALS":
      // Conservative default (S10): opposing executable signals block
      // execution until an explicit policy resolves them. Never net them -
      // both sides remain visible in allOpportunities.
      return { instrumentId, executable: [], blocked: group, allOpportunities: group };
    case "HIGHEST_PRIORITY": {
      const maxPriority = Math.max(...group.map((o) => o.priority));
      const winners = group.filter((o) => o.priority === maxPriority);
      if (winners.length !== 1) {
        // Tie at the top priority is itself an unresolved conflict - block all.
        return { instrumentId, executable: [], blocked: group, allOpportunities: group };
      }
      const losers = group.filter((o) => o !== winners[0]);
      return { instrumentId, executable: winners, blocked: losers, allOpportunities: group };
    }
    case "PORTFOLIO_SELECTOR":
      throw new Error(
        "PORTFOLIO_SELECTOR conflict policy is not implemented yet - it requires portfolio-wide risk state that does not exist in this checkpoint",
      );
  }
}

/**
 * Deterministic conflict resolution across every enabled assignment's
 * opportunities for the same evaluation pass. Grouping/order never depends
 * on which strategy produced an opportunity first.
 */
export function resolveConflicts(
  opportunities: Opportunity[],
  policy: ConflictPolicy = "BLOCK_OPPOSING_SIGNALS",
): ConflictResolutionResult[] {
  const groups = groupByInstrument(opportunities);
  const instrumentIds = [...groups.keys()].sort();
  return instrumentIds.map((id) => resolveGroup(id, groups.get(id)!, policy));
}
