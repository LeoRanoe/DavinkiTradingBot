import type { NormalizedRiskConfig } from "../position-sizing";

/**
 * Checkpoint 3B.0 §8: the single normalized risk assumption used for
 * every one of the 30 strategy x instrument configurations, across all
 * four cost scenarios. Locked so no configuration/instrument gets a more
 * favorable risk setting than another - this is for EDGE COMPARISON, not
 * a prediction of profit on the real $20 PAPER balance (see
 * position-sizing.ts's own doc comment). The 3A.1 no-leverage capital
 * cap remains active and is untouched by this checkpoint.
 */
export const LOCKED_RISK: NormalizedRiskConfig = {
  initialEquity: 10_000,
  riskPct: 0.01,
};
