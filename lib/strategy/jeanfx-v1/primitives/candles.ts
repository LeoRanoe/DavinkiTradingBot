import type { CanonicalCandle } from "@/lib/strategy-platform/types";

/**
 * Candle confirmation patterns - SOURCE RULE names bullish/bearish
 * engulfing, hammer, and shooting star (docs/strategies/jeanfx-v1-spec.md
 * S7/S8). The exact body/wick math is an IMPLEMENTATION ASSUMPTION:
 * body-to-body engulfing (not full-range), and a 2:1 dominant-wick-to-body
 * ratio with a 0.5x cap on the opposite wick for hammer/shooting star.
 */
export type CandleConfirmationParams = { minWickBodyRatio: number; maxOppositeWickRatio: number };

function body(c: CanonicalCandle): number {
  return Math.abs(c.close - c.open);
}
function upperWick(c: CanonicalCandle): number {
  return c.high - Math.max(c.open, c.close);
}
function lowerWick(c: CanonicalCandle): number {
  return Math.min(c.open, c.close) - c.low;
}
function isBullish(c: CanonicalCandle): boolean {
  return c.close > c.open;
}
function isBearish(c: CanonicalCandle): boolean {
  return c.close < c.open;
}

/** Bullish/bearish "this candle closed up/down" - trivial sugar, exposed as its own DSL primitive for plain-English rules. */
export function isBullishCandle(c: CanonicalCandle): boolean {
  return isBullish(c);
}
export function isBearishCandle(c: CanonicalCandle): boolean {
  return isBearish(c);
}

/** Body-to-body engulfing: current candle's body fully contains the prior candle's body, opposite direction. */
export function isBullishEngulfing(prior: CanonicalCandle, current: CanonicalCandle): boolean {
  return isBearish(prior) && isBullish(current) && current.open <= prior.close && current.close >= prior.open;
}

export function isBearishEngulfing(prior: CanonicalCandle, current: CanonicalCandle): boolean {
  return isBullish(prior) && isBearish(current) && current.open >= prior.close && current.close <= prior.open;
}

function wickRatioPattern(c: CanonicalCandle, dominant: "lower" | "upper", params: CandleConfirmationParams): boolean {
  const b = body(c);
  const range = c.high - c.low;
  if (range <= 0) return false;
  const dominantWick = dominant === "lower" ? lowerWick(c) : upperWick(c);
  const oppositeWick = dominant === "lower" ? upperWick(c) : lowerWick(c);

  if (b > 0) {
    return dominantWick >= params.minWickBodyRatio * b && oppositeWick <= params.maxOppositeWickRatio * b;
  }
  // Degenerate near-zero body: fall back to range-relative thresholds to avoid a division-by-near-zero blowup.
  return dominantWick >= 0.6 * range && oppositeWick <= 0.1 * range;
}

export function isHammer(c: CanonicalCandle, params: CandleConfirmationParams): boolean {
  return wickRatioPattern(c, "lower", params);
}

export function isShootingStar(c: CanonicalCandle, params: CandleConfirmationParams): boolean {
  return wickRatioPattern(c, "upper", params);
}
