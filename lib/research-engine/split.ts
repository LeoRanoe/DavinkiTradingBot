import type { CanonicalCandle } from "@/lib/domain/market-data-provider";

/**
 * Deterministic chronological splitting (Checkpoint 3A §18). 60%
 * DEVELOPMENT / 20% VALIDATION / 20% HOLDOUT, by candle COUNT in
 * chronological order — never randomized, never shuffled. Boundaries are
 * index-based (half-open ranges: [startIndex, endIndex)) so the three
 * slices are contiguous and exactly partition the input with no gap and
 * no overlap.
 */
export type SplitRange = { startIndex: number; endIndex: number };

export type ChronologicalSplit = {
  development: SplitRange;
  validation: SplitRange;
  holdout: SplitRange;
};

export function computeChronologicalSplit(candleCount: number): ChronologicalSplit {
  if (!Number.isInteger(candleCount) || candleCount < 0) {
    throw new Error(`computeChronologicalSplit: candleCount must be a non-negative integer, got ${candleCount}`);
  }
  const developmentEnd = Math.floor(candleCount * 0.6);
  const validationEnd = Math.floor(candleCount * 0.8);
  return {
    development: { startIndex: 0, endIndex: developmentEnd },
    validation: { startIndex: developmentEnd, endIndex: validationEnd },
    holdout: { startIndex: validationEnd, endIndex: candleCount },
  };
}

/** Slices candles for one split range. Oldest-first order is preserved (no shuffling anywhere in this module). */
export function sliceForRange<T = CanonicalCandle>(candles: readonly T[], range: SplitRange): T[] {
  return candles.slice(range.startIndex, range.endIndex);
}

export function splitCandles(
  candles: readonly CanonicalCandle[],
): { split: ChronologicalSplit; development: CanonicalCandle[]; validation: CanonicalCandle[]; holdout: CanonicalCandle[] } {
  const split = computeChronologicalSplit(candles.length);
  return {
    split,
    development: sliceForRange(candles, split.development),
    validation: sliceForRange(candles, split.validation),
    holdout: sliceForRange(candles, split.holdout),
  };
}
