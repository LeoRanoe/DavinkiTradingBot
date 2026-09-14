import { makeInstrumentId, type Instrument } from "../instrument";

/**
 * Static canonical definitions for the crypto instruments this platform
 * currently knows about. `priceIncrement`/`sizeIncrement`/`minSize` here are
 * placeholders for domain-modeling purposes only — the frozen V1 production
 * path never reads this file and continues to fetch live exchange rules via
 * lib/bybit/client.ts `getInstrumentMetadata` (CLAUDE.md: "never hard-code
 * these" for anything that actually places or sizes an order).
 *
 * Membership here means "the domain model can represent this instrument",
 * NOT "this instrument is research-enabled" or "PAPER-enabled" — see
 * CLAUDE.md §43 (research_enabled / paper_enabled must stay separate flags,
 * to be owned by a future universe-service table, not by this file).
 */
export const CRYPTO_SPOT_INSTRUMENTS: readonly Instrument[] = [
  {
    id: makeInstrumentId("CRYPTO_SPOT", "BYBIT", "BTC", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: "BYBIT",
    venueSymbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    priceIncrement: 0.01,
    sizeIncrement: 0.000001,
    minSize: 0,
    maxSize: null,
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
  },
  {
    id: makeInstrumentId("CRYPTO_SPOT", "BYBIT", "ETH", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: "BYBIT",
    venueSymbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    priceIncrement: 0.01,
    sizeIncrement: 0.0001,
    minSize: 0,
    maxSize: null,
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
  },
  // Research-candidate instruments only (CLAUDE.md §13). Not enabled for
  // PRODUCTION or PAPER by anything in this codebase — no scanner, no
  // execution path, and no universe/settings table references these ids
  // yet. Each must still be verified live (listing, liquidity, not a
  // leveraged token/stablecoin pair) before any historical research runs;
  // this file only proves the domain model can name them.
  {
    id: makeInstrumentId("CRYPTO_SPOT", "BYBIT", "SOL", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: "BYBIT",
    venueSymbol: "SOLUSDT",
    baseAsset: "SOL",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    priceIncrement: 0.01,
    sizeIncrement: 0.001,
    minSize: 0,
    maxSize: null,
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    metadata: { researchCandidate: true, paperEnabled: false },
  },
  {
    id: makeInstrumentId("CRYPTO_SPOT", "BYBIT", "XRP", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: "BYBIT",
    venueSymbol: "XRPUSDT",
    baseAsset: "XRP",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    priceIncrement: 0.0001,
    sizeIncrement: 1,
    minSize: 0,
    maxSize: null,
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    metadata: { researchCandidate: true, paperEnabled: false },
  },
  {
    id: makeInstrumentId("CRYPTO_SPOT", "BYBIT", "BNB", "USDT"),
    assetClass: "CRYPTO_SPOT",
    venue: "BYBIT",
    venueSymbol: "BNBUSDT",
    baseAsset: "BNB",
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    priceIncrement: 0.01,
    sizeIncrement: 0.001,
    minSize: 0,
    maxSize: null,
    allowsLong: true,
    allowsShort: false,
    tradingCalendarId: "CRYPTO_24_7",
    metadata: { researchCandidate: true, paperEnabled: false },
  },
] as const;

export function findCryptoInstrumentByVenueSymbol(venueSymbol: string): Instrument | undefined {
  return CRYPTO_SPOT_INSTRUMENTS.find((i) => i.venueSymbol === venueSymbol);
}
