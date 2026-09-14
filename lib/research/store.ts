import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  planResearchWindow,
  researchWindowFromRow,
  RESEARCH_DEFAULT_DAYS,
  type ResearchWindow,
  type StartWindowInput,
} from "./window";

const RESEARCH_TABLE = "paper_research_sessions";

/**
 * Loads the newest research session. The partial unique index guarantees at
 * most one ACTIVE row, so "newest" is unambiguous for the purpose of
 * answering "is a window open right now?".
 *
 * Reads fail soft (null), because a research-table problem must never stop
 * the scanner from managing open positions. Null means NOT_CONFIGURED, which
 * makes DRAFT non-executable and AUTO degrade to APPROVAL_REQUIRED - the safe
 * direction in every case.
 */
export async function loadCurrentResearchWindow(
  client: SupabaseClient<Database>,
): Promise<ResearchWindow | null> {
  const { data } = await client
    .from(RESEARCH_TABLE)
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return researchWindowFromRow(data as never);
}

export type StartResearchResult =
  | { ok: true; window: ResearchWindow }
  | { ok: false; reason: string };

/**
 * Opens a new research window. The partial unique index on ACTIVE rows makes
 * a concurrent double-start impossible at the database level rather than by
 * application check-then-insert.
 */
export async function startResearchWindow(
  client: SupabaseClient<Database>,
  input: StartWindowInput & { days?: number },
): Promise<StartResearchResult> {
  const days = input.days ?? RESEARCH_DEFAULT_DAYS;
  const planned = planResearchWindow({ ...input, days });
  if (!planned.ok) return { ok: false, reason: planned.reason };

  const { data, error } = await client
    .from(RESEARCH_TABLE)
    .insert({
      started_at: planned.startedAt,
      ends_at: planned.endsAt,
      planned_days: planned.plannedDays,
      status: "ACTIVE",
      starting_equity: input.startingEquity,
      target_equity: input.targetEquity ?? null,
      strategy_version_id: input.strategyVersionId ?? null,
      label: input.label ?? null,
    } as never)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, reason: error?.message ?? "Could not create the research session." };
  }

  const window = researchWindowFromRow(data as never);
  if (!window) return { ok: false, reason: "Research session was created but could not be read back." };
  return { ok: true, window };
}

/**
 * ATOMIC expiry reconciliation: ACTIVE -> EXPIRED, and at the same time the
 * claim on sending the completion notification.
 *
 * `ended_notified_at` is set by the SAME compare-and-set that flips the
 * status, and the update is conditioned on the row still being ACTIVE. So
 * exactly one caller can ever win - two overlapping scans, or a scan racing a
 * manual stop, cannot both send the "research period completed" message.
 * Returns true only for the winner, which is the only caller that may notify.
 */
export async function claimResearchExpiry(
  client: SupabaseClient<Database>,
  windowId: string,
  nowIso: string,
): Promise<boolean> {
  const { data } = await client
    .from(RESEARCH_TABLE)
    .update({ status: "EXPIRED", ended_at: nowIso, ended_notified_at: nowIso } as never)
    .eq("id", windowId)
    .eq("status", "ACTIVE")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

/**
 * Persists the fallback to APPROVAL_REQUIRED once a window has ended.
 *
 * This is a convenience so the stored configuration matches reality and the
 * settings screen does not keep claiming AUTO. It is NOT what stops automatic
 * execution: `effectiveExecutionPolicy` already refuses AUTO the moment the
 * window closes, whether or not this write ever succeeds. Conditioned on the
 * column still being AUTO so it cannot clobber a deliberate owner change.
 */
export async function revertExecutionPolicyToApproval(
  client: SupabaseClient<Database>,
): Promise<boolean> {
  const { data } = await client
    .from("system_settings")
    .update({ execution_policy: "APPROVAL_REQUIRED", updated_at: new Date().toISOString() } as never)
    .eq("id", true)
    .eq("execution_policy", "AUTO")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

/** Owner-initiated early stop. Never sends the completion notification path. */
export async function cancelResearchWindow(
  client: SupabaseClient<Database>,
  windowId: string,
  nowIso: string,
): Promise<boolean> {
  const { data } = await client
    .from(RESEARCH_TABLE)
    .update({ status: "CANCELLED", ended_at: nowIso } as never)
    .eq("id", windowId)
    .eq("status", "ACTIVE")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}
