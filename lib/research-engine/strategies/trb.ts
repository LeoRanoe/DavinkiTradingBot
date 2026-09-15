import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import type { EntryEvaluation, ExitEvaluation, StrategyDefinition, StrategyParameterSet } from "../strategy";

/**
 * V2 Trading Range Breakout (Checkpoint 3A §3-§8). DRAFT / RESEARCH ONLY —
 * not inserted or promoted into live strategy execution anywhere. No
 * PAPER, SHADOW, or LIVE path exists for this strategy id.
 *
 * ================================ SEMANTICS ================================
 * LONG ONLY (current crypto-spot research policy). Closed candles only.
 *
 * ENTRY (§5): on closed bar t, with entryLookback = N:
 *
 *   signal iff close[t] > highest(high[t-N .. t-1])
 *
 * The channel is computed over the N bars STRICTLY BEFORE t — bar t itself
 * is never part of its own breakout channel. `closedCandles`'s last
 * element (index length-1) is bar t; the channel is
 * closedCandles[length-1-N .. length-2].
 *
 * Execution: NEXT bar open (engine responsibility, not this file — see
 * lib/research-engine/engine.ts). This strategy never claims a fill on
 * the signal bar itself.
 *
 * EXIT (§6): NO fixed profit target — trend-following strategies must be
 * able to ride a large winner. While in a position, on closed bar x, with
 * exitLookback = M:
 *
 *   exit iff close[x] < lowest(low[x-M .. x-1])
 *
 * Same exclusion rule: the channel is the M bars strictly before x.
 * Execution: NEXT bar open. If there is no next bar, the engine records
 * the position OPEN_AT_END rather than fabricating a fill (engine
 * responsibility).
 *
 * INITIAL RISK REFERENCE (§7): at signal time, initialStop = lowest low of
 * the prior `exitLookback` closed bars (the same M-bar window the exit
 * rule will keep re-evaluating going forward) — informational for
 * position sizing, NOT a separate executed stop-loss order. The strategy
 * ONLY ever exits via the dynamic channel exit above. The
 * `initialStop < entryPrice` validity check is deliberately NOT performed
 * here: entryPrice isn't known until the engine fills at next-bar open,
 * so the engine (lib/research-engine/position-sizing.ts) is the one that
 * rejects an invalid trade — see Checkpoint 3A §7/§15.
 *
 * NO SCORE (§8): `Opportunity.strength` is left undefined — there is no
 * defined deterministic 0-100 quantity for a breakout the way Strategy V1
 * has one, and none is invented here. `features` records only factual
 * values (entryLookback, exitLookback, breakoutChannelHigh, timeframe).
 * =============================================================================
 */

export type TrbParams = {
  entryLookback: number;
  exitLookback: number;
};

const STRATEGY_ID = "v2-trb";

function highestOfWindowExcludingLast(candles: readonly CanonicalCandle[], windowSize: number): number | null {
  // candles' last element is "now" (bar t) - the window is the windowSize
  // bars strictly before it: indices [length-1-windowSize, length-2].
  if (candles.length < windowSize + 1) return null;
  const start = candles.length - 1 - windowSize;
  const end = candles.length - 1; // exclusive - excludes the current bar
  let max = -Infinity;
  for (let i = start; i < end; i++) max = Math.max(max, candles[i].high);
  return max;
}

function lowestOfWindowExcludingLast(candles: readonly CanonicalCandle[], windowSize: number): number | null {
  if (candles.length < windowSize + 1) return null;
  const start = candles.length - 1 - windowSize;
  const end = candles.length - 1;
  let min = Infinity;
  for (let i = start; i < end; i++) min = Math.min(min, candles[i].low);
  return min;
}

