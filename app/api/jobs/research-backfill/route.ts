import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createBearerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";
import {
  describeCoverage,
  runBackfillTarget,
  RESEARCH_TARGET_DAYS,
  type BackfillTarget,
} from "@/lib/research/backfill-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bounded historical backfill for research (spec section E).
 *
 * Deliberately separate from `/api/jobs/scan` and from the live watermark:
 * this job only ever extends history BACKWARDS from the oldest candle already
 * stored, so it can never mark a recent candle as processed and suppress a
 * real setup. See lib/research/backfill-runner.ts for both guards.
 *
 * Resumable by design: each invocation advances a bounded number of pages per
 * target and persists a cursor, so the caller simply re-invokes until every
 * target reports COMPLETE. Inserts are idempotent, so a repeated or
 * overlapping run costs nothing.
 *
 * Auth mirrors the other jobs exactly: the scanner principal's short-lived
 * JWT, with CRON_SECRET retained only as a manual fallback.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let admin: SupabaseClient<Database> | null = null;
  if (bearerToken) {
    const scoped = createBearerClient(bearerToken);
    const {
      data: { user },
    } = await scoped.auth.getUser(bearerToken);
    if (user?.app_metadata?.role === "scanner") admin = scoped;
  }
  if (!admin && cronSecret && authHeader === `Bearer ${cronSecret}`) {
    admin = createAdminClient();
  }
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetDays = Number.isFinite(body?.targetDays) ? Number(body.targetDays) : RESEARCH_TARGET_DAYS;
  const maxPages = Number.isFinite(body?.maxPages) ? Number(body.maxPages) : undefined;

  const targets: BackfillTarget[] = [];
  for (const symbol of STRATEGY_V1_PARAMS.symbols) {
    // 15M first: it is the entry timeframe and by far the larger fetch, so it
    // benefits most from the available page budget on each invocation.
    targets.push({ symbol, timeframe: "15M" });
    targets.push({ symbol, timeframe: "1H" });
  }

  const { data: jobRun } = await admin
    .from("job_runs")
    .insert({ job_name: "research_backfill", status: "RUNNING" })
    .select("id")
    .single();

  const outcomes = [];
  const errors: string[] = [];
  let inserted = 0;

  for (const target of targets) {
    try {
      const outcome = await runBackfillTarget(admin, target, { targetDays, maxPages });
      outcomes.push(outcome);
      inserted += outcome.inserted;
      if (outcome.status === "FAILED") {
        errors.push(`${target.symbol} ${target.timeframe}: ${outcome.detail ?? "unknown error"}`);
      }
    } catch (error) {
      // One target failing never stops the others.
      errors.push(`${target.symbol} ${target.timeframe}: ${(error as Error).message}`);
    }
  }

  const coverage = await describeCoverage(admin, targets).catch(() => []);
  const complete = outcomes.every((o) => o.status === "COMPLETE");

  const status = errors.length > 0 && inserted === 0 ? "FAILED" : inserted === 0 ? "NOOP" : "SUCCEEDED";

  if (jobRun) {
    await admin
      .from("job_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        records_processed: inserted,
        error_summary: errors.join("; ") || null,
        metadata: { outcomes, coverage, complete, targetDays } as never,
      })
      .eq("id", jobRun.id);
  }

  return NextResponse.json({ status, inserted, complete, targetDays, outcomes, coverage, errors });
}
