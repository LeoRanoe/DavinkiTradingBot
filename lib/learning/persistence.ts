import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { reviewPostTrade } from "@/lib/qwen/client";
import { createAiUsageRecorder, classifyAiError } from "@/lib/ai/usage";
import type { FactualTradeReview } from "./outcomes";
import type { ClosedPosition } from "@/lib/trading/position-manager";

/** Facts are persisted before, and independently from, optional AI output. */
export async function persistFactualTradeReview(admin: SupabaseClient<Database>, tradeId: string, factualReview: FactualTradeReview): Promise<void> {
  await admin.from("trade_reviews").upsert({ trade_id: tradeId, factual_review: factualReview } as never, { onConflict: "trade_id" });
}

/** Best-effort and deduplicated. This has no authority over a trade or strategy. */
export async function queueAiPostTradeReview(admin: SupabaseClient<Database>, tradeId: string, input: { factualReview: FactualTradeReview; symbol: string; entryPrice: number; exitPrice: number; stopPrice: number; targetPrice: number; pnl: number; rMultiple: number; newsRisk: string | null }): Promise<void> {
  const { data: existing } = await admin.from("trade_reviews").select("ai_summary").eq("trade_id", tradeId).maybeSingle();
  if (existing?.ai_summary) return;
  const recorder = createAiUsageRecorder(admin);
  const result = await reviewPostTrade(input);
  if (result.status !== "OK") {
    await recorder.record({ feature: "TRADE_REVIEW", success: false, usage: "usage" in result ? result.usage : undefined, errorKind: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : classifyAiError(result.message) });
    return;
  }
  await recorder.record({ feature: "TRADE_REVIEW", success: true, usage: result.usage });
  await admin.from("trade_reviews").upsert({ trade_id: tradeId, ai_summary: { label: "AI_INTERPRETATION", ...result.data }, ai_interpretation: { label: "AI_INTERPRETATION", ...result.data } } as never, { onConflict: "trade_id" });
}

/** Called only after the atomic settlement and equity snapshot succeeded. */
export async function captureClosedTradeLearning(admin: SupabaseClient<Database>, closed: ClosedPosition): Promise<void> {
  const { data: trade } = await admin.from("trades").select("signal_id, stop_price, target_price").eq("id", closed.tradeId).maybeSingle();
  const { data: signal } = trade?.signal_id
    ? await admin.from("signals").select("planned_entry, approved_at, news_risk").eq("id", trade.signal_id).maybeSingle()
    : { data: null };
  const factualReview: FactualTradeReview = {
    label: "FACT", plannedR: closed.entryPrice > (trade?.stop_price ?? 0) ? ((trade?.target_price ?? closed.entryPrice) - closed.entryPrice) / (closed.entryPrice - (trade?.stop_price ?? 0)) : null,
    realizedR: closed.realizedR, grossPnl: closed.grossPnl, netPnl: closed.netPnl, fees: closed.totalFees, slippage: closed.realizedSlippage,
    durationMinutes: closed.openedAt && closed.closedAt ? Math.max(0, (new Date(closed.closedAt).getTime() - new Date(closed.openedAt).getTime()) / 60_000) : null,
    approvalDelayMinutes: signal?.approved_at && closed.openedAt ? Math.max(0, (new Date(closed.openedAt).getTime() - new Date(signal.approved_at).getTime()) / 60_000) : null,
    entryDriftPct: signal?.planned_entry ? (closed.entryPrice - signal.planned_entry) / signal.planned_entry : null,
    exitReason: closed.exitReason,
    excursions: { mfePrice: closed.mfePrice ?? 0, maePrice: closed.maePrice ?? 0, mfePct: closed.entryPrice ? (closed.mfePrice ?? 0) / closed.entryPrice : 0, maePct: closed.entryPrice ? (closed.maePrice ?? 0) / closed.entryPrice : 0, mfeR: closed.mfeR ?? null, maeR: closed.maeR ?? null },
  };
  await persistFactualTradeReview(admin, closed.tradeId, factualReview);
  void queueAiPostTradeReview(admin, closed.tradeId, {
    factualReview, symbol: closed.symbol, entryPrice: closed.entryPrice, exitPrice: closed.exitPrice,
    stopPrice: trade?.stop_price ?? 0, targetPrice: trade?.target_price ?? 0, pnl: closed.netPnl,
    rMultiple: closed.realizedR, newsRisk: signal?.news_risk ?? null,
  });
}
