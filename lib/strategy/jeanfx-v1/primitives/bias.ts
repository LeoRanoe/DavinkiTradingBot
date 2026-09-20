import type { CanonicalCandle } from "@/lib/strategy-platform/types";
import type { LiquidityPool } from "../types";

/**
 * JeanFX HTF bias - SOURCE RULE.
 *
 * Source (JeanFX_Final_Complete, "Daily Bias Framework"):
 *   "Determine bias by observing where liquidity sits relative to price.
 *    If liquidity sits above price, market may seek it first."
 *
 * Source ("Core Strategy: Liquidity -> BOS -> FVG"):
 *   "When price moves above a high or below a low, it often does not mean
 *    continuation. It means the market is collecting liquidity before
 *    reversing in the true direction." and "If price sweeps below lows
 *    (taking sell-side liquidity) and then breaks above a previous high,
 *    this signals a shift from bearish to bullish."
 *
 * Composing those two statements gives the deterministic rule below:
 *
 *   1. The DRAW is the nearest unswept liquidity pool to current price -
 *      that is the liquidity the market "may seek first".
 *   2. Taking that liquidity is a collection event, not continuation, so
 *      the resulting true direction is AWAY from the draw:
 *        draw = sell-side (below price) -> sweep down -> BULLISH -> permits LONG
 *        draw = buy-side  (above price) -> sweep up   -> BEARISH -> permits SHORT
 *
 * This is deliberately NOT a trend model. The previous implementation used
 * EMA50/EMA200 + price-vs-EMA50, which appears nowhere in the JeanFX source
 * and silently turned JeanFX into generic trend-following. EMAs are no
 * longer consulted for JeanFX bias anywhere in this codebase.
 *
 * IMPLEMENTATION ASSUMPTIONS in this module (not source numbers - they
 * belong to the strategy VERSION, see config.ts JEANFX_IMPLEMENTATION_ASSUMPTIONS):
 *   - "nearest" is measured as absolute price distance from the last closed
 *     bias candle's close. The source says which liquidity the market seeks
 *     but gives no metric for choosing between two candidates.
 *   - `ambiguityTolerance` (ATR-relative): when both sides' nearest pools are
 *     within this distance of each other, the draw is genuinely ambiguous and
 *     bias resolves to NONE rather than being decided by a rounding error.
 */

export type JeanfxBias = "BULLISH" | "BEARISH" | "NONE";

export type BiasResult = {
  bias: JeanfxBias;
  /** The pool the market is judged to be drawing toward, or null when undecidable. */
  draw: LiquidityPool | null;
  nearestBuySide: LiquidityPool | null;
  nearestSellSide: LiquidityPool | null;
  reasonCode:
    | "DRAW_SELL_SIDE"
    | "DRAW_BUY_SIDE"
    | "NO_LIQUIDITY_MAPPED"
    | "AMBIGUOUS_DRAW"
    | "MISSING_MARKET_DATA";
};

/**
 * Determines JeanFX HTF bias from mapped liquidity relative to price.
 *
 * @param biasCandles  CLOSED bias-timeframe candles (H1 or M30 per profile).
 * @param pools        Unswept liquidity pools mapped on the bias timeframe.
 * @param ambiguityTolerance Absolute price distance within which the two
 *                     sides are treated as equidistant (caller supplies an
 *                     ATR-relative value).
 */
export function determineLiquidityBias(
  biasCandles: CanonicalCandle[],
  pools: LiquidityPool[],
  ambiguityTolerance: number,
): BiasResult {
  if (biasCandles.length === 0) {
    return { bias: "NONE", draw: null, nearestBuySide: null, nearestSellSide: null, reasonCode: "MISSING_MARKET_DATA" };
  }

  const price = biasCandles[biasCandles.length - 1].close;

  // Only liquidity that still sits in front of price can be "sought": a
  // buy-side pool is only a draw while it is still ABOVE price, and a
  // sell-side pool only while still BELOW it.
  const nearest = (side: "BUY_SIDE" | "SELL_SIDE"): LiquidityPool | null => {
    const candidates = pools.filter(
      (p) => !p.swept && p.side === side && (side === "BUY_SIDE" ? p.level > price : p.level < price),
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((best, p) => (Math.abs(p.level - price) < Math.abs(best.level - price) ? p : best));
  };

  const nearestBuySide = nearest("BUY_SIDE");
  const nearestSellSide = nearest("SELL_SIDE");

  if (!nearestBuySide && !nearestSellSide) {
    return { bias: "NONE", draw: null, nearestBuySide, nearestSellSide, reasonCode: "NO_LIQUIDITY_MAPPED" };
  }

  // Exactly one side has liquidity in front of price: that side is the draw.
  if (nearestBuySide && !nearestSellSide) {
    return { bias: "BEARISH", draw: nearestBuySide, nearestBuySide, nearestSellSide, reasonCode: "DRAW_BUY_SIDE" };
  }
  if (nearestSellSide && !nearestBuySide) {
    return { bias: "BULLISH", draw: nearestSellSide, nearestBuySide, nearestSellSide, reasonCode: "DRAW_SELL_SIDE" };
  }

  const distUp = Math.abs(nearestBuySide!.level - price);
  const distDown = Math.abs(nearestSellSide!.level - price);

  // Reject ambiguity rather than letting a rounding difference pick a side.
  if (Math.abs(distUp - distDown) <= ambiguityTolerance) {
    return { bias: "NONE", draw: null, nearestBuySide, nearestSellSide, reasonCode: "AMBIGUOUS_DRAW" };
  }

  return distDown < distUp
    ? { bias: "BULLISH", draw: nearestSellSide, nearestBuySide, nearestSellSide, reasonCode: "DRAW_SELL_SIDE" }
    : { bias: "BEARISH", draw: nearestBuySide, nearestBuySide, nearestSellSide, reasonCode: "DRAW_BUY_SIDE" };
}
