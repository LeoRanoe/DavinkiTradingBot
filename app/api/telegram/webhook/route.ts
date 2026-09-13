import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramWebhookSecret, isAuthorizedTelegramUser } from "@/lib/telegram/client";
import { approveAndExecuteSignal, rejectSignalManually } from "@/lib/trading/execute";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Telegram webhook. Validates the secret token header AND the calling
 * user's identity before doing anything - unknown users are rejected
 * outright (spec #54). Approval always re-runs the full risk engine via
 * approveAndExecuteSignal(); Telegram itself has zero execution authority.
 */
export async function POST(request: NextRequest) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  const valid = await verifyTelegramWebhookSecret(secretHeader);
  if (!valid) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const update = await request.json();
  const callback = update?.callback_query;
  if (!callback) return NextResponse.json({ ok: true });

  const userId = callback.from?.id;
  if (!userId || !(await isAuthorizedTelegramUser(userId))) {
    await createAdminClient().from("audit_events").insert({
      actor: "telegram",
      action: "unauthorized_callback_rejected",
      metadata: { userId },
    });
    return NextResponse.json({ ok: true });
  }

  const data: string = callback.data ?? "";
  const [action, signalId] = data.split(":");

  if (action === "approve" && signalId) {
    const outcome = await approveAndExecuteSignal(signalId, "telegram");
    return NextResponse.json({ ok: true, outcome });
  }
  if (action === "reject" && signalId) {
    await rejectSignalManually(signalId, "telegram");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
