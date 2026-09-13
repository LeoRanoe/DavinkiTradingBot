import type {
  AccountState,
  CostModel,
  InstrumentRules,
  PositionSizing,
  RiskDecision,
  RiskLimits,
  TradeProposal,
} from "./types";

const ZERO_COST_MODEL: CostModel = { feeBps: 0, slippageBps: 0 };

function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.floor(value / step) * step;
}

function validateProposal(proposal: TradeProposal): RiskDecision | null {
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
  return null;
}

/**
 * Computes a risk-compliant position size against an ALREADY-KNOWN dollar
 * risk budget (spec Milestone 1). This is the core sizing primitive shared
 * by both risk modes (PERCENT_OF_EQUITY and FIXED_AMOUNT) and by every
 * caller (paper execution, backtest, Telegram candidate preview).
 *
 * risk_budget = (caller-supplied, see resolveRiskBudget)
 * stop_distance_pct = (entry - stop) / entry
 * position_notional = risk_budget / stop_distance_pct
 *
 * The size is:
 *  - rounded DOWN to the exchange qty step (never up - that would exceed
 *    the intended risk budget),
 *  - capped to the account's available balance (spot has no margin - never
 *    increased to compensate, only ever reduced, which only reduces risk),
 *  - REJECTED (MIN_ORDER_RISK_CONFLICT) rather than inflated when the
 *    resulting size is below the exchange minimum (spec #42). The stop is
 *    never shrunk to force a fit either.
 */
export function computePositionSizeFromBudget(
  proposal: TradeProposal,
  account: AccountState,
  riskBudget: number,
  instrument: InstrumentRules,
  costModel: CostModel = ZERO_COST_MODEL,
): RiskDecision {
  const invalid = validateProposal(proposal);
  if (invalid) return invalid;

  const { entryPrice, stopPrice, targetPrice } = proposal;
  const stopDistancePct = (entryPrice - stopPrice) / entryPrice;
  const riskReward = (targetPrice - entryPrice) / (entryPrice - stopPrice);

  if (account.equity <= 0) {
    return { approved: false, reason: "INSUFFICIENT_BALANCE", detail: "Account equity is zero or negative." };
  }
  if (riskBudget <= 0) {
    return { approved: false, reason: "INSUFFICIENT_BALANCE", detail: "Configured risk budget is zero or negative." };
  }

  const idealNotional = riskBudget / stopDistancePct;

  // Spot has no margin: notional can never exceed usable capital. Capping it
  // here only ever REDUCES exposure (and therefore risk) below the intended
  // budget - it must never be raised to compensate.
  const availableBalance = account.availableBalance ?? account.equity;
  const cappedNotional = Math.min(idealNotional, Math.max(0, availableBalance));
  const idealQty = cappedNotional / entryPrice;

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

  const entryFee = notional * (costModel.feeBps / 10_000);
  const exitFee = notional * (costModel.feeBps / 10_000);
  const slippageCost = notional * (costModel.slippageBps / 10_000) * 2; // entry + exit
  const estimatedActualRisk = riskAmount + entryFee + exitFee + slippageCost;
  const grossTargetProfit = qty * (targetPrice - entryPrice);
  const estimatedTargetProfit = grossTargetProfit - entryFee - exitFee - slippageCost;

  const sizing: PositionSizing = {
    qty,
    notional,
    riskAmount,
    riskReward,
    riskBudget,
    entryFee,
    exitFee,
    slippageCost,
    estimatedActualRisk,
    modeledMaxLoss: estimatedActualRisk,
    estimatedTargetProfit,
  };
  return { approved: true, sizing };
}

/**
 * Legacy percent-of-equity entry point, unchanged in signature and behavior
 * for existing callers (paper execution, backtester). Delegates to
 * `computePositionSizeFromBudget` so both risk modes share one code path.
 */
export function computePositionSize(
  proposal: TradeProposal,
  account: AccountState,
  maxRiskPerTradePct: number,
  instrument: InstrumentRules,
  costModel: CostModel = ZERO_COST_MODEL,
): RiskDecision {
  const riskBudget = account.equity * maxRiskPerTradePct;
  return computePositionSizeFromBudget(proposal, account, riskBudget, instrument, costModel);
}

/**
 * Translates the owner's configured risk mode into a dollar risk budget.
 * Risk is never grown automatically (spec section 9) - this only reads the
 * owner's stored configuration, it never adapts to progress toward a goal.
 *
 *   PERCENT_OF_EQUITY - equity * maxRiskPerTradePct
 *   FIXED_AMOUNT       - fixedRiskAmount, capped at current equity (a fixed
 *                         dollar risk can never exceed what the account has)
 */
export function resolveRiskBudget(account: AccountState, limits: RiskLimits): number {
  const mode = limits.riskMode ?? "PERCENT_OF_EQUITY";
  if (mode === "FIXED_AMOUNT") {
    const amount = limits.fixedRiskAmount ?? 0;
    return Math.max(0, Math.min(amount, account.equity));
  }
  return account.equity * limits.maxRiskPerTradePct;
}
