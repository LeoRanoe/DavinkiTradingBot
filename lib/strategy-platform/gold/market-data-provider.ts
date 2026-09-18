import { z } from "zod";
import type { CanonicalCandle, Timeframe } from "../types";
import type { DataRequirement, MarketDataProvider } from "../orchestrator-types";
import { GOLD_INSTRUMENT_ID } from "./instrument";

/**
 * XAU/USD market-data client, kept behind the generic `MarketDataProvider`
 * contract (lib/strategy-platform/orchestrator-types.ts) exactly like
 * lib/bybit/client.ts is kept behind the crypto scanner - JeanFX never
 * imports this file directly (see lib/strategy-platform/built-in/jeanfx-v1.ts,
 * which only ever consumes `CanonicalCandle[]`).
 *
 * Provider: Twelve Data (https://twelvedata.com) - a real, documented REST
 * market-data API with free-tier coverage of XAU/USD across intraday
 * intervals (5min/15min/30min/1h) plus a real-time quote endpoint. Chosen
 * over scraping TradingView per the activation brief's explicit
 * instruction. No API key is committed anywhere - see getGoldDataConfig()
 * below and lib/config/env.ts, following this repo's existing
 * credential-resolution pattern (CLAUDE.md #6).
 *
 * Fails closed: a malformed/unexpected response throws rather than
 * returning partial or guessed candles, mirroring the Bybit client's
 * closed-candle / data-integrity invariant. Nothing here places or touches
 * an order - this is read-only market data.
 */
const BASE_URL = "https://api.twelvedata.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const TWELVE_DATA_SYMBOL = "XAU/USD";

/** Twelve Data's own interval strings for our four supported timeframes. */
const INTERVAL_BY_TIMEFRAME: Record<Timeframe, string> = {
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
};

const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
};

export class GoldMarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldMarketDataError";
  }
}

export type GoldDataConfig = { apiKey: string; baseUrl?: string };

/**
 * Resolves the Twelve Data API key from the environment. Returns null (not
 * a throw) when unset, so the app boots and every other feature keeps
 * working with this integration simply absent - same "optional
 * integration" pattern as lib/qwen/ and lib/telegram/ (CLAUDE.md
 * "lib/qwen/, lib/telegram/ ... app must boot and trade fine with either
 * absent"). Callers (the gold scan job) must check for null and skip
 * gracefully rather than crash.
 */
export function getGoldDataConfig(env: NodeJS.ProcessEnv = process.env): GoldDataConfig | null {
  const apiKey = env.GOLD_DATA_API_KEY;
  if (!apiKey) return null;
  return { apiKey, baseUrl: env.GOLD_DATA_BASE_URL || undefined };
}

const timeSeriesRowSchema = z.object({
  datetime: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
});

const timeSeriesResponseSchema = z.object({
  status: z.string().optional(),
  values: z.array(timeSeriesRowSchema).optional(),
  meta: z.object({ interval: z.string().optional() }).optional(),
  message: z.string().optional(),
  code: z.number().optional(),
});

const quoteResponseSchema = z.object({
  status: z.string().optional(),
  symbol: z.string().optional(),
  bid: z.string().optional(),
  ask: z.string().optional(),
  close: z.string().optional(),
  timestamp: z.number().optional(),
  message: z.string().optional(),
});

export type GoldQuote = {
  instrumentId: string;
  bid: number;
  ask: number;
  /** Mid, used only where a single reference price is needed (e.g. UI display) - never for fills, which always apply the spread explicitly (see paper-executor.ts). */
  mid: number;
  serverTimeMs: number;
};

/** Injectable so tests never touch the network - mirrors how the rest of this repo avoids live network calls in `npm test` (CLAUDE.md "no external calls" convention in lib/trading/paper.ts etc.). */
export type FetchLike = typeof fetch;

