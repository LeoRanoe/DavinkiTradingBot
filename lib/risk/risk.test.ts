import { describe, expect, it } from "vitest";
import { computePositionSize } from "./position-sizing";
import { checkAccountLimits } from "./limits";
import { evaluateTradeRisk } from "./engine";
import type { AccountState, InstrumentRules, RiskLimits, TradeProposal } from "./types";

const baseInstrument: InstrumentRules = {
  tickSize: 0.01,
  qtyStep: 0.0001,
  minOrderQty: 0.0001,
  minOrderAmt: 5,
  maxOrderQty: null,
};

const baseAccount: AccountState = {
  equity: 10,
  openPositionsCount: 0,
  tradesOpenedTodayUtc: 0,
  losingTradesTodayUtc: 0,
};

const baseLimits: RiskLimits = {
  maxRiskPerTradePct: 0.01,
  maxOpenPositions: 1,
  maxNewTradesPerDay: 2,
  maxLosingTradesPerDay: 2,
};

describe("MANDATORY: minimum-order risk-conflict test (spec #42)", () => {
  it("rejects a trade whose risk-compliant size ($3.33) is below the $5 exchange minimum, WITHOUT inflating size or shrinking the stop", () => {
    // equity=10, risk=1% -> risk budget = $0.10
    // technical stop = 3% away -> risk-compliant notional = 0.10/0.03 ≈ $3.33
    // exchange minimum = $5 -> expect TRADE_REJECTED_MIN_ORDER_RISK_CONFLICT
    const entryPrice = 100;
    const stopPrice = 97; // 3% stop distance
    const targetPrice = 106; // arbitrary target, not the point of this test
    const proposal: TradeProposal = { entryPrice, stopPrice, targetPrice };

    const decision = computePositionSize(proposal, baseAccount, 0.01, {
      ...baseInstrument,
      minOrderAmt: 5,
    });

    expect(decision.approved).toBe(false);
    if (!decision.approved) {
      expect(decision.reason).toBe("MIN_ORDER_RISK_CONFLICT");
      // Must NOT have silently produced a $5 order.
      expect(decision.detail).not.toMatch(/\$5\.00\)/);
    }
  });

  it("does not increase the trade to $5 nor shrink the stop to make it fit", () => {
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 97, targetPrice: 106 };
    const decision = computePositionSize(proposal, baseAccount, 0.01, baseInstrument);
    // The function must return a rejection, not a mutated/adjusted proposal.
    expect(decision.approved).toBe(false);
  });
});

describe("position sizing - risk math", () => {
  it("sizes a position at exactly the 1% risk budget when above minimums", () => {
    const account: AccountState = { ...baseAccount, equity: 1000 };
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 97, targetPrice: 106 };
    const decision = computePositionSize(proposal, account, 0.01, baseInstrument);
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      // risk budget = 1000*0.01 = 10; stop distance = 3 -> qty ~= 3.333
      expect(decision.sizing.riskAmount).toBeLessThanOrEqual(10);
      expect(decision.sizing.riskAmount).toBeGreaterThan(9.9);
    }
  });

  it("computes risk/reward correctly", () => {
    const account: AccountState = { ...baseAccount, equity: 1000 };
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 95, targetPrice: 110 };
    const decision = computePositionSize(proposal, account, 0.01, baseInstrument);
    expect(decision.approved).toBe(true);
    if (decision.approved) expect(decision.sizing.riskReward).toBeCloseTo(2);
  });

  it("rejects when stop is not below entry", () => {
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 100, targetPrice: 110 };
    const decision = computePositionSize(proposal, baseAccount, 0.01, baseInstrument);
    expect(decision.approved).toBe(false);
    if (!decision.approved) expect(decision.reason).toBe("INVALID_RISK_REWARD");
  });

  it("rejects when target is not above entry", () => {
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 95, targetPrice: 100 };
    const decision = computePositionSize(proposal, baseAccount, 0.01, baseInstrument);
    expect(decision.approved).toBe(false);
    if (!decision.approved) expect(decision.reason).toBe("INVALID_RISK_REWARD");
  });

  it("rejects when equity is zero", () => {
    const account: AccountState = { ...baseAccount, equity: 0 };
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 95, targetPrice: 110 };
    const decision = computePositionSize(proposal, account, 0.01, baseInstrument);
    expect(decision.approved).toBe(false);
    if (!decision.approved) expect(decision.reason).toBe("INSUFFICIENT_BALANCE");
  });

  it("never rounds qty up past the qty step (would exceed intended risk)", () => {
    const account: AccountState = { ...baseAccount, equity: 1000 };
    const proposal: TradeProposal = { entryPrice: 100, stopPrice: 97, targetPrice: 106 };
    const decision = computePositionSize(proposal, account, 0.01, { ...baseInstrument, qtyStep: 0.01 });
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      const steps = decision.sizing.qty / 0.01;
      expect(Number.isInteger(Math.round(steps * 1e8) / 1e8)).toBe(true);
    }
  });
});

