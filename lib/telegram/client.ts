import { getTelegramConfiguration } from "@/lib/config/integrations";

export type TelegramResult = { ok: true } | { ok: false; reason: "NOT_CONFIGURED" | "ERROR"; message?: string };

const API_BASE = "https://api.telegram.org";

/**
 * Sends a message to the configured owner chat. Telegram is a notification
 * surface only - it is never on the path that authorizes a trade. Silently
 * degrades (returns NOT_CONFIGURED) when no bot token is set; callers must
 * never treat that as an error worth failing the scan/trade over.
 */
export async function sendTelegramMessage(
  text: string,
  options?: { replyMarkup?: unknown },
): Promise<TelegramResult> {
  const config = await getTelegramConfiguration();
  if (!config) return { ok: false, reason: "NOT_CONFIGURED" };

  try {
    const res = await fetch(`${API_BASE}/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: options?.replyMarkup,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, reason: "ERROR", message: `Telegram API error ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "ERROR", message: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Formats a CANDIDATE signal notification. Kept short - detail lives in the dashboard. */
export function formatCandidateMessage(input: {
  symbol: string;
  score: number;
  regime: string;
  riskAmount: number;
  riskReward: number | null;
  reason: string;
}): string {
  const lines = [
    `*${input.symbol}*`,
    `Candidate • ${input.score}/100`,
    `1H regime: ${input.regime}`,
    `Risk: $${input.riskAmount.toFixed(2)}`,
    input.riskReward !== null ? `R/R: ${input.riskReward.toFixed(1)}` : undefined,
    "",
    input.reason,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function verifyTelegramWebhookSecret(headerValue: string | null): Promise<boolean> {
  const config = await getTelegramConfiguration();
  if (!config || !config.webhookSecret) return false;
  return headerValue === config.webhookSecret;
}

export async function isAuthorizedTelegramUser(userId: string | number): Promise<boolean> {
  const config = await getTelegramConfiguration();
  if (!config) return false;
  return String(userId) === String(config.ownerUserId);
}
