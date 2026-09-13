import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import {
  RISK_PRESETS,
  riskSettingsUpdateSchema,
  riskSettingsUpdateToRow,
  type RiskSettingsUpdate,
} from "@/lib/settings/risk-settings";

const presetSchema = z.object({ preset: z.enum(["CONSERVATIVE", "BALANCED", "GROWTH_EXPERIMENT"]) });

/**
 * Owner-only risk configuration.
 *
 * Validation happens here on the server and again as CHECK constraints in
 * the database - the client form is a convenience, never the authority.
 * Guests are refused twice over: by the `isOwner` check below and by the
 * `owner_update_settings` RLS policy, which this route deliberately relies
 * on by using the RLS-respecting user client rather than the admin client.
 *
 * Nothing here can enable real-money trading: `live_trading_enabled` is not
 * writable, the trading mode is not settable from this route, and an AUTO
 * execution policy is constrained to PAPER/DEMO by the database.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // A preset only POPULATES owner-editable fields; it is then validated by
  // exactly the same schema as a manual edit and can never bypass a bound.
  const asPreset = presetSchema.safeParse(raw);
  const candidate: unknown = asPreset.success ? RISK_PRESETS[asPreset.data.preset] : raw;

  const parsed = riskSettingsUpdateSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid risk settings", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const update: RiskSettingsUpdate = parsed.data;
  const row = riskSettingsUpdateToRow(update);
  if (Object.keys(row).length === 0) {
    return NextResponse.json({ error: "No recognized settings supplied" }, { status: 400 });
  }

  const { error } = await supabase
    .from("system_settings")
    .update({ ...row, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await supabase.from("audit_events").insert({
    actor: user.email ?? user.id,
    action: "risk_settings_changed",
    metadata: { preset: asPreset.success ? asPreset.data.preset : null, changed: row },
  });

  return NextResponse.json({ ok: true, applied: row });
}
