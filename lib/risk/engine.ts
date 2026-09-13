import type { TradingMode } from "@/lib/types/trading-mode";
import { checkAccountLimits } from "./limits";
import { computePositionSize } from "./position-sizing";
import type { AccountState, InstrumentRules, RiskDecision, RiskLimits, TradeProposal } from "./types";

export type RiskEngineInput = {
  tradingMode: TradingMode;
  strategyApproved: boolean;
  proposal: TradeProposal;
  account: AccountState;
  limits: RiskLimits;
  instrument: InstrumentRules;
  signalExpired: boolean;
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
  const { tradingMode, strategyApproved, proposal, account, limits, instrument, signalExpired } = input;

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

  return computePositionSize(proposal, account, limits.maxRiskPerTradePct, instrument);
}
