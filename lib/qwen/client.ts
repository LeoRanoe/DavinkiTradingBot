import { getQwenConfiguration } from "@/lib/config/integrations";
import { qwenSignalExplanationSchema, qwenTradeReviewSchema, qwenPostTradeReviewSchema, type QwenSignalExplanation, type QwenTradeReview, type QwenPostTradeReview } from "./schemas";
import { qwenNewsAnalysisSchema, type QwenNewsAnalysis } from "./news-schema";

export type QwenStatus = "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE";

/** Token accounting reported by the provider, when it reports any. */
export type QwenUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
};

export type QwenResult<T> =
  | { status: "OK"; data: T; usage?: QwenUsage }
  | { status: "NOT_CONFIGURED" }
  | { status: "ERROR"; message: string; usage?: QwenUsage };

/**
 * Qwen client interface. The trading engine never depends on this returning
 * successfully - every caller must handle NOT_CONFIGURED/ERROR by simply
 * omitting the AI explanation, never by blocking a trade or a page render.
 *
 * Uses an OpenAI-compatible chat completions endpoint (DashScope/Model
 * Studio compatible mode) with JSON-mode structured output, re-validated
 * with Zod before anything downstream trusts it.
 */
async function callQwen(systemPrompt: string, userPrompt: string): Promise<QwenResult<unknown>> {
  const config = await getQwenConfiguration();
  if (!config) return { status: "NOT_CONFIGURED" };

  const startedAt = Date.now();
  const usageOf = (raw: unknown): QwenUsage => {
    const u = (raw as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined) ?? {};
    return {
      model: config.model,
      inputTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
      outputTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null,
      totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : null,
      latencyMs: Date.now() - startedAt,
    };
  };
  const failed = (message: string): QwenResult<unknown> => ({
    status: "ERROR",
    message,
    usage: usageOf(undefined),
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });
    clearTimeout(timeout);

    if (res.status === 401 || res.status === 403) {
      return failed("Authentication failed");
    }
    if (res.status === 429) {
      return failed("Rate limited");
    }
    if (!res.ok) {
      return failed(`Provider unavailable (HTTP ${res.status})`);
    }

    const json = await res.json();
    const usage = usageOf(json?.usage);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return { status: "ERROR", message: "Empty response from provider", usage };

    try {
      return { status: "OK", data: JSON.parse(content), usage };
    } catch {
      // The model returned something that is not JSON at all. Never eval it,
      // never store it - report a clean failure.
      return { status: "ERROR", message: "Provider returned non-JSON content", usage };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return failed(message.includes("abort") ? "Provider unavailable (timeout)" : message);
  }
}

const SIGNAL_SYSTEM_PROMPT = `You are a trading coach explaining a DETERMINISTIC signal that was already
computed by application code. You do not decide trades and you must never
invent market numbers - only reference numbers given to you in the prompt.
Respond as JSON: { "summary": string, "notes": [{ "kind": "FACT"|"INTERPRETATION"|"EDUCATIONAL_NOTE"|"RISK", "text": string }], "lesson": string }.
Use plain, factual language. Never say "guaranteed," "safe," or "certain."`;

export async function explainSignal(input: {
  symbol: string;
  score: number;
  classification: string;
  regime: string;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  riskReward: number | null;
}): Promise<QwenResult<QwenSignalExplanation>> {
  const result = await callQwen(SIGNAL_SYSTEM_PROMPT, JSON.stringify(input));
  if (result.status !== "OK") return result;
  const parsed = qwenSignalExplanationSchema.safeParse(result.data);
  if (!parsed.success) return { status: "ERROR", message: "Provider returned malformed structured output" };
  return { status: "OK", data: parsed.data };
}

const REVIEW_SYSTEM_PROMPT = `You are a trading coach reviewing a CLOSED trade whose outcome was already
computed deterministically. Distinguish a valid losing trade (rules followed,
outcome still negative) from a rule violation or a failed strategy assumption.
Avoid hindsight language like "should have obviously known." Respond as JSON:
{ "summary": string, "notes": [...], "classification": "VALID_LOSS"|"VALID_WIN"|"RULE_VIOLATION"|"STRATEGY_ASSUMPTION_FAILED", "lesson": string }.`;

