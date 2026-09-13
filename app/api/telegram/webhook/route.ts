import { NextRequest, NextResponse } from "next/server";
import {
  answerCallbackQuery,
  isAuthorizedTelegramChat,
  isAuthorizedTelegramUser,
  parseCallbackData,
  verifyTelegramWebhookSecret,
} from "@/lib/telegram/client";
import { approveAndExecuteSignal, rejectSignalManually } from "@/lib/trading/execute";

export const dynamic = "force-dynamic";

/**
 * Telegram webhook - a financial control surface, so it is authenticated in
 * four independent ways before anything happens:
 *
 *   1. the secret token header Telegram echoes back (proves the request came
 *      from the webhook we registered),
 *   2. the calling Telegram user id must be the configured owner,
 *   3. the chat the button was pressed in must be the configured owner chat
 *      (a correct user id pressed in some other chat is still refused),
 *   4. the callback payload must match `action:uuid` exactly - the candidate
 *      is addressed by an opaque UUID, never by price, symbol or any secret.
 *
 * Nothing here is execution authority. APPROVE only asks the deterministic
 * engine to re-evaluate the candidate; the engine decides.
 *
 * The handler always answers Telegram with 200 once authenticated, because a
 * non-2xx makes Telegram RETRY the same callback - and a retry must never be
 * able to produce a second position. Idempotency is guaranteed by the atomic
 * PENDING -> OPENING claim and the unique index on trades.signal_id, so a
 * retry that does slip through is reported as already processed.
 */
export async function POST(request: NextRequest) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (!(await verifyTelegramWebhookSecret(secretHeader))) {
    // No audit write here: an unauthenticated caller must not be able to make
    // us write rows, and we never reveal why the request failed.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const callback = (update as { callback_query?: Record<string, unknown> } | null)?.callback_query;
  if (!callback) return NextResponse.json({ ok: true });

  const from = callback.from as { id?: string | number } | undefined;
  const message = callback.message as { chat?: { id?: string | number } } | undefined;
  const callbackId = typeof callback.id === "string" ? callback.id : null;

  const userOk = from?.id !== undefined && (await isAuthorizedTelegramUser(from.id));
  const chatOk = await isAuthorizedTelegramChat(message?.chat?.id);
  if (!userOk || !chatOk) {
    // Acknowledge so the sender sees a refusal, but do not act and do not
    // disclose which check failed.
    if (callbackId) await answerCallbackQuery(callbackId, "Not authorized.");
    return NextResponse.json({ ok: true });
  }

  const parsed = parseCallbackData(callback.data);
  if (!parsed) {
    if (callbackId) await answerCallbackQuery(callbackId, "Unrecognized action.");
    return NextResponse.json({ ok: true });
  }

  try {
    if (parsed.action === "approve") {
      const outcome = await approveAndExecuteSignal(parsed.signalId, "telegram");
      if (callbackId) await answerCallbackQuery(callbackId, approvalAcknowledgement(outcome));
      return NextResponse.json({ ok: true, outcome: outcome.kind });
    }

    const rejection = await rejectSignalManually(parsed.signalId, "telegram");
    if (callbackId) {
      await answerCallbackQuery(
        callbackId,
        rejection.kind === "REJECTED_BY_OWNER"
          ? "Candidate rejected."
          : rejection.kind === "ALREADY_PROCESSED"
            ? `Already ${rejection.state}.`
            : "Candidate not found.",
      );
    }
    return NextResponse.json({ ok: true, outcome: rejection.kind });
  } catch (err) {
    // A server-side failure (most likely a missing or rotated Supabase
    // service key, which this path still needs) must not become a 500:
    // Telegram would retry the same callback indefinitely. Tell the owner
    // plainly, without leaking the underlying error, and stop the retries.
    // Nothing was executed - the atomic claim either never happened or was
    // left for the OPENING reconciliation sweep to resolve.
    console.error("telegram callback failed", (err as Error).message);
    if (callbackId) {
      await answerCallbackQuery(callbackId, "Server configuration error. Nothing was executed.");
    }
    return NextResponse.json({ ok: true, outcome: "ERROR" });
  }
}

function approvalAcknowledgement(outcome: Awaited<ReturnType<typeof approveAndExecuteSignal>>): string {
  switch (outcome.kind) {
    case "EXECUTED":
      return "Approved - paper position opened.";
    case "REJECTED":
      return `Not opened: ${outcome.reason}`;
    case "ALREADY_PROCESSED":
      return `Already ${outcome.state}.`;
    case "NOT_FOUND":
      return "Candidate not found.";
  }
}