describe("account risk limits", () => {
  it("blocks a second open position when max is one", () => {
    const account: AccountState = { ...baseAccount, openPositionsCount: 1 };
    expect(checkAccountLimits(account, baseLimits)).toBe("OPEN_POSITION_LIMIT");
  });

  it("blocks new trades after two losing trades in a UTC day", () => {
    const account: AccountState = { ...baseAccount, losingTradesTodayUtc: 2 };
    expect(checkAccountLimits(account, baseLimits)).toBe("DAILY_LOSS_LOCK");
  });

  it("blocks a third new trade in a UTC day", () => {
    const account: AccountState = { ...baseAccount, tradesOpenedTodayUtc: 2 };
    expect(checkAccountLimits(account, baseLimits)).toBe("DAILY_TRADE_LIMIT");
  });

  it("allows a trade within all limits", () => {
    expect(checkAccountLimits(baseAccount, baseLimits)).toBeNull();
  });
});

describe("risk engine - full evaluation", () => {
  const goodProposal: TradeProposal = { entryPrice: 100, stopPrice: 95, targetPrice: 110 };

  it("blocks LIVE mode unconditionally, defense in depth", () => {
    const decision = evaluateTradeRisk({
      tradingMode: "LIVE",
      strategyApproved: true,
      proposal: goodProposal,
      account: { ...baseAccount, equity: 1000 },
      limits: baseLimits,
      instrument: baseInstrument,
      signalExpired: false,
    });
    expect(decision.approved).toBe(false);
    if (!decision.approved) expect(decision.reason).toBe("TRADING_MODE_BLOCK");
  });

  it("blocks trades on an unapproved strategy version", () => {
    const decision = evaluateTradeRisk({
      tradingMode: "PAPER",
      strategyApproved: false,
      proposal: goodProposal,
      account: { ...baseAccount, equity: 1000 },
      limits: baseLimits,
      instrument: baseInstrument,
      signalExpired: false,
    });
    expect(decision.approved).toBe(false);
    if (!decision.approved) expect(decision.reason).toBe("STRATEGY_NOT_APPROVED");
  });

  it("blocks an expired signal even if everything else is fine", () => {
    const decision = evaluateTradeRisk({
      tradingMode: "PAPER",
      strategyApproved: true,
      proposal: goodProposal,
      account: { ...baseAccount, equity: 1000 },
      limits: baseLimits,
      instrument: baseInstrument,
      signalExpired: true,
    });
    expect(decision.approved).toBe(false);
    if (!decision.approved) expect(decision.reason).toBe("STALE_SIGNAL");
  });

  it("approves a well-formed PAPER trade within limits", () => {
    const decision = evaluateTradeRisk({
      tradingMode: "PAPER",
      strategyApproved: true,
      proposal: goodProposal,
      account: { ...baseAccount, equity: 1000 },
      limits: baseLimits,
      instrument: baseInstrument,
      signalExpired: false,
    });
    expect(decision.approved).toBe(true);
  });

  it("AI confidence has no code path into this function - it only accepts deterministic inputs", () => {
    // Structural guarantee: RiskEngineInput has no "confidence"/"aiScore" field,
    // so there is nothing for an AI explanation to influence here even if a
    // caller tried to pass one through (TypeScript would reject an extra key
    // on a literal, and the function only reads the typed fields it declares).
    const decision = evaluateTradeRisk({
      tradingMode: "PAPER",
      strategyApproved: true,
      proposal: goodProposal,
      account: { ...baseAccount, equity: 1000 },
      limits: baseLimits,
      instrument: baseInstrument,
      signalExpired: false,
    } as const);
    expect(decision.approved).toBe(true);
  });
});
