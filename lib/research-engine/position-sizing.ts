/**
 * Normalized research-only position sizing (Checkpoint 3A §14/§15). This
 * is NOT `lib/risk/position-sizing.ts` (Strategy V1's real-money sizing
 * against live exchange minimums) and must never be used by anything that
 * touches real capital. It exists purely to compare strategy EDGE across
 * configurations on an identical risk budget — not to represent what the
 * live $20 PAPER account could actually execute.
 *
 * Convention: `initialEquity` starts at a normalized unit count (e.g.
 * 10,000), `riskPct` is the fraction of CURRENT equity risked per trade
 * (so risk compounds with equity, same convention as
 * lib/risk/position-sizing.ts's PERCENT_OF_EQUITY mode). The unit is
 * unitless/normalized — R-multiples are what's comparable across
 * instruments and configurations, not the absolute unit count. This must
 * never be reported as expected dollar profit from the real PAPER account.
 *
 * No leverage: qty is always sized from spot-equivalent notional. No
 * averaging down, no martingale — sizing is computed once per trade, at
 * entry, from the equity at that moment.
 */
export type NormalizedRiskConfig = {
  initialEquity: number;
  riskPct: number; // e.g. 0.01 for 1%
};

export type PositionSizingResult =
  | { accepted: true; qty: number; riskBudget: number; stopDistancePct: number }
  | { accepted: false; reason: "STOP_NOT_BELOW_ENTRY" | "NON_FINITE_INPUT" | "NON_POSITIVE_QTY" };

/**
 * riskBudget = equity * riskPct
 * stopDistancePct = (entryPrice - initialStopPrice) / entryPrice
 * rawNotional = riskBudget / stopDistancePct
 * qty = rawNotional / entryPrice
 *
 * Rejects (never inflates/shrinks to force a fit) when initialStopPrice is
 * not strictly below entryPrice — this is the engine-side twin of §7's
 * "Require: initialStop < entryPrice. Otherwise: reject the trade as
 * invalid", evaluated here against the ACTUAL fill price (next-bar open),
 * not the strategy's signal-time reference price.
 */
export function computeNormalizedPositionSize(
  entryPrice: number,
  initialStopPrice: number,
  currentEquity: number,
  config: NormalizedRiskConfig,
): PositionSizingResult {
  if (![entryPrice, initialStopPrice, currentEquity, config.riskPct].every(Number.isFinite)) {
    return { accepted: false, reason: "NON_FINITE_INPUT" };
  }
  if (!(initialStopPrice < entryPrice)) {
    return { accepted: false, reason: "STOP_NOT_BELOW_ENTRY" };
  }

  const riskBudget = currentEquity * config.riskPct;
  const stopDistancePct = (entryPrice - initialStopPrice) / entryPrice;
  const rawNotional = riskBudget / stopDistancePct;
  const qty = rawNotional / entryPrice;

  if (!Number.isFinite(qty) || qty <= 0) {
    return { accepted: false, reason: "NON_POSITIVE_QTY" };
  }

  return { accepted: true, qty, riskBudget, stopDistancePct };
}
