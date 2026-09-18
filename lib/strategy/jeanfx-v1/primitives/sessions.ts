import type { TradingSession } from "@/lib/strategy-platform/types";

/**
 * Session classification - SOURCE RULE: the brief names Asian/London/New
 * York sessions (docs/strategies/jeanfx-v1-spec.md S9). The exact clock
 * windows below are an IMPLEMENTATION ASSUMPTION pending review.
 *
 * DST-aware by construction: `Intl.DateTimeFormat` with an IANA `timeZone`
 * resolves the correct local hour for any instant using the runtime's own
 * tz database, so a session's local start/end hour never needs to be
 * manually shifted for a DST transition.
 */
export type SessionWindow = {
  session: TradingSession;
  timezone: string; // IANA tz name, e.g. "Europe/London"
  startLocalHour: number; // inclusive, 0-23
  endLocalHour: number; // exclusive, 0-23
};

export const JEANFX_DEFAULT_SESSION_WINDOWS: SessionWindow[] = [
  { session: "ASIA", timezone: "Asia/Tokyo", startLocalHour: 0, endLocalHour: 9 },
  { session: "LONDON", timezone: "Europe/London", startLocalHour: 8, endLocalHour: 17 },
  { session: "NEW_YORK", timezone: "America/New_York", startLocalHour: 8, endLocalHour: 17 },
];

function localHour(ms: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
  const parts = formatter.formatToParts(new Date(ms));
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = Number.parseInt(hourPart, 10);
  // en-US "hour: numeric, hour12: false" can report 24 for midnight in some ICU versions.
  return hour === 24 ? 0 : hour;
}

function inWindow(hour: number, window: SessionWindow): boolean {
  if (window.startLocalHour <= window.endLocalHour) {
    return hour >= window.startLocalHour && hour < window.endLocalHour;
  }
  // Overnight wraparound window (not used by the defaults above, supported for completeness).
  return hour >= window.startLocalHour || hour < window.endLocalHour;
}

/** All sessions active at the given instant (an instant can be in more than one, e.g. LONDON + NEW_YORK overlap). */
export function classifySession(ms: number, windows: SessionWindow[] = JEANFX_DEFAULT_SESSION_WINDOWS): TradingSession[] {
  return windows.filter((w) => inWindow(localHour(ms, w.timezone), w)).map((w) => w.session);
}
