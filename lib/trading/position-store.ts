import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TradingMode } from "@/lib/types/trading-mode";
import { INITIAL_PAPER_EQUITY } from "@/lib/settings/risk-settings";
import type { PositionStore, TradeRow } from "./position-manager";

export function createPositionStore(client: SupabaseClient<Database>): PositionStore {
  return {
    async loadOpenTrades(mode: TradingMode): Promise<TradeRow[]> {
      const { data } = await client
        .from("trades")
        .select("*")
        .eq("trading_mode", mode)
        .eq("status", "OPEN");
      return data ?? [];
    },

    /**
     * ATOMIC: OPEN -> CLOSED. The `status = 'OPEN'` predicate is what makes
     * settlement idempotent - a concurrent or repeated scan updates zero rows
     * and the caller then skips the equity snapshot entirely.
     */
    async closeTrade(args) {
      const { data } = await client
        .from("trades")
        .update({
          status: "CLOSED",
          exit_price: args.exitPrice,
          exit_reason: args.exitReason,
          pnl: args.netPnl,
          r_multiple: args.realizedR,
          exit_fee: args.exitFee,
          fees: args.totalFees,
          slippage: args.realizedSlippage,
          equity_after: args.equityAfter,
          closed_at: args.closedAtIso,
        })
        .eq("id", args.tradeId)
        .eq("status", "OPEN")
        .select("id")
        .maybeSingle();
      return Boolean(data);
    },

    async insertTradeEvent(tradeId, eventType, payload) {
      await client.from("trade_events").insert({
        trade_id: tradeId,
        event_type: eventType,
        payload: payload as never,
      });
    },

    async latestEquity(mode: TradingMode): Promise<number> {
      const { data } = await client
        .from("portfolio_snapshots")
        .select("equity")
        .eq("trading_mode", mode)
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.equity ?? INITIAL_PAPER_EQUITY;
    },

    async insertPortfolioSnapshot({ mode, equity, takenAtIso }) {
      await client.from("portfolio_snapshots").insert({
        trading_mode: mode,
        equity,
        balance: equity,
        open_risk: 0,
        taken_at: takenAtIso,
      });
    },
  };
}

export type ExpirySweepResult = { expired: number; reconciled: number };

/**
 * Housekeeping for candidates nobody acted on, run by the scheduled job.
 *
 * - PENDING past its expiry becomes EXPIRED. This is silent by design: the
 *   owner is not notified every time an unattended candidate lapses.
 * - A candidate stuck in OPENING (a function died between claiming it and
 *   finishing) is reconciled against the authoritative execution state: if a
 *   trade exists it becomes APPROVED, otherwise ERROR. It is never returned
 *   to PENDING, which could otherwise open a second position.
 */
export async function sweepStaleCandidates(
  client: SupabaseClient<Database>,
  opts: { nowMs?: number; openingGraceMs?: number } = {},
): Promise<ExpirySweepResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const graceMs = opts.openingGraceMs ?? 5 * 60_000;

  const { data: expiredRows } = await client
    .from("signals")
    .update({ approval_status: "EXPIRED", processed_at: nowIso })
    .eq("approval_status", "PENDING")
    .lt("expires_at", nowIso)
    .select("id");

  const { data: stuck } = await client
    .from("signals")
    .select("id, processed_at")
    .eq("approval_status", "OPENING")
    .lt("processed_at", new Date(nowMs - graceMs).toISOString());

  let reconciled = 0;
  for (const row of stuck ?? []) {
    const { data: trade } = await client
      .from("trades")
      .select("id")
      .eq("signal_id", row.id)
      .maybeSingle();

    const { data: updated } = await client
      .from("signals")
      .update(
        trade
          ? { approval_status: "APPROVED", owner_decision: "APPROVED", approved_at: nowIso, processed_at: nowIso }
          : {
              approval_status: "ERROR",
              rejection_reason: "MISSING_MARKET_DATA",
              rejection_detail:
                "Execution was claimed but never completed (the function ended mid-flight). No position was opened.",
              processed_at: nowIso,
            },
      )
      .eq("id", row.id)
      .eq("approval_status", "OPENING")
      .select("id")
      .maybeSingle();
    if (updated) reconciled += 1;
  }

  return { expired: expiredRows?.length ?? 0, reconciled };
}
