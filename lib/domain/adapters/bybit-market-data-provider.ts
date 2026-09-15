import { getCandles, getInstrumentMetadata, getTicker } from "@/lib/bybit/client";
import type { CanonicalCandle, CanonicalTicker, MarketDataProvider } from "../market-data-provider";
import type { Instrument } from "../instrument";
import type { CanonicalTimeframe } from "../timeframe";
import { CRYPTO_SPOT_INSTRUMENTS, findCryptoInstrumentByVenueSymbol } from "../instruments/crypto";

/**
 * MarketDataProvider adapter over the existing lib/bybit/client.ts. This is
 * a thin wrapper — it does not reimplement fetch/parsing/error handling, so
 * behavior stays identical to the client Strategy V1 already depends on
 * (parity is asserted in bybit-adapter-parity.test.ts).
 *
 * "1H", "15M", and "4H" are supported — the three timeframes
 * lib/bybit/client.ts's `getCandles` accepts today ("4H" added
 * Checkpoint 3A for V2 TRB research; "1H"/"15M" behavior for V1 is
 * unchanged). Widening further is future work, not something this adapter
 * should fake by silently mis-mapping an interval.
 */
const SUPPORTED: Partial<Record<CanonicalTimeframe, "1H" | "15M" | "4H">> = {
  "1H": "1H",
  "15M": "15M",
  "4H": "4H",
};

export class BybitMarketDataProvider implements MarketDataProvider {
  readonly venue = "BYBIT" as const;

  async listInstruments(): Promise<Instrument[]> {
    return [...CRYPTO_SPOT_INSTRUMENTS];
  }

  async getInstrument(instrumentId: string): Promise<Instrument | null> {
    return CRYPTO_SPOT_INSTRUMENTS.find((i) => i.id === instrumentId) ?? null;
  }

  async getServerTimeMs(): Promise<number> {
    // Bybit has no free-standing server-time endpoint wired up in
    // lib/bybit/client.ts; the ticker response carries the venue's
    // server time envelope, so use any liquid instrument as a proxy.
    const anchor = CRYPTO_SPOT_INSTRUMENTS[0];
    const ticker = await getTicker(anchor.venueSymbol);
    return ticker.serverTimeMs;
  }

  async getTicker(instrument: Instrument): Promise<CanonicalTicker> {
    const t = await getTicker(instrument.venueSymbol);
    return {
      instrumentId: instrument.id,
      lastPrice: t.lastPrice,
      serverTimeMs: t.serverTimeMs,
    };
  }

  async getCandles(
    instrument: Instrument,
    timeframe: CanonicalTimeframe,
    limit = 200,
    endMs?: number,
  ): Promise<CanonicalCandle[]> {
    const venueTimeframe = SUPPORTED[timeframe];
    if (!venueTimeframe) {
      throw new Error(
        `BybitMarketDataProvider does not support canonical timeframe "${timeframe}" yet ` +
          `(only 1H/15M/4H are wired to lib/bybit/client.ts today).`,
      );
    }

    const candles = await getCandles(instrument.venueSymbol, venueTimeframe, limit, endMs);
    return candles.map((c) => ({
      instrumentId: instrument.id,
      timeframe,
      openTime: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      isClosed: c.isClosed,
    }));
  }

  /** Exposed for callers that still need raw exchange rules (e.g. sizing). */
  async getInstrumentMetadata(instrument: Instrument) {
    return getInstrumentMetadata(instrument.venueSymbol);
  }
}

export { findCryptoInstrumentByVenueSymbol };
