import { z } from "zod";
import type { CanonicalCandle, Timeframe } from "@/lib/strategy-platform/types";
import {
  MarketDataError,
  type CandleRequest,
  type CanonicalInstrument,
  type MarketDataSource,
  type ProviderHealth,
  type Quote,
} from "../types";
import { instrumentsForProvider } from "../instruments";

/**
 * Twelve Data adapter - spot XAU/USD.
 *
 * Chosen over the alternatives for this build because it is the only one of
 * the three candidates that serves genuine SPOT XAU/USD on all four JeanFX
 * timeframes from a single key, with intraday history deep enough for a
 * 12-24 month walk-forward. Notably NOT used: Bybit, whose public V5 API has
 * no XAU/USD at all - its nearest instrument is XAUT/USDT (Tether Gold), a
 * gold-BACKED crypto token with its own premium, depeg risk and 24/7 crypto
 * session profile. Trading JeanFX on XAUT and calling it Gold would be
 * exactly the silent proxy substitution this system forbids.
 *
 * REQUIRED ENV VAR: TWELVE_DATA_API_KEY
 *
 * Fails closed throughout: no synthetic candles, no partial series, no
 * silent substitution of a different symbol, no in-progress bar.
 */

const BASE_URL = "https://api.twelvedata.com";

/** JeanFX timeframes -> Twelve Data interval strings. */
const INTERVALS: Record<Timeframe, string> = {
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
};

const TIMEFRAME_MS: Record<Timeframe, number> = {
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
};

/**
 * Twelve Data returns an `status: "error"` envelope with HTTP 200 for many
 * failures, so the error shape is parsed explicitly rather than trusting the
 * status code.
 */
const errorEnvelope = z.object({ status: z.literal("error"), message: z.string(), code: z.number().optional() });

const timeSeriesSchema = z.object({
  values: z.array(
    z.object({
      datetime: z.string(),
      open: z.string(),
      high: z.string(),
      low: z.string(),
      close: z.string(),
      volume: z.string().optional(),
    }),
  ),
});

const quoteSchema = z.object({
  symbol: z.string(),
  bid: z.string().optional(),
  ask: z.string().optional(),
  close: z.string().optional(),
  timestamp: z.number().optional(),
});

function numeric(value: string | undefined, field: string): number {
  if (value === undefined) throw new MarketDataError(`Missing '${field}' in Twelve Data response`, "INVALID_RESPONSE", "TWELVEDATA");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new MarketDataError(`Non-numeric '${field}' ('${value}') from Twelve Data`, "INVALID_RESPONSE", "TWELVEDATA");
  return parsed;
}

/**
 * Twelve Data datetimes for intraday intervals are exchange-local wall clock
 * without an offset ("2026-01-12 10:30:00"); for this provider's forex/metals
 * feed that clock is UTC. Parsed explicitly rather than via `new Date(str)`,
 * whose behaviour for offset-less strings is implementation-defined.
 */
