import { classifySession, JEANFX_DEFAULT_SESSION_WINDOWS, type SessionWindow } from "./primitives/sessions";
import type { TradingSession } from "@/lib/strategy-platform/types";

/**
 * SOURCE RULE (Risk Management table): "Max trades per session - 3".
 *
 * Previously `maxTradesPerSession: 3` existed in the parameter block and was
 * read by nothing: the limit was documented but never enforced, so a scanner
 * running every 5 minutes could open an unbounded number of trades in one
 * London session.
 *
 * Enforcement rules this module implements:
 *   - London and New York are counted SEPARATELY, each against its own
 *     allowance (they are distinct sessions in the source's model).
 *   - The count is derived from DURABLE trade records, never from in-memory
 *     scanner state, so repeated cron invocations cannot reset it.
 *   - A session instance is identified by (session, local calendar date in
 *     that session's own timezone), which is DST-safe: the IANA timezone
 *     resolves the correct local day across a transition without any manual
 *     clock shifting.
 *   - During the London/New York overlap a trade counts against EVERY
 *     session active at its timestamp. Counting it against only one would
 *     let an operator take 3 London trades and 3 more in the overlap hour.
 */

export type SessionTradeRecord = {
  /** Trade open time, ms epoch. */
  openedAt: number;
};

export type SessionInstanceKey = string; // `${session}:${localDate}`

export function sessionInstanceKey(session: TradingSession, ms: number, windows: SessionWindow[] = JEANFX_DEFAULT_SESSION_WINDOWS): SessionInstanceKey {
  const window = windows.find((w) => w.session === session);
  const timezone = window?.timezone ?? "UTC";
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return `${session}:${localDate}`;
}

/** Every session instance the given instant belongs to (an instant can be in both LONDON and NEW_YORK during the overlap). */
export function sessionInstancesAt(ms: number, windows: SessionWindow[] = JEANFX_DEFAULT_SESSION_WINDOWS): { session: TradingSession; key: SessionInstanceKey }[] {
  return classifySession(ms, windows).map((session) => ({ session, key: sessionInstanceKey(session, ms, windows) }));
}

export type SessionLimitDecision =
  | { allowed: true; counts: Record<SessionInstanceKey, number> }
  | { allowed: false; reasonCode: "SESSION_TRADE_LIMIT_REACHED" | "OUTSIDE_TRADED_SESSION"; session: TradingSession | null; count: number; limit: number };

/**
 * Decides whether a new trade may open at `now`, given the trades already
 * recorded for this (strategy, instrument, paper session) scope.
 *
 * @param existingTrades Durable trade records for the SAME scope the limit
 *   applies to. The caller is responsible for scoping the query; this
 *   function never widens it.
 * @param tradedSessions The sessions the configuration actually trades. An
 *   instant outside all of them is rejected, which is also how the Asian
 *   session stays liquidity CONTEXT rather than a tradeable session.
 */
export function checkSessionTradeLimit(
  now: number,
  existingTrades: SessionTradeRecord[],
  tradedSessions: TradingSession[],
  limit: number,
  windows: SessionWindow[] = JEANFX_DEFAULT_SESSION_WINDOWS,
): SessionLimitDecision {
  const active = sessionInstancesAt(now, windows).filter((i) => tradedSessions.includes(i.session));

  if (active.length === 0) {
    return { allowed: false, reasonCode: "OUTSIDE_TRADED_SESSION", session: null, count: 0, limit };
  }

  const counts: Record<SessionInstanceKey, number> = {};
  for (const instance of active) counts[instance.key] = 0;

  for (const trade of existingTrades) {
    for (const instance of sessionInstancesAt(trade.openedAt, windows)) {
      if (instance.key in counts) counts[instance.key] += 1;
    }
  }

  // Every active session instance must have room - during the overlap a new
  // trade consumes allowance in both.
  for (const instance of active) {
    if (counts[instance.key] >= limit) {
      return { allowed: false, reasonCode: "SESSION_TRADE_LIMIT_REACHED", session: instance.session, count: counts[instance.key], limit };
    }
  }

  return { allowed: true, counts };
}

/** Human-readable message for the frontend (spec S48) - never a bare 500. */
export function describeSessionLimitRejection(decision: Extract<SessionLimitDecision, { allowed: false }>): string {
  if (decision.reasonCode === "OUTSIDE_TRADED_SESSION") {
    return "Outside the trading sessions this configuration is enabled for.";
  }
  return `Maximum ${decision.limit} trades reached for the ${decision.session === "NEW_YORK" ? "New York" : "London"} session.`;
}
