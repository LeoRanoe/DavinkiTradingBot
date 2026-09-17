import { JEANFX_V1_PARAMS, JEANFX_V1_STATUS, JEANFX_V1_VERSION_LABEL } from "@/lib/strategy/jeanfx-v1/config";
import type { StrategyContract, StrategyDecision, StrategyMetadata } from "../types";

/**
 * Registry entry for JeanFX v1 - metadata only in this checkpoint.
 *
 * The full liquidity-sweep -> MSS/BOS -> FVG -> retracement -> confirmation
 * state machine specified in docs/strategies/jeanfx-v1-spec.md is NOT
 * implemented yet (that is Prompt 2's work, per the brief: "Prompt 2 will
 * build JeanFX + user Strategy Builder on this architecture"). evaluate()
 * is an honest NOT_IMPLEMENTED stub so the registry is complete and
 * discoverable without fabricating detection logic.
 */
const JEANFX_V1_METADATA: StrategyMetadata = {
  slug: JEANFX_V1_VERSION_LABEL,
  displayName: "JeanFX Liquidity System",
  description:
    "Liquidity sweep -> MSS/BOS -> FVG -> retracement -> confirmation -> entry, targeting the next liquidity pool. See docs/strategies/jeanfx-v1-spec.md. Detection logic not yet implemented.",
  type: "BUILT_IN",
  status: JEANFX_V1_STATUS,
  requiredTimeframes: [JEANFX_V1_PARAMS.biasTimeframe, JEANFX_V1_PARAMS.structureTimeframe, JEANFX_V1_PARAMS.entryTimeframe],
  supportedAssetClasses: ["CRYPTO", "FOREX", "METAL"],
  supportedSides: ["LONG", "SHORT"],
  // IMPLEMENTATION ASSUMPTION: rough minimums to seat swing/ATR detection; not tuned.
  minimumHistoryRequirements: { H1: 50, M15: 50, M5: 50 },
  requiredFeatures: ["ATR14", "SWING_STRUCTURE", "LIQUIDITY_POOLS", "FVG"],
};

function evaluate(): StrategyDecision {
  return {
    type: "NO_ACTION",
    reason:
      "JeanFX v1 detection logic (sweep/MSS/BOS/FVG state machine) is not implemented in this checkpoint - see docs/strategies/jeanfx-v1-spec.md and TASKS.md for the planned follow-up.",
  };
}

export const jeanfxV1BuiltInStrategy: StrategyContract = { metadata: JEANFX_V1_METADATA, evaluate };