function parseUtc(datetime: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(datetime);
  if (!match) {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datetime);
    if (!dateOnly) throw new MarketDataError(`Unparseable datetime '${datetime}' from Twelve Data`, "INVALID_RESPONSE", "TWELVEDATA");
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

export type TwelveDataConfig = {
  apiKey: string | undefined;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class TwelveDataProvider implements MarketDataSource {
  readonly providerId = "TWELVEDATA" as const;
  readonly supportedTimeframes: Timeframe[] = ["M5", "M15", "M30", "H1"];

  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastErrorMessage: string | null = null;
  private latencyMs: number | null = null;

  constructor(private readonly config: TwelveDataConfig) {}

  supports(instrument: CanonicalInstrument): boolean {
    return instrument.providerId === "TWELVEDATA";
  }

  private requireKey(): string {
    if (!this.config.apiKey) {
      throw new MarketDataError(
        "Twelve Data credentials are not configured. Set TWELVE_DATA_API_KEY.",
        "MISSING_CREDENTIALS",
        "TWELVEDATA",
      );
    }
    return this.config.apiKey;
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const apiKey = this.requireKey();
    const doFetch = this.config.fetchImpl ?? fetch;
    const now = this.config.now ?? Date.now;
    const url = new URL(`${BASE_URL}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("apikey", apiKey);

    const startedAt = now();
    let response: Response;
    try {
      response = await doFetch(url, { headers: { accept: "application/json" } });
    } catch (err) {
      this.recordError(now(), err instanceof Error ? err.message : String(err));
      throw new MarketDataError(`Twelve Data request failed: ${err instanceof Error ? err.message : String(err)}`, "PROVIDER_ERROR", "TWELVEDATA");
    }
    this.latencyMs = now() - startedAt;

    const body: unknown = await response.json().catch(() => null);

    const asError = errorEnvelope.safeParse(body);
    if (asError.success) {
      this.recordError(now(), asError.data.message);
      const rateLimited = asError.data.code === 429 || /limit/i.test(asError.data.message);
      throw new MarketDataError(`Twelve Data: ${asError.data.message}`, rateLimited ? "RATE_LIMITED" : "PROVIDER_ERROR", "TWELVEDATA");
    }

    if (!response.ok) {
      this.recordError(now(), `HTTP ${response.status}`);
      throw new MarketDataError(`Twelve Data returned HTTP ${response.status}`, response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR", "TWELVEDATA");
    }

    this.lastSuccessAt = now();
    return body;
  }

  private recordError(at: number, message: string) {
    this.lastErrorAt = at;
    this.lastErrorMessage = message;
  }

  async fetchCandles(request: CandleRequest): Promise<CanonicalCandle[]> {
    const { instrument, timeframe, limit } = request;
    if (!this.supports(instrument)) {
      throw new MarketDataError(`${instrument.canonicalId} is not a Twelve Data instrument`, "UNSUPPORTED_INSTRUMENT", "TWELVEDATA");
    }
    const interval = INTERVALS[timeframe];
    if (!interval) {
      throw new MarketDataError(`Timeframe ${timeframe} is not supported by Twelve Data`, "UNSUPPORTED_TIMEFRAME", "TWELVEDATA");
    }

    const params: Record<string, string> = {
      symbol: instrument.providerSymbol,
      interval,
      outputsize: String(Math.max(1, Math.min(5000, limit))),
      order: "ASC",
      timezone: "UTC",
      format: "JSON",
    };
    if (request.startTime !== undefined) params.start_date = new Date(request.startTime).toISOString().slice(0, 19).replace("T", " ");
    if (request.endTime !== undefined) params.end_date = new Date(request.endTime).toISOString().slice(0, 19).replace("T", " ");

    const parsed = timeSeriesSchema.safeParse(await this.request("time_series", params));
    if (!parsed.success) {
      throw new MarketDataError(`Unexpected Twelve Data time_series payload: ${parsed.error.message}`, "INVALID_RESPONSE", "TWELVEDATA");
    }

    const now = (this.config.now ?? Date.now)();
    const durationMs = TIMEFRAME_MS[timeframe];

    const candles = parsed.data.values.map((row): CanonicalCandle => {
      const openTime = parseUtc(row.datetime);
      return {
        instrumentId: instrument.id,
        timeframe,
        openTime,
        open: numeric(row.open, "open"),
        high: numeric(row.high, "high"),
        low: numeric(row.low, "low"),
        close: numeric(row.close, "close"),
        // Spot FX/metals has no consolidated tape, so volume is frequently 0.
        // Reported as-is; never invented.
        volume: row.volume === undefined ? 0 : Number(row.volume) || 0,
        isClosed: openTime + durationMs <= now,
      };
    });

    // CLOSED-CANDLE INVARIANT: the in-progress bar never leaves this adapter.
    return candles.filter((c) => c.isClosed).sort((a, b) => a.openTime - b.openTime);
  }

  async fetchQuote(instrument: CanonicalInstrument): Promise<Quote> {
    if (!this.supports(instrument)) {
      throw new MarketDataError(`${instrument.canonicalId} is not a Twelve Data instrument`, "UNSUPPORTED_INSTRUMENT", "TWELVEDATA");
    }
    const parsed = quoteSchema.safeParse(await this.request("quote", { symbol: instrument.providerSymbol, timezone: "UTC" }));
    if (!parsed.success) {
      throw new MarketDataError(`Unexpected Twelve Data quote payload: ${parsed.error.message}`, "INVALID_RESPONSE", "TWELVEDATA");
    }

    const { bid, ask } = parsed.data;
    // A quote without a genuine two-sided market is an ERROR. Synthesising a
    // spread around `close` would silently hand the backtester and the paper
    // engine a free zero-spread fill.
    if (bid === undefined || ask === undefined) {
      throw new MarketDataError(
        `Twelve Data returned no bid/ask for ${instrument.providerSymbol}; refusing to synthesise a spread`,
        "INVALID_RESPONSE",
        "TWELVEDATA",
      );
    }

    const bidValue = numeric(bid, "bid");
    const askValue = numeric(ask, "ask");
    if (askValue < bidValue) {
      throw new MarketDataError(`Crossed quote from Twelve Data (bid ${bidValue} > ask ${askValue})`, "INVALID_RESPONSE", "TWELVEDATA");
    }

    const now = (this.config.now ?? Date.now)();
    return {
      canonicalId: instrument.canonicalId,
      bid: bidValue,
      ask: askValue,
      spread: askValue - bidValue,
      providerTimestamp: parsed.data.timestamp !== undefined ? parsed.data.timestamp * 1000 : now,
      receivedAt: now,
    };
  }

  async health(): Promise<ProviderHealth> {
    const credentialConfigured = Boolean(this.config.apiKey);
    const base: ProviderHealth = {
      providerId: this.providerId,
      status: "DISCONNECTED",
      credentialConfigured,
      requiredEnvVars: ["TWELVE_DATA_API_KEY"],
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      latencyMs: this.latencyMs,
      supportedInstruments: instrumentsForProvider("TWELVEDATA").map((i) => i.canonicalId),
      supportedTimeframes: this.supportedTimeframes,
    };

    if (!credentialConfigured) return { ...base, status: "MISSING_CREDENTIALS" };

    // Health is judged by a real call, never assumed from the key's presence.
    const probe = instrumentsForProvider("TWELVEDATA")[0];
    if (!probe) return { ...base, status: "DEGRADED", lastErrorMessage: "No instruments registered for this provider" };

    try {
      const candles = await this.fetchCandles({ instrument: probe, timeframe: "M5", limit: 2 });
      return {
        ...base,
        status: candles.length > 0 ? "CONNECTED" : "DEGRADED",
        lastSuccessAt: this.lastSuccessAt,
        latencyMs: this.latencyMs,
        lastErrorMessage: candles.length > 0 ? this.lastErrorMessage : "Provider returned no closed candles",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        status: err instanceof MarketDataError && err.code === "MISSING_CREDENTIALS" ? "MISSING_CREDENTIALS" : "DEGRADED",
        lastErrorAt: this.lastErrorAt,
        lastErrorMessage: message,
        latencyMs: this.latencyMs,
      };
    }
  }
}
