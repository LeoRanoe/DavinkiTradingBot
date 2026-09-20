import { describe, expect, it } from "vitest";
import { TwelveDataProvider } from "./providers/twelve-data";
import { XAUUSD_TWELVEDATA, resolveInstrument } from "./instruments";
import { MarketDataError, type Quote } from "./types";
import { entryFillPrice, exitFillPrice, settleGoldPaperTrade, sizeGoldPosition } from "./gold-execution";

const NOW = Date.UTC(2026, 0, 12, 12, 0, 0);
const now = () => NOW;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function provider(body: unknown, opts: { apiKey?: string | undefined; status?: number } = {}) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));
    return jsonResponse(body, opts.status ?? 200);
  }) as unknown as typeof fetch;
  return {
    calls,
    instance: new TwelveDataProvider({ apiKey: "apiKey" in opts ? opts.apiKey : "test-key", fetchImpl, now }),
  };
}

const series = (rows: { datetime: string; open: string; high: string; low: string; close: string }[]) => ({ values: rows });

describe("canonical Gold instrument", () => {
  it("is addressed by a provider-qualified canonical id, not a vendor ticker", () => {
    expect(XAUUSD_TWELVEDATA.canonicalId).toBe("METAL:TWELVEDATA:XAU/USD");
    expect(resolveInstrument("METAL:TWELVEDATA:XAU/USD")).toBe(XAUUSD_TWELVEDATA);
    expect(resolveInstrument("METAL:TWELVEDATA:NOPE")).toBeNull();
  });

  it("states its unit model explicitly: one troy ounce, no contract multiplier", () => {
    expect(XAUUSD_TWELVEDATA.assetClass).toBe("METAL");
    expect(XAUUSD_TWELVEDATA.unitLabel).toBe("troy ounce");
    expect(XAUUSD_TWELVEDATA.unitsPerContract).toBe(1);
    expect(XAUUSD_TWELVEDATA.quoteCurrency).toBe("USD");
  });
});

