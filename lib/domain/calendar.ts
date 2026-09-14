import type { Instrument } from "./instrument";

/**
 * Generic trading-calendar abstraction (CLAUDE.md §9). Deliberately not a
 * full holiday/DST database — just enough that strategy/scanner design no
 * longer assumes every market trades 24/7.
 */
export function isMarketOpen(calendarId: Instrument["tradingCalendarId"], atMs: number): boolean {
  if (calendarId === "CRYPTO_24_7") return true;

  // FX_24_5: closed roughly Fri 22:00 UTC -> Sun 22:00 UTC (a standard,
  // simplified approximation of the interbank FX week; real session/holiday
  // handling is future work per CLAUDE.md §9, not implemented here).
  const d = new Date(atMs);
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  const hour = d.getUTCHours();
  if (day === 6) return false; // all Saturday
  if (day === 0 && hour < 22) return false; // Sunday before 22:00 UTC
  if (day === 5 && hour >= 22) return false; // Friday from 22:00 UTC
  return true;
}
