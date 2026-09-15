/**
 * Configurable cost model (Checkpoint 3A §16). Unlike
 * `lib/backtest/types.ts`'s `BacktestConfig` ("feeBps: // round-trip fee in
 * basis points, applied each side" — ambiguous: is it once, halved, or
 * applied twice at full value?), every field here has exactly one meaning,
 * applied exactly once, at exactly one fill.
 *
 * No field's value is asserted to be "the correct Bybit cost" — cost
 * scenarios are locked for comparison in Checkpoint 3B, not here.
 */
export type CostModel = {
  /** Fee charged on the ENTRY fill, in basis points of entry notional (qty * entryFillPrice). Charged once, at entry only. */
  entryFeeBps: number;
  /** Fee charged on the EXIT fill, in basis points of exit notional (qty * exitFillPrice). Charged once, at exit only. */
  exitFeeBps: number;
  /**
   * Adverse price movement applied to the raw entry price BEFORE computing
   * entry notional/fee. For a long entry, slippage always moves the price
   * against the trader: effectiveEntryPrice = rawEntryPrice * (1 + entrySlippageBps / 10_000).
   */
  entrySlippageBps: number;
  /**
   * Adverse price movement applied to the raw exit price BEFORE computing
   * exit notional/fee. For a long exit (a sell), slippage always moves the
   * price against the trader: effectiveExitPrice = rawExitPrice * (1 - exitSlippageBps / 10_000).
   */
  exitSlippageBps: number;
};

export const ZERO_COST_MODEL: CostModel = {
  entryFeeBps: 0,
  exitFeeBps: 0,
  entrySlippageBps: 0,
  exitSlippageBps: 0,
};

export type FillCosts = {
  effectivePrice: number;
  feeAmount: number;
  slippageAmount: number;
};

/** Applies entry-side slippage + fee to a raw fill price. Long entry only (buy). */
export function applyEntryCosts(rawPrice: number, qty: number, cost: CostModel): FillCosts {
  const effectivePrice = rawPrice * (1 + cost.entrySlippageBps / 10_000);
  const slippageAmount = (effectivePrice - rawPrice) * qty;
  const feeAmount = (effectivePrice * qty * cost.entryFeeBps) / 10_000;
  return { effectivePrice, feeAmount, slippageAmount };
}

/** Applies exit-side slippage + fee to a raw fill price. Long exit only (sell). */
export function applyExitCosts(rawPrice: number, qty: number, cost: CostModel): FillCosts {
  const effectivePrice = rawPrice * (1 - cost.exitSlippageBps / 10_000);
  const slippageAmount = (rawPrice - effectivePrice) * qty;
  const feeAmount = (effectivePrice * qty * cost.exitFeeBps) / 10_000;
  return { effectivePrice, feeAmount, slippageAmount };
}
