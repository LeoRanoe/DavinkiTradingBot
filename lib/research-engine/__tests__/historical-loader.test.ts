import { describe, expect, it, vi } from "vitest";
import type { Instrument } from "@/lib/domain/instrument";
import type { CanonicalCandle, MarketDataProvider } from "@/lib/domain/market-data-provider";
import { ConflictingDuplicateCandleError, loadHistoricalCandles } from "../historical-loader";

const HOUR = 3_600_000;

const instrument: Instrument = {
  id: "CRYPTO:BYBIT:BTC/USDT",
  assetClass: "CRYPTO_SPOT",
  venue: "BYBIT",
  venueSymbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  settlementAsset: "USDT",
  allowsLong: true,
  allowsShort: false,
  tradingCalendarId: "CRYPTO_24_7",
  isActive: true,
};

function candle(openTime: number, overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return {
    instrumentId: instrument.id,
    timeframe: "1H",
    openTime,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    isClosed: true,
    ...overrides,
  };
}

/** Fake provider whose getCandles is fully controlled by the test via a page function. */
function makeFakeProvider(pageFn: (endMs: number, limit: number) => CanonicalCandle[]): MarketDataProvider {
  return {
    venue: "BYBIT",
    listInstruments: vi.fn(),
    getInstrument: vi.fn(),
    getTicker: vi.fn(),
    getServerTimeMs: vi.fn(),
    getCandles: vi.fn(async (_instrument, _timeframe, limit = 1000, endMs?: number) => pageFn(endMs ?? Date.now(), limit)),
  };
}

describe("loadHistoricalCandles (§10)", () => {
  it("paginates backwards and merges pages into an oldest-first, deduplicated result", async () => {
    // Two pages: newest page (closer to requested end) returned first call, older page on the second (lower endMs cursor).
    let call = 0;
    const provider = makeFakeProvider((endMs) => {
      call++;
      if (call === 1) {
        // "page 1": candles at hours 8,9 (oldest-first within the page, as CanonicalCandle always is)
        return [candle(8 * HOUR), candle(9 * HOUR)];
      }
      // "page 2": candles at hours 5,6,7 - strictly older than page 1's earliest (8*HOUR)
      expect(endMs).toBe(8 * HOUR - 1);
      return [candle(5 * HOUR), candle(6 * HOUR), candle(7 * HOUR)];
    });

    const result = await loadHistoricalCandles({
      provider,
      instrument,
      timeframe: "1H",
      startMs: 5 * HOUR,
      endMs: 9 * HOUR,
    });

    expect(result.candles.map((c) => c.openTime)).toEqual([5, 6, 7, 8, 9].map((h) => h * HOUR));
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.earliestAvailableMs).toBe(5 * HOUR);
    expect(result.latestAvailableMs).toBe(9 * HOUR);
  });

  it("deduplicates a candle openTime that appears in more than one page (identical data)", async () => {
    let call = 0;
    const provider = makeFakeProvider(() => {
      call++;
      if (call === 1) return [candle(8 * HOUR), candle(9 * HOUR)];
      // Overlapping page re-returns hour 8 identically, plus one older bar.
      return [candle(7 * HOUR), candle(8 * HOUR)];
    });
    const result = await loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 7 * HOUR, endMs: 9 * HOUR });
    expect(result.candles.map((c) => c.openTime)).toEqual([7 * HOUR, 8 * HOUR, 9 * HOUR]);
  });

  it("rejects a conflicting duplicate (same openTime, different OHLCV across pages)", async () => {
    let call = 0;
    const provider = makeFakeProvider(() => {
      call++;
      if (call === 1) return [candle(8 * HOUR, { close: 100 })];
      return [candle(7 * HOUR), candle(8 * HOUR, { close: 999 })]; // conflicting close for hour 8
    });
    await expect(
      loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 7 * HOUR, endMs: 8 * HOUR }),
    ).rejects.toThrow(ConflictingDuplicateCandleError);
  });

  it("filters out unclosed candles", async () => {
    const provider = makeFakeProvider(() => [candle(8 * HOUR), candle(9 * HOUR, { isClosed: false })]);
    const result = await loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 8 * HOUR, endMs: 9 * HOUR });
    expect(result.candles.map((c) => c.openTime)).toEqual([8 * HOUR]);
  });

  it("detects a gap where the interval between consecutive candles isn't the expected bucket length", async () => {
    const provider = makeFakeProvider(() => [candle(1 * HOUR), candle(5 * HOUR)]); // missing hours 2,3,4
    const result = await loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 1 * HOUR, endMs: 5 * HOUR });
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ afterOpenTime: 1 * HOUR, beforeOpenTime: 5 * HOUR, expectedIntervalMs: HOUR });
  });

  it("trims to the explicit [startMs, endMs] bounds even if the provider returns extra candles outside them", async () => {
    const provider = makeFakeProvider(() => [candle(1 * HOUR), candle(5 * HOUR), candle(10 * HOUR)]);
    const result = await loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 2 * HOUR, endMs: 8 * HOUR });
    expect(result.candles.map((c) => c.openTime)).toEqual([5 * HOUR]);
  });

  it("never includes a candle after the requested endMs (no future candles)", async () => {
    const provider = makeFakeProvider(() => [candle(5 * HOUR), candle(100 * HOUR)]);
    const result = await loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 1 * HOUR, endMs: 6 * HOUR });
    expect(result.candles.every((c) => c.openTime <= 6 * HOUR)).toBe(true);
  });

  it("stops rather than looping forever, and reports truncated:true when maxPages is hit before reaching startMs", async () => {
    // Every page only ever returns ONE bar, one hour older each call - will
    // never converge before maxPages if startMs is far enough back.
    let cursor = 1000 * HOUR;
    const provider = makeFakeProvider((endMs) => {
      const openTime = Math.min(cursor, endMs);
      cursor = openTime - HOUR;
      return [candle(openTime)];
    });
    const result = await loadHistoricalCandles({
      provider,
      instrument,
      timeframe: "1H",
      startMs: 0,
      endMs: 1000 * HOUR,
      maxPages: 5,
    });
    expect(result.pagesFetched).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("truncated is false when pagination stops because the provider legitimately ran out of data (a true boundary, not a cap)", async () => {
    let call = 0;
    const provider = makeFakeProvider(() => {
      call++;
      if (call === 1) return [candle(5 * HOUR), candle(6 * HOUR)];
      return []; // no more data - the venue's actual history start
    });
    const result = await loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 0, endMs: 6 * HOUR, maxPages: 50 });
    expect(result.truncated).toBe(false);
    expect(result.earliestAvailableMs).toBe(5 * HOUR);
  });

  it("rejects a request where startMs is not strictly before endMs", async () => {
    const provider = makeFakeProvider(() => []);
    await expect(loadHistoricalCandles({ provider, instrument, timeframe: "1H", startMs: 5, endMs: 5 })).rejects.toThrow();
  });
});
