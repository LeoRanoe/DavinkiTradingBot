import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createBearerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { persistHypotheses, runHistoricalResearch } from "@/lib/research/run";
import { summarizeHistoricalResearch } from "@/lib/research/hard-test-report";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The historical hostile-testing pass (spec sections F through N).
 *
 * READ-ONLY with respect to trading. It reads stored candles and the owner's
 * settings, runs the research suite in memory, and writes only research
 * hypotheses and a job_runs record. It cannot open, close or size a position,
 * and it never touches PAPER equity.
 *
 * Deliberately NOT scheduled: it is an owner-driven analysis, and running a
 * multi-minute sweep every five minutes would be pure waste.
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
  const equity = Number.isFinite(body?.equity) ? Number(body.equity) : 1000;
  const maxCandles = Number.isFinite(body?.maxCandles) ? Number(body.maxCandles) : undefined;
  const persist = body?.persistHypotheses !== false;

  const { data: jobRun } = await admin
    .from("job_runs")
    .insert({ job_name: "research_run", status: "RUNNING" })
    .select("id")
    .single();

  try {
    const { data: settingsRow } = await admin.from("system_settings").select("*").eq("id", true).single();
    const settings = riskSettingsFromRow(settingsRow);

    const result = await runHistoricalResearch(admin, settings, { equity, maxCandles });
    const summary = summarizeHistoricalResearch(result);

    const hypotheses = persist ? await persistHypotheses(admin, result).catch(() => 0) : 0;

    if (jobRun) {
      await admin
        .from("job_runs")
        .update({
          status: "SUCCEEDED",
          completed_at: new Date().toISOString(),
          records_processed: result.baseline.combined.sampleCount,
          error_summary: result.warnings.join("; ") || null,
          // The full result is large; the summary is what stays queryable.
          metadata: { summary, coverage: result.coverage, hypotheses } as never,
        })
        .eq("id", jobRun.id);
    }

    return NextResponse.json({ status: "SUCCEEDED", summary, coverage: result.coverage, hypotheses, warnings: result.warnings });
  } catch (error) {
    const detail = (error as Error).message;
    if (jobRun) {
      await admin
        .from("job_runs")
        .update({ status: "FAILED", completed_at: new Date().toISOString(), error_summary: detail.slice(0, 500) })
        .eq("id", jobRun.id);
    }
    return NextResponse.json({ status: "FAILED", error: detail }, { status: 500 });
  }
}
