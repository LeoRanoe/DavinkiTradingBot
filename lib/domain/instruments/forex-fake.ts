import { makeInstrumentId, type Instrument } from "../instrument";

/**
 * NOT a real forex data source. These are fixtures for
 * lib/domain/adapters/fake-forex-market-data-provider.ts, which exists only
 * to prove (with tests) that the canonical domain model introduced in
 * Checkpoint 1 can represent FOREX instruments without a rewrite —
 * per CLAUDE.md §40/§41/§60 "Forex readiness". No real broker is connected.
 * No real money, price, or execution capability exists for these ids.
 */
export const FAKE_FOREX_INSTRUMENTS: readonly Instrument[] = [
  {
    id: makeInstrumentId("FOREX", "OANDA_FAKE", "EUR", "USD"),
    assetClass: "FOREX",
    venue: "OANDA_FAKE",
    venueSymbol: "EUR_USD",
    baseAsset: "EUR",
    quoteAsset: "USD",
    settlementAsset: "USD",
    priceIncrement: 0.0001,
    sizeIncrement: 1000,
    minSize: 1000,
    maxSize: null,
    pipSize: 0.0001,
    pipValuePerLot: 10, // standard lot, USD-quoted pair, approximate/fixed for test purposes
    lotSize: 100000,
    marginRequired: true,
    allowsLong: true,
    allowsShort: true,
    tradingCalendarId: "FX_24_5",
  },
  {
    id: makeInstrumentId("FOREX", "OANDA_FAKE", "USD", "JPY"),
    assetClass: "FOREX",
    venue: "OANDA_FAKE",
    venueSymbol: "USD_JPY",
    baseAsset: "USD",
    quoteAsset: "JPY",
    settlementAsset: "JPY",
    priceIncrement: 0.001,
    sizeIncrement: 1000,
    minSize: 1000,
    maxSize: null,
    pipSize: 0.01, // JPY pairs: pip is the 2nd decimal, not the 4th
    pipValuePerLot: 1000, // in JPY, before conversion to account currency
    lotSize: 100000,
    marginRequired: true,
    allowsLong: true,
    allowsShort: true,
    tradingCalendarId: "FX_24_5",
  },
] as const;
