import { describe, expect, it } from "vitest";
import { classifyHistoricalEdgeEligibility, type HistoricalEdgeEligibilityInput } from "../historical-edge-eligibility";

function baseInput(overrides: Partial<HistoricalEdgeEligibilityInput> = {}): HistoricalEdgeEligibilityInput {
  return {
    instrument: { assetClass: "CRYPTO_SPOT", venue: "BYBIT", venueSymbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
    isPreregisteredStudyMember: true,
    researchEnabled: true,
    runtimeProviderConfirmsPairExists: true,
    listingStatus: "Trading",
    instrumentMetadataLoaded: true,
    isLikelyLeveragedToken: false,
    isStablecoinVsStablecoin: false,
    isUnselectedSyntheticDuplicate: false,
    historicalDataIntegrityValid: true,
    noUnexplainedGaps: true,
    loadNotTruncated: true,
    hasSufficientHistory: true,
    ...overrides,
  };
}

describe("classifyHistoricalEdgeEligibility (§4) — separate from DB execution eligibility, no turnover requirement", () => {
  it("ELIGIBLE when every historical-data condition holds, with no turnover input at all", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput());
    expect(result.status).toBe("HISTORICAL_EDGE_ELIGIBLE");
  });

  it("this module's input type has no turnover/liquidity field whatsoever (structural proof of the separation)", () => {
    const input = baseInput();
    expect(input).not.toHaveProperty("turnoverUsd24h");
    expect(input).not.toHaveProperty("minTurnoverUsd24h");
  });

  it("INELIGIBLE when the instrument is not one of the five preregistered study members", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ isPreregisteredStudyMember: false }));
    expect(result.status).toBe("HISTORICAL_EDGE_INELIGIBLE");
    expect(result.reasons).toContain("NOT_A_PREREGISTERED_STUDY_MEMBER");
  });

  it("INELIGIBLE when research is not enabled on the owner's universe_members row", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ researchEnabled: false }));
    expect(result.reasons).toContain("RESEARCH_NOT_ENABLED");
  });

  it("INELIGIBLE on the wrong asset class", () => {
    const result = classifyHistoricalEdgeEligibility(
      baseInput({ instrument: { assetClass: "FOREX", venue: "BYBIT", venueSymbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" } }),
    );
    expect(result.reasons.some((r) => r.startsWith("WRONG_ASSET_CLASS"))).toBe(true);
  });

  it("INELIGIBLE on the wrong venue", () => {
    const result = classifyHistoricalEdgeEligibility(
      baseInput({ instrument: { assetClass: "CRYPTO_SPOT", venue: "BINANCE", venueSymbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" } }),
    );
    expect(result.reasons.some((r) => r.startsWith("WRONG_VENUE"))).toBe(true);
  });

  it("INELIGIBLE when the runtime provider does not confirm the pair exists", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ runtimeProviderConfirmsPairExists: false }));
    expect(result.reasons).toContain("RUNTIME_PROVIDER_DID_NOT_CONFIRM_PAIR");
  });

  it("INELIGIBLE when listing status is not Trading", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ listingStatus: "Delisted" }));
    expect(result.reasons.some((r) => r.startsWith("NOT_ACTIVELY_TRADING"))).toBe(true);
  });

  it("INELIGIBLE when instrument metadata did not load", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ instrumentMetadataLoaded: false }));
    expect(result.reasons).toContain("INSTRUMENT_METADATA_DID_NOT_LOAD");
  });

  it("INELIGIBLE for a likely leveraged token", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ isLikelyLeveragedToken: true }));
    expect(result.reasons).toContain("LEVERAGED_TOKEN_EXCLUDED");
  });

  it("INELIGIBLE for a stablecoin-vs-stablecoin pair", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ isStablecoinVsStablecoin: true }));
    expect(result.reasons).toContain("STABLECOIN_VS_STABLECOIN_EXCLUDED");
  });

  it("INELIGIBLE for an unselected synthetic duplicate", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ isUnselectedSyntheticDuplicate: true }));
    expect(result.reasons).toContain("SYNTHETIC_WRAPPED_DUPLICATE_NOT_SELECTED");
  });

  it("INELIGIBLE when historical data integrity fails", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ historicalDataIntegrityValid: false }));
    expect(result.reasons).toContain("HISTORICAL_DATA_INTEGRITY_FAILED");
  });

  it("INELIGIBLE when unexplained gaps are present", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ noUnexplainedGaps: false }));
    expect(result.reasons).toContain("UNEXPLAINED_GAPS_PRESENT");
  });

  it("INELIGIBLE when the historical load was truncated", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ loadNotTruncated: false }));
    expect(result.reasons).toContain("HISTORICAL_LOAD_TRUNCATED");
  });

  it("INELIGIBLE when there is insufficient history", () => {
    const result = classifyHistoricalEdgeEligibility(baseInput({ hasSufficientHistory: false }));
    expect(result.reasons).toContain("INSUFFICIENT_HISTORY");
  });

  it("reports every failing reason at once, not just the first", () => {
    const result = classifyHistoricalEdgeEligibility(
      baseInput({ isLikelyLeveragedToken: true, isStablecoinVsStablecoin: true, loadNotTruncated: false }),
    );
    expect(result.reasons).toContain("LEVERAGED_TOKEN_EXCLUDED");
    expect(result.reasons).toContain("STABLECOIN_VS_STABLECOIN_EXCLUDED");
    expect(result.reasons).toContain("HISTORICAL_LOAD_TRUNCATED");
  });

  it("result status values are distinct strings from ResearchEligibilityStatus - never confusable with a DB row's status", () => {
    const eligible = classifyHistoricalEdgeEligibility(baseInput());
    const ineligible = classifyHistoricalEdgeEligibility(baseInput({ hasSufficientHistory: false }));
    expect(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]).not.toContain(eligible.status);
    expect(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]).not.toContain(ineligible.status);
  });
});
