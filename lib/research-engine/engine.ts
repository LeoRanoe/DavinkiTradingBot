import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { validateCandleIntegrity } from "./candle-integrity";
import { applyEntryCosts, applyExitCosts, type CostModel } from "./cost-model";
import { computeNormalizedPositionSize, type NormalizedRiskConfig } from "./position-sizing";
import type { StrategyDefinition, StrategyParameterSet } from "./strategy";

/**
 * Generic, strategy-agnostic research backtest engine (Checkpoint 3A
 * §12/§13). MUST NOT import lib/strategy/v1/signal.ts or anything from
 * lib/backtest/ — this is a wholly separate engine for the generic
 * multi-strategy research pipeline. lib/backtest/engine.ts (V1's
 * backtester) is untouched and remains V1's frozen baseline.
 *
 * EXECUTION SEMANTICS (§13) — no look-ahead anywhere:
 *   - A strategy only ever sees `candles.slice(0, t + 1)` — see
 *     strategy.ts's doc comment for why that's a structural, not
 *     documentation-only, guarantee.
 *   - Entry signal known at close of bar t -> filled at bar (t+1)'s OPEN.
 *   - Exit signal known at close of bar x -> filled at bar (x+1)'s OPEN.
 *   - If there is no next bar to fill on, the engine NEVER fakes a fill.
 *     A pending entry signal with no next bar simply produces no trade.
 *     An open position with no next bar to exit on ends the run in
 *     OPEN_AT_END (unrealized, `exitPrice`/`exitTime`/`pnl`/`rMultiple`
 *     all null) - explicit, never estimated.
 *   - One open position at a time per (strategy, parameter set,
 *     instrument, candle array) call - this function IS that one trial.
 */

export type TradeOutcome = "CLOSED" | "OPEN_AT_END";

export type ResearchTradeRecord = {
  signalTime: number;
  signalReason: string;
  entryCandleIndex: number;
  entryTime: number;
  entryPrice: number; // effective (post-slippage) fill price
  initialStopPrice: number;
  riskBudget: number;
  qty: number;
  entryFee: number;
  entrySlippageCost: number;

  exitCandleIndex: number | null;
  exitTime: number | null;
  exitPrice: number | null; // effective (post-slippage) fill price
  exitReason: string | null;
  exitFee: number;
  exitSlippageCost: number;

  pnl: number | null; // null until realized
  rMultiple: number | null; // null until realized
  holdingBars: number | null; // exitCandleIndex - entryCandleIndex, null until realized

  outcome: TradeOutcome;
};

export type ResearchSkip = {
  time: number;
  reason: string;
};

export type ResearchBacktestConfig = {
  risk: NormalizedRiskConfig;
  cost: CostModel;
};

export type EquityCurvePoint = { time: number; equity: number };

export type ResearchBacktestResult = {
  trades: ResearchTradeRecord[];
  skips: ResearchSkip[];
  finalEquity: number;
  equityCurve: EquityCurvePoint[]; // one point at start, then one per realized (CLOSED) trade, chronological
};

/**
 * Runs one strategy × parameter set trial over one chronologically-ordered
 * candle array (already the slice for whichever split — development,
 * validation, or holdout — the caller wants; this function itself knows
 * nothing about splits). Deterministic: identical inputs always produce an
 * identical result; the ONLY input that determines the result is the
 * candle array's content, never its "index position in some larger
 * dataset" or any wall-clock value.
 */
