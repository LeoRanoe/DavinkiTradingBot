import type { Candle } from "@/lib/bybit/types";
import { evaluateRegime } from "./regime";
import { scoreSetup } from "./score";
import { STRATEGY_V1_VERSION_LABEL } from "./config";

export type SignalEvaluation =
  | { kind: "NO_SIGNAL"; reason: "NO_BULLISH_REGIME" | "MISSING_MARKET_DATA" }
  | {
      kind: "SIGNAL";
      symbol: string;
      candleTime: number;
      strategyVersionLabel: string;
      regime: string;
      score: ReturnType<typeof scoreSetup>;
    };

/**
 * Orchestrates Strategy V1: closed-candle invariant -> 1H regime gate ->
 * 15M setup score. Pure function - callers own persistence/dedup/idempotency.
 *
 * The CLOSED CANDLE INVARIANT: the last element of candles15m MUST be closed.
 * We only ever score a signal off a fully closed 15-minute candle.
 */
export function evaluateSignal(symbol: string, candles1h: Candle[], candles15m: Candle[]): SignalEvaluation {
  const closed1h = candles1h.filter((candle) => candle.isClosed);
  const closed15m = candles15m.filter((candle) => candle.isClosed);

  if (closed1h.length === 0 || closed15m.length === 0) {
    return { kind: "NO_SIGNAL", reason: "MISSING_MARKET_DATA" };
  }

  const lastCandle15m = closed15m[closed15m.length - 1];

  const regime = evaluateRegime(closed1h);
  if (!regime.bullish) {
    return { kind: "NO_SIGNAL", reason: "NO_BULLISH_REGIME" };
  }

  const score = scoreSetup(closed15m);

  return {
    kind: "SIGNAL",
    symbol,
    candleTime: lastCandle15m.openTime,
    strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
    regime: regime.reason,
    score,
  };
}
