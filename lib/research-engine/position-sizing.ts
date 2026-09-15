/**
 * Normalized research-only position sizing (Checkpoint 3A §14/§15, hardened
 * Checkpoint 3A.1 §1). This is NOT `lib/risk/position-sizing.ts` (Strategy
 * V1's real-money sizing against live exchange minimums) and must never be
 * used by anything that touches real capital. It exists purely to compare
 * strategy EDGE across configurations on an identical risk budget — not to
 * represent what the live $20 PAPER account could actually execute.
 *
 * Convention: `initialEquity` starts at a normalized unit count (e.g.
 * 10,000), `riskPct` is the fraction of CURRENT equity risked per trade
 * (so risk compounds with equity, same convention as
 * lib/risk/position-sizing.ts's PERCENT_OF_EQUITY mode). The unit is
 * unitless/normalized — R-multiples are what's comparable across
 * instruments and configurations, not the absolute unit count. This must
 * never be reported as expected dollar profit from the real PAPER account.
 *
 * No leverage (§1): the risk-sized notional is capped to available equity
 * BEFORE computing qty. A narrow stop can never size a position larger
 * than 1x spot-equivalent equity — that would be implicit leverage. When
 * capped, the position risks LESS than `targetRiskBudget`; both the target
 * and the actual realized risk are reported so callers never silently
 * conflate the two.
 */
export type NormalizedRiskConfig = {
  initialEquity: number;
  riskPct: number; // e.g. 0.01 for 1%
};

export type PositionSizingResult =
  | {
      accepted: true;
      qty: number;
      /** equity * riskPct — the risk the trade WOULD have taken if capital were unlimited. */
      targetRiskBudget: number;
      /**
       * qty * (entryPrice - initialStopPrice) — the risk the trade ACTUALLY
       * takes given the equity cap. Use this, never `targetRiskBudget`, as
       * the R-multiple denominator: when `capitalCapped` is true this is
       * strictly less than `targetRiskBudget`.
       */
      actualInitialRisk: number;
      stopDistancePct: number;
      /** true when the risk-sized notional exceeded available equity and was capped to 1x equity (no leverage). */
      capitalCapped: boolean;
    }
  | {
      accepted: false;
      reason:
        | "STOP_NOT_BELOW_ENTRY"
        | "NON_FINITE_INPUT"
        | "NON_POSITIVE_QTY"
        | "NON_POSITIVE_EQUITY"
        | "RISK_PCT_OUT_OF_RANGE";
    };

/**
 * targetRiskBudget = equity * riskPct
 * stopDistancePct = (entryPrice - initialStopPrice) / entryPrice
 * riskSizedNotional = targetRiskBudget / stopDistancePct
 * actualNotional = min(riskSizedNotional, equity)   <- §1 no-leverage cap
 * qty = actualNotional / entryPrice
 * actualInitialRisk = qty * (entryPrice - initialStopPrice)
 * capitalCapped = riskSizedNotional > equity
 *
 * Rejects (never inflates/shrinks to force a fit) when initialStopPrice is
 * not strictly below entryPrice — this is the engine-side twin of §7's
 * "Require: initialStop < entryPrice. Otherwise: reject the trade as
 * invalid", evaluated here against the ACTUAL fill price (effective entry
 * price after slippage — see engine.ts), not the strategy's signal-time
 * reference price.
 *
 * Also rejects non-finite inputs, equity <= 0, and riskPct outside (0, 1] —
 * a zero/negative risk budget or a >100% risk-per-trade setting can never
 * silently pass through as "accepted".
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
  if (currentEquity <= 0) {
    return { accepted: false, reason: "NON_POSITIVE_EQUITY" };
  }
  if (!(config.riskPct > 0 && config.riskPct <= 1)) {
    return { accepted: false, reason: "RISK_PCT_OUT_OF_RANGE" };
  }
  if (!(initialStopPrice < entryPrice)) {
    return { accepted: false, reason: "STOP_NOT_BELOW_ENTRY" };
  }

  const targetRiskBudget = currentEquity * config.riskPct;
  const stopDistancePct = (entryPrice - initialStopPrice) / entryPrice;
  const riskSizedNotional = targetRiskBudget / stopDistancePct;
  const capitalCapped = riskSizedNotional > currentEquity;
  const actualNotional = Math.min(riskSizedNotional, currentEquity);
  const qty = actualNotional / entryPrice;

  if (!Number.isFinite(qty) || qty <= 0) {
    return { accepted: false, reason: "NON_POSITIVE_QTY" };
  }

  const actualInitialRisk = qty * (entryPrice - initialStopPrice);

  return { accepted: true, qty, targetRiskBudget, actualInitialRisk, stopDistancePct, capitalCapped };
}
