import { getCandles } from "@/lib/bybit/client";
import { collectResearchCandles } from "./backfill";
import type { Candle } from "@/lib/bybit/types";

/**
 * Fetches a bounded page sequence from Bybit for research only. Callers own
 * persistence and resume state; this deliberately never reads or updates the
 * production scanner's candle watermark.
 */
export async function backfillBybitResearchCandles(input: {
  symbol: string;
  timeframe: "1H" | "15M";
  maxPages: number;
  pageSize: number;
  existingOpenTimes?: ReadonlySet<number>;
  resumeEndMs?: number | null;
  nowMs?: number;
}): Promise<{ candles: Candle[]; resumeEndMs: number | null; pages: number }> {
  return collectResearchCandles({
    maxPages: input.maxPages,
    pageSize: input.pageSize,
    existingOpenTimes: input.existingOpenTimes,
    resumeEndMs: input.resumeEndMs,
    nowMs: input.nowMs ?? Date.now(),
    fetchPage: async (endMs, limit) => {
      const candles = await getCandles(input.symbol, input.timeframe, limit, endMs ?? undefined);
      const oldest = candles[0];
      return { candles, nextEndMs: oldest ? oldest.openTime - 1 : null };
    },
  });
}
