import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createBearerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { riskSettingsFromRow } from "@/lib/settings/risk-settings";
import {
  persistStage,
  prepareStageContext,
  runStage,
  RESEARCH_STAGES,
  type ResearchStage,
} from "@/lib/research/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One stage of the historical hostile-testing programme (spec F through N).
 *
 * READ-ONLY with respect to trading. It reads stored candles and the owner's
 * settings, runs the research harness in memory, and writes only a job_runs
 * record. It cannot open, close or size a position and never touches PAPER
 * equity.
 *
 * Staged because the full suite is several minutes of CPU and the available
 * runtime is one minute. Call it once per stage; the report is assembled from
 * the stored stages. Deliberately NOT scheduled - it is owner-driven analysis.
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
  const stage = String(body?.stage ?? "BASELINE").toUpperCase() as ResearchStage;
  if (!RESEARCH_STAGES.includes(stage)) {
    return NextResponse.json(
      { error: `Unknown stage. Expected one of ${RESEARCH_STAGES.join(", ")}.` },
      { status: 400 },
    );
  }

  const equity = Number.isFinite(body?.equity) ? Number(body.equity) : 1000;
  const maxCandles = Number.isFinite(body?.maxCandles) ? Number(body.maxCandles) : undefined;

  const { data: jobRun } = await admin
    .from("job_runs")
    .insert({ job_name: "research_run", status: "RUNNING" })
    .select("id")
    .single();

  try {
    const { data: settingsRow } = await admin.from("system_settings").select("*").eq("id", true).single();
    const settings = riskSettingsFromRow(settingsRow);

    const context = await prepareStageContext(admin, settings, { equity, maxCandles });
    const result = runStage(stage, context);
    await persistStage(admin, result, jobRun?.id);

    return NextResponse.json({
      status: "SUCCEEDED",
      stage,
      coverage: result.coverage,
      warnings: result.warnings,
      payload: result.payload,
    });
  } catch (error) {
    const detail = (error as Error).message;
    if (jobRun) {
      await admin
        .from("job_runs")
        .update({
          status: "FAILED",
          completed_at: new Date().toISOString(),
          error_summary: detail.slice(0, 500),
          metadata: { stage } as never,
        })
        .eq("id", jobRun.id);
    }
    return NextResponse.json({ status: "FAILED", stage, error: detail }, { status: 500 });
  }
}
