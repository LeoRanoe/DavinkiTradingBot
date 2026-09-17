import type { StrategyContract, StrategyDecision, StrategyMetadata } from "../types";

/**
 * Registry entry for "v2-trb".
 *
 * IMPORTANT - honesty note: no TRB strategy code, spec, or documentation
 * exists anywhere in this repository (verified by search across lib/,
 * docs/, and supabase/ before writing this file). The brief that
 * introduced this platform instructs "Do NOT delete TRB" / "TRB remains
 * intact as a secondary research benchmark," but there is nothing to
 * preserve - the previous JeanFX spec checkpoint reported this same
 * finding (docs/strategies/jeanfx-v1-spec.md S1). This entry registers the
 * slug as a placeholder so the registry shape and future implementation
 * path exist, without fabricating a strategy that was never built. Status
 * is DRAFT (not RESEARCH_ONLY) because RESEARCH_ONLY in this platform's
 * lifecycle implies a strategy that can actually be evaluated - this one
 * cannot yet.
 */
const TRB_METADATA: StrategyMetadata = {
  slug: "v2-trb",
  displayName: "TRB (Research Benchmark)",
  description:
    "Placeholder registry entry. No TRB algorithm exists in this repository yet - nothing was found to preserve or wrap. Implement before promoting this entry's status.",
  type: "BUILT_IN",
  status: "DRAFT",
  requiredTimeframes: [],
  supportedAssetClasses: ["CRYPTO"],
  supportedSides: ["LONG"],
  minimumHistoryRequirements: {},
  requiredFeatures: [],
};

function evaluate(): StrategyDecision {
  return {
    type: "NO_ACTION",
    reason: "v2-trb has no implementation in this repository - this registry entry is a placeholder only.",
  };
}

export const trbBuiltInStrategy: StrategyContract = { metadata: TRB_METADATA, evaluate };
