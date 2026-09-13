import type { TradingMode } from "@/lib/types/trading-mode";
import { checkAccountLimits } from "./limits";
import { computePositionSizeFromBudget, resolveRiskBudget } from "./position-sizing";
import type {
  AccountState,
  CostModel,
  InstrumentRules,
  RiskDecision,
  RiskLimits,
  TradeProposal,
} from "./types";

export type RiskEngineInput = {
  tradingMode: TradingMode;
  strategyApproved: boolean;
  proposal: TradeProposal;
  account: AccountState;
  limits: RiskLimits;
  instrument: InstrumentRules;
  signalExpired: boolean;
  /** Fee/slippage assumptions applied to modeled loss/profit. Defaults to zero cost for legacy callers. */
  costModel?: CostModel;
};

/**
 * Single entry point for all trade-eligibility decisions. This is the ONLY
 * place that may approve a trade for sizing. AI (Qwen) never calls this with
 * elevated authority - approval always re-runs through here regardless of
 * where the request originated (dashboard click or Telegram approval).
 *
 * Evaluation order matters: cheapest/most-fundamental checks first.
 */
export function evaluateTradeRisk(input: RiskEngineInput): RiskDecision {
  const { tradingMode, strategyApproved, proposal, account, limits, instrument, signalExpired, costModel } = input;

  if (tradingMode === "LIVE") {
    // Defense in depth: LIVE must never be reachable, but if it somehow is,
    // refuse unconditionally rather than trust an upstream mode check.
    return { approved: false, reason: "TRADING_MODE_BLOCK", detail: "LIVE trading is disabled in this build." };
  }

  if (!strategyApproved) {
    return {
      approved: false,
      reason: "STRATEGY_NOT_APPROVED",
      detail: "Strategy version is not approved for this trading mode.",
    };
  }

  if (signalExpired) {
    return { approved: false, reason: "STALE_SIGNAL", detail: "Signal approval window has expired." };
  }

  const limitReason = checkAccountLimits(account, limits);
  if (limitReason) {
    return { approved: false, reason: limitReason, detail: `Blocked by account risk limit: ${limitReason}.` };
  }

  const riskBudget = resolveRiskBudget(account, limits);
  const decision = computePositionSizeFromBudget(proposal, account, riskBudget, instrument, costModel);

  if (decision.approved && limits.minRiskReward !== undefined && decision.sizing.riskReward < limits.minRiskReward) {
    return {
      approved: false,
      reason: "MIN_RISK_REWARD_NOT_MET",
      detail: `Risk/reward ${decision.sizing.riskReward.toFixed(2)} is below the configured minimum ${limits.minRiskReward.toFixed(2)}.`,
    };
  }

  return decision;
}
