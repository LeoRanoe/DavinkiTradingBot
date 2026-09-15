/**
 * Configurable cost model (Checkpoint 3A §16, hardened Checkpoint 3A.1
 * §2/§9). Every field has exactly one meaning, applied exactly once, at
 * exactly one fill.
 *
 * No field's value is asserted to be "the correct Bybit cost" — cost
 * scenarios are locked for comparison in Checkpoint 3B, not here.
 */
export type CostModel = {
  /** Fee charged on the ENTRY fill, in basis points of entry notional (qty * effective entry price). Charged once, at entry only. */
  entryFeeBps: number;
  /** Fee charged on the EXIT fill, in basis points of exit notional (qty * effective exit price). Charged once, at exit only. */
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

/**
 * §9: reject a cost model before it can create artificial alpha via a
 * negative "cost". All four fields must be finite and >= 0.
 */
export function validateCostModel(cost: CostModel): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const field of ["entryFeeBps", "exitFeeBps", "entrySlippageBps", "exitSlippageBps"] as const) {
    const value = cost[field];
    if (!Number.isFinite(value)) reasons.push(`${field}: must be finite (got ${value})`);
    else if (value < 0) reasons.push(`${field}: must be >= 0 (got ${value})`);
  }
  return { valid: reasons.length === 0, reasons };
}

export function assertValidCostModel(cost: CostModel): void {
  const check = validateCostModel(cost);
  if (!check.valid) {
    throw new Error(`Invalid cost model: ${check.reasons.join("; ")}`);
  }
}

/**
 * Effective price functions (§2): price-only, independent of quantity, so
 * they can be computed BEFORE sizing determines qty. This is the ordering
 * Checkpoint 3A.1 §2 requires: raw price -> effective price -> size from
 * effective price -> fee from resulting qty/effective notional.
 */
export function computeEffectiveEntryPrice(rawPrice: number, cost: CostModel): number {
  return rawPrice * (1 + cost.entrySlippageBps / 10_000);
}

/** For a long exit (a sell), slippage always lowers the effective price. */
export function computeEffectiveExitPrice(rawPrice: number, cost: CostModel): number {
  return rawPrice * (1 - cost.exitSlippageBps / 10_000);
}

export type FillCosts = {
  effectivePrice: number;
  feeAmount: number;
  slippageAmount: number;
};

/** qty must already be known (sized from the effective entry price - see engine.ts). */
export function computeEntryFillCosts(rawPrice: number, qty: number, cost: CostModel): FillCosts {
  const effectivePrice = computeEffectiveEntryPrice(rawPrice, cost);
  const slippageAmount = (effectivePrice - rawPrice) * qty;
  const feeAmount = (effectivePrice * qty * cost.entryFeeBps) / 10_000;
  return { effectivePrice, feeAmount, slippageAmount };
}

export function computeExitFillCosts(rawPrice: number, qty: number, cost: CostModel): FillCosts {
  const effectivePrice = computeEffectiveExitPrice(rawPrice, cost);
  const slippageAmount = (rawPrice - effectivePrice) * qty;
  const feeAmount = (effectivePrice * qty * cost.exitFeeBps) / 10_000;
  return { effectivePrice, feeAmount, slippageAmount };
}
