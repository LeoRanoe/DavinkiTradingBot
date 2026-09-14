import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { backfillBybitResearchCandles } from "@/lib/learning/bybit-backfill";

/**
 * Bounded, resumable historical backfill for research.
 *
 * THE WATERMARK INVARIANT
 * -----------------------
 * The live scanner uses the `candles` table as its own durable watermark: it
 * asks "have I already stored the latest closed 15m candle?" and skips
 * evaluation when the answer is yes. A backfill that paged forward from
 * `now` would insert that very candle and silently convince the scanner it
 * had already processed a setup it never evaluated - suppressing real trades.
 *
 * So this job NEVER pages forward. It starts from the OLDEST candle already
 * stored for a (symbol, timeframe) and extends strictly BACKWARDS. Two
 * independent guards enforce that:
 *
 *   1. The initial cursor is `oldest stored open_time - 1`, so the very first
 *      page Bybit returns already ends before anything the scanner owns.
 *   2. Every fetched candle is filtered against `backwardsCeilingMs` before
 *      insert, so even a surprising API response cannot cross the line.
 *
 * Everything is bounded per invocation (pages and rows) so a single run stays
 * well inside the function timeout, and the cursor is persisted so the next
 * invocation resumes exactly where this one stopped.
 */

export const RESEARCH_TARGET_DAYS = 365;

/** Bybit's kline page limit. */
const PAGE_SIZE = 1000;

/** Pages per invocation. Keeps one run well inside the 60s function budget. */
const PAGES_PER_RUN = 8;

export type BackfillTarget = {
  symbol: string;
  timeframe: "15M" | "1H";
};

export type BackfillOutcome = {
  symbol: string;
  timeframe: "15M" | "1H";
  status: "COMPLETE" | "RUNNING" | "FAILED";
  inserted: number;
  pages: number;
  oldestStored: string | null;
  coverageDays: number;
  detail?: string;
};

function intervalMs(timeframe: "15M" | "1H"): number {
  return timeframe === "1H" ? 3_600_000 : 900_000;
}

/**
 * Advances one (symbol, timeframe) backfill by a bounded number of pages.
 * Isolated per target: one failing symbol never stops another.
 */
