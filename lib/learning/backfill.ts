import type { OutcomeCandle } from "./types";

export type ResearchCandlePage<T extends OutcomeCandle = OutcomeCandle> = { candles: T[]; nextEndMs: number | null };
export type ResearchCandleFetcher<T extends OutcomeCandle = OutcomeCandle> = (endMs: number | null, limit: number) => Promise<ResearchCandlePage<T>>;

/**
 * Bounded, resumable, idempotent research-only backfill planner. It has no access to live scanner watermarks.
 *
 * Generic over the candle shape so a richer source candle (one carrying
 * volume, say) survives the round trip intact. Scoring reads volume, so
 * narrowing to the bare OHLC shape here would silently produce backfilled
 * candles that score differently from live ones.
 */
export async function collectResearchCandles<T extends OutcomeCandle>(input: { fetchPage: ResearchCandleFetcher<T>; existingOpenTimes?: ReadonlySet<number>; maxPages: number; pageSize: number; nowMs: number; resumeEndMs?: number | null }): Promise<{ candles: T[]; resumeEndMs: number | null; pages: number }> {
  const known = input.existingOpenTimes ?? new Set<number>();
  const output = new Map<number, T>();
  let endMs = input.resumeEndMs ?? null;
  let pages = 0;
  while (pages < input.maxPages) {
    const page = await input.fetchPage(endMs, input.pageSize);
    pages += 1;
    for (const candle of page.candles) if (candle.isClosed && candle.openTime < input.nowMs && !known.has(candle.openTime)) output.set(candle.openTime, candle);
    endMs = page.nextEndMs;
    if (endMs === null || page.candles.length === 0) break;
  }
  return { candles: [...output.values()].sort((a, b) => a.openTime - b.openTime), resumeEndMs: endMs, pages };
}
