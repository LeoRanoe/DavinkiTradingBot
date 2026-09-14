/**
 * Research-eligibility classification for an instrument (CLAUDE.md §8,
 * Checkpoint 2 §8). Pure function of explicit inputs — it never fetches
 * anything itself and never invents a threshold it can't defend.
 *
 * When a required metric is missing, the result is UNKNOWN with a reason
 * naming exactly what's missing — never a guessed ELIGIBLE/INELIGIBLE.
 */

export type ResearchEligibilityStatus = "UNKNOWN" | "ELIGIBLE" | "INELIGIBLE";

export type ResearchEligibilityInput = {
  /** Bybit instruments-info `status` field, e.g. "Trading", "Delisted". */
  listingStatus: string | null;
  /** True if venue metadata (tickSize/qtyStep/minOrderAmt) could be fetched. */
  hasInstrumentMetadata: boolean;
  /** Number of closed candles actually observed on the strategy's entry timeframe. */
  historyBarCount: number | null;
  /** Minimum bar count required for a defensible study; caller-supplied, not invented here. */
  minHistoryBarCount: number;
  /** 24h quote-currency turnover, if the venue reports one. */
  turnoverUsd24h: number | null;
  /** Minimum turnover required; null means "no defensible threshold set yet". */
  minTurnoverUsd24h: number | null;
  isLeveragedToken: boolean;
  isStablecoinPair: boolean;
  /** True if the pair is a synthetic/wrapped duplicate not explicitly selected for research. */
  isUnselectedSyntheticDuplicate: boolean;
};

export type ResearchEligibilityResult = {
  status: ResearchEligibilityStatus;
  reasons: string[];
};

export function classifyResearchEligibility(input: ResearchEligibilityInput): ResearchEligibilityResult {
  const reasons: string[] = [];

  if (input.isLeveragedToken) reasons.push("LEVERAGED_TOKEN_EXCLUDED");
  if (input.isStablecoinPair) reasons.push("STABLECOIN_VS_STABLECOIN_EXCLUDED");
  if (input.isUnselectedSyntheticDuplicate) reasons.push("SYNTHETIC_WRAPPED_DUPLICATE_NOT_SELECTED");
  if (input.listingStatus !== null && input.listingStatus !== "Trading") {
    reasons.push(`NOT_ACTIVELY_TRADING (status=${input.listingStatus})`);
  }
  if (reasons.length > 0) {
    return { status: "INELIGIBLE", reasons };
  }

  const unknowns: string[] = [];
  if (input.listingStatus === null) unknowns.push("LISTING_STATUS_UNKNOWN");
  if (!input.hasInstrumentMetadata) unknowns.push("INSTRUMENT_METADATA_UNAVAILABLE");
  if (input.historyBarCount === null) unknowns.push("HISTORY_COVERAGE_UNKNOWN");
  if (input.minTurnoverUsd24h === null) unknowns.push("NO_DEFENSIBLE_TURNOVER_THRESHOLD_SET");
  else if (input.turnoverUsd24h === null) unknowns.push("TURNOVER_UNKNOWN");

  if (unknowns.length > 0) {
    return { status: "UNKNOWN", reasons: unknowns };
  }

  // From here every required metric is present.
  if (input.historyBarCount! < input.minHistoryBarCount) {
    return {
      status: "INELIGIBLE",
      reasons: [`INSUFFICIENT_HISTORY (${input.historyBarCount} < ${input.minHistoryBarCount})`],
    };
  }
  if (input.turnoverUsd24h! < input.minTurnoverUsd24h!) {
    return {
      status: "INELIGIBLE",
      reasons: [`INSUFFICIENT_TURNOVER (${input.turnoverUsd24h} < ${input.minTurnoverUsd24h})`],
    };
  }

  return { status: "ELIGIBLE", reasons: ["PASSED_ALL_CHECKS"] };
}
