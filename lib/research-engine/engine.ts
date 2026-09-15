import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { validateCandleBatchIdentity, validateCandleIntegrity } from "./candle-integrity";
import { assertValidCostModel, computeEffectiveEntryPrice, computeEntryFillCosts, computeExitFillCosts, type CostModel } from "./cost-model";
import { computeNormalizedPositionSize, type NormalizedRiskConfig } from "./position-sizing";
import { assertRegisteredParameterSet } from "./registry-guard";
import type { StrategyDefinition, StrategyParameterSet } from "./strategy";

/**
 * Generic, strategy-agnostic research backtest engine (Checkpoint 3A
 * §12/§13, hardened Checkpoint 3A.1 §1-§4/§6/§7/§8/§9). MUST NOT import
 * lib/strategy/v1/signal.ts or anything from lib/backtest/ — this is a
 * wholly separate engine for the generic multi-strategy research
 * pipeline. lib/backtest/engine.ts (V1's backtester) is untouched and
 * remains V1's frozen baseline.
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
 *
 * PRICE/SIZING ORDERING (§2) — raw next-bar open -> effective entry price
 * (slippage applied) -> size from effective price vs initialStop -> fee
 * computed on the resulting qty/effective notional. Sizing and PnL both
 * use the SAME effective entry price; there is no separate "sizing price"
 * vs "pnl price" to reconcile.
 *
 * WARM-UP / EXECUTION WINDOW (§6) — `config.tradeWindowStartIndex`
 * (default 0) lets a caller pass MORE history than the segment it wants
 * results for, so a strategy's lookback (channel, EMA, etc.) has legal
 * prior context at the very start of a validation/holdout split without
 * that split "borrowing" a trade that actually started in the prior
 * split. A signal produced on any bar t < tradeWindowStartIndex is never
 * allowed to open a trade — it is recorded as a skip
 * (`PRE_WINDOW_SIGNAL_IGNORED`), never silently dropped. See
 * split-execution.ts for the caller-facing wrapper that turns a
 * (fullHistory, window) pair into this option.
 */

export type TradeOutcome = "CLOSED" | "OPEN_AT_END";

export type ResearchTradeRecord = {
  signalTime: number;
  signalReason: string;
  entryCandleIndex: number;
  entryTime: number;
  /** Effective (post-slippage) fill price — the SAME price sizing was computed from. */
  entryPrice: number;
  /** Raw next-bar-open price, before slippage. Reported for gross/raw reconciliation (§7). */
  rawEntryPrice: number;
  initialStopPrice: number;
  /** equity * riskPct at entry time — the risk the trade WOULD have taken if capital were unlimited. */
  targetRiskBudget: number;
  /** The risk the trade ACTUALLY takes, given the no-leverage equity cap. Use this for R-multiples, never targetRiskBudget. */
  actualInitialRisk: number;
  /** True when position-sizing capped the notional to available equity (no leverage) rather than the full risk-sized notional. */
  capitalCapped: boolean;
  qty: number;
  entryFee: number;
  entrySlippageCost: number;

  exitCandleIndex: number | null;
  exitTime: number | null;
  /** Effective (post-slippage) fill price. */
  exitPrice: number | null;
  /** Raw next-bar-open price, before slippage. Null until realized. */
  rawExitPrice: number | null;
  exitReason: string | null;
  exitFee: number;
  exitSlippageCost: number;

  /** (rawExitPrice - rawEntryPrice) * qty — raw execution PnL with NO modeled costs applied. Null until realized. */
  grossPnl: number | null;
  /** Net PnL after all modeled costs (fees + slippage). Null until realized. This is what moves `equity`. */
  pnl: number | null;
  /** rMultiple = pnl / actualInitialRisk. Null until realized. */
  rMultiple: number | null;
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
  /**
   * §6: bars at index < tradeWindowStartIndex are still visible to
   * strategies as history (for warm-up) but can never themselves produce
   * a trade. Default 0 (the whole input array is tradeable), which
   * preserves prior behavior for any caller that doesn't pass this.
   */
  tradeWindowStartIndex?: number;
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
 * validation, or holdout — the caller wants, or the full context array
 * when using `tradeWindowStartIndex` for warm-up; this function itself
 * knows nothing about splits beyond that one option). Deterministic:
 * identical inputs always produce an identical result; the ONLY input
 * that determines the result is the candle array's content, never its
 * "index position in some larger dataset" or any wall-clock value.
 *
 * Before running, this function enforces (never just documents) two
 * registry/data invariants (§3/§4):
 *   - `paramSet` must be the actual preregistered object for its id on
 *     `strategy` (same strategyId, same timeframe, same param values) —
 *     see registry-guard.ts.
 *   - `candles` must be a single instrument, a single timeframe, and that
 *     timeframe must match `paramSet.timeframe` — see
 *     validateCandleBatchIdentity in candle-integrity.ts. Zero candles is
 *     handled explicitly: it returns an empty, valid result with a
 *     recorded skip rather than either throwing or silently doing
 *     nothing.
 */
