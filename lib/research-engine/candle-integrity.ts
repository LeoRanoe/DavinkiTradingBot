import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import type { CanonicalTimeframe } from "@/lib/domain/timeframe";

/**
 * Candle data-integrity validation (Checkpoint 3A §11). Run before any
 * historical trial. Never manufactures or interpolates data — only
 * reports what's wrong so the caller can decide whether the history is
 * usable.
 */
export type CandleIntegrityIssueReason =
  | "UNCLOSED_CANDLE"
  | "DUPLICATE_OPEN_TIME"
  | "OPEN_TIME_NOT_STRICTLY_INCREASING"
  | "NON_FINITE_OPEN"
  | "NON_FINITE_HIGH"
  | "NON_FINITE_LOW"
  | "NON_FINITE_CLOSE"
  | "NON_FINITE_VOLUME"
  | "HIGH_BELOW_OPEN_OR_CLOSE"
  | "LOW_ABOVE_OPEN_OR_CLOSE"
  | "HIGH_BELOW_LOW"
  | "NEGATIVE_VOLUME";

export type CandleIntegrityIssue = {
  index: number;
  openTime: number;
  reason: CandleIntegrityIssueReason;
};

export type CandleIntegrityReport = {
  valid: boolean;
  issues: readonly CandleIntegrityIssue[];
};

/**
 * Pure validation, no mutation. Checks (§11):
 *  - strictly increasing openTime
 *  - no duplicate openTimes
 *  - OHLC + volume finite
 *  - high >= max(open, close); low <= min(open, close); high >= low
 *  - volume >= 0
 *  - only closed bars (an unclosed candle anywhere in the array is an issue —
 *    callers doing a historical trial should never pass one in at all;
 *    this function still names it explicitly rather than silently
 *    filtering, so a caller who forgot to filter finds out).
 */
export function validateCandleIntegrity(candles: readonly CanonicalCandle[]): CandleIntegrityReport {
  const issues: CandleIntegrityIssue[] = [];
  const seenOpenTimes = new Set<number>();
  let previousOpenTime = -Infinity;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const push = (reason: CandleIntegrityIssueReason) => issues.push({ index: i, openTime: c.openTime, reason });

    if (!c.isClosed) push("UNCLOSED_CANDLE");

    if (seenOpenTimes.has(c.openTime)) {
      push("DUPLICATE_OPEN_TIME");
    } else if (c.openTime <= previousOpenTime) {
      push("OPEN_TIME_NOT_STRICTLY_INCREASING");
    }
    seenOpenTimes.add(c.openTime);
    previousOpenTime = c.openTime;

    if (!Number.isFinite(c.open)) push("NON_FINITE_OPEN");
    if (!Number.isFinite(c.high)) push("NON_FINITE_HIGH");
    if (!Number.isFinite(c.low)) push("NON_FINITE_LOW");
    if (!Number.isFinite(c.close)) push("NON_FINITE_CLOSE");
    if (!Number.isFinite(c.volume)) push("NON_FINITE_VOLUME");

    if (Number.isFinite(c.high) && Number.isFinite(c.open) && Number.isFinite(c.close)) {
      if (c.high < Math.max(c.open, c.close)) push("HIGH_BELOW_OPEN_OR_CLOSE");
    }
    if (Number.isFinite(c.low) && Number.isFinite(c.open) && Number.isFinite(c.close)) {
      if (c.low > Math.min(c.open, c.close)) push("LOW_ABOVE_OPEN_OR_CLOSE");
    }
    if (Number.isFinite(c.high) && Number.isFinite(c.low) && c.high < c.low) push("HIGH_BELOW_LOW");
    if (Number.isFinite(c.volume) && c.volume < 0) push("NEGATIVE_VOLUME");
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Candle-batch identity validation (Checkpoint 3A.1 §4). Separate from
 * `validateCandleIntegrity` (which checks each candle's own OHLCV
 * shape) — this checks that the BATCH, as a whole, is a legal input to a
 * single trial: one instrument, one timeframe, and that timeframe must
 * match the parameter set the caller intends to run against it (e.g. a
 * TRB-4H config must never silently run on 1H candles). Zero candles is
 * its own explicit, typed outcome — never conflated with "mixed" or
 * "mismatched" since neither claim is meaningful for an empty batch.
 */
export type CandleBatchIdentityIssueReason =
  | "ZERO_CANDLES"
  | "MIXED_INSTRUMENTS"
  | "MIXED_TIMEFRAMES"
  | "TIMEFRAME_MISMATCH_WITH_PARAM_SET";

export type CandleBatchIdentityIssue = {
  reason: CandleBatchIdentityIssueReason;
  details?: string;
};

export type CandleBatchIdentityReport = {
  valid: boolean;
  issue: CandleBatchIdentityIssue | null;
};

export function validateCandleBatchIdentity(
  candles: readonly CanonicalCandle[],
  expectedTimeframe: CanonicalTimeframe,
): CandleBatchIdentityReport {
  if (candles.length === 0) {
    return { valid: false, issue: { reason: "ZERO_CANDLES" } };
  }

  const instrumentIds = new Set(candles.map((c) => c.instrumentId));
  if (instrumentIds.size > 1) {
    return { valid: false, issue: { reason: "MIXED_INSTRUMENTS", details: [...instrumentIds].join(", ") } };
  }

  const timeframes = new Set(candles.map((c) => c.timeframe));
  if (timeframes.size > 1) {
    return { valid: false, issue: { reason: "MIXED_TIMEFRAMES", details: [...timeframes].join(", ") } };
  }

  const actualTimeframe = candles[0].timeframe;
  if (actualTimeframe !== expectedTimeframe) {
    return {
      valid: false,
      issue: {
        reason: "TIMEFRAME_MISMATCH_WITH_PARAM_SET",
        details: `candle batch timeframe=${actualTimeframe}, parameter set expects timeframe=${expectedTimeframe}`,
      },
    };
  }

  return { valid: true, issue: null };
}
