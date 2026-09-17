import { describe, expect, it } from "vitest";
import { classifyProfitabilityEvidence, type ProfitabilityEvidenceInput } from "../profitability-rules";

function evidence(overrides: Partial<ProfitabilityEvidenceInput> = {}): ProfitabilityEvidenceInput {
  return {
    validation: { expectancyR: 0.3, profitFactor: 1.5, closedTradeCount: 12 },
    holdout: { expectancyR: 0.2, profitFactor: 1.3, closedTradeCount: 10 },
    combinedBaselineExpectancyR: 0.25,
    combinedStressExpectancyR: 0.1,
    ...overrides,
  };
}

describe("classifyProfitabilityEvidence (§12/§13) — locked before any real result exists", () => {
  it("REJECT when validation expectancyR <= 0", () => {
    const input = evidence({ validation: { expectancyR: -0.1, profitFactor: 0.8, closedTradeCount: 15 } });
    expect(classifyProfitabilityEvidence(input)).toBe("REJECT");
  });

  it("REJECT when holdout expectancyR <= 0, even if validation is strongly positive", () => {
    const input = evidence({ holdout: { expectancyR: 0, profitFactor: 1, closedTradeCount: 15 } });
    expect(classifyProfitabilityEvidence(input)).toBe("REJECT");
  });

  it("INSUFFICIENT_SAMPLE when both splits are positive but combined OOS sample < 20", () => {
    const input = evidence({
      validation: { expectancyR: 0.3, profitFactor: 1.5, closedTradeCount: 8 },
      holdout: { expectancyR: 0.2, profitFactor: 1.3, closedTradeCount: 5 },
    });
    expect(classifyProfitabilityEvidence(input)).toBe("INSUFFICIENT_SAMPLE");
  });

  it("INSUFFICIENT_SAMPLE when a split has zero closed trades (null expectancyR is not treated as <= 0)", () => {
    const input = evidence({
      validation: { expectancyR: null, profitFactor: null, closedTradeCount: 0 },
      holdout: { expectancyR: 0.5, profitFactor: 2, closedTradeCount: 5 },
    });
    expect(classifyProfitabilityEvidence(input)).toBe("INSUFFICIENT_SAMPLE");
  });

  it("KEEP_RESEARCHING when all conditions hold but stress expectancy is not positive", () => {
    const input = evidence({ combinedStressExpectancyR: -0.05 });
    expect(classifyProfitabilityEvidence(input)).toBe("KEEP_RESEARCHING");
  });

  it("ROBUST_RESEARCH_CANDIDATE when KEEP_RESEARCHING conditions hold AND combined stress expectancy is positive", () => {
    const input = evidence({ combinedStressExpectancyR: 0.05 });
    expect(classifyProfitabilityEvidence(input)).toBe("ROBUST_RESEARCH_CANDIDATE");
  });

  it("WEAK_EVIDENCE when both splits positive, sample adequate, but a profitFactor fails the >1 bar", () => {
    const input = evidence({ validation: { expectancyR: 0.1, profitFactor: 0.9, closedTradeCount: 15 } });
    expect(classifyProfitabilityEvidence(input)).toBe("WEAK_EVIDENCE");
  });

  it("WEAK_EVIDENCE when both splits positive, sample adequate, but combined baseline expectancy is not positive", () => {
    const input = evidence({ combinedBaselineExpectancyR: -0.01 });
    expect(classifyProfitabilityEvidence(input)).toBe("WEAK_EVIDENCE");
  });

  it("exactly 20 combined closed trades is adequate (boundary, not insufficient)", () => {
    const input = evidence({
      validation: { expectancyR: 0.3, profitFactor: 1.5, closedTradeCount: 10 },
      holdout: { expectancyR: 0.2, profitFactor: 1.3, closedTradeCount: 10 },
    });
    expect(classifyProfitabilityEvidence(input)).not.toBe("INSUFFICIENT_SAMPLE");
  });

  it("19 combined closed trades is insufficient (boundary)", () => {
    const input = evidence({
      validation: { expectancyR: 0.3, profitFactor: 1.5, closedTradeCount: 9 },
      holdout: { expectancyR: 0.2, profitFactor: 1.3, closedTradeCount: 10 },
    });
    expect(classifyProfitabilityEvidence(input)).toBe("INSUFFICIENT_SAMPLE");
  });

  it("never labels a configuration higher merely because it has more trades - two identical-quality configs differing only in trade count both KEEP_RESEARCHING", () => {
    const fewer = evidence({
      validation: { expectancyR: 0.3, profitFactor: 1.5, closedTradeCount: 10 },
      holdout: { expectancyR: 0.2, profitFactor: 1.3, closedTradeCount: 10 },
    });
    const more = evidence({
      validation: { expectancyR: 0.3, profitFactor: 1.5, closedTradeCount: 50 },
      holdout: { expectancyR: 0.2, profitFactor: 1.3, closedTradeCount: 50 },
    });
    expect(classifyProfitabilityEvidence(fewer)).toBe(classifyProfitabilityEvidence(more));
  });
});