export async function reviewTrade(input: {
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  pnl: number;
  rMultiple: number;
  outcome: string;
}): Promise<QwenResult<QwenTradeReview>> {
  const result = await callQwen(REVIEW_SYSTEM_PROMPT, JSON.stringify(input));
  if (result.status !== "OK") return result;
  const parsed = qwenTradeReviewSchema.safeParse(result.data);
  if (!parsed.success) return { status: "ERROR", message: "Provider returned malformed structured output" };
  return { status: "OK", data: parsed.data };
}

const POST_TRADE_REVIEW_SYSTEM_PROMPT = `You review deterministic, already-settled PAPER trade facts. Return only AI INTERPRETATION and HYPOTHESES; never claim a supplied fact as your own, change risk, change parameters, activate a strategy, or decide execution. Avoid hindsight. Respond as JSON: {"summary":string,"observations":string[],"hypotheses":string[],"confidence":number,"dataLimitations":string[]}.`;

export async function reviewPostTrade(input: Record<string, unknown>): Promise<QwenResult<QwenPostTradeReview>> {
  const result = await callQwen(POST_TRADE_REVIEW_SYSTEM_PROMPT, JSON.stringify(input));
  if (result.status !== "OK") return result;
  const parsed = qwenPostTradeReviewSchema.safeParse(result.data);
  if (!parsed.success) return { status: "ERROR", message: "Provider returned malformed structured output", usage: result.usage };
  return { status: "OK", data: parsed.data, usage: result.usage };
}

const NEWS_SYSTEM_PROMPT = `You analyse a single news item for a deterministic crypto trading system.
You provide CONTEXT ONLY. You never decide trades, position sizes, stops, targets or entries,
and nothing you output can authorise or block an order.
Judge how much EVENT RISK / UNCERTAINTY the item introduces - this is NOT a buy or sell view.
Be conservative: if the item is speculation, rumour or commentary, say so in "uncertainty" and
keep potentialImpact LOW or UNKNOWN. Only use HIGH for a concrete, confirmed, market-wide event.
Never invent prices, numbers, dates or facts that are not in the input.
Respond as JSON only:
{ "summary": string, "affectedAssets": ("BTC"|"ETH"|"CRYPTO_MARKET"|"USD"|"MACRO"|"XAUUSD")[],
  "sentiment": "POSITIVE"|"NEGATIVE"|"MIXED"|"NEUTRAL"|"UNKNOWN",
  "potentialImpact": "LOW"|"MEDIUM"|"HIGH"|"UNKNOWN",
  "timeHorizon": "IMMEDIATE"|"SHORT_TERM"|"MEDIUM_TERM"|"UNKNOWN",
  "relevance": number between 0 and 1, "reasoning": string, "uncertainty": string }`;

/**
 * Analyses one news event. Called only for items the DETERMINISTIC
 * classifier already judged relevant and potentially material, and only
 * once per event - see lib/news/classify.ts and the analysis cache.
 */
export async function analyzeNewsEvent(input: {
  headline: string;
  source: string;
  sourceQuality: string;
  category: string;
  publishedAt: string;
  excerpt: string | null;
}): Promise<QwenResult<QwenNewsAnalysis>> {
  const result = await callQwen(NEWS_SYSTEM_PROMPT, JSON.stringify(input));
  if (result.status !== "OK") return result;

  const parsed = qwenNewsAnalysisSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      status: "ERROR",
      message: "Provider returned malformed structured output",
      usage: result.usage,
    };
  }
  return { status: "OK", data: parsed.data, usage: result.usage };
}

/** Cheap connectivity check for the Settings -> Connections "Test connection" button. */
export async function testQwenConnection(): Promise<QwenResult<{ model: string }>> {
  const config = await getQwenConfiguration();
  if (!config) return { status: "NOT_CONFIGURED" };
  const result = await callQwen(
    "Respond with JSON only: {\"ok\": true}",
    "ping",
  );
  if (result.status === "OK") return { status: "OK", data: { model: config.model } };
  return result;
}
