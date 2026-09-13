import type { PerformanceMetrics } from "./analytics";

export type PaperReadinessReport = {
  recommendation: "KEEP_DRAFT" | "OWNER_REVIEW_FOR_PAPER_APPROVAL";
  reasons: string[];
  closedTrades: number;
  minimumInitialEvidenceMet: boolean;
};

/** Governance recommendation only. It never mutates strategy_versions. */
export function createPaperReadinessReport(input: {
  aggregate: PerformanceMetrics;
  validation: PerformanceMetrics;
  holdout: PerformanceMetrics;
  btc: PerformanceMetrics;
  eth: PerformanceMetrics;
}): PaperReadinessReport {
  const reasons: string[] = [];
  const aggregate = input.aggregate;
  if (aggregate.sampleCount < 20) reasons.push("Fewer than 20 closed trades: insufficient initial evidence.");
  if ((aggregate.expectancyR ?? 0) <= 0) reasons.push("Aggregate expectancy is not positive.");
  if ((aggregate.profitFactor ?? 0) <= 1) reasons.push("Profit factor is not above 1 after modeled costs.");
  if (input.validation.evidenceLevel !== "INITIAL_EVIDENCE" || input.holdout.evidenceLevel !== "INITIAL_EVIDENCE") reasons.push("Validation and untouched holdout evidence are not yet sufficient.");
  if ((input.validation.expectancyR ?? 0) <= 0 || (input.holdout.expectancyR ?? 0) <= 0) reasons.push("Out-of-sample expectancy is not positive.");
  if (input.btc.evidenceLevel !== "INITIAL_EVIDENCE" || input.eth.evidenceLevel !== "INITIAL_EVIDENCE") reasons.push("Asset-level robustness is not yet established for both BTC and ETH.");
  return {
    recommendation: reasons.length ? "KEEP_DRAFT" : "OWNER_REVIEW_FOR_PAPER_APPROVAL",
    reasons: reasons.length ? reasons : ["Evidence meets the minimum gate; owner review is still required and no activation occurred."],
    closedTrades: aggregate.sampleCount,
    minimumInitialEvidenceMet: aggregate.sampleCount >= 20,
  };
}
