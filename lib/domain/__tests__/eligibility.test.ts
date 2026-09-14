import { describe, expect, it } from "vitest";
import { classifyResearchEligibility, type ResearchEligibilityInput } from "../eligibility";

function baseInput(overrides: Partial<ResearchEligibilityInput> = {}): ResearchEligibilityInput {
  return {
    listingStatus: "Trading",
    hasInstrumentMetadata: true,
    historyBarCount: 1000,
    minHistoryBarCount: 500,
    turnoverUsd24h: 50_000_000,
    minTurnoverUsd24h: 1_000_000,
    isLeveragedToken: false,
    isStablecoinPair: false,
    isUnselectedSyntheticDuplicate: false,
    ...overrides,
  };
}

describe("classifyResearchEligibility", () => {
  it("is ELIGIBLE when every check passes", () => {
    const result = classifyResearchEligibility(baseInput());
    expect(result.status).toBe("ELIGIBLE");
  });

  it("is INELIGIBLE for a leveraged token, without needing any other metric", () => {
    const result = classifyResearchEligibility(baseInput({ isLeveragedToken: true }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons).toContain("LEVERAGED_TOKEN_EXCLUDED");
  });

  it("is INELIGIBLE for a stablecoin-vs-stablecoin pair", () => {
    const result = classifyResearchEligibility(baseInput({ isStablecoinPair: true }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons).toContain("STABLECOIN_VS_STABLECOIN_EXCLUDED");
  });

  it("is INELIGIBLE for a not-Trading listing status", () => {
    const result = classifyResearchEligibility(baseInput({ listingStatus: "Delisted" }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons[0]).toMatch(/NOT_ACTIVELY_TRADING/);
  });

  it("is UNKNOWN, never a guessed verdict, when listing status hasn't been fetched", () => {
    const result = classifyResearchEligibility(baseInput({ listingStatus: null }));
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasons).toContain("LISTING_STATUS_UNKNOWN");
  });

  it("is UNKNOWN when history coverage hasn't been measured", () => {
    const result = classifyResearchEligibility(baseInput({ historyBarCount: null }));
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasons).toContain("HISTORY_COVERAGE_UNKNOWN");
  });

  it("is UNKNOWN (never fabricates a threshold) when no defensible turnover minimum is set", () => {
    const result = classifyResearchEligibility(baseInput({ minTurnoverUsd24h: null }));
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasons).toContain("NO_DEFENSIBLE_TURNOVER_THRESHOLD_SET");
  });

  it("is INELIGIBLE for insufficient history once every metric is actually known", () => {
    const result = classifyResearchEligibility(baseInput({ historyBarCount: 10, minHistoryBarCount: 500 }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons[0]).toMatch(/INSUFFICIENT_HISTORY/);
  });

  it("is INELIGIBLE for insufficient turnover once every metric is actually known", () => {
    const result = classifyResearchEligibility(baseInput({ turnoverUsd24h: 100, minTurnoverUsd24h: 1_000_000 }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons[0]).toMatch(/INSUFFICIENT_TURNOVER/);
  });
});
