/**
 * Canonical, venue-independent instrument model — Checkpoint 1 of the
 * multi-market architecture (see TASKS.md). This module introduces the
 * abstractions only; it does not change any production behavior. Strategy
 * V1's frozen BTC/USDT + ETH/USDT production universe
 * (lib/strategy/v1/config.ts) is untouched and does not consume this file.
 */

export type AssetClass = "CRYPTO_SPOT" | "FOREX";

/**
 * Deliberately an open string type, not a closed union of every venue this
 * platform might ever connect to (CLAUDE.md §41 "broker agnostic";
 * Checkpoint 2 review §7). Adding a real future venue is an adapter
 * implementation plus a `venues` DB row - it must never require widening a
 * union type baked into the core instrument model. `KNOWN_VENUE_IDS` below
 * exists for typo-safety in fixtures/tests, not to close the type.
 */
export type VenueId = string;

export const KNOWN_VENUE_IDS = {
  BYBIT: "BYBIT",
  OANDA_FAKE: "OANDA_FAKE",
  IBKR_FAKE: "IBKR_FAKE",
} as const satisfies Record<string, VenueId>;

/**
 * Stable, human-readable canonical identifier, e.g.
 * "CRYPTO:BYBIT:BTC/USDT" or "FOREX:OANDA_FAKE:EUR/USD".
 * Never used for business-logic branching (see CLAUDE.md §3 "no symbol
 * strings as the domain model") — it's an id, not a decision input.
 */
export type InstrumentId = string;

export function makeInstrumentId(
  assetClass: AssetClass,
  venue: VenueId,
  baseAsset: string,
  quoteAsset: string,
): InstrumentId {
  const family = assetClass === "CRYPTO_SPOT" ? "CRYPTO" : "FOREX";
  return `${family}:${venue}:${baseAsset}/${quoteAsset}`;
}

/**
 * A venue-independent instrument definition. See CLAUDE.md "Canonical
 * Instrument Model". Crypto spot fields that don't apply to a market
 * (pipSize, lotSize, marginRequired, ...) are left undefined rather than
 * defaulted to a fake value — strategies/sizing must check for presence,
 * never assume 0/1 means "not applicable".
 */
export interface Instrument {
  id: InstrumentId;
  assetClass: AssetClass;
  venue: VenueId;
  /** Venue-native symbol, e.g. "BTCUSDT" (Bybit) or "EUR_USD" (a future FX adapter). */
  venueSymbol: string;

  baseAsset: string;
  quoteAsset: string;
  /** Currency the account/P&L is settled in for this instrument, e.g. "USDT", "USD". */
  settlementAsset: string;

  /**
   * Provider-dependent exchange/broker rules. Deliberately OPTIONAL
   * (Checkpoint 2 review §3): the canonical instrument model is identity,
   * not a cache of live, mutable exchange rules. The authoritative source
   * for crypto spot remains `lib/bybit/client.ts getInstrumentMetadata()` +
   * the `instrument_metadata` table, refreshed every scan - nothing here
   * duplicates or guesses those values. Do not populate these fields with a
   * placeholder; leave them undefined until a real provider call has
   * verified them, and any execution code that needs them must fail
   * closed on `undefined` rather than default to 0/1 (see
   * lib/domain/exchange-rules.ts).
   */
  priceIncrement?: number;
  sizeIncrement?: number;
  minSize?: number;
  maxSize?: number | null;

  /** Futures/CFD-style contract multiplier. Undefined for crypto spot / FX spot. */
  contractMultiplier?: number;

  /** FOREX only. */
  pipSize?: number;
  /** Value of 1 pip per 1 lot, in quote currency, before account-currency conversion. */
  pipValuePerLot?: number;
  lotSize?: number;
  marginRequired?: boolean;

  allowsLong: boolean;
  allowsShort: boolean;

  tradingCalendarId: "CRYPTO_24_7" | "FX_24_5";

  /** Mirrors `instruments.is_active` (Checkpoint 2 review §2/§4) - used to exclude a delisted/retired instrument from any eligible research set. */
  isActive: boolean;

  metadata?: Record<string, unknown>;
}

/**
 * Current crypto spot policy: LONG ONLY. This is enforced independently of
 * whatever an Instrument or Opportunity's `side` field can represent —
 * supporting a LONG/SHORT enum in the domain model is not permission to
 * short (CLAUDE.md §17). Strategy V1 does not call this; it has never
 * emitted anything but LONG.
 */
export function assertLongOnlyPolicy(side: "LONG" | "SHORT", instrument: Pick<Instrument, "allowsShort">): {
  allowed: boolean;
  reason?: string;
} {
  if (side === "LONG") return { allowed: true };
  if (!instrument.allowsShort) {
    return { allowed: false, reason: "INSTRUMENT_DOES_NOT_ALLOW_SHORT" };
  }
  // Even when an instrument's convention permits shorting (e.g. margin FX),
  // current platform-wide policy is long-only across every asset class -
  // hence a reason name with no "CRYPTO_SPOT" in it (Checkpoint 2 review §8:
  // the old name was misleading on a non-crypto instrument, e.g. the FOREX
  // fixtures below).
  return { allowed: false, reason: "PLATFORM_LONG_ONLY_POLICY" };
}
