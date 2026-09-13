import { getQwenConfiguration } from "@/lib/config/integrations";
import { qwenSignalExplanationSchema, qwenTradeReviewSchema, type QwenSignalExplanation, type QwenTradeReview } from "./schemas";

export type QwenStatus = "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE";

export type QwenResult<T> =
  | { status: "OK"; data: T }
  | { status: "NOT_CONFIGURED" }
  | { status: "ERROR"; message: string };

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
      return { status: "ERROR", message: "Authentication failed" };
    }
    if (res.status === 429) {
      return { status: "ERROR", message: "Rate limited" };
    }
    if (!res.ok) {
      return { status: "ERROR", message: `Provider unavailable (HTTP ${res.status})` };
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return { status: "ERROR", message: "Empty response from provider" };

    return { status: "OK", data: JSON.parse(content) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { status: "ERROR", message: message.includes("abort") ? "Provider unavailable (timeout)" : message };
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
