import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AccountState, InstrumentRules } from "@/lib/risk/types";
import type { TradingMode } from "@/lib/types/trading-mode";
import { INITIAL_PAPER_EQUITY, riskSettingsFromRow, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import type { SignalRow } from "@/lib/candidates/persistence";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { computeAccountState } from "./account-state";
import type { ApprovalStore, ApprovalSource, InsertTradeResult, TradeInsert } from "./approval";

const UNIQUE_VIOLATION = "23505";

/**
 * Supabase-backed `ApprovalStore`.
 *
 * Every state transition here is a single-statement compare-and-set with the
 * expected current state in the WHERE clause, so Postgres row locking - not
 * application logic - is what makes concurrent approvals safe. No transition
 * is ever implemented as read-then-write.
 */
export function createApprovalStore(client: SupabaseClient<Database>): ApprovalStore {
  return {
    /** ATOMIC: PENDING -> OPENING. Exactly one concurrent caller can win. */
    async claim(signalId, nowIso) {
      const { data } = await client
        .from("signals")
        .update({ approval_status: "OPENING", processed_at: nowIso })
        .eq("id", signalId)
        .eq("approval_status", "PENDING")
        .select("*")
        .maybeSingle();
      return (data as SignalRow | null) ?? null;
    },

    async currentStatus(signalId) {
      const { data } = await client
        .from("signals")
        .select("approval_status")
        .eq("id", signalId)
        .maybeSingle();
      return data?.approval_status ?? null;
    },

    async finalizeRejection({ signalId, status, reason, detail, nowIso }) {
      await client
        .from("signals")
        .update({
          approval_status: status,
          rejection_reason: reason,
          rejection_detail: detail,
          processed_at: nowIso,
        })
        .eq("id", signalId)
        .eq("approval_status", "OPENING");
    },

    async finalizeApproval({ signalId, source, nowIso, approvalDelayMs }) {
      await client
        .from("signals")
        .update({
          approval_status: "APPROVED",
          // `approval_status` records the EXECUTION state; `owner_decision`
          // records whether a human decided. For AUTO no human did, so it
          // stays null - writing "APPROVED" here would make automatic
          // research trades indistinguishable from owner-approved ones in
          // every later query and report.
          owner_decision: source === "AUTO" ? null : "APPROVED",
          decision_at: nowIso,
          decision_source: source,
          approval_delay_ms: approvalDelayMs,
          approved_at: nowIso,
          processed_at: nowIso,
        })
        .eq("id", signalId)
        .eq("approval_status", "OPENING");
    },

    /** ATOMIC: PENDING -> REJECTED, attributed to the owner (no engine reason). */
    async recordOwnerRejection({ signalId, source, nowIso }) {
      const { data: existing } = await client
        .from("signals")
        .select("created_at, approval_status")
        .eq("id", signalId)
        .maybeSingle();
      if (!existing) return { ok: false, state: null };

      const delay = Math.max(0, new Date(nowIso).getTime() - new Date(existing.created_at).getTime());

      const { data } = await client
        .from("signals")
        .update({
          approval_status: "REJECTED",
          owner_decision: "REJECTED",
          decision_at: nowIso,
          decision_source: source,
          approval_delay_ms: delay,
          processed_at: nowIso,
        })
        .eq("id", signalId)
        .eq("approval_status", "PENDING")
        .select("symbol")
        .maybeSingle();

      if (!data) return { ok: false, state: existing.approval_status };
      return { ok: true, symbol: data.symbol };
    },

    async insertTrade(row: TradeInsert): Promise<InsertTradeResult> {
      const { data, error } = await client.from("trades").insert(row).select("id").single();
      if (error) {
        const duplicate = error.code === UNIQUE_VIOLATION || error.message.includes("duplicate key");
        return { ok: false, duplicate, message: error.message };
      }
      return { ok: true, tradeId: data.id };
    },

    async insertTradeEvent(tradeId, eventType, payload) {
      await client.from("trade_events").insert({
        trade_id: tradeId,
        event_type: eventType,
        payload: payload as never,
      });
    },

    async loadSettings(): Promise<OwnerRiskSettings> {
      const { data } = await client.from("system_settings").select("*").eq("id", true).maybeSingle();
      return riskSettingsFromRow(data);
    },

    async loadResearchWindow() {
      return loadCurrentResearchWindow(client);
    },

    async loadStrategyVersion(strategyVersionId) {
      const { data } = await client
        .from("strategy_versions")
        .select("status, version_label")
        .eq("id", strategyVersionId)
        .maybeSingle();
      return data ? { status: data.status, versionLabel: data.version_label } : null;
    },

    async loadInstrument(symbol): Promise<InstrumentRules | null> {
      const { data } = await client
        .from("instrument_metadata")
        .select("tick_size, qty_step, min_order_qty, min_order_amt, max_order_qty")
        .eq("symbol", symbol)
        .maybeSingle();
      if (!data) return null;
      return {
        tickSize: data.tick_size,
        qtyStep: data.qty_step,
        minOrderQty: data.min_order_qty,
        minOrderAmt: data.min_order_amt,
        maxOrderQty: data.max_order_qty,
      };
    },

    async loadAccount(mode: TradingMode): Promise<AccountState> {
      return computeAccountState(client, mode, INITIAL_PAPER_EQUITY);
    },

    async audit(actor, action, metadata) {
      await client.from("audit_events").insert({ actor, action, metadata: metadata as never });
    },
  };
}

export type { ApprovalSource };
