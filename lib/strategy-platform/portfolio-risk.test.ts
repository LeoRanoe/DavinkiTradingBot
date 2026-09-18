import { describe, expect, it } from "vitest";
import { applyPortfolioRisk, NO_CORRELATION_MODELING, type PortfolioLimits } from "./portfolio-risk";
import type { PortfolioState } from "./orchestrator-types";
import type { Instrument, Opportunity } from "./types";

function opp(overrides: Partial<Opportunity>): Opportunity {
  return {
    userId: "user-1",
    strategyDefinitionId: "def-jeanfx",
    strategyVersionId: "ver-1",
    strategyConfigurationId: "cfg-1",
    strategyAssignmentId: "asn-1",
    instrumentId: "ETHUSDT",
    side: "LONG",
    signalTime: 1,
    entry: { price: 100, kind: "MARKET" },
    stop: { price: 95, kind: "STRUCTURE" },
    target: { price: 115, kind: "LIQUIDITY" },
    partialExitPlan: null,
    reasonCodes: [],
    parameterSnapshot: {},
    featureSnapshot: {},
    confidence: null,
    priority: 100,
    ...overrides,
  };
}

const emptyPortfolio: PortfolioState = {
  openRiskByInstrument: {},
  openRiskByStrategy: {},
  openRiskByAssetClass: {},
  openPositionsByStrategy: {},
  totalOpenPositions: 0,
  totalOpenRisk: 0,
};

const generousLimits: PortfolioLimits = {
  maxTotalOpenRiskPct: 1,
  maxRiskPerInstrumentPct: 1,
  maxRiskPerStrategyPct: 1,
  maxPositionsPerStrategy: 100,
  maxTotalPositions: 100,
  maxExposurePerAssetClassPct: 1,
  maxCorrelatedExposurePct: 1,
};

const flatRisk = () => 0.01;
const cryptoInstrument = (id: string): Instrument => ({ id, assetClass: "CRYPTO", pipSize: 0.01 });

describe("applyPortfolioRisk - same-instrument/same-direction aggregation (Prompt 3 S5)", () => {
  it("JeanFX LONG ETH + TRB LONG ETH combine into one PositionIntent with both attributed", () => {
    const jeanfx = opp({ strategyDefinitionId: "def-jeanfx" });
    const trb = opp({ strategyDefinitionId: "def-trb" });
    const result = applyPortfolioRisk([jeanfx, trb], flatRisk, cryptoInstrument, emptyPortfolio, generousLimits);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].combinedRiskPct).toBeCloseTo(0.02);
    expect(result.intents[0].contributingOpportunities).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("combined risk exceeding the instrument cap rejects the whole group rather than silently doubling exposure", () => {
    const jeanfx = opp({ strategyDefinitionId: "def-jeanfx" });
    const trb = opp({ strategyDefinitionId: "def-trb" });
    const tightLimits: PortfolioLimits = { ...generousLimits, maxRiskPerInstrumentPct: 0.015 };
    const result = applyPortfolioRisk([jeanfx, trb], flatRisk, cryptoInstrument, emptyPortfolio, tightLimits);
    expect(result.intents).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0].reason).toMatch(/INSTRUMENT_RISK_CAP/);
  });

  it("is deterministic regardless of input array order", () => {
    const a = opp({ strategyDefinitionId: "def-a", instrumentId: "BTCUSDT" });
    const b = opp({ strategyDefinitionId: "def-b", instrumentId: "ETHUSDT" });
    const forward = applyPortfolioRisk([a, b], flatRisk, cryptoInstrument, emptyPortfolio, generousLimits);
    const backward = applyPortfolioRisk([b, a], flatRisk, cryptoInstrument, emptyPortfolio, generousLimits);
    expect(forward.intents.map((i) => i.instrumentId).sort()).toEqual(backward.intents.map((i) => i.instrumentId).sort());
  });
});

describe("applyPortfolioRisk - per-strategy and total caps", () => {
  it("rejects a strategy's opportunities once its own risk cap is reached, without affecting other strategies", () => {
    const overCap = opp({ strategyDefinitionId: "def-jeanfx", instrumentId: "BTCUSDT" });
    const fine = opp({ strategyDefinitionId: "def-trb", instrumentId: "ETHUSDT" });
    const riskByStrategy = (o: Opportunity) => (o.strategyDefinitionId === "def-jeanfx" ? 0.01 : 0.001);
    const limits: PortfolioLimits = { ...generousLimits, maxRiskPerStrategyPct: 0.005 };
    const result = applyPortfolioRisk([overCap, fine], riskByStrategy, cryptoInstrument, emptyPortfolio, limits);
    expect(result.intents.map((i) => i.instrumentId)).toEqual(["ETHUSDT"]);
    expect(result.rejected[0].reason).toMatch(/STRATEGY_RISK_CAP/);
  });

  it("respects existing portfolio state, not just new opportunities", () => {
    const portfolioWithOpenRisk: PortfolioState = { ...emptyPortfolio, openRiskByInstrument: { BTCUSDT: 0.995 } };
    const result = applyPortfolioRisk([opp({ instrumentId: "BTCUSDT" })], flatRisk, cryptoInstrument, portfolioWithOpenRisk, generousLimits);
    expect(result.intents).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/INSTRUMENT_RISK_CAP/);
  });

  it("total position cap rejects the excess deterministically once the cap is hit", () => {
    const opps = ["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((id) => opp({ instrumentId: id, strategyDefinitionId: `def-${id}` }));
    const limits: PortfolioLimits = { ...generousLimits, maxTotalPositions: 2 };
    const result = applyPortfolioRisk(opps, flatRisk, cryptoInstrument, emptyPortfolio, limits);
    expect(result.intents).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });

  it("asset class exposure cap is enforced across instruments in the same class", () => {
    const opps = ["BTCUSDT", "ETHUSDT"].map((id) => opp({ instrumentId: id, strategyDefinitionId: `def-${id}` }));
    const limits: PortfolioLimits = { ...generousLimits, maxExposurePerAssetClassPct: 0.015 };
    const result = applyPortfolioRisk(opps, flatRisk, cryptoInstrument, emptyPortfolio, limits);
    expect(result.intents).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/ASSET_CLASS_CAP/);
  });
});

describe("applyPortfolioRisk - correlation hook (honestly conservative, not pretending it's solved)", () => {
  it("with no correlation policy given, two different instruments never interact", () => {
    const opps = ["BTCUSDT", "ETHUSDT"].map((id) => opp({ instrumentId: id, strategyDefinitionId: `def-${id}` }));
    const limits: PortfolioLimits = { ...generousLimits, maxCorrelatedExposurePct: 0.015 };
    const result = applyPortfolioRisk(opps, flatRisk, cryptoInstrument, emptyPortfolio, limits, NO_CORRELATION_MODELING);
    expect(result.intents).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("a real correlation policy caps combined exposure across grouped instruments", () => {
    const opps = ["BTCUSDT", "ETHUSDT"].map((id) => opp({ instrumentId: id, strategyDefinitionId: `def-${id}` }));
    const limits: PortfolioLimits = { ...generousLimits, maxCorrelatedExposurePct: 0.015 };
    const majorCryptoCorrelated = { groupOf: () => "MAJOR_CRYPTO" };
    const result = applyPortfolioRisk(opps, flatRisk, cryptoInstrument, emptyPortfolio, limits, majorCryptoCorrelated);
    expect(result.intents).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/CORRELATED_EXPOSURE_CAP/);
  });
});
