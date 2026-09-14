/**
 * Generic position-sizing contract (CLAUDE.md §7/§8). This does NOT replace
 * lib/risk/position-sizing.ts, which remains the single entrypoint for the
 * frozen crypto-spot V1 production path. This module only proves the
 * abstraction can be expressed for a second asset class (FOREX) without
 * reusing crypto's qty×price formula, per the explicit instruction:
 * "Do not implement fake forex sizing using crypto formulas."
 */

export type CryptoSpotSizingInput = {
  riskBudgetQuote: number;
  stopDistancePrice: number;
  qtyStep: number;
  minOrderAmt: number;
};

/** Mirrors the crypto-spot formula already implemented in lib/risk/position-sizing.ts. */
export function cryptoSpotRiskCompliantQty(input: CryptoSpotSizingInput): number {
  if (input.stopDistancePrice <= 0) return 0;
  return input.riskBudgetQuote / input.stopDistancePrice;
}

export type ForexSizingInput = {
  /** Risk budget expressed in ACCOUNT currency, not quote currency. */
  riskBudgetAccountCurrency: number;
  stopDistancePips: number;
  pipValuePerLot: number;
  /** Rate to convert pipValuePerLot's currency into account currency (1 if already matching). */
  quoteToAccountConversionRate: number;
};

/**
 * FX sizing is riskBudgetAccountCurrency / lossPerLotAtStopAccountCurrency
 * (CLAUDE.md §7), never qty × price. Returns lots (fractional allowed;
 * broker-specific lot-step rounding is an execution-provider concern, not
 * modeled here).
 */
export function forexRiskCompliantLots(input: ForexSizingInput): number {
  const lossPerLotAtStopAccountCurrency =
    input.stopDistancePips * input.pipValuePerLot * input.quoteToAccountConversionRate;
  if (lossPerLotAtStopAccountCurrency <= 0) return 0;
  return input.riskBudgetAccountCurrency / lossPerLotAtStopAccountCurrency;
}