describe("Twelve Data adapter", () => {
  it("translates the canonical instrument into the vendor's ticker", async () => {
    const { instance, calls } = provider(series([{ datetime: "2026-01-12 11:00:00", open: "2600", high: "2610", low: "2595", close: "2605" }]));
    await instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe: "H1", limit: 10 });
    expect(calls[0].searchParams.get("symbol")).toBe("XAU/USD");
    expect(calls[0].searchParams.get("interval")).toBe("1h");
  });

  it("requests the right interval per JeanFX timeframe", async () => {
    for (const [timeframe, interval] of [["M5", "5min"], ["M15", "15min"], ["M30", "30min"], ["H1", "1h"]] as const) {
      const { instance, calls } = provider(series([]));
      await instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe, limit: 5 });
      expect(calls[0].searchParams.get("interval")).toBe(interval);
    }
  });

  it("drops the in-progress candle - closed candles only", async () => {
    // 11:00 H1 closed at 12:00 (== now, so closed); 12:00 is still forming.
    const { instance } = provider(
      series([
        { datetime: "2026-01-12 11:00:00", open: "2600", high: "2610", low: "2595", close: "2605" },
        { datetime: "2026-01-12 12:00:00", open: "2605", high: "2612", low: "2603", close: "2611" },
      ]),
    );
    const candles = await instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe: "H1", limit: 10 });
    expect(candles).toHaveLength(1);
    expect(candles[0].openTime).toBe(Date.UTC(2026, 0, 12, 11, 0));
    expect(candles.every((c) => c.isClosed)).toBe(true);
  });

  it("parses vendor datetimes as UTC deterministically", async () => {
    const { instance } = provider(series([{ datetime: "2026-01-12 09:30:00", open: "1", high: "2", low: "0.5", close: "1.5" }]));
    const [c] = await instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe: "M30", limit: 5 });
    expect(c.openTime).toBe(Date.UTC(2026, 0, 12, 9, 30));
  });

  it("reports missing credentials with the exact env var, never silently degrading", async () => {
    const { instance } = provider(series([]), { apiKey: undefined });
    await expect(instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe: "H1", limit: 1 })).rejects.toThrow(MarketDataError);

    const health = await instance.health();
    expect(health.status).toBe("MISSING_CREDENTIALS");
    expect(health.credentialConfigured).toBe(false);
    expect(health.requiredEnvVars).toEqual(["TWELVE_DATA_API_KEY"]);
  });

  it("never leaks the API key into health output", async () => {
    const { instance } = provider(series([]));
    const health = await instance.health();
    expect(JSON.stringify(health)).not.toContain("test-key");
  });

  it("fails closed on the vendor's HTTP-200 error envelope", async () => {
    const { instance } = provider({ status: "error", message: "**symbol** not found", code: 404 });
    await expect(instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe: "H1", limit: 1 })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("classifies rate limiting distinctly", async () => {
    const { instance } = provider({ status: "error", message: "You have run out of API credits; limit reached", code: 429 });
    await expect(instance.fetchCandles({ instrument: XAUUSD_TWELVEDATA, timeframe: "H1", limit: 1 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("refuses to synthesise a spread when the vendor returns no bid/ask", async () => {
    const { instance } = provider({ symbol: "XAU/USD", close: "2605" });
    await expect(instance.fetchQuote(XAUUSD_TWELVEDATA)).rejects.toThrow(/refusing to synthesise a spread/);
  });

  it("rejects a crossed quote rather than trading on it", async () => {
    const { instance } = provider({ symbol: "XAU/USD", bid: "2606", ask: "2605" });
    await expect(instance.fetchQuote(XAUUSD_TWELVEDATA)).rejects.toThrow(/Crossed quote/);
  });

  it("returns bid, ask and a real spread", async () => {
    const { instance } = provider({ symbol: "XAU/USD", bid: "2604.8", ask: "2605.2", timestamp: NOW / 1000 });
    const quote = await instance.fetchQuote(XAUUSD_TWELVEDATA);
    expect(quote.bid).toBeCloseTo(2604.8);
    expect(quote.ask).toBeCloseTo(2605.2);
    expect(quote.spread).toBeCloseTo(0.4);
    expect(quote.providerTimestamp).toBe(NOW);
  });
});

describe("Gold position sizing", () => {
  const base = { instrument: XAUUSD_TWELVEDATA, equity: 10_000, riskPct: 0.01, entryPrice: 2600, stopPrice: 2590 };

  it("derives units from equity, risk and stop distance - no leverage assumption", () => {
    const result = sizeGoldPosition(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // $100 risk / $10 stop distance = 10 oz.
      expect(result.riskAmount).toBeCloseTo(100);
      expect(result.stopDistance).toBeCloseTo(10);
      expect(result.units).toBeCloseTo(10);
    }
  });

  it("halving the risk halves the size; doubling the stop halves it too", () => {
    const half = sizeGoldPosition({ ...base, riskPct: 0.005 });
    const wide = sizeGoldPosition({ ...base, stopPrice: 2580 });
    if (half.ok && wide.ok) {
      expect(half.units).toBeCloseTo(5);
      expect(wide.units).toBeCloseTo(5);
    }
  });

  it("REJECTS a below-minimum size rather than inflating the trade or shrinking the stop", () => {
    // Tiny equity + huge stop distance => a size far below minOrderUnits.
    const result = sizeGoldPosition({ ...base, equity: 10, riskPct: 0.005, stopPrice: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MIN_ORDER_RISK_CONFLICT");
      expect(result.message).toMatch(/Rejected rather than inflated/);
    }
  });

  it("fails closed on invalid inputs", () => {
    expect(sizeGoldPosition({ ...base, stopPrice: 2600 }).ok).toBe(false); // zero stop distance
    expect(sizeGoldPosition({ ...base, equity: 0 }).ok).toBe(false);
    expect(sizeGoldPosition({ ...base, riskPct: -0.01 }).ok).toBe(false);
    expect(sizeGoldPosition({ ...base, entryPrice: Number.NaN }).ok).toBe(false);
  });
});

describe("Gold PAPER execution - bid/ask semantics", () => {
  const quote = (bid: number, ask: number): Quote => ({
    canonicalId: XAUUSD_TWELVEDATA.canonicalId,
    bid,
    ask,
    spread: ask - bid,
    providerTimestamp: NOW,
    receivedAt: NOW,
  });

  it("LONG enters at ask and exits at bid", () => {
    const q = quote(2600, 2600.5);
    expect(entryFillPrice("LONG", q)).toBe(2600.5);
    expect(exitFillPrice("LONG", q)).toBe(2600);
  });

  it("SHORT enters at bid and exits at ask", () => {
    const q = quote(2600, 2600.5);
    expect(entryFillPrice("SHORT", q)).toBe(2600);
    expect(exitFillPrice("SHORT", q)).toBe(2600.5);
  });

  it("a wider spread can only ever worsen PnL", () => {
    const tight = settleGoldPaperTrade({ direction: "LONG", units: 10, entryQuote: quote(2600, 2600.2), exitQuote: quote(2610, 2610.2), riskAmount: 100 });
    const wide = settleGoldPaperTrade({ direction: "LONG", units: 10, entryQuote: quote(2599, 2601.2), exitQuote: quote(2609, 2611.2), riskAmount: 100 });
    expect(wide.netPnl).toBeLessThan(tight.netPnl);
  });

  it("slippage is applied against the trader on both sides, for both directions", () => {
    const costs = { slippagePerUnit: 0.5, commissionPerUnit: 0 };
    const long = settleGoldPaperTrade({ direction: "LONG", units: 1, entryQuote: quote(2600, 2600.5), exitQuote: quote(2610, 2610.5), riskAmount: 100, costs });
    const longClean = settleGoldPaperTrade({ direction: "LONG", units: 1, entryQuote: quote(2600, 2600.5), exitQuote: quote(2610, 2610.5), riskAmount: 100 });
    expect(long.netPnl).toBeLessThan(longClean.netPnl);

    const short = settleGoldPaperTrade({ direction: "SHORT", units: 1, entryQuote: quote(2610, 2610.5), exitQuote: quote(2600, 2600.5), riskAmount: 100, costs });
    const shortClean = settleGoldPaperTrade({ direction: "SHORT", units: 1, entryQuote: quote(2610, 2610.5), exitQuote: quote(2600, 2600.5), riskAmount: 100 });
    expect(short.netPnl).toBeLessThan(shortClean.netPnl);
  });

  it("commission is charged on both sides and reduces net PnL", () => {
    const result = settleGoldPaperTrade({
      direction: "LONG",
      units: 10,
      entryQuote: quote(2600, 2600.2),
      exitQuote: quote(2610, 2610.2),
      riskAmount: 100,
      costs: { slippagePerUnit: 0, commissionPerUnit: 0.1 },
    });
    expect(result.commission).toBeCloseTo(2); // 0.1 * 10 units * 2 sides
    expect(result.netPnl).toBeCloseTo(result.grossPnl - 2);
  });

  it("a profitable SHORT is profitable, mirroring LONG", () => {
    const short = settleGoldPaperTrade({ direction: "SHORT", units: 10, entryQuote: quote(2610, 2610.2), exitQuote: quote(2600, 2600.2), riskAmount: 100 });
    expect(short.grossPnl).toBeGreaterThan(0);
    expect(short.rMultiple).toBeGreaterThan(0);
  });

  it("never models a free zero-spread fill", () => {
    const q = quote(2600, 2600.5);
    expect(entryFillPrice("LONG", q)).not.toBe((q.bid + q.ask) / 2);
    const flat = settleGoldPaperTrade({ direction: "LONG", units: 10, entryQuote: q, exitQuote: q, riskAmount: 100 });
    // Enter at ask, exit at bid with no price movement => a loss of the spread.
    expect(flat.grossPnl).toBeCloseTo(-5);
    expect(flat.spreadCost).toBeGreaterThan(0);
  });
});
