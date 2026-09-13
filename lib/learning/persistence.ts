import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { reviewTrade } from "@/lib/qwen/client";
import type { FactualTradeReview } from "./outcomes";

/** Facts are persisted before, and independently from, optional AI output. */
export async function persistFactualTradeReview(admin: SupabaseClient<Database>, tradeId: string, factualReview: FactualTradeReview): Promise<void> {
  await admin.from("trade_reviews").upsert({ trade_id: tradeId, factual_review: factualReview } as never, { onConflict: "trade_id" });
}

/** Best-effort and deduplicated. This has no authority over a trade or strategy. */
export async function queueAiPostTradeReview(admin: SupabaseClient<Database>, tradeId: string, input: Parameters<typeof reviewTrade>[0] & { factualReview: FactualTradeReview }): Promise<void> {
  const { data: existing } = await admin.from("trade_reviews").select("ai_summary").eq("trade_id", tradeId).maybeSingle();
  if (existing?.ai_summary) return;
  const result = await reviewTrade(input);
  if (result.status !== "OK") return;
  await admin.from("trade_reviews").upsert({ trade_id: tradeId, ai_summary: { label: "AI_INTERPRETATION", ...result.data }, ai_interpretation: { label: "AI_INTERPRETATION", ...result.data } } as never, { onConflict: "trade_id" });
}
