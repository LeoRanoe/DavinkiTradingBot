import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { evaluateTradeRisk } from "@/lib/risk/engine";
import { computeAccountState } from "./account-state";
import { simulateEntryFill, computeFee } from "./paper";
import type { RejectionReason } from "@/lib/risk/types";
import type { Database } from "@/lib/supabase/database.types";

export type ExecutionOutcome =
  | { kind: "EXECUTED"; tradeId: string }
  | { kind: "REJECTED"; reason: RejectionReason }
  | { kind: "NOT_APPLICABLE"; reason: string };

const DEFAULT_FEE_BPS = 10;
const DEFAULT_SLIPPAGE_BPS = 5;

/**
 * The single path that turns an approved signal into a trade, used by BOTH
 * the dashboard "Approve" button and the Telegram approval callback. Always
 * re-runs the full risk engine regardless of who/what is asking - approval
 * from a human or from Telegram is a REQUEST, never execution authority by
 * itself (spec #55/#56).
 */
export async function approveAndExecuteSignal(
  signalId: string,
  actor: "dashboard" | "telegram",
): Promise<ExecutionOutcome> {
  const admin = createAdminClient();

  const { data: signal } = await admin.from("signals").select("*").eq("id", signalId).maybeSingle();
  if (!signal) return { kind: "NOT_APPLICABLE", reason: "Signal not found." };

  if (signal.approval_status !== "PENDING") {
    // Idempotency: a duplicate Telegram callback or double-click must not
    // re-execute or re-evaluate an already-decided signal.
    return { kind: "NOT_APPLICABLE", reason: `Signal already ${signal.approval_status}.` };
  }

  const signalExpired = signal.expires_at !== null && new Date(signal.expires_at).getTime() < Date.now();

  const { data: settings } = await admin.from("system_settings").select("*").eq("id", true).single();
  const { data: strategyVersion } = await admin
    .from("strategy_versions")
    .select("status")
    .eq("id", signal.strategy_version_id)
    .single();

  const strategyApproved =
    strategyVersion?.status === "PAPER_APPROVED" || strategyVersion?.status === "DEMO_APPROVED";

  const { data: instrument } = await admin
    .from("instrument_metadata")
    .select("*")
    .eq("symbol", signal.symbol)
    .maybeSingle();

  if (!instrument) {
    await rejectSignal(admin, signalId, "INVALID_EXCHANGE_METADATA");
    return { kind: "REJECTED", reason: "INVALID_EXCHANGE_METADATA" };
  }

  const tradingMode = settings?.trading_mode ?? "OBSERVE";
  if (tradingMode === "OBSERVE") {
    return { kind: "NOT_APPLICABLE", reason: "System is in OBSERVE mode; no trades are executed." };
  }

  const account = await computeAccountState(admin, tradingMode, 10);

  const decision = evaluateTradeRisk({
    tradingMode,
    strategyApproved,
    proposal: {
      entryPrice: signal.entry_price ?? 0,
      stopPrice: signal.stop_price ?? 0,
      targetPrice: signal.target_price ?? 0,
    },
    account,
    limits: {
      maxRiskPerTradePct: settings?.max_risk_per_trade_pct ?? 0.01,
      maxOpenPositions: settings?.max_open_positions ?? 1,
      maxNewTradesPerDay: settings?.max_new_trades_per_day ?? 2,
      maxLosingTradesPerDay: settings?.max_losing_trades_per_day ?? 2,
    },
    instrument: {
      tickSize: instrument.tick_size,
      qtyStep: instrument.qty_step,
      minOrderQty: instrument.min_order_qty,
      minOrderAmt: instrument.min_order_amt,
      maxOrderQty: instrument.max_order_qty,
    },
    signalExpired,
  });

  if (!decision.approved) {
    await rejectSignal(admin, signalId, decision.reason);
    await logAudit(admin, actor, "trade_rejected", { signalId, reason: decision.reason });
    return { kind: "REJECTED", reason: decision.reason };
  }

  if (tradingMode === "DEMO") {
    // Demo execution is not implemented yet (no credentials available in
    // this build) - do not fabricate a fill. Leave the signal PENDING so a
    // human can retry once Demo is wired up, and say so explicitly.
    return { kind: "NOT_APPLICABLE", reason: "Bybit Demo execution is not yet available." };
  }

  // PAPER execution: simulate a fill using the same fee/slippage model as
  // the backtester so results are directly comparable.
  const fillPrice = simulateEntryFill(signal.entry_price!, DEFAULT_SLIPPAGE_BPS);
  const notional = decision.sizing.qty * fillPrice;
  const fee = computeFee(notional, DEFAULT_FEE_BPS);

  const { data: trade, error } = await admin
    .from("trades")
    .insert({
      signal_id: signalId,
      strategy_version_id: signal.strategy_version_id,
      trading_mode: "PAPER",
      symbol: signal.symbol,
      status: "OPEN",
      entry_price: fillPrice,
      stop_price: signal.stop_price,
      target_price: signal.target_price,
      qty: decision.sizing.qty,
      notional,
      risk_amount: decision.sizing.riskAmount,
      risk_reward: decision.sizing.riskReward,
      fees: fee,
      opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !trade) {
    return { kind: "NOT_APPLICABLE", reason: `Failed to record trade: ${error?.message}` };
  }

  await admin
    .from("signals")
    .update({ approval_status: "APPROVED", approved_at: new Date().toISOString(), owner_decision_at: new Date().toISOString() } as never)
    .eq("id", signalId);

  await admin.from("trade_events").insert({
    trade_id: trade.id,
    event_type: "OPENED",
    payload: { fillPrice, qty: decision.sizing.qty, fee },
  });

  await logAudit(admin, actor, "paper_trade_opened", { signalId, tradeId: trade.id });

  return { kind: "EXECUTED", tradeId: trade.id };
}

export async function rejectSignalManually(signalId: string, actor: "dashboard" | "telegram"): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("signals")
    .update({ approval_status: "REJECTED", owner_decision_at: new Date().toISOString() } as never)
    .eq("id", signalId)
    .eq("approval_status", "PENDING");
  await logAudit(admin, actor, "signal_rejected_by_user", { signalId });
}

async function rejectSignal(admin: SupabaseClient<Database>, signalId: string, reason: RejectionReason) {
  await admin
    .from("signals")
    .update({ approval_status: "REJECTED", owner_decision_at: new Date().toISOString(), owner_rejection_reason: reason } as never)
    .eq("id", signalId)
    .eq("approval_status", "PENDING");
}

async function logAudit(
  admin: SupabaseClient<Database>,
  actor: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_events").insert({ actor, action, metadata: metadata as never });
}
