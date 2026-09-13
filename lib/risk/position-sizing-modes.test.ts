import { describe, expect, it } from "vitest";
import { computePositionSizeFromBudget, resolveRiskBudget } from "./position-sizing";
import type { AccountState, InstrumentRules, TradeProposal } from "./types";

const instrument: InstrumentRules = {
  tickSize: 0.01,
  qtyStep: 0.0001,
  minOrderQty: 0.0001,
  minOrderAmt: 5,
  maxOrderQty: null,
};

const proposal: TradeProposal = { entryPrice: 100, stopPrice: 97, targetPrice: 106 }; // 3% stop

describe("risk modes (spec Milestone 1)", () => {
  it("PERCENT_OF_EQUITY: $20 equity, 1% risk, 4% stop -> ~$5 notional", () => {
    const account: AccountState = { equity: 20, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const budget = resolveRiskBudget(account, {
      maxRiskPerTradePct: 0.01,
      maxOpenPositions: 1,
      maxNewTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
      riskMode: "PERCENT_OF_EQUITY",
    });
    expect(budget).toBeCloseTo(0.2);
    const p: TradeProposal = { entryPrice: 100, stopPrice: 96, targetPrice: 108 }; // 4% stop
    const decision = computePositionSizeFromBudget(p, account, budget, { ...instrument, minOrderAmt: 1, minOrderQty: 0.0001 });
    expect(decision.approved).toBe(true);
    if (decision.approved) expect(decision.sizing.notional).toBeCloseTo(5, 0);
  });

  it("FIXED_AMOUNT: risk budget equals the configured dollar amount, not a percentage of equity", () => {
    const account: AccountState = { equity: 1000, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const budget = resolveRiskBudget(account, {
      maxRiskPerTradePct: 0.5, // deliberately absurd, must be ignored in FIXED_AMOUNT mode
      maxOpenPositions: 1,
      maxNewTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
      riskMode: "FIXED_AMOUNT",
      fixedRiskAmount: 2,
    });
    expect(budget).toBe(2);
  });

  it("FIXED_AMOUNT is capped at current equity - never risks more than the account has", () => {
    const account: AccountState = { equity: 5, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const budget = resolveRiskBudget(account, {
      maxRiskPerTradePct: 0.01,
      maxOpenPositions: 1,
      maxNewTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
      riskMode: "FIXED_AMOUNT",
      fixedRiskAmount: 50,
    });
    expect(budget).toBe(5);
  });

  it("legacy callers omitting riskMode still get PERCENT_OF_EQUITY behavior", () => {
    const account: AccountState = { equity: 1000, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const budget = resolveRiskBudget(account, {
      maxRiskPerTradePct: 0.02,
      maxOpenPositions: 1,
      maxNewTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
    });
    expect(budget).toBe(20);
  });
});

describe("available-capital limitation (spec: never increase exposure to reach desired risk)", () => {
  it("caps notional to available balance, which only ever REDUCES the resulting risk", () => {
    // risk budget 10, 3% stop -> ideal notional ~333, but only $8 is available.
    const account: AccountState = {
      equity: 1000,
      availableBalance: 8,
      openPositionsCount: 0,
      tradesOpenedTodayUtc: 0,
      losingTradesTodayUtc: 0,
    };
    const decision = computePositionSizeFromBudget(proposal, account, 10, instrument);
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.sizing.notional).toBeLessThanOrEqual(8);
      expect(decision.sizing.riskAmount).toBeLessThan(10); // reduced, never inflated
    }
  });

  it("never produces a notional above available balance even when risk budget alone would allow it", () => {
    const account: AccountState = {
      equity: 1000,
      availableBalance: 50,
      openPositionsCount: 0,
      tradesOpenedTodayUtc: 0,
      losingTradesTodayUtc: 0,
    };
    const decision = computePositionSizeFromBudget(proposal, account, 100, instrument);
    expect(decision.approved).toBe(true);
    if (decision.approved) expect(decision.sizing.notional).toBeLessThanOrEqual(50);
  });
});

describe("fees and slippage (spec: displayed max loss must not understate realistic loss)", () => {
  it("modeledMaxLoss includes entry+exit fees and round-trip slippage, on top of the raw stop loss", () => {
    const account: AccountState = { equity: 1000, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const decision = computePositionSizeFromBudget(proposal, account, 10, instrument, { feeBps: 10, slippageBps: 5 });
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.sizing.modeledMaxLoss).toBeGreaterThan(decision.sizing.riskAmount);
      expect(decision.sizing.modeledMaxLoss).toBe(decision.sizing.estimatedActualRisk);
      expect(decision.sizing.entryFee).toBeGreaterThan(0);
      expect(decision.sizing.exitFee).toBeGreaterThan(0);
      expect(decision.sizing.slippageCost).toBeGreaterThan(0);
    }
  });

  it("estimatedTargetProfit is the gross target gain minus modeled fees and slippage", () => {
    const account: AccountState = { equity: 1000, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const decision = computePositionSizeFromBudget(proposal, account, 10, instrument, { feeBps: 10, slippageBps: 5 });
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      const grossTargetGain = decision.sizing.qty * (proposal.targetPrice - proposal.entryPrice);
      expect(decision.sizing.estimatedTargetProfit).toBeLessThan(grossTargetGain);
    }
  });

  it("zero cost model (legacy callers) leaves modeledMaxLoss equal to the raw stop loss", () => {
    const account: AccountState = { equity: 1000, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 };
    const decision = computePositionSizeFromBudget(proposal, account, 10, instrument);
    expect(decision.approved).toBe(true);
    if (decision.approved) expect(decision.sizing.modeledMaxLoss).toBeCloseTo(decision.sizing.riskAmount);
  });
});