async function goldFetch(path: string, params: Record<string, string>, config: GoldDataConfig, fetchImpl: FetchLike): Promise<unknown> {
  const url = new URL(path, config.baseUrl ?? BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", config.apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url.toString(), { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new GoldMarketDataError(`Twelve Data HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof GoldMarketDataError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GoldMarketDataError(`Twelve Data request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new GoldMarketDataError(`Twelve Data request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches candles for one timeframe. Returns oldest-first, `isClosed`
 * derived from wall-clock time vs. the candle's own bucket end (never
 * trusted from the provider) - same closed-candle rule as Bybit's client
 * and the same invariant JeanFX's evaluator depends on
 * (lib/strategy/jeanfx-v1/state-machine.ts only ever walks candles the
 * caller has already filtered to `isClosed`).
 */
export async function getGoldCandles(
  timeframe: Timeframe,
  config: GoldDataConfig,
  outputSize = 210,
  fetchImpl: FetchLike = fetch,
): Promise<CanonicalCandle[]> {
  const raw = await goldFetch(
    "/time_series",
    { symbol: TWELVE_DATA_SYMBOL, interval: INTERVAL_BY_TIMEFRAME[timeframe], outputsize: String(outputSize), timezone: "UTC" },
    config,
    fetchImpl,
  );
  const parsed = timeSeriesResponseSchema.safeParse(raw);
  if (!parsed.success) throw new GoldMarketDataError(`Invalid Twelve Data time_series response: ${parsed.error.message}`);
  if (parsed.data.status === "error") throw new GoldMarketDataError(parsed.data.message ?? "Twelve Data returned an error status");
  if (!parsed.data.values) throw new GoldMarketDataError("Twelve Data time_series response has no 'values'");

  const durationMs = TIMEFRAME_DURATION_MS[timeframe];
  const nowMs = Date.now();

  const rows = [...parsed.data.values].reverse(); // Twelve Data returns newest-first; we want oldest-first
  return rows.map((row) => {
    const openTime = Date.parse(`${row.datetime}Z`);
    if (!Number.isFinite(openTime)) throw new GoldMarketDataError(`Unparseable candle datetime '${row.datetime}'`);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (![open, high, low, close].every(Number.isFinite)) {
      throw new GoldMarketDataError(`Non-finite OHLC in Twelve Data candle at ${row.datetime}`);
    }
    return {
      instrumentId: GOLD_INSTRUMENT_ID,
      timeframe,
      openTime,
      open,
      high,
      low,
      close,
      volume: 0, // Twelve Data's OTC gold feed carries no reliable volume figure - never guessed/synthesized.
      isClosed: openTime + durationMs <= nowMs,
    } satisfies CanonicalCandle;
  });
}

/** Current bid/ask (spot). Used by the paper executor for spread-aware fills, never for order placement. */
export async function getGoldQuote(config: GoldDataConfig, fetchImpl: FetchLike = fetch): Promise<GoldQuote> {
  const raw = await goldFetch("/quote", { symbol: TWELVE_DATA_SYMBOL }, config, fetchImpl);
  const parsed = quoteResponseSchema.safeParse(raw);
  if (!parsed.success) throw new GoldMarketDataError(`Invalid Twelve Data quote response: ${parsed.error.message}`);
  if (parsed.data.status === "error") throw new GoldMarketDataError(parsed.data.message ?? "Twelve Data returned an error status");

  // Twelve Data's free/basic quote tier does not always carry bid/ask for
  // metals - fall back to `close` for both sides rather than guessing a
  // spread, and let the caller's own spread model (sizing.ts) apply the
  // documented assumption explicitly instead of silently baking one in here.
  const closeStr = parsed.data.close;
  const bidStr = parsed.data.bid ?? closeStr;
  const askStr = parsed.data.ask ?? closeStr;
  if (!bidStr || !askStr) throw new GoldMarketDataError("Twelve Data quote response has neither bid/ask nor close");
  const bid = Number(bidStr);
  const ask = Number(askStr);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) throw new GoldMarketDataError("Non-finite bid/ask in Twelve Data quote");

  return {
    instrumentId: GOLD_INSTRUMENT_ID,
    bid,
    ask,
    mid: (bid + ask) / 2,
    serverTimeMs: parsed.data.timestamp ? parsed.data.timestamp * 1000 : Date.now(),
  };
}

/**
 * Builds a `MarketDataProvider` (lib/strategy-platform/orchestrator-types.ts)
 * closure bound to one API key/fetch implementation, so the orchestrator
 * (and the gold scan job - scan.ts) can request candles by
 * `{instrumentId, timeframe}` exactly like every other strategy's data,
 * with no gold-specific branch anywhere in generic orchestration code.
 */
export function createGoldMarketDataProvider(config: GoldDataConfig, fetchImpl: FetchLike = fetch): MarketDataProvider {
  return async (requirement: DataRequirement) => {
    if (requirement.instrumentId !== GOLD_INSTRUMENT_ID) {
      throw new GoldMarketDataError(`GoldMarketDataProvider only serves '${GOLD_INSTRUMENT_ID}', got '${requirement.instrumentId}'`);
    }
    return getGoldCandles(requirement.timeframe, config, 210, fetchImpl);
  };
}