function evaluateEntry(
  closedCandles: readonly CanonicalCandle[],
  params: StrategyParameterSet<TrbParams>,
): EntryEvaluation {
  const { entryLookback, exitLookback } = params.params;
  const current = closedCandles[closedCandles.length - 1];
  if (!current) return { kind: "NO_OPPORTUNITY", reason: "NO_CANDLES" };
  if (!current.isClosed) return { kind: "NO_OPPORTUNITY", reason: "CURRENT_CANDLE_NOT_CLOSED" };

  const breakoutChannelHigh = highestOfWindowExcludingLast(closedCandles, entryLookback);
  if (breakoutChannelHigh === null) {
    return { kind: "NO_OPPORTUNITY", reason: "INSUFFICIENT_ENTRY_HISTORY" };
  }

  // The initial-risk reference also needs exitLookback prior bars known at
  // signal time - if that window isn't available yet, no valid signal.
  const initialStop = lowestOfWindowExcludingLast(closedCandles, exitLookback);
  if (initialStop === null) {
    return { kind: "NO_OPPORTUNITY", reason: "INSUFFICIENT_EXIT_HISTORY_FOR_RISK_REFERENCE" };
  }

  if (!(current.close > breakoutChannelHigh)) {
    return { kind: "NO_OPPORTUNITY", reason: "NO_BREAKOUT" };
  }

  return {
    kind: "OPPORTUNITY",
    opportunity: {
      strategyVersion: params.id,
      instrumentId: current.instrumentId,
      timestamp: current.openTime,
      side: "LONG",
      entryModel: { price: current.close }, // signal-time reference price; actual fill is next-bar open (engine)
      initialStop: { price: initialStop },
      reason: "CLOSE_ABOVE_ENTRY_CHANNEL_HIGH",
      features: {
        entryLookback,
        exitLookback,
        timeframe: params.timeframe,
        breakoutChannelHigh,
        signalClose: current.close,
      },
    },
  };
}

function evaluateExit(
  closedCandles: readonly CanonicalCandle[],
  params: StrategyParameterSet<TrbParams>,
): ExitEvaluation {
  const { exitLookback } = params.params;
  const current = closedCandles[closedCandles.length - 1];
  if (!current || !current.isClosed) return { kind: "HOLD" };

  const exitChannelLow = lowestOfWindowExcludingLast(closedCandles, exitLookback);
  if (exitChannelLow === null) return { kind: "HOLD" };

  if (current.close < exitChannelLow) {
    return {
      kind: "EXIT",
      reason: "CLOSE_BELOW_EXIT_CHANNEL_LOW",
      features: { exitLookback, exitChannelLow, exitClose: current.close },
    };
  }
  return { kind: "HOLD" };
}

/**
 * Exactly six preregistered configurations (§4) — three entry/exit channel
 * pairs × two timeframes. No parameter search, no additional lookbacks.
 * IDs are immutable and stable: TRB-<timeframe>-<entryLookback>-<exitLookback>.
 */
const CHANNEL_PAIRS: readonly { entryLookback: number; exitLookback: number }[] = [
  { entryLookback: 20, exitLookback: 10 },
  { entryLookback: 50, exitLookback: 20 },
  { entryLookback: 100, exitLookback: 50 },
];

const TIMEFRAMES = ["1H", "4H"] as const;

function makeParameterSetId(timeframe: (typeof TIMEFRAMES)[number], entryLookback: number, exitLookback: number): string {
  return `TRB-${timeframe}-${entryLookback}-${exitLookback}`;
}

export const TRB_PARAMETER_SETS: readonly StrategyParameterSet<TrbParams>[] = TIMEFRAMES.flatMap((timeframe) =>
  CHANNEL_PAIRS.map(
    ({ entryLookback, exitLookback }): StrategyParameterSet<TrbParams> => ({
      id: makeParameterSetId(timeframe, entryLookback, exitLookback),
      strategyId: STRATEGY_ID,
      timeframe,
      params: { entryLookback, exitLookback },
    }),
  ),
);

export const TRB_STRATEGY: StrategyDefinition<TrbParams> = {
  id: STRATEGY_ID,
  name: "Trading Range Breakout",
  status: "RESEARCH_ONLY",
  supportedAssetClasses: ["CRYPTO_SPOT", "FOREX"],
  parameterSets: TRB_PARAMETER_SETS,
  evaluateEntry,
  evaluateExit,
};

export function getTrbParameterSet(id: string): StrategyParameterSet<TrbParams> | undefined {
  return TRB_PARAMETER_SETS.find((p) => p.id === id);
}
