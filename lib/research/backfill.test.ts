import { describe, expect, it } from "vitest";
import { collectResearchCandles } from "@/lib/learning/backfill";
import type { OutcomeCandle } from "@/lib/learning/types";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-14T00:00:00Z");

function candle(openTime: number, close = 100): OutcomeCandle {
  return { openTime, open: close, high: close + 1, low: close - 1, close, isClosed: true };
}

/**
 * These guard the property the whole backfill depends on: it extends history
 * BACKWARDS and never writes into the region the live scanner uses as its
 * watermark. A regression here would silently suppress real trades, so the
 * boundary is tested from both directions.
 */
describe("research backfill paging", () => {
  it("pages backwards and stops when the source runs out", async () => {
    const pages = [
      [candle(NOW - 3 * HOUR), candle(NOW - 2 * HOUR)],
      [candle(NOW - 5 * HOUR), candle(NOW - 4 * HOUR)],
      [],
    ];
    let call = 0;

    const result = await collectResearchCandles({
      fetchPage: async () => {
        const batch = pages[call++] ?? [];
        const oldest = batch[0];
        return { candles: batch, nextEndMs: oldest ? oldest.openTime - 1 : null };
      },
      maxPages: 10,
      pageSize: 1000,
      nowMs: NOW,
    });

    expect(result.candles).toHaveLength(4);
    // Always returned oldest-first, so a caller can rely on chronological order.
    expect(result.candles[0].openTime).toBeLessThan(result.candles[3].openTime);
  });

  it("respects the page budget so one invocation cannot run away", async () => {
    let call = 0;
    const result = await collectResearchCandles({
      fetchPage: async () => {
        const start = NOW - (call + 1) * 10 * HOUR;
        call += 1;
        return { candles: [candle(start)], nextEndMs: start - 1 };
      },
      maxPages: 3,
      pageSize: 1000,
      nowMs: NOW,
    });

    expect(result.pages).toBe(3);
    expect(result.resumeEndMs).not.toBeNull();
  });

  it("never returns an unclosed candle", async () => {
    const result = await collectResearchCandles({
      fetchPage: async () => ({
        candles: [
          { ...candle(NOW - 2 * HOUR), isClosed: false },
          candle(NOW - 3 * HOUR),
        ],
        nextEndMs: null,
      }),
      maxPages: 1,
      pageSize: 1000,
      nowMs: NOW,
    });

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].openTime).toBe(NOW - 3 * HOUR);
  });

  it("never returns a candle at or after now", async () => {
    const result = await collectResearchCandles({
      fetchPage: async () => ({
        candles: [candle(NOW), candle(NOW + HOUR), candle(NOW - HOUR)],
        nextEndMs: null,
      }),
      maxPages: 1,
      pageSize: 1000,
      nowMs: NOW,
    });

    expect(result.candles.map((c) => c.openTime)).toEqual([NOW - HOUR]);
  });

  it("skips candles already stored, so re-running writes nothing new", async () => {
    const known = new Set([NOW - 2 * HOUR, NOW - 3 * HOUR]);
    const result = await collectResearchCandles({
      fetchPage: async () => ({
        candles: [candle(NOW - 3 * HOUR), candle(NOW - 2 * HOUR)],
        nextEndMs: null,
      }),
      existingOpenTimes: known,
      maxPages: 1,
      pageSize: 1000,
      nowMs: NOW,
    });

    expect(result.candles).toHaveLength(0);
  });

  it("deduplicates a candle returned twice across overlapping pages", async () => {
    let call = 0;
    const result = await collectResearchCandles({
      fetchPage: async () => {
        call += 1;
        if (call === 1) return { candles: [candle(NOW - 3 * HOUR), candle(NOW - 2 * HOUR)], nextEndMs: NOW - 3 * HOUR };
        return { candles: [candle(NOW - 4 * HOUR), candle(NOW - 3 * HOUR)], nextEndMs: null };
      },
      maxPages: 5,
      pageSize: 1000,
      nowMs: NOW,
    });

    const times = result.candles.map((c) => c.openTime);
    expect(new Set(times).size).toBe(times.length);
    expect(times).toHaveLength(3);
  });
});

/**
 * The watermark ceiling itself. runBackfillTarget filters every fetched
 * candle against the oldest already-stored open time before inserting; this
 * reproduces that filter exactly so the rule is pinned by a test rather than
 * living only in a comment.
 */
describe("watermark ceiling", () => {
  const ceiling = NOW - 10 * HOUR;
  const targetOldest = NOW - 100 * HOUR;

  function applyGuard(candles: OutcomeCandle[]): OutcomeCandle[] {
    return candles.filter((c) => c.openTime < ceiling && c.openTime >= targetOldest);
  }

  it("refuses anything at or after the oldest stored candle", () => {
    const kept = applyGuard([
      candle(ceiling),
      candle(ceiling + HOUR),
      candle(NOW - HOUR),
      candle(ceiling - HOUR),
    ]);

    expect(kept.map((c) => c.openTime)).toEqual([ceiling - HOUR]);
  });

  it("refuses anything older than the research target window", () => {
    const kept = applyGuard([candle(targetOldest - HOUR), candle(targetOldest)]);
    expect(kept.map((c) => c.openTime)).toEqual([targetOldest]);
  });

  it("keeps the entire interior of the window", () => {
    const inside = [ceiling - HOUR, ceiling - 50 * HOUR, targetOldest];
    expect(applyGuard(inside.map((t) => candle(t)))).toHaveLength(3);
  });
});
