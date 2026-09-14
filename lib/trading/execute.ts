import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { getCandles, getTicker } from "@/lib/bybit/client";
import { getAppUrl } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/database.types";
import {
  formatApprovalRejectedMessage,
  formatOwnerRejectionMessage,
  formatPositionOpenedMessage,
  sendTelegramMessage,
} from "@/lib/telegram/client";
import {
  approveCandidate,
  rejectCandidateByOwner,
  type ApprovalResult,
  type ApprovalSource,
  type MarketDataPort,
  type RejectionResult,
} from "./approval";
import { createApprovalStore } from "./approval-store";

/**
 * Live Bybit market data for approval-time revalidation. Public endpoints
 * only - no credentials, and never an order-placement path.
 */
export const bybitMarketData: MarketDataPort = {
  async ticker(symbol) {
    const t = await getTicker(symbol);
    return { lastPrice: t.lastPrice, serverTimeMs: t.serverTimeMs };
  },
  async candles(symbol, timeframe, limit) {
    return getCandles(symbol, timeframe, limit);
  },
};

function sourceOf(actor: "dashboard" | "telegram"): ApprovalSource {
  return actor === "telegram" ? "TELEGRAM" : "DASHBOARD";
}

/**
 * The generic deterministic execution entrypoint shared by TELEGRAM,
 * DASHBOARD and AUTO.
 *
 * There is exactly one execution engine in this application. Whichever source
 * calls in, control reaches `approveCandidate`, which performs the atomic
 * claim, refetches the ticker and ATR, re-checks the entry range, expiry,
 * volatility, risk sizing, exchange metadata, available balance, daily
 * limits, the loss lock, the open-position limit, the min-order risk conflict
 * and duplicate protection - against state read at that moment.
 *
 * AUTO therefore changes WHO may authorize execution and nothing about WHAT
 * is checked. It is not a fast path and cannot skip a single gate above.
 */
export async function executeCandidate(
  signalId: string,
  source: ApprovalSource,
  scopedClient?: SupabaseClient<Database>,
): Promise<ApprovalResult> {
  const client = scopedClient ?? createAdminClient();
  return approveCandidate(signalId, source, {
    store: createApprovalStore(client),
    market: bybitMarketData,
  });
}

/**
 * The single path that turns an approved candidate into a PAPER position,
 * used by BOTH the dashboard button and the Telegram callback.
 *
 * Approval is a REQUEST, never execution authority: `approveCandidate`
 * atomically claims the candidate and then re-runs the complete
 * deterministic pipeline against fresh market data, current settings,
 * current account state and current exchange rules before anything opens.
 */
export async function approveAndExecuteSignal(
  signalId: string,
  actor: "dashboard" | "telegram",
  scopedClient?: SupabaseClient<Database>,
): Promise<ApprovalResult> {
  const client = scopedClient ?? createAdminClient();
  const result = await executeCandidate(signalId, sourceOf(actor), client);

  // Notifications are strictly secondary: execution state is already
  // committed at this point, so a Telegram failure can never re-open or
  // unwind a position.
  if (result.kind === "EXECUTED") {
    const { candidate } = result;
    await sendTelegramMessage(
      formatPositionOpenedMessage({
        symbol: candidate.symbol,
        entryPrice: candidate.position.referencePrice,
        qty: candidate.risk.roundedQuantity,
        stopPrice: candidate.position.stopPrice,
        targetPrice: candidate.position.targetPrice,
        modeledMaxLoss: candidate.risk.modeledMaxLoss,
      }),
    ).catch(() => undefined);
  } else if (result.kind === "REJECTED") {
    const { data: signal } = await client.from("signals").select("symbol").eq("id", signalId).maybeSingle();
    await sendTelegramMessage(
      formatApprovalRejectedMessage({
        symbol: signal?.symbol ?? "candidate",
        reason: result.reason,
        detail: result.detail,
      }),
    ).catch(() => undefined);
  }

  return result;
}

/** Owner REJECT, from either surface. Atomic; never opens a position. */
export async function rejectSignalManually(
  signalId: string,
  actor: "dashboard" | "telegram",
  scopedClient?: SupabaseClient<Database>,
): Promise<RejectionResult> {
  const client = scopedClient ?? createAdminClient();
  const store = createApprovalStore(client);

  const result = await rejectCandidateByOwner(signalId, sourceOf(actor), { store });

  if (result.kind === "REJECTED_BY_OWNER" && actor === "telegram") {
    await sendTelegramMessage(formatOwnerRejectionMessage(result.symbol)).catch(() => undefined);
  }

  return result;
}

export { getAppUrl };
