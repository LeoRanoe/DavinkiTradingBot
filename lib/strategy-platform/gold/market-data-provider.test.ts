import { describe, expect, it, vi } from "vitest";
import { createGoldMarketDataProvider, getGoldCandles, getGoldQuote, GoldMarketDataError, type FetchLike } from "./market-data-provider";
import { GOLD_INSTRUMENT_ID } from "./instrument";

const CONFIG = { apiKey: "test-key" };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("getGoldCandles", () => {
  it("parses a valid time_series response into oldest-first CanonicalCandle[]", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      jsonResponse({
        status: "ok",
        values: [
          { datetime: "2026-01-14 10:15:00", open: "2410.00", high: "2412.00", low: "2409.00", close: "2411.50" },
          { datetime: "2026-01-14 10:00:00", open: "2400.00", high: "2402.00", low: "2399.00", close: "2401.00" },
        ],
      }),
    ) as unknown as FetchLike;

    const candles = await getGoldCandles("M15", CONFIG, 210, fetchImpl);
    expect(candles).toHaveLength(2);
    expect(candles[0].openTime).toBeLessThan(candles[1].openTime); // reversed to oldest-first
    expect(candles[0].instrumentId).toBe(GOLD_INSTRUMENT_ID);
    expect(candles[0].close).toBe(2401.0);
    expect(candles[0].volume).toBe(0); // documented: no reliable volume figure for gold, never synthesized
  });

  it("marks a candle closed only once its bucket end time has passed - fails closed on ambiguity, never trusts the provider's own flag", async () => {
    const farFuture = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ status: "ok", values: [{ datetime: farFuture, open: "1", high: "2", low: "1", close: "1.5" }] })) as unknown as FetchLike;
    const candles = await getGoldCandles("M5", CONFIG, 1, fetchImpl);
    expect(candles[0].isClosed).toBe(false);
  });

  it("throws GoldMarketDataError on an error status rather than returning partial data", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ status: "error", message: "invalid API key" })) as unknown as FetchLike;
    await expect(getGoldCandles("H1", CONFIG, 210, fetchImpl)).rejects.toThrow(GoldMarketDataError);
  });

  it("throws on a malformed (schema-violating) response - fails closed", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ garbage: true })) as unknown as FetchLike;
    await expect(getGoldCandles("M30", CONFIG, 210, fetchImpl)).rejects.toThrow(GoldMarketDataError);
  });

  it("throws on a non-finite OHLC value rather than silently coercing", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      jsonResponse({ status: "ok", values: [{ datetime: "2026-01-14 10:00:00", open: "not-a-number", high: "1", low: "1", close: "1" }] }),
    ) as unknown as FetchLike;
    await expect(getGoldCandles("M5", CONFIG, 1, fetchImpl)).rejects.toThrow(GoldMarketDataError);
  });

  it("propagates a non-OK HTTP status as GoldMarketDataError", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({}, false, 500)) as unknown as FetchLike;
    await expect(getGoldCandles("M5", CONFIG, 1, fetchImpl)).rejects.toThrow(GoldMarketDataError);
  });
});

describe("getGoldQuote", () => {
  it("uses bid/ask directly when the provider supplies them", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ status: "ok", bid: "2400.10", ask: "2400.40", timestamp: 1_700_000_000 })) as unknown as FetchLike;
    const quote = await getGoldQuote(CONFIG, fetchImpl);
    expect(quote.bid).toBe(2400.1);
    expect(quote.ask).toBe(2400.4);
    expect(quote.mid).toBeCloseTo(2400.25, 5);
  });

  it("falls back to close for both sides when bid/ask are absent, rather than guessing a spread", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ status: "ok", close: "2400.00" })) as unknown as FetchLike;
    const quote = await getGoldQuote(CONFIG, fetchImpl);
    expect(quote.bid).toBe(2400);
    expect(quote.ask).toBe(2400);
  });

  it("throws when neither bid/ask nor close are present", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ status: "ok" })) as unknown as FetchLike;
    await expect(getGoldQuote(CONFIG, fetchImpl)).rejects.toThrow(GoldMarketDataError);
  });
});

describe("createGoldMarketDataProvider", () => {
  it("rejects a requirement for any instrument other than the canonical gold id", async () => {
    const fetchImpl: FetchLike = vi.fn() as unknown as FetchLike;
    const provider = createGoldMarketDataProvider(CONFIG, fetchImpl);
    await expect(provider({ instrumentId: "BTCUSDT", timeframe: "M15" })).rejects.toThrow(GoldMarketDataError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("delegates to getGoldCandles for the canonical gold instrument", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ status: "ok", values: [{ datetime: "2026-01-14 10:00:00", open: "1", high: "1", low: "1", close: "1" }] })) as unknown as FetchLike;
    const provider = createGoldMarketDataProvider(CONFIG, fetchImpl);
    const candles = await provider({ instrumentId: GOLD_INSTRUMENT_ID, timeframe: "M15" });
    expect(candles).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
