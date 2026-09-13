import type { AccountState, InstrumentRules, PositionSizing, RiskDecision, TradeProposal } from "./types";

function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.floor(value / step) * step;
}

/**
 * Computes a risk-compliant position size and validates it against exchange
 * minimums WITHOUT ever inflating size or shrinking the stop to force a fit.
 *
 * risk_budget = equity * maxRiskPerTradePct
 * position_notional = risk_budget / stop_distance_pct
 *
 * If the resulting size is below exchange minimums, the trade is REJECTED
 * with MIN_ORDER_RISK_CONFLICT - never bumped up to the minimum (spec #42).
 */
export function computePositionSize(
  proposal: TradeProposal,
  account: AccountState,
  maxRiskPerTradePct: number,
  instrument: InstrumentRules,
): RiskDecision {
  const { entryPrice, stopPrice, targetPrice } = proposal;

  if (entryPrice <= 0 || stopPrice <= 0 || targetPrice <= 0) {
    return { approved: false, reason: "INVALID_EXCHANGE_METADATA", detail: "Non-positive price(s) supplied." };
  }
  if (stopPrice >= entryPrice) {
    return {
      approved: false,
      reason: "INVALID_RISK_REWARD",
      detail: "Stop price must be below entry price for a long trade.",
    };
  }
  if (targetPrice <= entryPrice) {
    return {
      approved: false,
      reason: "INVALID_RISK_REWARD",
      detail: "Target price must be above entry price for a long trade.",
    };
  }

  const stopDistancePct = (entryPrice - stopPrice) / entryPrice;
  const riskReward = (targetPrice - entryPrice) / (entryPrice - stopPrice);

  if (account.equity <= 0) {
    return { approved: false, reason: "INSUFFICIENT_BALANCE", detail: "Account equity is zero or negative." };
  }

  const riskBudget = account.equity * maxRiskPerTradePct;
  const idealNotional = riskBudget / stopDistancePct;
  const idealQty = idealNotional / entryPrice;

  // Round DOWN to the exchange qty step - never round up, that would exceed
  // the intended risk budget.
  const qty = floorToStep(idealQty, instrument.qtyStep);
  const notional = qty * entryPrice;
  const riskAmount = qty * (entryPrice - stopPrice);

  if (qty <= 0 || qty < instrument.minOrderQty || notional < instrument.minOrderAmt) {
    return {
      approved: false,
      reason: "MIN_ORDER_RISK_CONFLICT",
      detail: `Risk-compliant size ($${notional.toFixed(2)}, qty ${qty}) is below the exchange minimum (min notional $${instrument.minOrderAmt}, min qty ${instrument.minOrderQty}). Skipping the trade rather than inflating size or shrinking the stop.`,
    };
  }

  if (instrument.maxOrderQty !== null && qty > instrument.maxOrderQty) {
    return {
      approved: false,
      reason: "INVALID_EXCHANGE_METADATA",
      detail: `Computed qty ${qty} exceeds exchange max order qty ${instrument.maxOrderQty}.`,
    };
  }

  const sizing: PositionSizing = { qty, notional, riskAmount, riskReward };
  return { approved: true, sizing };
}
