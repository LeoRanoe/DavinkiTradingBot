import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createBearerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { createDefaultProviders } from "@/lib/news/providers";
import { createNewsStore } from "@/lib/news/store";
import { createQwenNewsAnalyzer } from "@/lib/news/analyzer";
import { createAiUsageRecorder } from "@/lib/ai/usage";
import { ingestNews } from "@/lib/news/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * News ingestion job. Deliberately SEPARATE from `/api/jobs/scan`:
 *
 *  - the market scanner must never wait on a news fetch,
 *  - news ingestion runs on its own, slower cadence (10-15 minutes is
 *    ample; news does not arrive on a 15-minute candle boundary),
 *  - and a total news outage must leave trading completely unaffected.
 *
 * Auth mirrors the scan job exactly: the dedicated Supabase scanner
 * principal's short-lived JWT, with CRON_SECRET retained only as a manual
 * fallback. Repeated runs are idempotent - deduplication collapses anything
 * already stored, so re-running costs nothing and creates nothing.
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

  const { data: jobRun } = await admin
    .from("job_runs")
    .insert({ job_name: "news", status: "RUNNING" })
    .select("id")
    .single();

  try {
    const report = await ingestNews({
      providers: createDefaultProviders(),
      store: createNewsStore(admin),
      analyzer: createQwenNewsAnalyzer(createAiUsageRecorder(admin)),
    });

    const allProvidersFailed =
      report.providers.length > 0 && report.providers.every((p) => p.status === "FAILED");
    const someFailed = report.providers.some((p) => p.status === "FAILED");

    const status = allProvidersFailed ? "FAILED" : report.newEvents === 0 ? "NOOP" : "SUCCEEDED";

    if (jobRun) {
      await admin
        .from("job_runs")
        .update({
          status,
          completed_at: new Date().toISOString(),
          records_processed: report.newEvents,
          error_summary: someFailed
            ? report.providers
                .filter((p) => p.status === "FAILED")
                .map((p) => `${p.provider}: ${p.error}`)
                .join("; ")
            : null,
          metadata: report as never,
        })
        .eq("id", jobRun.id);
    }

    return NextResponse.json({ status, ...report });
  } catch (err) {
    // Never leave a job row RUNNING forever, and never leak internals.
    if (jobRun) {
      await admin
        .from("job_runs")
        .update({
          status: "FAILED",
          completed_at: new Date().toISOString(),
          error_summary: (err as Error).message.slice(0, 500),
        })
        .eq("id", jobRun.id);
    }
    return NextResponse.json({ error: "News ingestion failed" }, { status: 500 });
  }
}