export async function runBackfillTarget(
  client: SupabaseClient<Database>,
  target: BackfillTarget,
  options: { targetDays?: number; maxPages?: number; nowMs?: number } = {},
): Promise<BackfillOutcome> {
  const { symbol, timeframe } = target;
  const nowMs = options.nowMs ?? Date.now();
  const targetDays = options.targetDays ?? RESEARCH_TARGET_DAYS;
  const maxPages = options.maxPages ?? PAGES_PER_RUN;
  const targetOldestMs = nowMs - targetDays * 24 * 60 * 60 * 1000;

  // Where history currently begins. This is both the resume anchor and the
  // ceiling that keeps the backfill away from the scanner's watermark.
  const { data: oldestRow } = await client
    .from("candles")
    .select("open_time")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .order("open_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!oldestRow) {
    // Nothing stored yet. The live scanner seeds recent history on its own;
    // refusing here keeps this job strictly an extender of existing history
    // and removes any possibility of it defining the watermark itself.
    return {
      symbol,
      timeframe,
      status: "RUNNING",
      inserted: 0,
      pages: 0,
      oldestStored: null,
      coverageDays: 0,
      detail: "No stored candles yet; the live scanner seeds recent history first.",
    };
  }

  const backwardsCeilingMs = new Date(oldestRow.open_time).getTime();

  if (backwardsCeilingMs <= targetOldestMs) {
    await upsertCursor(client, symbol, timeframe, { status: "COMPLETE", resumeEnd: null });
    return {
      symbol,
      timeframe,
      status: "COMPLETE",
      inserted: 0,
      pages: 0,
      oldestStored: oldestRow.open_time,
      coverageDays: Math.floor((nowMs - backwardsCeilingMs) / 86_400_000),
    };
  }

  // Resume from the stored cursor when it is still strictly older than the
  // ceiling; otherwise re-anchor to the ceiling. Re-anchoring is always safe
  // because inserts are idempotent.
  const { data: cursorRow } = await client
    .from("research_backfill_jobs")
    .select("resume_end, records_written")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .maybeSingle();

  const storedCursorMs = cursorRow?.resume_end ? new Date(cursorRow.resume_end).getTime() : null;
  const resumeEndMs =
    storedCursorMs !== null && storedCursorMs < backwardsCeilingMs
      ? storedCursorMs
      : backwardsCeilingMs - 1;

  await upsertCursor(client, symbol, timeframe, { status: "RUNNING", resumeEnd: resumeEndMs });

  let fetched: Awaited<ReturnType<typeof backfillBybitResearchCandles>>;
  try {
    fetched = await backfillBybitResearchCandles({
      symbol,
      timeframe,
      maxPages,
      pageSize: PAGE_SIZE,
      resumeEndMs,
      nowMs,
    });
  } catch (error) {
    const detail = (error as Error).message;
    await upsertCursor(client, symbol, timeframe, {
      status: "FAILED",
      resumeEnd: resumeEndMs,
      error: detail,
    });
    return {
      symbol,
      timeframe,
      status: "FAILED",
      inserted: 0,
      pages: 0,
      oldestStored: oldestRow.open_time,
      coverageDays: Math.floor((nowMs - backwardsCeilingMs) / 86_400_000),
      detail,
    };
  }

  // GUARD 2: nothing at or after the ceiling may ever be written, and
  // nothing older than the target window is worth storing.
  const rows = fetched.candles
    .filter((c) => c.openTime < backwardsCeilingMs && c.openTime >= targetOldestMs)
    .map((c) => ({
      symbol,
      timeframe,
      open_time: new Date(c.openTime).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      is_closed: true,
    }));

  let inserted = 0;
  // Chunked so one oversized statement cannot blow the request budget.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await client
      .from("candles")
      .upsert(chunk, { onConflict: "symbol,timeframe,open_time", ignoreDuplicates: true });
    if (!error) inserted += chunk.length;
  }

  const reachedTarget =
    fetched.resumeEndMs === null || fetched.resumeEndMs <= targetOldestMs || rows.length === 0;

  await upsertCursor(client, symbol, timeframe, {
    status: reachedTarget ? "COMPLETE" : "RUNNING",
    resumeEnd: reachedTarget ? null : fetched.resumeEndMs,
    recordsWritten: (cursorRow?.records_written ?? 0) + inserted,
  });

  const { data: newOldest } = await client
    .from("candles")
    .select("open_time")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .order("open_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  const oldestMs = newOldest ? new Date(newOldest.open_time).getTime() : backwardsCeilingMs;

  return {
    symbol,
    timeframe,
    status: reachedTarget ? "COMPLETE" : "RUNNING",
    inserted,
    pages: fetched.pages,
    oldestStored: newOldest?.open_time ?? oldestRow.open_time,
    coverageDays: Math.floor((nowMs - oldestMs) / 86_400_000),
  };
}

async function upsertCursor(
  client: SupabaseClient<Database>,
  symbol: string,
  timeframe: string,
  args: { status: string; resumeEnd: number | null; recordsWritten?: number; error?: string },
): Promise<void> {
  const row: Record<string, unknown> = {
    symbol,
    timeframe,
    status: args.status,
    resume_end: args.resumeEnd === null ? null : new Date(args.resumeEnd).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (args.recordsWritten !== undefined) row.records_written = args.recordsWritten;
  if (args.error !== undefined) row.error_summary = args.error.slice(0, 500);

  await client
    .from("research_backfill_jobs")
    .upsert(row as never, { onConflict: "symbol,timeframe" })
    .then(
      () => undefined,
      () => undefined, // cursor bookkeeping must never fail the job
    );
}

/** Reports how much history is actually available, per target. */
export async function describeCoverage(
  client: SupabaseClient<Database>,
  targets: readonly BackfillTarget[],
  nowMs = Date.now(),
): Promise<Array<{ symbol: string; timeframe: string; candles: number; oldest: string | null; coverageDays: number }>> {
  const out = [];
  for (const { symbol, timeframe } of targets) {
    const { count } = await client
      .from("candles")
      .select("id", { count: "exact", head: true })
      .eq("symbol", symbol)
      .eq("timeframe", timeframe);
    const { data: oldest } = await client
      .from("candles")
      .select("open_time")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .order("open_time", { ascending: true })
      .limit(1)
      .maybeSingle();

    const oldestMs = oldest ? new Date(oldest.open_time).getTime() : null;
    out.push({
      symbol,
      timeframe,
      candles: count ?? 0,
      oldest: oldest?.open_time ?? null,
      coverageDays: oldestMs === null ? 0 : Math.floor((nowMs - oldestMs) / 86_400_000),
    });
  }
  return out;
}

export { intervalMs };