export function runResearchBacktest<TParams extends Record<string, unknown>>(
  candles: readonly CanonicalCandle[],
  strategy: StrategyDefinition<TParams>,
  paramSet: StrategyParameterSet<TParams>,
  config: ResearchBacktestConfig,
): ResearchBacktestResult {
  assertRegisteredParameterSet(strategy, paramSet);
  assertValidCostModel(config.cost);

  if (candles.length === 0) {
    return { trades: [], skips: [{ time: 0, reason: "ZERO_CANDLES" }], finalEquity: config.risk.initialEquity, equityCurve: [] };
  }

  const identity = validateCandleBatchIdentity(candles, paramSet.timeframe);
  if (!identity.valid) {
    throw new Error(
      `runResearchBacktest: candle batch identity violated - ${identity.issue!.reason}` +
        ("details" in identity.issue! ? `: ${identity.issue!.details}` : "") +
        ". A trial must not mix instruments/timeframes or run a parameter set's timeframe against mismatched candles.",
    );
  }

  const integrity = validateCandleIntegrity(candles);
  if (!integrity.valid) {
    throw new Error(
      `runResearchBacktest: candle integrity violated (${integrity.issues.length} issue(s)) - ` +
        `first: ${JSON.stringify(integrity.issues[0])}. Fix the input history; this engine never runs on unvalidated data.`,
    );
  }

  const tradeWindowStartIndex = config.tradeWindowStartIndex ?? 0;

  const trades: ResearchTradeRecord[] = [];
  const skips: ResearchSkip[] = [];
  let equity = config.risk.initialEquity;
  const equityCurve: EquityCurvePoint[] = [{ time: candles[0].openTime, equity }];

  type OpenPosition = {
    entryCandleIndex: number;
    entryTime: number;
    entryPrice: number;
    rawEntryPrice: number;
    qty: number;
    initialStopPrice: number;
    targetRiskBudget: number;
    actualInitialRisk: number;
    capitalCapped: boolean;
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

      if (t < tradeWindowStartIndex) {
        // §6: legal warm-up context, but this bar is before the segment's
        // own trade window - a signal here may not open an in-segment trade.
        skips.push({ time: evaluation.opportunity.timestamp, reason: "PRE_WINDOW_SIGNAL_IGNORED" });
        continue;
      }

      const fillIndex = t + 1;
      if (fillIndex >= candles.length) {
        // Signal produced on the last available bar - no next-bar open to
        // fill on. Never fake a fill; this signal simply produces no trade.
        skips.push({ time: evaluation.opportunity.timestamp, reason: "NO_NEXT_BAR_FOR_ENTRY_FILL" });
        continue;
      }

      const fillBar = candles[fillIndex];
      const rawEntryPrice = fillBar.open;
      // §2: raw price -> effective price -> size from EFFECTIVE price.
      const effectiveEntryPrice = computeEffectiveEntryPrice(rawEntryPrice, config.cost);
      const sizing = computeNormalizedPositionSize(
        effectiveEntryPrice,
        evaluation.opportunity.initialStop.price,
        equity,
        config.risk,
      );
      if (!sizing.accepted) {
        skips.push({ time: evaluation.opportunity.timestamp, reason: sizing.reason });
        continue;
      }

      // Fee is computed on the resulting qty against the raw price (fee
      // model applies to the same fill the slippage model does - see
      // cost-model.ts computeEntryFillCosts).
      const entryCosts = computeEntryFillCosts(rawEntryPrice, sizing.qty, config.cost);
      position = {
        entryCandleIndex: fillIndex,
        entryTime: fillBar.openTime,
        entryPrice: entryCosts.effectivePrice,
        rawEntryPrice,
        qty: sizing.qty,
        initialStopPrice: evaluation.opportunity.initialStop.price,
        targetRiskBudget: sizing.targetRiskBudget,
        actualInitialRisk: sizing.actualInitialRisk,
        capitalCapped: sizing.capitalCapped,
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
    const rawExitPrice = fillBar.open;
    const exitCosts = computeExitFillCosts(rawExitPrice, position.qty, config.cost);
    const grossPnl = (rawExitPrice - position.rawEntryPrice) * position.qty;
    const pnl =
      (exitCosts.effectivePrice - position.entryPrice) * position.qty - position.entryFee - exitCosts.feeAmount;
    const rMultiple = pnl / position.actualInitialRisk;
    equity += pnl;

    trades.push({
      signalTime: position.signalTime,
      signalReason: position.signalReason,
      entryCandleIndex: position.entryCandleIndex,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      rawEntryPrice: position.rawEntryPrice,
      initialStopPrice: position.initialStopPrice,
      targetRiskBudget: position.targetRiskBudget,
      actualInitialRisk: position.actualInitialRisk,
      capitalCapped: position.capitalCapped,
      qty: position.qty,
      entryFee: position.entryFee,
      entrySlippageCost: position.entrySlippageCost,
      exitCandleIndex: fillIndex,
      exitTime: fillBar.openTime,
      exitPrice: exitCosts.effectivePrice,
      rawExitPrice,
      exitReason: exitEvaluation.reason,
      exitFee: exitCosts.feeAmount,
      exitSlippageCost: exitCosts.slippageAmount,
      grossPnl,
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
      rawEntryPrice: position.rawEntryPrice,
      initialStopPrice: position.initialStopPrice,
      targetRiskBudget: position.targetRiskBudget,
      actualInitialRisk: position.actualInitialRisk,
      capitalCapped: position.capitalCapped,
      qty: position.qty,
      entryFee: position.entryFee,
      entrySlippageCost: position.entrySlippageCost,
      exitCandleIndex: null,
      exitTime: null,
      exitPrice: null,
      rawExitPrice: null,
      exitReason: null,
      exitFee: 0,
      exitSlippageCost: 0,
      grossPnl: null,
      pnl: null,
      rMultiple: null,
      holdingBars: null,
      outcome: "OPEN_AT_END",
    });
  }

  return { trades, skips, finalEquity: equity, equityCurve };
}
