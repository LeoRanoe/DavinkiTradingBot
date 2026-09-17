import type { AssetClass, Instrument } from "@/lib/domain/instrument";

/**
 * Historical-EDGE research eligibility (Checkpoint 3B.0 §4). This is a
 * DELIBERATELY SEPARATE policy from `lib/domain/eligibility.ts`'s
 * `classifyResearchEligibility` / the `instrument_research_eligibility`
 * DB table. That policy answers "is it safe to actually route
 * paper/shadow/live execution to this instrument" and includes
 * execution-liquidity concerns (a 24h turnover threshold). This module
 * answers a narrower, different question: "does the historical candle
 * data for this instrument, on this venue, support a defensible study of
 * whether a strategy has price-pattern edge" — turnover is irrelevant to
 * that question, and requiring it here would block a legitimate edge
 * study on an otherwise well-formed, real, exchange-listed instrument
 * for a reason that has nothing to do with historical price data.
 *
 * HARD SEPARATION, enforced by contract (not just by convention):
 *   - This module NEVER reads or writes `instrument_research_eligibility`,
 *     `paper_enabled`, or `shadow_enabled`. It takes plain inputs and
 *     returns a plain classification — no DB access of any kind.
 *   - The result status is `HISTORICAL_EDGE_ELIGIBLE` /
 *     `HISTORICAL_EDGE_INELIGIBLE` — deliberately NOT `ELIGIBLE`/
 *     `INELIGIBLE`/`UNKNOWN` (those are `ResearchEligibilityStatus`'s
 *     values). Nothing that reads this result can mistake it for a
 *     `instrument_research_eligibility` row's status by field-name
 *     confusion; they are different types entirely.
 *   - This module authorizes NOTHING beyond "run a historical backtest
 *     trial against this instrument's already-loaded candle data" - it
 *     has no path to `paper_enabled`/`shadow_enabled`/LIVE and must
 *     never be imported by any execution/production code path
 *     (lib/strategy/v1/, app/api/jobs/scan/route.ts, lib/trading/,
 *     lib/risk/) - same rule lib/research-engine/strategy.ts already
 *     documents for the whole namespace.
 *   - A `HISTORICAL_EDGE_ELIGIBLE` result changing `instrument_research_eligibility`,
 *     `paper_enabled`, or `shadow_enabled` for the same instrument is
 *     NEVER valid - a caller who does that has misused this module. If
 *     the DB row still resolves UNKNOWN for a given instrument, it
 *     remains UNKNOWN; this module's result does not (and cannot,
 *     because it never touches the DB) change that.
 */
export type HistoricalEdgeEligibilityStatus = "HISTORICAL_EDGE_ELIGIBLE" | "HISTORICAL_EDGE_INELIGIBLE";

export type HistoricalEdgeEligibilityInput = {
  instrument: Pick<Instrument, "assetClass" | "venue" | "venueSymbol" | "baseAsset" | "quoteAsset">;
  /** True iff this instrument is one of the checkpoint's exactly-five preregistered study members (by venueSymbol). */
  isPreregisteredStudyMember: boolean;
  /** From the owner's universe_members row - NOT authorized by this module, only read as a precondition. */
  researchEnabled: boolean;
  /** True iff the runtime provider (lib/domain/discovery/bybit-instrument-discovery.ts) confirmed the exact spot pair exists. */
  runtimeProviderConfirmsPairExists: boolean;
  /** Bybit instruments-info `status`, from a live runtime call - never manual/web evidence. */
  listingStatus: string | null;
  /** True iff live instrument metadata (tick size, lot size, etc.) was actually fetched. */
  instrumentMetadataLoaded: boolean;
  isLikelyLeveragedToken: boolean;
  isStablecoinVsStablecoin: boolean;
  isUnselectedSyntheticDuplicate: boolean;
  /** From candle-integrity.ts's validateCandleIntegrity(candles).valid over the loaded history. */
  historicalDataIntegrityValid: boolean;
  /** True iff loadHistoricalCandles reported zero gaps (or an explicit reviewed exception was granted - see gap-gate.ts). */
  noUnexplainedGaps: boolean;
  /** True iff the historical load was NOT truncated (maxPages was never the limiting factor). */
  loadNotTruncated: boolean;
  /** True iff the loaded bar count meets the study's minimum continuous-history requirement. */
  hasSufficientHistory: boolean;
};

export type HistoricalEdgeEligibilityResult = {
  status: HistoricalEdgeEligibilityStatus;
  reasons: string[];
};

const REQUIRED_ASSET_CLASS: AssetClass = "CRYPTO_SPOT";
const REQUIRED_VENUE = "BYBIT";

/**
 * Pure classification, no IO, no DB read/write. Every check below is
 * about "is the historical data fit for an edge study", never about
 * current liquidity/turnover - see the module doc comment for why that
 * distinction is deliberate, not an oversight.
 */
export function classifyHistoricalEdgeEligibility(
  input: HistoricalEdgeEligibilityInput,
): HistoricalEdgeEligibilityResult {
  const reasons: string[] = [];

  if (!input.isPreregisteredStudyMember) reasons.push("NOT_A_PREREGISTERED_STUDY_MEMBER");
  if (!input.researchEnabled) reasons.push("RESEARCH_NOT_ENABLED");
  if (input.instrument.assetClass !== REQUIRED_ASSET_CLASS) {
    reasons.push(`WRONG_ASSET_CLASS (expected ${REQUIRED_ASSET_CLASS}, got ${input.instrument.assetClass})`);
  }
  if (input.instrument.venue !== REQUIRED_VENUE) {
    reasons.push(`WRONG_VENUE (expected ${REQUIRED_VENUE}, got ${input.instrument.venue})`);
  }
  if (!input.runtimeProviderConfirmsPairExists) reasons.push("RUNTIME_PROVIDER_DID_NOT_CONFIRM_PAIR");
  if (input.listingStatus !== "Trading") reasons.push(`NOT_ACTIVELY_TRADING (status=${input.listingStatus})`);
  if (!input.instrumentMetadataLoaded) reasons.push("INSTRUMENT_METADATA_DID_NOT_LOAD");
  if (input.isLikelyLeveragedToken) reasons.push("LEVERAGED_TOKEN_EXCLUDED");
  if (input.isStablecoinVsStablecoin) reasons.push("STABLECOIN_VS_STABLECOIN_EXCLUDED");
  if (input.isUnselectedSyntheticDuplicate) reasons.push("SYNTHETIC_WRAPPED_DUPLICATE_NOT_SELECTED");
  if (!input.historicalDataIntegrityValid) reasons.push("HISTORICAL_DATA_INTEGRITY_FAILED");
  if (!input.noUnexplainedGaps) reasons.push("UNEXPLAINED_GAPS_PRESENT");
  if (!input.loadNotTruncated) reasons.push("HISTORICAL_LOAD_TRUNCATED");
  if (!input.hasSufficientHistory) reasons.push("INSUFFICIENT_HISTORY");

  if (reasons.length > 0) {
    return { status: "HISTORICAL_EDGE_INELIGIBLE", reasons };
  }
  return { status: "HISTORICAL_EDGE_ELIGIBLE", reasons: ["PASSED_ALL_HISTORICAL_EDGE_CHECKS"] };
}
