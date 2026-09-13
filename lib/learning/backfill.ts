import type { OutcomeCandle } from "./types";

export type ResearchCandlePage = { candles: OutcomeCandle[]; nextEndMs: number | null };
export type ResearchCandleFetcher = (endMs: number | null, limit: number) => Promise<ResearchCandlePage>;

/** Bounded, resumable, idempotent research-only backfill planner. It has no access to live scanner watermarks. */
export async function collectResearchCandles(input: { fetchPage: ResearchCandleFetcher; existingOpenTimes?: ReadonlySet<number>; maxPages: number; pageSize: number; nowMs: number; resumeEndMs?: number | null }): Promise<{ candles: OutcomeCandle[]; resumeEndMs: number | null; pages: number }> {
  const known = input.existingOpenTimes ?? new Set<number>();
  const output = new Map<number, OutcomeCandle>();
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
