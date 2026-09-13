import { getTelegramConfiguration } from "@/lib/config/integrations";
import type { TradeCandidate } from "@/lib/candidates/types";
import type { ClosedPosition } from "@/lib/trading/position-manager";
import type { CandidateNewsContext } from "@/lib/news/types";

export type TelegramResult = { ok: true } | { ok: false; reason: "NOT_CONFIGURED" | "ERROR"; message?: string };

const API_BASE = "https://api.telegram.org";

/**
 * Sends a message to the configured owner chat. Telegram is a notification
 * and request surface only - it is never execution authority. Silently
 * degrades (returns NOT_CONFIGURED) when no bot token is set; callers must
 * never treat that as an error worth failing a scan or a trade over.
 *
 * Messages default to PLAIN TEXT. The values we send include strings like
 * `EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50`, whose underscores Telegram's
 * Markdown parser would treat as formatting and reject or mangle - so
 * formatting is opt-in rather than the default.
 */
export async function sendTelegramMessage(
  text: string,
  options?: { replyMarkup?: unknown; parseMode?: "Markdown" | "HTML" },
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
        parse_mode: options?.parseMode,
        reply_markup: options?.replyMarkup,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      // Never include the bot token in an error surfaced to logs or the UI.
      return { ok: false, reason: "ERROR", message: `Telegram API error ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "ERROR", message: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Acknowledges a button press so Telegram stops showing the spinner. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const config = await getTelegramConfiguration();
  if (!config) return;
  try {
    await fetch(`${API_BASE}/bot${config.botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text?.slice(0, 200) }),
    });
  } catch {
    // An un-acknowledged button is cosmetic; never let it affect execution.
  }
}

function money(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return `${value < 0 ? "-" : ""}$${abs.toFixed(digits)}`;
}

function price(value: number): string {
  return `$${value.toFixed(value >= 100 ? 2 : 4)}`;
}

/**
 * The actionable candidate recommendation. Every number here comes from the
 * persisted, deterministically-calculated candidate - nothing is estimated
 * or placeholder. The news section is omitted entirely when no news context
 * was produced, and never padded with invented analysis.
 */
export function formatCandidateMessage(input: {
  candidate: TradeCandidate;
  riskModeLabel: string;
  validForMinutes: number;
  /** Milestone 3 context. Omitted entirely when the news layer never ran. */
  news?: CandidateNewsContext;
}): string {
  const { candidate: c } = input;
  const rr = c.position.riskReward;

  return [
    `${c.symbol} - PAPER TRADE CANDIDATE`,
    "",
    `${c.side}`,
    "",
    `Score        ${c.strategyScore} / 100`,
    `Entry        ${price(c.position.referencePrice)}`,
    `Allowed      ${price(c.position.minimumAllowedEntry)} - ${price(c.position.maximumAllowedEntry)}`,
    `Stop         ${price(c.position.stopPrice)}  (${(c.position.stopPct * 100).toFixed(2)}%)`,
    `Target       ${price(c.position.targetPrice)}`,
    `R/R          ${rr.toFixed(2)}`,
    "",
    "- - - ACCOUNT / RISK - - -",
    "",
    `Equity               ${money(c.risk.equity)}`,
    `Risk mode            ${input.riskModeLabel}`,
    `Risk budget          ${money(c.risk.riskBudget)}`,
    `Estimated risk       ${money(c.risk.estimatedActualRisk)}`,
    `Position size        ${money(c.risk.positionNotional)}`,
    `Quantity             ${c.risk.roundedQuantity}`,
    `Modeled max loss     ${money(c.risk.modeledMaxLoss)}`,
    `Target profit        ${money(c.risk.estimatedTargetProfit)}`,
    "",
    "- - - MARKET - - -",
    "",
    `1H regime      ${c.marketRegime}`,
    `Volatility     ${c.volatilityState}`,
    `Strategy       ${c.strategyVersionLabel}`,
    ...newsSection(input.news),
    "",
    `Valid for      ${input.validForMinutes} minutes`,
    "",
    "Approving re-checks everything against fresh market data before anything opens.",
  ].join("\n");
}

