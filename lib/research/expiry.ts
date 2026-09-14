import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { buildResearchReportFor } from "./evidence";
import { formatResearchCompletedMessage } from "./report";
import { claimResearchExpiry, revertExecutionPolicyToApproval } from "./store";
import { needsExpiryReconciliation, type ResearchWindow } from "./window";

export type ExpiryOutcome =
  | { kind: "NOT_DUE" }
  | { kind: "ALREADY_HANDLED" }
  | { kind: "EXPIRED"; policyReverted: boolean; notified: boolean };

/**
 * Reconciles an elapsed research window, once.
 *
 * Ordering is deliberate and is the safety property of this function:
 *
 *   1. Claim the expiry ATOMICALLY (ACTIVE -> EXPIRED). Only the winner
 *      continues, so overlapping scans cannot both revert policy or both
 *      notify. A loser returns ALREADY_HANDLED and does nothing.
 *   2. Revert the stored execution policy to APPROVAL_REQUIRED.
 *   3. Notify.
 *
 * Steps 2 and 3 are best-effort AFTER the authoritative state change, never
 * before it. This cannot leave automatic execution running: by the time this
 * function is reached, `effectiveExecutionPolicy` has already stopped
 * honoring AUTO on the basis of time alone. Step 2 only makes the stored
 * configuration agree with what the system is already doing, and a failure in
 * either step leaves a correctly expired window behind rather than an
 * ambiguous one.
 */
export async function reconcileResearchExpiry(
  client: SupabaseClient<Database>,
  window: ResearchWindow | null,
  nowMs: number,
): Promise<ExpiryOutcome> {
  if (!needsExpiryReconciliation(window, nowMs)) return { kind: "NOT_DUE" };

  const active = window as ResearchWindow;
  const nowIso = new Date(nowMs).toISOString();

  // Build the report BEFORE the status flip so the trade set is read while
  // the window is still identifiable in exactly the state being summarized.
  // A reporting failure must not prevent the window from expiring, so this is
  // wrapped rather than allowed to throw.
  let message: string | null = null;
  try {
    const report = await buildResearchReportFor(client, active);
    message = formatResearchCompletedMessage(report);
  } catch {
    message = null;
  }

  const won = await claimResearchExpiry(client, active.id, nowIso);
  if (!won) return { kind: "ALREADY_HANDLED" };

  const policyReverted = await revertExecutionPolicyToApproval(client).catch(() => false);

  let notified = false;
  if (message) {
    const result = await sendTelegramMessage(message).catch(() => ({ ok: false as const }));
    notified = result.ok === true;
  } else {
    // The report could not be built, but the owner must still be told that
    // automatic execution stopped. Silence here would be the worst outcome.
    const fallback = await sendTelegramMessage(
      [
        "Davinki Trading",
        "The automatic PAPER research period has ended.",
        "",
        "Automatic execution has been disabled.",
        "",
        "Execution mode is now:",
        "Approval Required",
        "",
        "The evidence report could not be generated for this message; it remains available in the dashboard.",
      ].join("\n"),
    ).catch(() => ({ ok: false as const }));
    notified = fallback.ok === true;
  }

  await client
    .from("audit_events")
    .insert({
      actor: "scanner",
      action: "paper_research_period_ended",
      metadata: { researchSessionId: active.id, policyReverted, notified } as never,
    })
    .then(
      () => undefined,
      () => undefined,
    );

  return { kind: "EXPIRED", policyReverted, notified };
}
