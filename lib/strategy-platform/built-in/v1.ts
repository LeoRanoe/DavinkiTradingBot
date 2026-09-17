import type { StrategyContract, StrategyDecision, StrategyMetadata } from "../types";

/**
 * Registry entry for legacy Strategy V1 - discoverability only.
 *
 * V1's real execution path is unchanged and untouched by this checkpoint:
 * lib/strategy/v1/signal.ts -> lib/candidates/build-candidate.ts ->
 * app/api/jobs/scan/route.ts, gated by the strategy_versions table (see
 * docs/STRATEGY_V1.md, docs/STRATEGY_V1_PAPER_READINESS.md). This entry
 * exists so `BUILT_IN_STRATEGIES` is a complete, honest list - it
 * deliberately does NOT re-route V1's production evaluation through the
 * generic contract, per the explicit instruction not to convert V1
 * production behavior in this checkpoint.
 */
const V1_METADATA: StrategyMetadata = {
  slug: "v1",
  displayName: "Strategy V1 (Legacy Baseline)",
  description:
    "The original single-strategy research baseline (1H regime gate + 15M setup score). Frozen/control - see docs/STRATEGY_V1.md. Still runs through its own dedicated pipeline, not this registry.",
  type: "BUILT_IN",
  status: "DRAFT",
  requiredTimeframes: ["H1", "M15"],
  supportedAssetClasses: ["CRYPTO"],
  supportedSides: ["LONG"],
  minimumHistoryRequirements: { H1: 200, M15: 50 },
  requiredFeatures: ["EMA20", "EMA50", "EMA200", "RSI14", "ATR14", "VOLUME_AVG20"],
};

function evaluate(): StrategyDecision {
  return {
    type: "NO_ACTION",
    reason:
      "V1 is not routed through the generic strategy contract in this checkpoint - it continues to run through lib/strategy/v1 and lib/candidates directly. This registry entry is metadata-only.",
  };
}

export const v1BuiltInStrategy: StrategyContract = { metadata: V1_METADATA, evaluate };
