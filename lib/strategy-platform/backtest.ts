import { evaluateTradeRisk } from "@/lib/risk/engine";
import type { AccountState, CostModel, InstrumentRules, RiskLimits } from "@/lib/risk/types";
import { computeMetrics } from "@/lib/backtest/metrics";
import type { BacktestMetrics } from "@/lib/backtest/types";
import type { CanonicalCandle, Direction, StrategyContext, StrategyContract, Timeframe, TradingSession } from "./types";

/**
 * Generic backtest engine - the SAME engine for every strategy, built-in or
 * user-defined-and-compiled (see docs/architecture/strategy-platform.md
 * "Generic backtest page"). There is no separate "fake simulator" for
 * custom strategies: this module only ever calls `strategy.evaluate(ctx)`
 * through the StrategyContract interface, exactly as any other caller
 * would.
 *
 * LONG sizing reuses `evaluateTradeRisk`/`computePositionSizeFromBudget`
 * UNCHANGED - the exact same risk math live PAPER trading uses. SHORT
 * sizing is deliberately NOT routed through lib/risk/ - that engine is
 * intentionally spot/long-only (CLAUDE.md, Prompt 1 S4: SHORT is a
 * research concept only, never wired to Bybit spot execution) and this
 * checkpoint does not modify it. `researchShortPositionSize` below is a
 * separate, self-contained, symmetric mirror of the exact same formulas,
 * used ONLY for research backtesting of a direction that can never
 * actually execute in this build. Every trade record below is tagged with
 * `direction` so a SHORT backtest is never confused for an executable one.
 */

export type GenericBacktestConfig = {
  /** The timeframe the engine steps through bar-by-bar; other timeframes are trimmed to "as of this bar" on every step. */
  primaryTimeframe: Timeframe;
  initialEquity: number;
  maxRiskPerTradePct: number;
  maxOpenPositions: number;
  maxNewTradesPerDay: number;
  maxLosingTradesPerDay: number;
  feeBps: number;
  slippageBps: number;
  instrument: InstrumentRules;
  minHistoryBars: number;
  marketSessionOf?: (candleOpenTime: number) => TradingSession[] | null;
};

export type GenericBacktestTradeRecord = {
  direction: Direction;
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  fees: number;
  pnl: number | null;
  rMultiple: number | null;
  outcome: "STOP" | "TARGET" | "OPEN_AT_END" | null;
};

export type GenericBacktestSkip = { candleTime: number; reason: string };

export type GenericBacktestResult = {
  trades: GenericBacktestTradeRecord[];
  skips: GenericBacktestSkip[];
  metrics: BacktestMetrics;
  /** Overfitting/evidence-quality warnings (spec Prompt 2 S19) - neutral language, never "profitable strategy". */
  warnings: string[];
};

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Research-only, symmetric mirror of lib/risk/position-sizing.ts's LONG
 * math for a SHORT proposal (stop above entry, target below entry). Not a
 * production path - see the module doc comment above.
 */
function researchShortPositionSize(
  entryPrice: number,
  stopPrice: number,
  targetPrice: number,
  account: AccountState,
  riskBudget: number,
  instrument: InstrumentRules,
  costModel: CostModel,
): { approved: true; qty: number; riskAmount: number; riskReward: number } | { approved: false; reason: string } {
  if (entryPrice <= 0 || stopPrice <= 0 || targetPrice <= 0) return { approved: false, reason: "INVALID_EXCHANGE_METADATA" };
  if (stopPrice <= entryPrice) return { approved: false, reason: "INVALID_RISK_REWARD" };
  if (targetPrice >= entryPrice) return { approved: false, reason: "INVALID_RISK_REWARD" };
  if (account.equity <= 0 || riskBudget <= 0) return { approved: false, reason: "INSUFFICIENT_BALANCE" };

  const stopDistancePct = (stopPrice - entryPrice) / entryPrice;
  const riskReward = (entryPrice - targetPrice) / (stopPrice - entryPrice);
  const idealNotional = riskBudget / stopDistancePct;
  const availableBalance = account.availableBalance ?? account.equity;
  const cappedNotional = Math.min(idealNotional, Math.max(0, availableBalance));
  const idealQty = cappedNotional / entryPrice;
  const qty = instrument.qtyStep > 0 ? Math.floor(idealQty / instrument.qtyStep) * instrument.qtyStep : idealQty;
  const notional = qty * entryPrice;
  const riskAmount = qty * (stopPrice - entryPrice);

  if (qty <= 0 || qty < instrument.minOrderQty || notional < instrument.minOrderAmt) {
    return { approved: false, reason: "MIN_ORDER_RISK_CONFLICT" };
  }
  void costModel; // fees applied uniformly to both directions at trade-record build time, see below
  return { approved: true, qty, riskAmount, riskReward };
}

