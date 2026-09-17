/**
 * Checkpoint 3B.0 §12/§13: profitability-evidence labeling rules, written
 * into the preregistration manifest and locked BEFORE any real V2
 * performance result is calculated (this module is pure code and takes
 * no real market data - see its test file for synthetic-only coverage,
 * which is explicitly allowed per strategy.ts's "unit tests ... may
 * construct synthetic ... objects directly" precedent).
 *
 * The four spec-named labels are REJECT / INSUFFICIENT_SAMPLE /
 * KEEP_RESEARCHING / ROBUST_RESEARCH_CANDIDATE (§12). A fifth,
 * WEAK_EVIDENCE, is added here ONLY for exhaustiveness: it is what a
 * configuration gets when it triggers neither REJECT nor
 * INSUFFICIENT_SAMPLE (both splits have positive expectancy and the
 * combined OOS sample is adequate) but still falls short of the full
 * KEEP_RESEARCHING bar (e.g. one split's profit factor <= 1).
 * WEAK_EVIDENCE is never a pass gate and never implies anything beyond
 * "none of the four preregistered labels apply yet."
 *
 * PRECEDENCE (matches §12's own wording, where INSUFFICIENT_SAMPLE is
 * explicitly scoped to "even when observed expectancy is positive" -
 * i.e. REJECT and INSUFFICIENT_SAMPLE are mutually exclusive by
 * construction, not by an arbitrary ordering choice here):
 *   1. REJECT - validation.expectancyR <= 0 OR holdout.expectancyR <= 0
 *      (a null expectancyR, meaning zero CLOSED trades in that split, is
 *      NOT treated as "<= 0" here - there is no evidence to reject, only
 *      a thin sample, which is INSUFFICIENT_SAMPLE's job to catch via
 *      the trade-count check below).
 *   2. INSUFFICIENT_SAMPLE - combined validation+holdout CLOSED trade
 *      count < 20.
 *   3. KEEP_RESEARCHING / ROBUST_RESEARCH_CANDIDATE - all §12 conditions
 *      met (validation & holdout expectancyR > 0 and profitFactor > 1,
 *      combined baseline expectancyR > 0, combined sample >= 20); ROBUST
 *      additionally requires the combined validation+holdout expectancy
 *      to remain > 0 under COST_STRESS.
 *   4. WEAK_EVIDENCE - none of the above (see above).
 */
export type ProfitabilityLabel =
  | "REJECT"
  | "INSUFFICIENT_SAMPLE"
  | "WEAK_EVIDENCE"
  | "KEEP_RESEARCHING"
  | "ROBUST_RESEARCH_CANDIDATE";

export type SplitEvidence = {
  expectancyR: number | null;
  profitFactor: number | null;
  closedTradeCount: number;
};

export type ProfitabilityEvidenceInput = {
  validation: SplitEvidence;
  holdout: SplitEvidence;
  /** expectancyR over validation+holdout CLOSED trades pooled together, under COST_BASELINE (the primary evaluation scenario, §12). */
  combinedBaselineExpectancyR: number | null;
  /** expectancyR over the same pooled validation+holdout trades, but re-evaluated under COST_STRESS - only consulted for the ROBUST upgrade. */
  combinedStressExpectancyR: number | null;
};

export const MIN_OOS_CLOSED_TRADES = 20;

function isStrictlyPositive(value: number | null): boolean {
  return value !== null && value > 0;
}

function isNonPositive(value: number | null): boolean {
  return value !== null && value <= 0;
}

export function classifyProfitabilityEvidence(input: ProfitabilityEvidenceInput): ProfitabilityLabel {
  if (isNonPositive(input.validation.expectancyR) || isNonPositive(input.holdout.expectancyR)) {
    return "REJECT";
  }

  const combinedSample = input.validation.closedTradeCount + input.holdout.closedTradeCount;
  if (combinedSample < MIN_OOS_CLOSED_TRADES) {
    return "INSUFFICIENT_SAMPLE";
  }

  const meetsKeepResearching =
    isStrictlyPositive(input.validation.expectancyR) &&
    isStrictlyPositive(input.holdout.expectancyR) &&
    input.validation.profitFactor !== null &&
    input.validation.profitFactor > 1 &&
    input.holdout.profitFactor !== null &&
    input.holdout.profitFactor > 1 &&
    isStrictlyPositive(input.combinedBaselineExpectancyR);

  if (!meetsKeepResearching) {
    return "WEAK_EVIDENCE";
  }

  if (isStrictlyPositive(input.combinedStressExpectancyR)) {
    return "ROBUST_RESEARCH_CANDIDATE";
  }

  return "KEEP_RESEARCHING";
}
