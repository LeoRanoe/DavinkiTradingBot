import type { Instrument } from "@/lib/domain/instrument";
import type { CanonicalCandle, MarketDataProvider } from "@/lib/domain/market-data-provider";

/**
 * Deterministic historical candle loader for research (Checkpoint 3A
 * §10). Sits ABOVE MarketDataProvider — it does not touch
 * lib/bybit/client.ts directly and does not change Strategy V1's normal
 * scanner fetch behavior (that path calls getCandles() for a small recent
 * window and never paginates).
 *
 * Only "1H" and "4H" are accepted (the two timeframes V2 TRB's
 * preregistered configs use); other timeframes are rejected rather than
 * silently handled.
 */

export type HistoricalTimeframe = "1H" | "4H";

const TIMEFRAME_MS: Record<HistoricalTimeframe, number> = {
  "1H": 3_600_000,
  "4H": 14_400_000,
};

export type HistoricalLoadRequest = {
  provider: MarketDataProvider;
  instrument: Instrument;
  timeframe: HistoricalTimeframe;
  /** Inclusive lower bound (ms epoch) of requested history. */
  startMs: number;
  /** Inclusive upper bound (ms epoch) of requested history. */
  endMs: number;
  /** Candles requested per provider call. Default 1000 (Bybit's practical page size). */
  pageSize?: number;
  /** Safety cap on the number of pagination requests - never paginate forever. Default 500. */
  maxPages?: number;
};

export type HistoricalGap = {
  afterOpenTime: number;
  beforeOpenTime: number;
  expectedIntervalMs: number;
  actualIntervalMs: number;
};

export type HistoricalLoadResult = {
  /** Oldest-first, closed-only, deduplicated, trimmed to [startMs, endMs]. */
  candles: CanonicalCandle[];
  requestedStartMs: number;
  requestedEndMs: number;
  /** Actual earliest/latest closed candle openTime obtained — null if nothing was returned at all. */
  earliestAvailableMs: number | null;
  latestAvailableMs: number | null;
  /**
   * True if pagination stopped because `maxPages` was reached before
   * `requestedStartMs` was covered — the caller must not treat `candles`
   * as complete back to `requestedStartMs` in that case. False whenever
   * pagination stopped because the provider ran out of data (which is a
   * true, not truncated, boundary) or because the requested range was
   * fully covered.
   */
  truncated: boolean;
  gaps: HistoricalGap[];
  pagesFetched: number;
};

class ConflictingDuplicateCandleError extends Error {
  constructor(openTime: number) {
    super(`loadHistoricalCandles: conflicting duplicate candle at openTime=${openTime} (same timestamp, different OHLCV across pages)`);
    this.name = "ConflictingDuplicateCandleError";
  }
}

function candlesConflict(a: CanonicalCandle, b: CanonicalCandle): boolean {
  return a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || a.volume !== b.volume;
}

/**
 * Paginates BACKWARDS from `endMs` using the provider's `endMs` cursor
 * parameter, merging pages until `startMs` is covered, the provider stops
 * returning new data, or `maxPages` is hit (explicit `truncated: true`,
 * never a silent gap). Deduplicates by openTime; a duplicate openTime
 * whose OHLCV disagrees with what was already collected is a hard error
 * (REJECTS conflicting duplicates, per §10) rather than picking one
 * silently.
 */
export async function loadHistoricalCandles(request: HistoricalLoadRequest): Promise<HistoricalLoadResult> {
  const { provider, instrument, timeframe, startMs, endMs } = request;
  const pageSize = request.pageSize ?? 1000;
  const maxPages = request.maxPages ?? 500;

  if (!(startMs < endMs)) {
    throw new Error(`loadHistoricalCandles: startMs (${startMs}) must be strictly before endMs (${endMs})`);
  }

  const byOpenTime = new Map<number, CanonicalCandle>();
  let cursorEndMs = endMs;
  let pagesFetched = 0;
  let truncated = false;

  while (pagesFetched < maxPages) {
    const batch = await provider.getCandles(instrument, timeframe, pageSize, cursorEndMs);
    pagesFetched++;

    // Only closed candles are usable for historical research (§11) - an
    // unclosed trailing candle is never silently included.
    const closed = batch.filter((c) => c.isClosed && c.openTime <= endMs);
    if (closed.length === 0) break; // provider has nothing more/older to offer - true boundary, not truncation

    let earliestInBatch = Infinity;
    for (const c of closed) {
      earliestInBatch = Math.min(earliestInBatch, c.openTime);
      const existing = byOpenTime.get(c.openTime);
      if (existing && candlesConflict(existing, c)) {
        throw new ConflictingDuplicateCandleError(c.openTime);
      }
      byOpenTime.set(c.openTime, c);
    }

    if (earliestInBatch <= startMs) break; // requested range fully covered

    cursorEndMs = earliestInBatch - 1;
  }
  if (pagesFetched >= maxPages) {
    // We stopped because of the safety cap, not because we ran out of
    // real data or covered the requested range - only true if the
    // earliest candle collected so far is still after startMs.
    const collected = [...byOpenTime.values()];
    const earliest = collected.length > 0 ? Math.min(...collected.map((c) => c.openTime)) : null;
    truncated = earliest === null || earliest > startMs;
  }

  const candles = [...byOpenTime.values()]
    .filter((c) => c.openTime >= startMs && c.openTime <= endMs)
    .sort((a, b) => a.openTime - b.openTime);

  const gaps: HistoricalGap[] = [];
  const expectedIntervalMs = TIMEFRAME_MS[timeframe];
  for (let i = 1; i < candles.length; i++) {
    const actualIntervalMs = candles[i].openTime - candles[i - 1].openTime;
    if (actualIntervalMs !== expectedIntervalMs) {
      gaps.push({
        afterOpenTime: candles[i - 1].openTime,
        beforeOpenTime: candles[i].openTime,
        expectedIntervalMs,
        actualIntervalMs,
      });
    }
  }

  return {
    candles,
    requestedStartMs: startMs,
    requestedEndMs: endMs,
    earliestAvailableMs: candles.length > 0 ? candles[0].openTime : null,
    latestAvailableMs: candles.length > 0 ? candles[candles.length - 1].openTime : null,
    truncated,
    gaps,
    pagesFetched,
  };
}

export { ConflictingDuplicateCandleError };
