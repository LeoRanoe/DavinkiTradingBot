import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import {
  cancelResearchWindow,
  loadCurrentResearchWindow,
  startResearchWindow,
} from "@/lib/research/store";
import { buildResearchReportFor } from "@/lib/research/evidence";
import {
  RESEARCH_DEFAULT_DAYS,
  RESEARCH_MAX_DAYS,
  formatTimeRemaining,
  researchProgress,
  researchWindowState,
} from "@/lib/research/window";

/**
 * Owner-only control over the PAPER research window.
 *
 * Starting a window is what makes a DRAFT strategy executable in PAPER, so it
 * is deliberately an explicit, audited, owner-authenticated action - never a
 * side effect of changing a setting. Duration is bounded here, in
 * `planResearchWindow`, and by a database CHECK constraint.
 *
 * This route can never enable LIVE: it writes only to the research table, and
 * every other LIVE prohibition remains in force regardless of what it does.
 */
const startSchema = z.object({
  action: z.literal("start"),
  days: z.number().int().min(1).max(RESEARCH_MAX_DAYS).optional(),
  startingEquity: z.number().gt(0).max(1_000_000),
  targetEquity: z.number().gt(0).max(1_000_000).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
});

const stopSchema = z.object({ action: z.literal("stop") });

const bodySchema = z.discriminatedUnion("action", [startSchema, stopSchema]);

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const window = await loadCurrentResearchWindow(supabase);
  const now = Date.now();
  const state = researchWindowState(window, now);

  if (!window) {
    return NextResponse.json({ state, window: null, report: null });
  }

  const progress = researchProgress(window, now);
  const report = await buildResearchReportFor(supabase, window).catch(() => null);

  return NextResponse.json({
    state,
    window: {
      ...window,
      day: progress.day,
      totalDays: progress.totalDays,
      timeRemaining: formatTimeRemaining(progress.msRemaining),
    },
    report,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (parsed.data.action === "stop") {
    const current = await loadCurrentResearchWindow(supabase);
    if (!current || current.status !== "ACTIVE") {
      return NextResponse.json({ error: "No active research window to stop." }, { status: 409 });
    }

    const stopped = await cancelResearchWindow(supabase, current.id, new Date().toISOString());
    if (!stopped) {
      return NextResponse.json({ error: "The research window was already closed." }, { status: 409 });
    }

    // Automatic execution stops the moment the window is no longer active -
    // `effectiveExecutionPolicy` refuses AUTO without one - but the stored
    // policy is reverted too so the settings screen stops claiming AUTO.
    await supabase
      .from("system_settings")
      .update({ execution_policy: "APPROVAL_REQUIRED", updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", true)
      .eq("execution_policy", "AUTO");

    await supabase.from("audit_events").insert({
      actor: user.email ?? user.id,
      action: "paper_research_window_stopped",
      metadata: { researchSessionId: current.id },
    });

    return NextResponse.json({ ok: true, state: "EXPIRED" });
  }

  const { days = RESEARCH_DEFAULT_DAYS, startingEquity, targetEquity, label } = parsed.data;

  const { data: strategy } = await supabase
    .from("strategy_versions")
    .select("id, status")
    .eq("version_label", "v1")
    .maybeSingle();

  const result = await startResearchWindow(supabase, {
    startedAtMs: Date.now(),
    days,
    startingEquity,
    targetEquity: targetEquity ?? null,
    strategyVersionId: strategy?.id ?? null,
    label: label ?? `${days}-day PAPER research`,
  });

  if (!result.ok) {
    // A unique-violation here means a window is already active; the partial
    // index, not this route, is what guarantees only one can exist.
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  await supabase.from("audit_events").insert({
    actor: user.email ?? user.id,
    action: "paper_research_window_started",
    metadata: {
      researchSessionId: result.window.id,
      days,
      startingEquity,
      targetEquity: targetEquity ?? null,
      // Recorded so the audit trail shows this never implied a promotion.
      strategyStatusAtStart: strategy?.status ?? null,
    },
  });

  return NextResponse.json({ ok: true, window: result.window });
}
