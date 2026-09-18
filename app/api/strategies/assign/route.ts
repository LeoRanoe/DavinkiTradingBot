import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { isMissingTableError } from "@/lib/strategy-platform/db";

/**
 * "Use this strategy" (spec Prompt 2 S16): creates a StrategyConfiguration
 * and its StrategyAssignment in one step. Mode is restricted to
 * RESEARCH/SHADOW here - PAPER requires separate owner authorization
 * (the strategy_assignments_protect_authorization trigger refuses to set
 * paper_authorized_by from this route at all, since it never supplies
 * that column), and LIVE is refused unconditionally by both the DB CHECK
 * constraint and lib/strategy-platform/authorization.ts
 * canSetAssignmentMode - there is no path from this route to either.
 */
const bodySchema = z.object({
  strategyVersionId: z.string().uuid(),
  configurationName: z.string().min(1).max(200),
  instrumentIds: z.array(z.string().min(1)).min(1).max(25),
  parameters: z.record(z.string(), z.unknown()).default({}),
  mode: z.enum(["RESEARCH", "SHADOW"]).default("RESEARCH"),
});

export async function POST(request: NextRequest) {
  const typedSupabase = await createClient();
  const supabase = typedSupabase as unknown as {
    auth: typeof typedSupabase.auth;
    from: (table: string) => { insert: (row: Record<string, unknown>) => { select: () => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } } };
  };
  const {
    data: { user },
  } = await typedSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const { strategyVersionId, configurationName, instrumentIds, parameters, mode } = parsed.data;

  const configInsert = await supabase
    .from("strategy_configurations")
    .insert({ user_id: user.id, strategy_version_id: strategyVersionId, name: configurationName, parameters, enabled: true })
    .select()
    .single();

  if (configInsert.error) {
    if (isMissingTableError(configInsert.error)) {
      return NextResponse.json(
        { error: "Strategy platform tables are not yet available - the foundation migration has not been applied to this environment." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: configInsert.error.message }, { status: 400 });
  }

  const configuration = configInsert.data as { id: string };

  const assignmentInsert = await supabase
    .from("strategy_assignments")
    .insert({
      user_id: user.id,
      strategy_configuration_id: configuration.id,
      instrument_ids: instrumentIds,
      mode, // RESEARCH or SHADOW only - never PAPER/LIVE from this route
      enabled: true,
    })
    .select()
    .single();

  if (assignmentInsert.error) {
    return NextResponse.json({ error: assignmentInsert.error.message }, { status: 400 });
  }

  return NextResponse.json({ configuration, assignment: assignmentInsert.data });
}
