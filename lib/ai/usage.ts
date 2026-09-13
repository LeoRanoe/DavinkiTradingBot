import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { QwenUsage } from "@/lib/qwen/client";

/**
 * AI usage accounting.
 *
 * Records requests and tokens only. NO dollar figure is stored: reliable
 * per-token pricing for the configured model is not known to this
 * application, and an invented cost would be worse than none - the owner
 * would make budget decisions on a fabricated number.
 *
 * Recording usage must never affect the caller: a failure here is swallowed,
 * because accounting is observability, not trading state.
 */
export type AiFeature =
  | "NEWS_ANALYSIS"
  | "CANDIDATE_CONTEXT"
  | "SIGNAL_EXPLANATION"
  | "TRADE_REVIEW"
  | "CONNECTION_TEST";

export type UsageRecord = {
  feature: AiFeature;
  success: boolean;
  usage?: QwenUsage;
  /** Coarse failure class. Never the raw provider message, which may echo input. */
  errorKind?: "NOT_CONFIGURED" | "AUTH" | "RATE_LIMIT" | "TIMEOUT" | "MALFORMED_OUTPUT" | "UNAVAILABLE";
};

export interface AiUsageRecorder {
  record(entry: UsageRecord): Promise<void>;
}

export function createAiUsageRecorder(client: SupabaseClient<Database>): AiUsageRecorder {
  return {
    async record(entry) {
      try {
        await client.from("ai_usage_events").insert({
          provider: "QWEN",
          model: entry.usage?.model ?? null,
          feature: entry.feature,
          success: entry.success,
          input_tokens: entry.usage?.inputTokens ?? null,
          output_tokens: entry.usage?.outputTokens ?? null,
          total_tokens: entry.usage?.totalTokens ?? null,
          latency_ms: entry.usage?.latencyMs ?? null,
          error_kind: entry.errorKind ?? null,
        });
      } catch {
        // Accounting must never break the feature it is measuring.
      }
    },
  };
}

/** A recorder that does nothing, for tests and for callers without a client. */
export const nullUsageRecorder: AiUsageRecorder = {
  async record() {
    /* no-op */
  },
};

/** Maps a provider error message to a coarse, non-echoing failure class. */
export function classifyAiError(message: string): NonNullable<UsageRecord["errorKind"]> {
  const lower = message.toLowerCase();
  if (lower.includes("authentication")) return "AUTH";
  if (lower.includes("rate limit")) return "RATE_LIMIT";
  if (lower.includes("timeout")) return "TIMEOUT";
  if (lower.includes("malformed") || lower.includes("non-json")) return "MALFORMED_OUTPUT";
  return "UNAVAILABLE";
}
