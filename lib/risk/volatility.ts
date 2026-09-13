import type { RejectionReason } from "./types";

/**
 * Deterministic volatility protection (Milestone 1). Not every technically
 * valid setup should be tradable during extreme movement - this is a hard
 * risk-layer gate using ATR-as-%-of-price, independent of the strategy
 * score's own volatility component. Qwen never decides volatility
 * eligibility.
 */
export type VolatilityConfig = {
  /** Reject candidates whose ATR/price exceeds this fraction, e.g. 0.05 for 5%. */
  maxAtrPct: number;
};

export function checkVolatility(atrPct: number | null, config: VolatilityConfig): RejectionReason | null {
  if (atrPct === null) return null; // insufficient history is already handled upstream by the score/regime gates.
  if (atrPct > config.maxAtrPct) return "EXCESSIVE_VOLATILITY";
  return null;
}
