import type { RejectionReason } from "./types";

/**
 * "No chasing" protection (Milestone 1). Crypto moves fast between the
 * closed candle a signal was scored off and the moment a candidate is
 * actually reviewed/approved. Every candidate carries an explicit allowed
 * entry zone around the planned entry, a market-data freshness bound, and a
 * short expiration - an old candidate price is never treated as executable
 * later.
 */
export type EntryProtectionConfig = {
  /** Max allowed drift of the reference price from the planned entry, e.g. 0.0015 for 0.15%. */
  maxEntryDriftPct: number;
  /** How long a freshly built candidate stays actionable before it must be rebuilt. */
  candidateExpiryMinutes: number;
  /** How stale the market data feeding the candidate is allowed to be. */
  maxMarketDataAgeMs: number;
};

export type EntryZone = {
  plannedEntry: number;
  minimumAllowedEntry: number;
  maximumAllowedEntry: number;
};

/** Symmetric allowed entry band around the planned entry, spec's "allowed entry zone". */
export function computeEntryZone(plannedEntry: number, maxEntryDriftPct: number): EntryZone {
  const drift = plannedEntry * maxEntryDriftPct;
  return {
    plannedEntry,
    minimumAllowedEntry: plannedEntry - drift,
    maximumAllowedEntry: plannedEntry + drift,
  };
}

export function computeExpiry(createdAtMs: number, candidateExpiryMinutes: number): number {
  return createdAtMs + candidateExpiryMinutes * 60_000;
}

/**
 * Checks a fresh reference price against a candidate's allowed entry zone,
 * market-data freshness, and expiration - all before the risk engine is ever
 * called. Never delegated to Qwen; purely deterministic.
 */
export function checkEntryProtection(input: {
  referencePrice: number;
  marketDataTimestampMs: number;
  zone: EntryZone;
  createdAtMs: number;
  expiresAtMs: number;
  nowMs: number;
  maxMarketDataAgeMs: number;
}): RejectionReason | null {
  const { referencePrice, marketDataTimestampMs, zone, expiresAtMs, nowMs, maxMarketDataAgeMs } = input;

  if (nowMs > expiresAtMs) {
    return "CANDIDATE_EXPIRED";
  }
  if (nowMs - marketDataTimestampMs > maxMarketDataAgeMs) {
    return "STALE_MARKET_DATA";
  }
  if (referencePrice < zone.minimumAllowedEntry || referencePrice > zone.maximumAllowedEntry) {
    return "ENTRY_OUTSIDE_ALLOWED_RANGE";
  }
  return null;
}
