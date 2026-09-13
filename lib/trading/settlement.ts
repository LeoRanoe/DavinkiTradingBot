import type { CostModel } from "@/lib/risk/types";
import { computeFee, simulateEntryFill, simulateExitFill } from "./paper";

/**
 * Deterministic PAPER settlement math (Task A / Milestone 2).
 *
 * COST ACCOUNTING RULE - read before changing anything here:
 *   Slippage is expressed ONLY through the fill prices (a worse entry, a
 *   worse exit). It is therefore already inside `grossPnl` and must NEVER be
 *   subtracted again as a separate line - that would double-count it.
 *   Fees are the opposite: they are not in the fill price, so entry and exit
 *   fees are each subtracted exactly once.
 *
 *     entryFill = price * (1 + slippageBps/10000)     (worse for a long)
 *     exitFill  = price * (1 - slippageBps/10000)     (worse for a long)
 *     grossPnl  = (exitFill - entryFill) * qty
 *     netPnl    = grossPnl - entryFee - exitFee
 *
 * `realizedSlippage` is reported for auditing only; it is derived from the
 * same fills, never deducted a second time.
 */
export type OpenFill = {
  entryFillPrice: number;
  notional: number;
  entryFee: number;
  entrySlippageCost: number;
};

/** Models the fill for opening a long PAPER position at a reference price. */
export function computeOpenFill(referencePrice: number, qty: number, costModel: CostModel): OpenFill {
  const entryFillPrice = simulateEntryFill(referencePrice, costModel.slippageBps);
  const notional = entryFillPrice * qty;
  return {
    entryFillPrice,
    notional,
    entryFee: computeFee(notional, costModel.feeBps),
    entrySlippageCost: (entryFillPrice - referencePrice) * qty,
  };
}

export type SettlementInput = {
  entryFillPrice: number;
  /** The stop or target price itself, before exit slippage. */
  rawExitPrice: number;
  qty: number;
  /** Fee already charged when the position was opened. */
  entryFee: number;
  /** Entry-leg slippage already incurred at open, for the reported total. */
  entrySlippageCost: number;
  costModel: CostModel;
  /**
   * Denominator for realized R: the modeled worst case recorded at open
   * (price risk + fees + slippage), so a clean stop-out lands near -1.0R
   * AFTER costs rather than flattering the result.
   */
  riskBasis: number;
};

export type Settlement = {
  exitFillPrice: number;
  exitFee: number;
  totalFees: number;
  realizedSlippage: number;
  grossPnl: number;
  netPnl: number;
  realizedR: number;
};

export function computeSettlement(input: SettlementInput): Settlement {
  const exitFillPrice = simulateExitFill(input.rawExitPrice, input.costModel.slippageBps);
  const exitNotional = exitFillPrice * input.qty;
  const exitFee = computeFee(exitNotional, input.costModel.feeBps);

  const grossPnl = (exitFillPrice - input.entryFillPrice) * input.qty;
  const netPnl = grossPnl - input.entryFee - exitFee;

  const exitSlippageCost = (input.rawExitPrice - exitFillPrice) * input.qty;

  return {
    exitFillPrice,
    exitFee,
    totalFees: input.entryFee + exitFee,
    realizedSlippage: input.entrySlippageCost + exitSlippageCost,
    grossPnl,
    netPnl,
    realizedR: input.riskBasis > 0 ? netPnl / input.riskBasis : 0,
  };
}