function trimToAsOf(candles: CanonicalCandle[], asOfOpenTime: number): CanonicalCandle[] {
  // Candles are chronological; a linear scan is simplest and correct - this
  // is a research tool run offline, not a hot path.
  const out: CanonicalCandle[] = [];
  for (const c of candles) {
    if (c.openTime > asOfOpenTime) break;
    out.push(c);
  }
  return out;
}

function buildWarnings(trades: GenericBacktestTradeRecord[], candleCount: number, parameterCount: number, feeBps: number): string[] {
  const warnings: string[] = [];
  const closed = trades.filter((t) => t.pnl !== null);
  if (closed.length < 20) warnings.push(`Too few trades (${closed.length}) for a reliable read - treat any result as insufficient sample.`);
  if (candleCount < 500) warnings.push(`Short history (${candleCount} bars) - results may not generalize.`);
  if (parameterCount > 6) warnings.push(`High parameter count (${parameterCount}) increases overfitting risk on a single backtest window.`);
  warnings.push("Results are in-sample only - this run has not been validated out-of-sample.");
  if (feeBps === 0) warnings.push("Zero cost assumption - real fees/slippage will reduce these results.");
  return warnings;
}

/**
 * Runs `strategy` against historical candles, stepping through
 * `config.primaryTimeframe` bar by bar. No look-ahead: every timeframe's
 * candle array is trimmed to "as of the current primary-timeframe bar" on
 * every step before being handed to `strategy.evaluate()`, and entry never
 * occurs earlier than the NEXT primary-timeframe candle's open (mirroring
 * lib/backtest/engine.ts's V1 backtester).
 */
