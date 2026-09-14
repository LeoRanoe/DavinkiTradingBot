import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createBearerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { buildResearchReportFor } from "@/lib/research/evidence";
import { summarizeShadows } from "@/lib/research/shadow";
import { loadLatestStages } from "@/lib/research/stages";
import {
  buildHardTestReport,
  formatHardTestReport,
  historicalSummaryFromStages,
} from "@/lib/research/hard-test-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Assembles the 14-day hard-test report from everything already persisted:
 * the actual PAPER window, the stored historical stages, and the
 * counterfactual shadow set.
 *
 * READ-ONLY. It computes a recommendation but has no power to act on one -
 * promoting Strategy V1 out of DRAFT is a human decision and there is no code
 * path here that does it.
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

  const window = await loadCurrentResearchWindow(admin).catch(() => null);

  const [actualPaper, counterfactual, stages] = await Promise.all([
    window ? buildResearchReportFor(admin, window).catch(() => null) : Promise.resolve(null),
    summarizeShadows(admin, window?.id ?? null).catch(() => null),
    loadLatestStages(admin).catch(() => ({})),
  ]);

  const historical = historicalSummaryFromStages(stages as never);

  const report = buildHardTestReport({ actualPaper, historical, counterfactual });
  const text = formatHardTestReport(report);

  const wantsText = new URL(request.url).searchParams.get("format") === "text";
  if (wantsText) {
    return new NextResponse(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return NextResponse.json({
    recommendation: report.recommendation,
    headline: report.headline,
    rationale: report.rationale,
    gates: report.gates,
    stagesAvailable: Object.keys(stages),
    text,
  });
}