export function runResearchBacktest<TParams extends Record<string, unknown>>(
  candles: readonly CanonicalCandle[],
  strategy: StrategyDefinition<TParams>,
  paramSet: StrategyParameterSet<TParams>,
  config: ResearchBacktestConfig,
): ResearchBacktestResult {
  const integrity = validateCandleIntegrity(candles);
  if (!integrity.valid) {
    throw new Error(
      `runResearchBacktest: candle integrity violated (${integrity.issues.length} issue(s)) - ` +
        `first: ${JSON.stringify(integrity.issues[0])}. Fix the input history; this engine never runs on unvalidated data.`,
    );
  }

  const trades: ResearchTradeRecord[] = [];
  const skips: ResearchSkip[] = [];
  let equity = config.risk.initialEquity;
  const equityCurve: EquityCurvePoint[] = candles.length > 0 ? [{ time: candles[0].openTime, equity }] : [];

  type OpenPosition = {
    entryCandleIndex: number;
    entryTime: number;
    entryPrice: number;
    qty: number;
    initialStopPrice: number;
    riskBudget: number;
    signalTime: number;
    signalReason: string;
    entryFee: number;
    entrySlippageCost: number;
  };
  let position: OpenPosition | null = null;

  for (let t = 0; t < candles.length; t++) {
    // Structural no-lookahead: this is the ONLY view of history any
    // strategy call ever receives, and it never extends past bar t.
    const historyUpToT = candles.slice(0, t + 1);

    if (position === null) {
      const evaluation = strategy.evaluateEntry(historyUpToT, paramSet);
      if (evaluation.kind !== "OPPORTUNITY") continue;

      const fillIndex = t + 1;
      if (fillIndex >= candles.length) {
        // Signal produced on the last available bar - no next-bar open to
        // fill on. Never fake a fill; this signal simply produces no trade.
        skips.push({ time: evaluation.opportunity.timestamp, reason: "NO_NEXT_BAR_FOR_ENTRY_FILL" });
        continue;
      }

      const fillBar = candles[fillIndex];
      const rawEntryPrice = fillBar.open;
      const sizing = computeNormalizedPositionSize(
        rawEntryPrice,
        evaluation.opportunity.initialStop.price,
        equity,
        config.risk,
      );
      if (!sizing.accepted) {
        skips.push({ time: evaluation.opportunity.timestamp, reason: sizing.reason });
        continue;
      }

      const entryCosts = applyEntryCosts(rawEntryPrice, sizing.qty, config.cost);
      position = {
        entryCandleIndex: fillIndex,
        entryTime: fillBar.openTime,
        entryPrice: entryCosts.effectivePrice,
        qty: sizing.qty,
        initialStopPrice: evaluation.opportunity.initialStop.price,
        riskBudget: sizing.riskBudget,
        signalTime: evaluation.opportunity.timestamp,
        signalReason: evaluation.opportunity.reason,
        entryFee: entryCosts.feeAmount,
        entrySlippageCost: entryCosts.slippageAmount,
      };
      // Next loop iteration (t+1) will naturally evaluate this trade's
      // exit using history that now includes the fill bar's own close -
      // no manual index jump needed.
      continue;
    }

    // In position: ask the strategy whether bar t's close is an exit signal.
    const exitEvaluation = strategy.evaluateExit(historyUpToT, paramSet);
    if (exitEvaluation.kind !== "EXIT") continue;

    const fillIndex = t + 1;
    if (fillIndex >= candles.length) {
      // Exit signal on the last bar - no next-bar open to fill on. Leave
      // the loop; the open position is finalized as OPEN_AT_END below.
      break;
    }

    const fillBar = candles[fillIndex];
    const exitCosts = applyExitCosts(fillBar.open, position.qty, config.cost);
    const pnl =
      (exitCosts.effectivePrice - position.entryPrice) * position.qty - position.entryFee - exitCosts.feeAmount;
    const rMultiple = pnl / position.riskBudget;
    equity += pnl;

    trades.push({
      signalTime: position.signalTime,
      signalReason: position.signalReason,
      entryCandleIndex: position.entryCandleIndex,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      initialStopPrice: position.initialStopPrice,
      riskBudget: position.riskBudget,
      qty: position.qty,
      entryFee: position.entryFee,
      entrySlippageCost: position.entrySlippageCost,
      exitCandleIndex: fillIndex,
      exitTime: fillBar.openTime,
      exitPrice: exitCosts.effectivePrice,
      exitReason: exitEvaluation.reason,
      exitFee: exitCosts.feeAmount,
      exitSlippageCost: exitCosts.slippageAmount,
      pnl,
      rMultiple,
      holdingBars: fillIndex - position.entryCandleIndex,
      outcome: "CLOSED",
    });
    equityCurve.push({ time: fillBar.openTime, equity });
    position = null;
  }

  if (position !== null) {
    // Ran out of data while still holding - explicit unresolved state,
    // never an estimated/faked close.
    trades.push({
      signalTime: position.signalTime,
      signalReason: position.signalReason,
      entryCandleIndex: position.entryCandleIndex,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      initialStopPrice: position.initialStopPrice,
      riskBudget: position.riskBudget,
      qty: position.qty,
      entryFee: position.entryFee,
      entrySlippageCost: position.entrySlippageCost,
      exitCandleIndex: null,
      exitTime: null,
      exitPrice: null,
      exitReason: null,
      exitFee: 0,
      exitSlippageCost: 0,
      pnl: null,
      rMultiple: null,
      holdingBars: null,
      outcome: "OPEN_AT_END",
    });
  }

  return { trades, skips, finalEquity: equity, equityCurve };
}
