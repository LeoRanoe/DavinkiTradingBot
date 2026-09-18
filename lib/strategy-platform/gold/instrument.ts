import type { Instrument } from "../types";

/**
 * JeanFX Gold (XAU/USD) - canonical instrument construction.
 *
 * Per the activation brief: "Add XAU/USD through the existing generic
 * Instrument / MarketDataProvider / StrategyContract. Do not put
 * broker-specific symbols inside JeanFX." JeanFX itself
 * (lib/strategy/jeanfx-v1/) never sees this file - it only ever consumes
 * the generic Instrument/CanonicalCandle/StrategyContext shapes from
 * lib/strategy-platform/types.ts, exactly as it does for crypto.
 *
 * Canonical id format: "METAL:<PROVIDER>:XAU/USD" (brief's own example).
 * The provider segment is NOT a broker/execution symbol - this stays a
 * PAPER research instrument with no live order-routing path anywhere in
 * this codebase. It identifies which market-data feed's candle/quote
 * semantics apply (session coverage, precision, gaps) since two metals
 * data providers are not guaranteed to agree bar-for-bar - see
 * docs/strategies/jeanfx-gold-activation.md "Instrument identity".
 */
export const GOLD_DATA_PROVIDER = "TWELVEDATA" as const;

export const GOLD_INSTRUMENT_ID = `METAL:${GOLD_DATA_PROVIDER}:XAU/USD` as const;

/**
 * IMPLEMENTATION ASSUMPTION (documented, pending real broker contract
 * metadata - see docs/strategies/jeanfx-gold-activation.md "Sizing model
 * assumptions"): spot gold is typically quoted to 2 decimal places
 * (e.g. 2412.35), so pipSize here is the minimum quoted price increment,
 * NOT a pip in the traditional FX sense (gold has no standardized "pip").
 */
export const GOLD_PIP_SIZE = 0.01;

export function buildGoldInstrument(): Instrument {
  return { id: GOLD_INSTRUMENT_ID, assetClass: "METAL", pipSize: GOLD_PIP_SIZE };
}