function relativeAge(fromIso: string, toIso: string): string {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/**
 * Concise news context. Kept short on purpose - Telegram is an approval
 * surface, not a newsfeed - and never padded with placeholder analysis.
 * News is context: it does not gate approval and does not alter any number
 * above it.
 */
function newsSection(news: CandidateNewsContext | undefined): string[] {
  if (!news) return [];

  const lines = ["", "- - - NEWS - - -", "", `Risk           ${news.newsRisk}`];

  if (news.status === "UNAVAILABLE") {
    lines.push(
      "",
      "News analysis temporarily unavailable.",
      "Technical and risk checks are independent and unaffected.",
    );
    return lines;
  }

  if (news.status === "NO_RELEVANT_EVENTS") {
    lines.push("", "No major relevant recent events found.");
    return lines;
  }

  if (news.headline) lines.push("", `Context        ${news.headline}`);

  for (const event of news.events.slice(0, 2)) {
    lines.push(`  - ${event.headline} (${event.source})`);
  }

  const newest = news.events[0];
  if (newest) lines.push("", `Updated        ${relativeAge(newest.publishedAt, news.generatedAt)}`);

  return lines;
}

/** APPROVE / REJECT callback buttons plus a VIEW deep link into the app. */
export function buildCandidateKeyboard(signalId: string, appUrl: string | null) {
  const row: Array<{ text: string; callback_data?: string; url?: string }> = [
    { text: "APPROVE", callback_data: `approve:${signalId}` },
    { text: "REJECT", callback_data: `reject:${signalId}` },
  ];
  if (appUrl) row.push({ text: "VIEW", url: `${appUrl.replace(/\/$/, "")}/signals/${signalId}` });
  return { inline_keyboard: [row] };
}

export function formatApprovalRejectedMessage(input: {
  symbol: string;
  reason: string;
  detail: string;
}): string {
  const headline =
    input.reason === "ENTRY_OUTSIDE_ALLOWED_RANGE"
      ? "Trade cancelled. Price moved outside the allowed entry range. The bot will wait for another setup."
      : input.detail;

  return [`Trade cancelled - ${input.symbol}`, "", `Reason: ${input.reason}`, "", headline].join("\n");
}

export function formatOwnerRejectionMessage(symbol: string): string {
  return [`Candidate rejected - ${symbol}`, "", "No position was opened."].join("\n");
}

export function formatPositionOpenedMessage(input: {
  symbol: string;
  entryPrice: number;
  qty: number;
  stopPrice: number;
  targetPrice: number;
  modeledMaxLoss: number;
}): string {
  return [
    `PAPER POSITION OPENED - ${input.symbol}`,
    "",
    `Entry        ${price(input.entryPrice)}`,
    `Quantity     ${input.qty}`,
    `Stop         ${price(input.stopPrice)}`,
    `Target       ${price(input.targetPrice)}`,
    `Max loss     ${money(input.modeledMaxLoss)}`,
    "",
    "The bot manages this position automatically from here.",
  ].join("\n");
}

/** The closed-position result. Factual, never celebratory. */
export function formatTradeClosedMessage(closed: ClosedPosition, strategyLabel: string): string {
  const header = closed.exitReason === "TARGET" ? "PAPER TARGET HIT" : "PAPER STOP HIT";
  const sign = closed.netPnl >= 0 ? "+" : "";

  return [
    `${header} - ${closed.symbol}`,
    "",
    `Entry        ${price(closed.entryPrice)}`,
    `Exit         ${price(closed.exitPrice)}`,
    `Result       ${sign}${money(closed.netPnl)}`,
    `R            ${sign}${closed.realizedR.toFixed(2)}R`,
    `Fees         ${money(closed.totalFees)}`,
    `Slippage     ${money(closed.realizedSlippage)}`,
    `New equity   ${money(closed.equityAfter)}`,
    `Strategy     ${strategyLabel}`,
  ].join("\n");
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

/**
 * The chat a callback arrived in must be the configured owner chat. Without
 * this, a correct owner user id pressed in some other chat the bot was added
 * to would still be honored.
 */
export async function isAuthorizedTelegramChat(chatId: string | number | undefined | null): Promise<boolean> {
  const config = await getTelegramConfiguration();
  if (!config || !config.chatId) return false;
  if (chatId === undefined || chatId === null) return false;
  return String(chatId) === String(config.chatId);
}

/** Parses `action:uuid` callback data. The id is an opaque UUID - never a price or a secret. */
export function parseCallbackData(data: unknown): { action: "approve" | "reject"; signalId: string } | null {
  if (typeof data !== "string") return null;
  const match = /^(approve|reject):([0-9a-fA-F-]{36})$/.exec(data.trim());
  if (!match) return null;
  return { action: match[1] as "approve" | "reject", signalId: match[2] };
}
