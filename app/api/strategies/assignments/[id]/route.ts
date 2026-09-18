import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";

/**
 * Settings -> Strategies (Prompt 3 S15): enable/disable an assignment, or
 * switch between RESEARCH and SHADOW. Mirrors app/api/strategies/assign/route.ts's
 * mode restriction exactly - PAPER/LIVE are never accepted by this schema,
 * so there is no request shape that could reach either through this route.
 * Identity and ownership come only from the session
 * (`strategy_assignments_all`/`*_update` RLS still applies regardless of
 * anything checked here - see supabase/migrations/*_strategy_platform.sql).
 */
const bodySchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["RESEARCH", "SHADOW"]).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const typedSupabase = await createClient();
  const supabase = typedSupabase as unknown as {
    from: (table: string) => {
      update: (row: Record<string, unknown>) => { eq: (col: string, v: string) => { eq: (col: string, v: string) => { select: () => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } } } };
    };
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
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No recognized fields supplied" }, { status: 400 });
  }

  // .eq("user_id", user.id) is belt-and-suspenders on top of RLS: even if
  // this update somehow ran with elevated privilege, it still could not
  // touch another user's row.
  const result = await supabase.from("strategy_assignments").update(parsed.data).eq("id", id).eq("user_id", user.id).select().single();

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ assignment: result.data });
}