export function runGenericBacktest(
  strategy: StrategyContract,
  candlesByTimeframe: Partial<Record<Timeframe, CanonicalCandle[]>>,
  instrumentId: string,
  config: GenericBacktestConfig,
  parameterCount = 0,
): GenericBacktestResult {
  const primary = candlesByTimeframe[config.primaryTimeframe] ?? [];
  const trades: GenericBacktestTradeRecord[] = [];
  const skips: GenericBacktestSkip[] = [];
  let totalFees = 0;

  let equity = config.initialEquity;
  let openPositionsCount = 0;
  let currentDay: string | null = null;
  let tradesOpenedTodayUtc = 0;
  let losingTradesTodayUtc = 0;

  const limits: RiskLimits = {
    maxRiskPerTradePct: config.maxRiskPerTradePct,
    maxOpenPositions: config.maxOpenPositions,
    maxNewTradesPerDay: config.maxNewTradesPerDay,
    maxLosingTradesPerDay: config.maxLosingTradesPerDay,
  };
  const costModel: CostModel = { feeBps: config.feeBps, slippageBps: config.slippageBps };

  let i = config.minHistoryBars;
  while (i < primary.length - 1) {
    const candle = primary[i];
    const day = utcDayKey(candle.openTime);
    if (day !== currentDay) {
      currentDay = day;
      tradesOpenedTodayUtc = 0;
      losingTradesTodayUtc = 0;
    }

    const ctx: StrategyContext = {
      instrument: { id: instrumentId, assetClass: "CRYPTO", pipSize: 0.01 },
      now: candle.openTime,
      candlesByTimeframe: Object.fromEntries(
        Object.entries(candlesByTimeframe).map(([tf, arr]) => [tf, trimToAsOf(arr!, candle.openTime)]),
      ) as Partial<Record<Timeframe, CanonicalCandle[]>>,
      marketSession: config.marketSessionOf ? config.marketSessionOf(candle.openTime) : null,
      currentPosition: null,
      strategyParameters: {},
    };

    const decision = strategy.evaluate(ctx);
    if (decision.type !== "ENTER_LONG" && decision.type !== "ENTER_SHORT") {
      i += 1;
      continue;
    }

    const direction: Direction = decision.type === "ENTER_LONG" ? "LONG" : "SHORT";
    const entryCandle = primary[i + 1]; // entry no earlier than the NEXT bar's open
    const rawEntryPrice = entryCandle.open;
    const entryPrice = direction === "LONG" ? rawEntryPrice * (1 + config.slippageBps / 10_000) : rawEntryPrice * (1 - config.slippageBps / 10_000);
    const stopPrice = decision.stop.price;
    const targetPrice = decision.target.price;

    const account: AccountState = { equity, openPositionsCount, tradesOpenedTodayUtc, losingTradesTodayUtc };

    let qty: number;
    let riskAmount: number;

    if (direction === "LONG") {
      const riskDecision = evaluateTradeRisk({
        tradingMode: "PAPER",
        strategyApproved: true,
        proposal: { entryPrice, stopPrice, targetPrice },
        account,
        limits,
        instrument: config.instrument,
        signalExpired: false,
        costModel,
      });
      if (!riskDecision.approved) {
        skips.push({ candleTime: candle.openTime, reason: riskDecision.reason });
        i += 1;
        continue;
      }
      qty = riskDecision.sizing.qty;
      riskAmount = riskDecision.sizing.riskAmount;
    } else {
      const riskBudget = equity * config.maxRiskPerTradePct;
      const shortDecision = researchShortPositionSize(entryPrice, stopPrice, targetPrice, account, riskBudget, config.instrument, costModel);
      if (!shortDecision.approved) {
        skips.push({ candleTime: candle.openTime, reason: shortDecision.reason });
        i += 1;
        continue;
      }
      qty = shortDecision.qty;
      riskAmount = shortDecision.riskAmount;
    }

    const entryFee = qty * entryPrice * (config.feeBps / 10_000);
    totalFees += entryFee;
    tradesOpenedTodayUtc += 1;
    openPositionsCount += 1;

    let exitIndex = -1;
    let outcome: GenericBacktestTradeRecord["outcome"] = null;
    let exitPrice: number | null = null;

    for (let j = i + 1; j < primary.length; j++) {
      const bar = primary[j];
      const hitStop = direction === "LONG" ? bar.low <= stopPrice : bar.high >= stopPrice;
      const hitTarget = direction === "LONG" ? bar.high >= targetPrice : bar.low <= targetPrice;
      if (hitStop) {
        // Ambiguous same-candle touch of both: assume the unfavorable ordering (stop first).
        outcome = "STOP";
        exitPrice = stopPrice;
        exitIndex = j;
        break;
      }
      if (hitTarget) {
        outcome = "TARGET";
        exitPrice = targetPrice;
        exitIndex = j;
        break;
      }
    }

    if (exitIndex === -1) {
      trades.push({
        direction,
        entryTime: entryCandle.openTime,
        exitTime: null,
        entryPrice,
        exitPrice: null,
        stopPrice,
        targetPrice,
        qty,
        fees: entryFee,
        pnl: null,
        rMultiple: null,
        outcome: "OPEN_AT_END",
      });
      break;
    }

    const exitCandle = primary[exitIndex];
    const slippedExitPrice = direction === "LONG" ? exitPrice! * (1 - config.slippageBps / 10_000) : exitPrice! * (1 + config.slippageBps / 10_000);
    const exitFee = qty * slippedExitPrice * (config.feeBps / 10_000);
    totalFees += exitFee;

    const grossPnl = direction === "LONG" ? (slippedExitPrice - entryPrice) * qty : (entryPrice - slippedExitPrice) * qty;
    const pnl = grossPnl - entryFee - exitFee;
    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

    equity += pnl;
    openPositionsCount -= 1;
    if (pnl <= 0) losingTradesTodayUtc += 1;

    trades.push({
      direction,
      entryTime: entryCandle.openTime,
      exitTime: exitCandle.openTime,
      entryPrice,
      exitPrice: slippedExitPrice,
      stopPrice,
      targetPrice,
      qty,
      fees: entryFee + exitFee,
      pnl,
      rMultiple,
      outcome,
    });

    i = exitIndex + 1;
  }

  const metrics = computeMetrics(trades, config.initialEquity, totalFees);
  const warnings = buildWarnings(trades, primary.length, parameterCount, config.feeBps);
  return { trades, skips, metrics, warnings };
}
