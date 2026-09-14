import { KNOWN_VENUE_IDS, makeInstrumentId, type Instrument } from "../instrument";

/**
 * Static canonical definitions for the crypto instruments this platform
 * currently knows about.
 *
 * Deliberately carry NO price/size/min-size exchange rules (Checkpoint 2
 * review §3): those are live, mutable, provider-owned values. This is true
 * even for BTC/ETH - the frozen V1 production path never reads this file
 * at all and continues to fetch live exchange rules via
 * lib/bybit/client.ts `getInstrumentMetadata` on every scan
 * (CLAUDE.md: "never hard-code these"). Duplicating a guessed
 * `priceIncrement`/`sizeIncrement`/`minSize` here would just be a second,
 * driftable copy of something that already has one authoritative source.
 * See lib/domain/exchange-rules.ts for the fail-closed guard any future
 * generic execution code must use instead of defaulting a missing rule.
 *
 * Membership here means "the domain model can represent this instrument",
 * NOT "this instrument is research-enabled" or "PAPER-enabled" — see
 * CLAUDE.md §43 (research_enabled / paper_enabled must stay separate flags,
 * owned by the universe-service tables in
 * supabase/migrations/20260914130000_multi_market_universe.sql, not by
 * this file).
 */
export const CRYPTO_SPOT_INSTRUMENTS: readonly Instrument[] = [
  {
    id: makeInstrumentId("CRYPTO_SPOT", KNOWN_VENUE_IDS.BYBIT, "BTC", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: KNOWN_VENUE_IDS.BYBIT,
    venueSymbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    isActive: true,
    metadata: { productionPair: true },
  },
  {
    id: makeInstrumentId("CRYPTO_SPOT", KNOWN_VENUE_IDS.BYBIT, "ETH", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: KNOWN_VENUE_IDS.BYBIT,
    venueSymbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    isActive: true,
    metadata: { productionPair: true },
  },
  // Research-candidate instruments only (CLAUDE.md §13). Not enabled for
  // PRODUCTION or PAPER by anything in this codebase — no scanner, no
  // execution path reads these ids. Each must still be verified live
  // (listing, liquidity, not a leveraged token/stablecoin pair) before any
  // historical research runs; this file only proves the domain model can
  // name them. metadata.verifiedOnVenue stays false until
  // lib/domain/discovery/bybit-instrument-discovery.ts actually confirms
  // it against the venue from a deployed environment - a manual/web
  // check is not runtime provider verification (Checkpoint 2 review).
  {
    id: makeInstrumentId("CRYPTO_SPOT", KNOWN_VENUE_IDS.BYBIT, "SOL", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: KNOWN_VENUE_IDS.BYBIT,
    venueSymbol: "SOLUSDT",
    baseAsset: "SOL",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    isActive: true,
    metadata: { researchCandidate: true, paperEnabled: false, verifiedOnVenue: false },
  },
  {
    id: makeInstrumentId("CRYPTO_SPOT", KNOWN_VENUE_IDS.BYBIT, "XRP", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: KNOWN_VENUE_IDS.BYBIT,
    venueSymbol: "XRPUSDT",
    baseAsset: "XRP",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    isActive: true,
    metadata: { researchCandidate: true, paperEnabled: false, verifiedOnVenue: false },
  },
  {
    id: makeInstrumentId("CRYPTO_SPOT", KNOWN_VENUE_IDS.BYBIT, "BNB", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: KNOWN_VENUE_IDS.BYBIT,
    venueSymbol: "BNBUSDT",
    baseAsset: "BNB",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    isActive: true,
    metadata: { researchCandidate: true, paperEnabled: false, verifiedOnVenue: false },
  },
] as const;

export function findCryptoInstrumentByVenueSymbol(venueSymbol: string): Instrument | undefined {
  return CRYPTO_SPOT_INSTRUMENTS.find((i) => i.venueSymbol === venueSymbol);
}
