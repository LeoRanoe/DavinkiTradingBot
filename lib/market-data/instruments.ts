import type { CanonicalInstrument, CanonicalInstrumentId } from "./types";

/**
 * Canonical instrument registry.
 *
 * XAU/USD is the PRIMARY JeanFX instrument. Its unit model is stated
 * explicitly rather than inherited from crypto sizing: one unit is one troy
 * ounce quoted in USD, so PnL is (exit - entry) * units in USD with no
 * contract multiplier and no implicit leverage. That makes normalized PAPER
 * research directly comparable across instruments without pretending to
 * model any particular broker's contract specification.
 */

export const XAUUSD_TWELVEDATA: CanonicalInstrument = {
  canonicalId: "METAL:TWELVEDATA:XAU/USD",
  id: "XAUUSD",
  providerId: "TWELVEDATA",
  providerSymbol: "XAU/USD",
  displayName: "Gold / US Dollar (spot)",
  assetClass: "METAL",
  // Gold is conventionally quoted to 2dp; one "pip" here is one cent.
  pipSize: 0.01,
  unitLabel: "troy ounce",
  unitsPerContract: 1,
  // 0.01 oz - small enough that a risk-compliant size is rarely below it,
  // and a size that IS below it is rejected, never rounded up.
  minOrderUnits: 0.01,
  quoteCurrency: "USD",
};

export const CANONICAL_INSTRUMENTS: Record<CanonicalInstrumentId, CanonicalInstrument> = {
  [XAUUSD_TWELVEDATA.canonicalId]: XAUUSD_TWELVEDATA,
};

export function resolveInstrument(canonicalId: CanonicalInstrumentId): CanonicalInstrument | null {
  return CANONICAL_INSTRUMENTS[canonicalId] ?? null;
}

export function instrumentsForProvider(providerId: CanonicalInstrument["providerId"]): CanonicalInstrument[] {
  return Object.values(CANONICAL_INSTRUMENTS).filter((i) => i.providerId === providerId);
}
