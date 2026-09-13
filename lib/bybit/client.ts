import {
  bybitInstrumentsResponseSchema,
  bybitKlineResponseSchema,
  bybitTickersResponseSchema,
} from "./schemas";
import { BYBIT_INTERVAL, type Candle, type InstrumentMetadata, type Ticker } from "./types";

/**
 * Bybit V5 public market-data client (spot category).
 * No API key required - these are public endpoints. Never used for order
 * placement (see lib/trading/bybit-demo.ts for the private Demo client).
 *
 * Fails closed: malformed/unexpected responses throw rather than returning
 * partial or guessed data, per the closed-candle / data-integrity invariant.
 */
const BASE_URL = "https://api.bybit.com";
const DEFAULT_TIMEOUT_MS = 10_000;

class BybitApiError extends Error {
  constructor(
    message: string,
    public readonly retCode?: number,
  ) {
    super(message);
    this.name = "BybitApiError";
  }
}

async function bybitFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      // Public market data - always get fresh data, no Next.js data cache.
      cache: "no-store",
    });

    if (res.status === 429) {
      throw new BybitApiError("Bybit rate limit exceeded (HTTP 429)");
    }
    if (res.status === 403) {
      // Bybit's CloudFront layer geo-blocks some countries/regions entirely,
      // returning a plain-text (not JSON) 403 body. Surface this distinctly
      // so it's diagnosable from job_runs.error_summary rather than looking
      // like a generic HTTP failure - the fix is a Vercel function region
      // change, not a code change.
      const body = await res.text().catch(() => "");
      throw new BybitApiError(
        `Bybit HTTP 403 - likely a geo-restriction on the calling server's region/country. ` +
          `If this persists, change the Vercel project's Function Region to one Bybit serves ` +
          `(e.g. Singapore/Tokyo), not a code issue. Response: ${body.slice(0, 200)}`,
      );
    }
    if (!res.ok) {
      throw new BybitApiError(`Bybit HTTP error ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof BybitApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new BybitApiError(`Bybit request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new BybitApiError(`Bybit request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches candles for a symbol/timeframe. Bybit returns newest-first; we
 * return oldest-first for straightforward indicator computation.
 * The most recent element may be an UNCLOSED candle - callers must check
 * `isClosed` and never finalize signals from it (closed-candle invariant).
 */
export async function getCandles(
  symbol: string,
  timeframe: "1H" | "15M",
  limit = 200,
): Promise<Candle[]> {
  const raw = await bybitFetch("/v5/market/kline", {
    category: "spot",
    symbol,
    interval: BYBIT_INTERVAL[timeframe],
    limit: String(limit),
  });

  const parsed = bybitKlineResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BybitApiError(`Invalid Bybit kline response: ${parsed.error.message}`);
  }
  if (parsed.data.retCode !== 0) {
    throw new BybitApiError(parsed.data.retMsg, parsed.data.retCode);
  }

  const rows = [...parsed.data.result.list].reverse(); // oldest first
  const nowMs = Date.now();
  const intervalMs = timeframe === "1H" ? 3_600_000 : 900_000;

  return rows.map(([startTime, open, high, low, close, volume]) => {
    const openTime = Number(startTime);
    // A candle is closed once its bucket's end time has passed.
    const isClosed = openTime + intervalMs <= nowMs;
    return {
      symbol,
      timeframe,
      openTime,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      isClosed,
    };
  });
}

/** Fetches dynamic exchange rules for a symbol. Never hard-code these. */
export async function getInstrumentMetadata(symbol: string): Promise<InstrumentMetadata> {
  const raw = await bybitFetch("/v5/market/instruments-info", {
    category: "spot",
    symbol,
  });

  const parsed = bybitInstrumentsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BybitApiError(`Invalid Bybit instruments response: ${parsed.error.message}`);
  }
  if (parsed.data.retCode !== 0) {
    throw new BybitApiError(parsed.data.retMsg, parsed.data.retCode);
  }

  const info = parsed.data.result.list[0];
  if (!info) {
    throw new BybitApiError(`No instrument metadata returned for ${symbol}`);
  }

  return {
    symbol: info.symbol,
    baseCoin: info.baseCoin,
    quoteCoin: info.quoteCoin,
    tickSize: Number(info.priceFilter.tickSize),
    qtyStep: Number(info.lotSizeFilter.qtyStep ?? info.lotSizeFilter.basePrecision),
    // Bybit now marks the spot min/max quantity fields as deprecated. Keep
    // honoring minOrderQty when the API supplies it, but never invent an
    // exchange constraint when it is absent. minOrderAmt is the authoritative
    // current spot minimum and is required by the response schema above.
    minOrderQty: info.lotSizeFilter.minOrderQty ? Number(info.lotSizeFilter.minOrderQty) : 0,
    minOrderAmt: Number(info.lotSizeFilter.minOrderAmt),
    maxOrderQty: info.lotSizeFilter.maxLimitOrderQty
      ? Number(info.lotSizeFilter.maxLimitOrderQty)
      : info.lotSizeFilter.maxOrderQty
        ? Number(info.lotSizeFilter.maxOrderQty)
        : null,
    priceScale: (info.priceFilter.tickSize.split(".")[1] ?? "").length,
    raw: info,
  };
}

export async function getTicker(symbol: string): Promise<Ticker> {
  const raw = await bybitFetch("/v5/market/tickers", { category: "spot", symbol });

  const parsed = bybitTickersResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BybitApiError(`Invalid Bybit ticker response: ${parsed.error.message}`);
  }
  if (parsed.data.retCode !== 0) {
    throw new BybitApiError(parsed.data.retMsg, parsed.data.retCode);
  }

  const t = parsed.data.result.list[0];
  if (!t) throw new BybitApiError(`No ticker returned for ${symbol}`);

  return {
    symbol: t.symbol,
    lastPrice: Number(t.lastPrice),
    price24hPcnt: Number(t.price24hPcnt),
    highPrice24h: Number(t.highPrice24h),
    lowPrice24h: Number(t.lowPrice24h),
    volume24h: Number(t.volume24h),
    serverTimeMs: parsed.data.time,
  };
}

export { BybitApiError };
