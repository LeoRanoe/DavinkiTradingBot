import type { Candle } from "@/lib/bybit/types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { evaluateTradeRisk } from "@/lib/risk/engine";
import type { AccountState } from "@/lib/risk/types";
import { computeMetrics } from "./metrics";
import type { BacktestConfig, BacktestResult, BacktestSkip, BacktestTradeRecord } from "./types";

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * No-look-ahead backtester for Strategy V1.
 *
 * Rules enforced (spec #45):
 *  - A signal is only evaluated off candles up to and including the current
 *    (already-closed, historical) 15M candle - nothing later is visible.
 *  - Entry occurs no earlier than the NEXT candle's open (never the candle
 *    that produced the signal).
 *  - If a later candle's high/low touch BOTH stop and target, we assume the
 *    UNFAVORABLE ordering (stop hit, target missed) since we cannot resolve
 *    intra-candle order without lower-timeframe data.
 *  - Position sizing, minimum-order rejection, and daily/loss/position
 *    limits reuse the exact same `evaluateTradeRisk` used in live/paper
 *    trading - no separate "backtest-only" risk logic.
 */
export function runBacktest(
  config: BacktestConfig,
  candles1h: Candle[],
  candles15m: Candle[],
): BacktestResult {
  const trades: BacktestTradeRecord[] = [];
  const skips: BacktestSkip[] = [];
  let totalFees = 0;

  let equity = config.initialEquity;
  let openPositionsCount = 0;
  let currentDay: string | null = null;
  let tradesOpenedTodayUtc = 0;
  let losingTradesTodayUtc = 0;

  const MIN_HISTORY_1H = 210; // enough for EMA200 + buffer
  const MIN_HISTORY_15M = 210;

  let i = MIN_HISTORY_15M;
  while (i < candles15m.length - 1) {
    const candle = candles15m[i];
    const day = utcDayKey(candle.openTime);
    if (day !== currentDay) {
      currentDay = day;
      tradesOpenedTodayUtc = 0;
      losingTradesTodayUtc = 0;
    }

    const hist15m = candles15m.slice(0, i + 1); // includes current, closed candle
    const hist1h = candles1h.filter((c) => c.openTime <= candle.openTime);

    if (hist1h.length < MIN_HISTORY_1H) {
      i += 1;
      continue;
    }

    const evaluation = evaluateSignal(config.symbol, hist1h, hist15m);
    if (evaluation.kind !== "SIGNAL" || evaluation.score.classification !== "CANDIDATE") {
      i += 1;
      continue;
    }

    const { stopPrice, targetPrice } = evaluation.score;
    if (stopPrice === null || targetPrice === null) {
      skips.push({ candleTime: candle.openTime, reason: "INVALID_RISK_REWARD" });
      i += 1;
      continue;
    }

    // Entry no earlier than the NEXT candle's open.
    const entryCandle = candles15m[i + 1];
    const rawEntryPrice = entryCandle.open;
    const entryPrice = rawEntryPrice * (1 + config.slippageBps / 10_000); // slippage against us

    const account: AccountState = {
      equity,
      openPositionsCount,
      tradesOpenedTodayUtc,
      losingTradesTodayUtc,
    };

    const decision = evaluateTradeRisk({
      tradingMode: "PAPER",
      strategyApproved: true,
      proposal: { entryPrice, stopPrice, targetPrice },
      account,
      limits: {
        maxRiskPerTradePct: config.maxRiskPerTradePct,
        maxOpenPositions: config.maxOpenPositions,
        maxNewTradesPerDay: config.maxNewTradesPerDay,
        maxLosingTradesPerDay: config.maxLosingTradesPerDay,
      },
      instrument: config.instrument,
      signalExpired: false,
    });

    if (!decision.approved) {
      skips.push({ candleTime: candle.openTime, reason: decision.reason });
      i += 1;
      continue;
    }

    const { qty } = decision.sizing;
    const entryFee = qty * entryPrice * (config.feeBps / 10_000);
    totalFees += entryFee;
    tradesOpenedTodayUtc += 1;
    openPositionsCount += 1;

    // Scan forward (starting at the entry candle itself) for stop/target.
    let exitIndex = -1;
    let outcome: BacktestTradeRecord["outcome"] = null;
    let exitPrice: number | null = null;

    for (let j = i + 1; j < candles15m.length; j++) {
      const bar = candles15m[j];
      const hitStop = bar.low <= stopPrice;
      const hitTarget = bar.high >= targetPrice;
      if (hitStop && hitTarget) {
        // Ambiguous same-candle touch: assume the unfavorable ordering.
        outcome = "STOP";
        exitPrice = stopPrice;
        exitIndex = j;
        break;
      }
      if (hitStop) {
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
      // Position still open at the end of available data.
      const lastClose = candles15m[candles15m.length - 1].close;
      trades.push({
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
        score: evaluation.score.total,
        regime: evaluation.regime,
        outcome: "OPEN_AT_END",
      });
      void lastClose;
      break; // no more data to advance through
    }

    const exitCandle = candles15m[exitIndex];
    const slippedExitPrice = exitPrice! * (1 - config.slippageBps / 10_000); // slippage against us on exit
    const exitFee = qty * slippedExitPrice * (config.feeBps / 10_000);
    totalFees += exitFee;

    const grossPnl = (slippedExitPrice - entryPrice) * qty;
    const pnl = grossPnl - entryFee - exitFee;
    const riskAmount = decision.sizing.riskAmount;
    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

    equity += pnl;
    openPositionsCount -= 1;
    if (pnl <= 0) losingTradesTodayUtc += 1;

    trades.push({
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
      score: evaluation.score.total,
      regime: evaluation.regime,
      outcome,
    });

    i = exitIndex + 1;
  }

  const metrics = computeMetrics(trades, config.initialEquity, totalFees);
  return { config, trades, skips, metrics };
}
