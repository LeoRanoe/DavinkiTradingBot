import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typed row shapes + queries for the JeanFX Gold tables
 * (supabase/migrations/20260920000000_jeanfx_gold_paper.sql), following the
 * exact same "cast for tables not yet in the generated Database type"
 * pattern as lib/strategy-platform/db.ts - see that file's comment for why.
 */

export type JeanfxGoldPaperTradeRow = {
  id: string;
  user_id: string;
  strategy_definition_id: string;
  strategy_version_id: string;
  strategy_configuration_id: string;
  strategy_assignment_id: string;
  instrument_id: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  stop_price: number;
  target_price: number;
  spread: number;
  slippage_bps: number;
  fees: number;
  qty: number;
  status: "OPEN" | "CLOSED";
  exit_price: number | null;
  exit_reason: "STOP" | "TARGET" | "MANUAL" | null;
  pnl: number | null;
  r_multiple: number | null;
  reason_codes: string[];
  feature_snapshot: unknown;
  session: "LONDON" | "NEW_YORK";
  opened_at: string;
  closed_at: string | null;
  created_at: string;
};

export type JeanfxGoldSessionDiagnosticsRow = {
  id: string;
  user_id: string;
  strategy_assignment_id: string;
  session_date: string;
  session: "LONDON" | "NEW_YORK";
  liquidity_sweeps: number;
  mss_bos: number;
  fvgs: number;
  retraces: number;
  confirmations: number;
  ready_setups: number;
  rr_rejected: number;
  risk_rejected: number;
  executed: number;
  updated_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** All PAPER trades for this user's JeanFX Gold assignments - never filtered by strategy_definition_id server-side beyond RLS's own user_id scoping, since JeanFX Gold's definition id is looked up by the caller (see the performance page). */
export async function listJeanfxGoldPaperTrades(supabase: AnyClient, userId: string) {
  return supabase
    .from("jeanfx_gold_paper_trades")
    .select("*")
    .eq("user_id", userId)
    .order("opened_at", { ascending: false }) as unknown as Promise<{ data: JeanfxGoldPaperTradeRow[] | null; error: { message: string } | null }>;
}

export async function listJeanfxGoldSessionDiagnostics(supabase: AnyClient, userId: string, limit = 60) {
  return supabase
    .from("jeanfx_gold_session_diagnostics")
    .select("*")
    .eq("user_id", userId)
    .order("session_date", { ascending: false })
    .limit(limit) as unknown as Promise<{ data: JeanfxGoldSessionDiagnosticsRow[] | null; error: { message: string } | null }>;
}

/** True when the error looks like "relation does not exist" - the migration hasn't been applied yet, not a real failure. Same convention as lib/strategy-platform/db.ts. */
export function isMissingTableError(error: { message: string } | null): boolean {
  return !!error && /relation .* does not exist/i.test(error.message);
}
