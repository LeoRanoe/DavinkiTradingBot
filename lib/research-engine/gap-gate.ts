import type { HistoricalLoadResult } from "./historical-loader";

/**
 * Real-trial gap gating (Checkpoint 3A.1 §5). Deliberately lives OUTSIDE
 * the generic engine (engine.ts has no calendar awareness and should
 * not gain any) — this is specifically about whether a loaded history is
 * fit to ENTER a real historical trial, for a CRYPTO_24_7 market
 * specifically, where "no gaps" is the expected baseline (crypto spot
 * trades continuously, unlike an equities/forex session calendar).
 *
 * Never interpolates or manufactures candles to close a gap — a gap
 * either blocks the trial, or an explicit reviewed exception is supplied
 * by the caller (never inferred or defaulted).
 */
export type AssetCalendarClass = "CRYPTO_24_7" | "SESSIONED";

export type GapGateInput = Pick<HistoricalLoadResult, "gaps" | "truncated">;

export type GapGateOptions = {
  assetCalendarClass: AssetCalendarClass;
  /**
   * A human-reviewed, explicit reason to proceed despite detected gaps
   * (e.g. a documented venue outage). Must never be inferred, defaulted,
   * or auto-generated — its presence alone is what makes it an
   * "exception", so an empty/falsy string does not count as one.
   */
  reviewedGapException?: string;
};

export type GapGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; gapCount: number };

export function checkRealTrialGapGate(input: GapGateInput, options: GapGateOptions): GapGateResult {
  if (options.assetCalendarClass !== "CRYPTO_24_7") {
    // §5 scopes this rule to CRYPTO_24_7 specifically - a sessioned
    // market (forex, equities) legitimately has calendar gaps and needs
    // a different (not-yet-built) gate, not this one.
    return { allowed: true };
  }

  if (input.truncated) {
    return {
      allowed: false,
      gapCount: input.gaps.length,
      reason:
        "Historical load was truncated (maxPages reached) before the requested range was fully covered. " +
        "A truncated load can hide gaps beyond the covered range and must never enter a real trial.",
    };
  }

  if (input.gaps.length > 0) {
    if (!options.reviewedGapException) {
      return {
        allowed: false,
        gapCount: input.gaps.length,
        reason:
          `${input.gaps.length} candle gap(s) detected in a CRYPTO_24_7 history and no reviewedGapException was ` +
          "supplied. Crypto spot trades continuously, so an unexplained gap is a data-quality defect, not a " +
          "calendar artifact - it must block the trial pending an explicit reviewed exception. Never interpolate " +
          "or manufacture candles to close it.",
      };
    }
  }

  return { allowed: true };
}

/** Throwing variant for call sites that want to fail hard rather than branch on the result. */
export function assertRealTrialGapGate(input: GapGateInput, options: GapGateOptions): void {
  const result = checkRealTrialGapGate(input, options);
  if (!result.allowed) {
    throw new Error(`assertRealTrialGapGate: ${result.reason}`);
  }
}
