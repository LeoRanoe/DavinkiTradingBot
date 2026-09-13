import { latestEma } from "@/lib/indicators/ema";
import type { Candle } from "@/lib/bybit/types";
import { STRATEGY_V1_PARAMS } from "./config";

export type RegimeResult = {
  bullish: boolean;
  ema50: number | null;
  ema200: number | null;
  close: number;
  reason: string;
};

/**
 * 1H market regime rule (Strategy V1):
 *   bullish when EMA50 > EMA200 AND close > EMA50.
 * Otherwise there is no long candidate this cycle - full stop, no long trade.
 */
export function evaluateRegime(candles1h: Candle[]): RegimeResult {
  const { mid, slow } = STRATEGY_V1_PARAMS.ema;
  const closes = candles1h.map((c) => c.close);
  const close = closes[closes.length - 1];

  const ema50 = latestEma(closes, mid);
  const ema200 = latestEma(closes, slow);

  if (ema50 === null || ema200 === null) {
    return { bullish: false, ema50, ema200, close, reason: "INSUFFICIENT_HISTORY" };
  }

  const bullish = ema50 > ema200 && close > ema50;
  return {
    bullish,
    ema50,
    ema200,
    close,
    reason: bullish ? "EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50" : "NO_BULLISH_REGIME",
  };
}
