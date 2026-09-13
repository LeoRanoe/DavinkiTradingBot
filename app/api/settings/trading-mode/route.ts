import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";

// LIVE is deliberately excluded from the accepted values - this is the
// UI-facing enforcement layer; the DB CHECK constraint and the risk engine
// are the other two (see docs/SECURITY.md "LIVE trading - three
// independent layers"). Zod simply cannot produce "LIVE" here at all.
const bodySchema = z.object({ mode: z.enum(["OBSERVE", "PAPER", "DEMO"]) });

/**
 * Switches the active trading mode. Uses the ordinary RLS-respecting user
 * client (not the admin client) - the "authenticated_update_settings"
 * policy already permits this for a signed-in user, and its WITH CHECK
 * clause independently re-enforces live_trading_enabled = false.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mode. Must be OBSERVE, PAPER, or DEMO." }, { status: 400 });
  }

  const { error } = await supabase
    .from("system_settings")
    .update({ trading_mode: parsed.data.mode, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("audit_events").insert({
    actor: user.email ?? user.id,
    action: "trading_mode_changed",
    metadata: { newMode: parsed.data.mode },
  });

  return NextResponse.json({ ok: true, mode: parsed.data.mode });
}
