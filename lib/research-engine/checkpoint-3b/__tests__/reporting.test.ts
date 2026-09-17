import { describe, expect, it } from "vitest";
import {
  compareConfigurations,
  computeOutlierConcentration,
  computeParameterFamilyEvidence,
  rankConfigurations,
  type ConfigurationComparisonSummary,
} from "../reporting";

function summary(overrides: Partial<ConfigurationComparisonSummary> = {}): ConfigurationComparisonSummary {
  return {
    configId: "X",
    oosNetExpectancyR: 0.2,
    oosProfitFactor: 1.5,
    survivesCostStress: true,
    maxDrawdownPct: 0.1,
    temporalInstability: 0.05,
    oosClosedTradeCount: 30,
    ...overrides,
  };
}

describe("compareConfigurations / rankConfigurations (§13) — expectancy first, never trade count", () => {
  it("ranks higher OOS net expectancyR first", () => {
    const a = summary({ configId: "A", oosNetExpectancyR: 0.5 });
    const b = summary({ configId: "B", oosNetExpectancyR: 0.1 });
    expect(rankConfigurations([b, a]).map((s) => s.configId)).toEqual(["A", "B"]);
  });

  it("breaks an expectancy tie on profit factor", () => {
    const a = summary({ configId: "A", oosProfitFactor: 2 });
    const b = summary({ configId: "B", oosProfitFactor: 1.1 });
    expect(rankConfigurations([b, a]).map((s) => s.configId)).toEqual(["A", "B"]);
  });

  it("breaks an expectancy+profitFactor tie on cost-stress survival", () => {
    const a = summary({ configId: "A", survivesCostStress: true });
    const b = summary({ configId: "B", survivesCostStress: false });
    expect(rankConfigurations([b, a]).map((s) => s.configId)).toEqual(["A", "B"]);
  });

  it("breaks further ties on lower max drawdown, then lower temporal instability", () => {
    const a = summary({ configId: "A", maxDrawdownPct: 0.05 });
    const b = summary({ configId: "B", maxDrawdownPct: 0.2 });
    expect(rankConfigurations([b, a]).map((s) => s.configId)).toEqual(["A", "B"]);
  });

  it("never ranks by trade count alone - a lower-trade-count config with better expectancy still wins", () => {
    const a = summary({ configId: "A", oosNetExpectancyR: 0.5, oosClosedTradeCount: 5 });
    const b = summary({ configId: "B", oosNetExpectancyR: 0.1, oosClosedTradeCount: 500 });
    expect(rankConfigurations([b, a]).map((s) => s.configId)).toEqual(["A", "B"]);
  });

  it("compareConfigurations returns 0 for identical summaries (aside from configId)", () => {
    expect(compareConfigurations(summary({ configId: "A" }), summary({ configId: "B" }))).toBe(0);
  });
});

describe("computeOutlierConcentration (§14) — exposed, never used to reject", () => {
  it("reports the largest winning and losing trade R", () => {
    const trades = [
      { outcome: "CLOSED" as const, rMultiple: 3 },
      { outcome: "CLOSED" as const, rMultiple: -1 },
      { outcome: "CLOSED" as const, rMultiple: 5 },
      { outcome: "CLOSED" as const, rMultiple: -2 },
    ];
    const report = computeOutlierConcentration(trades);
    expect(report.largestWinningTradeR).toBe(5);
    expect(report.largestLosingTradeR).toBe(-2);
  });

  it("computes top-1 and top-3 winning-trade contribution to total positive R", () => {
    const trades = [
      { outcome: "CLOSED" as const, rMultiple: 10 }, // top1
      { outcome: "CLOSED" as const, rMultiple: 5 },
      { outcome: "CLOSED" as const, rMultiple: 3 },
      { outcome: "CLOSED" as const, rMultiple: 2 },
      { outcome: "CLOSED" as const, rMultiple: -4 },
    ];
    // total positive R = 10+5+3+2 = 20
    const report = computeOutlierConcentration(trades);
    expect(report.top1WinContributionPct).toBeCloseTo(10 / 20, 10);
    expect(report.top3WinContributionPct).toBeCloseTo((10 + 5 + 3) / 20, 10);
  });

  it("ignores OPEN_AT_END trades entirely", () => {
    const trades = [
      { outcome: "CLOSED" as const, rMultiple: 2 },
      { outcome: "OPEN_AT_END" as const, rMultiple: null },
    ];
    const report = computeOutlierConcentration(trades);
    expect(report.largestWinningTradeR).toBe(2);
  });

  it("returns nulls when there are no winning trades (no division by zero)", () => {
    const trades = [{ outcome: "CLOSED" as const, rMultiple: -1 }];
    const report = computeOutlierConcentration(trades);
    expect(report.top1WinContributionPct).toBeNull();
    expect(report.top3WinContributionPct).toBeNull();
    expect(report.largestWinningTradeR).toBeNull();
  });
});

describe("computeParameterFamilyEvidence (§15) — losing instruments never hidden from the aggregate", () => {
  it("counts instruments with positive OOS expectancy out of the full universe, including losers", () => {
    const results = [
      { instrumentId: "BTC", oosBaselineExpectancyR: 0.3, oosBaselineProfitFactor: 1.5 },
      { instrumentId: "ETH", oosBaselineExpectancyR: -0.1, oosBaselineProfitFactor: 0.8 },
      { instrumentId: "SOL", oosBaselineExpectancyR: 0.2, oosBaselineProfitFactor: 1.2 },
      { instrumentId: "XRP", oosBaselineExpectancyR: -0.05, oosBaselineProfitFactor: 0.9 },
      { instrumentId: "BNB", oosBaselineExpectancyR: 0.1, oosBaselineProfitFactor: 1.1 },
    ];
    const evidence = computeParameterFamilyEvidence("TRB-1H-20-10", results);
    expect(evidence.instrumentsWithPositiveOosExpectancy).toBe(3);
    expect(evidence.totalInstrumentsEvaluated).toBe(5);
  });

  it("computes median expectancy and median profit factor across all five, losers included", () => {
    const results = [
      { instrumentId: "BTC", oosBaselineExpectancyR: 0.1, oosBaselineProfitFactor: 1.1 },
      { instrumentId: "ETH", oosBaselineExpectancyR: 0.2, oosBaselineProfitFactor: 1.2 },
      { instrumentId: "SOL", oosBaselineExpectancyR: 0.3, oosBaselineProfitFactor: 1.3 },
      { instrumentId: "XRP", oosBaselineExpectancyR: -0.5, oosBaselineProfitFactor: 0.5 },
      { instrumentId: "BNB", oosBaselineExpectancyR: -0.6, oosBaselineProfitFactor: 0.4 },
    ];
    const evidence = computeParameterFamilyEvidence("TRB-4H-50-20", results);
    expect(evidence.medianOosExpectancyR).toBe(0.1);
    expect(evidence.medianOosProfitFactor).toBe(1.1);
  });

  it("excludes null (insufficient-sample) results from the median but keeps them out of the positive count too", () => {
    const results = [
      { instrumentId: "BTC", oosBaselineExpectancyR: null, oosBaselineProfitFactor: null },
      { instrumentId: "ETH", oosBaselineExpectancyR: 0.2, oosBaselineProfitFactor: 1.2 },
    ];
    const evidence = computeParameterFamilyEvidence("TRB-1H-100-50", results);
    expect(evidence.totalInstrumentsEvaluated).toBe(2);
    expect(evidence.instrumentsWithPositiveOosExpectancy).toBe(1);
    expect(evidence.medianOosExpectancyR).toBe(0.2);
  });
});
