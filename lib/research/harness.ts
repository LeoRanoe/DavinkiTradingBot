import type { Candle } from "@/lib/bybit/types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { computePositionSizeFromBudget } from "@/lib/risk/position-sizing";
import { calculateLongExcursions } from "@/lib/learning/outcomes";
import type { InstrumentRules } from "@/lib/risk/types";
import type { ScoreComponent } from "@/lib/strategy/v1/score";
import { scoreBand, volatilityBand, type ScoreBand, type VolatilityBand } from "./report";

/**
 * The research harness: a hostile-testing superset of the production
 * backtester.
 *
 * It deliberately does NOT replace `lib/backtest/engine.ts`. That engine is
 * the proven, tested path behind the /backtests surface and stays untouched.
 * This one exists to answer questions the production engine was never built
 * to answer - what would sub-threshold scores have done, how much does an
 * entry delay cost, does the edge survive worse fills - and it is research
 * only: nothing here can open a position or move PAPER equity.
 *
 * WHAT IS SHARED WITH PRODUCTION (deliberately, so results mean something):
 *   - `evaluateSignal`      - the real Strategy V1, unmodified
 *   - `computePositionSizeFromBudget` - the real sizing primitive
 *   - `calculateLongExcursions`       - the real MFE/MAE measurement
 *
 * WHAT IS SIMULATED HERE:
 *   - fills, costs, entry delay, and the stop/target variant under test.
 *
 * NO LOOK-AHEAD. A signal is scored only from candles up to and including the
 * current closed 15m candle; entry can never occur before the NEXT candle's
 * open; and when a single bar touches both stop and target, STOP wins - the
 * unfavourable ordering - exactly as the production backtester assumes.
 */

export type TradeTrack =
  /** Met the real CANDIDATE threshold: this is what V1 would actually trade. */
  | "AUTHORITATIVE"
  /** Below the real threshold. Recorded for score-band research, never traded. */
  | "SHADOW";

export type ResearchTrade = {
  symbol: string;
  track: TradeTrack;
  signalTime: number;
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  riskBudget: number;
  /** Planned loss at the stop, from price alone. The R denominator. */
  plannedRisk: number;
  fees: number;
  slippage: number;
  grossPnl: number | null;
  pnl: number | null;
  rMultiple: number | null;
  outcome: "STOP" | "TARGET" | "OPEN_AT_END";
  score: number;
  band: ScoreBand;
  classification: string;
  regime: string;
  atrPct: number | null;
  volatility: VolatilityBand;
  components: Record<string, number>;
  mfeR: number | null;
  maeR: number | null;
  mfePrice: number;
  maePrice: number;
  /** Bars held. Lets duration effects be separated from price effects. */
  barsHeld: number;
};

export type ResearchSkip = {
  signalTime: number;
  score: number;
  band: ScoreBand;
  reason: string;
};

export type StopTargetVariant = {
  label: string;
  /** Multiplies the strategy's stop DISTANCE. 1 = V1 unchanged. */
  stopDistanceMultiple: number;
  /** Target as a multiple of the (possibly adjusted) stop distance. */
  targetRMultiple: number;
};

export const V1_STOP_TARGET: StopTargetVariant = {
  label: "V1",
  stopDistanceMultiple: 1,
  targetRMultiple: 2,
};

export type HarnessConfig = {
  symbol: string;
  /** Risk budget per trade, in quote currency. Held constant across variants. */
  riskBudget: number;
  equity: number;
  instrument: InstrumentRules;
  feeBps: number;
  slippageBps: number;
  /** Minimum score that counts as AUTHORITATIVE. Below it, trades are SHADOW. */
  minCandidateScore: number;
  /** Minimum risk/reward an AUTHORITATIVE trade must clear. */
  minRiskReward: number;
  /** Upper ATR% bound. Above it, an AUTHORITATIVE trade is skipped. */
  maxAtrPct: number;
  /**
   * Bars to wait after the signal before entering. 0 = next bar's open, the
   * production assumption. Higher values model approval/queueing delay.
   */
  entryDelayBars?: number;
  /** Stop/target shape under test. Sizing always re-derives from the budget. */
  stopTarget?: StopTargetVariant;
  /** Record sub-threshold bands as SHADOW trades (score-band research). */
  includeShadowBands?: boolean;
  /** Lowest score worth recording at all. Below this is noise. */
  shadowMinScore?: number;
};

export type HarnessResult = {
  config: HarnessConfig;
  trades: ResearchTrade[];
  skips: ResearchSkip[];
  /** Signals seen per band, before any risk filtering. The funnel's mouth. */
  bandCounts: Record<string, number>;
};

const MIN_HISTORY = 210; // EMA200 plus buffer

/**
 * Runs Strategy V1 across history under one research configuration.
 *
 * AUTHORITATIVE and SHADOW trades are accounted SEPARATELY and neither ever
 * touches the other: shadow trades consume no position slot, no daily limit
 * and no equity. That isolation is the point - a shadow winner must never be
 * able to flatter, or crowd out, the track that represents what V1 would
 * really have done.
 */
export function runResearchHarness(
  config: HarnessConfig,
  candles1h: Candle[],
  candles15m: Candle[],
): HarnessResult {
  const trades: ResearchTrade[] = [];
  const skips: ResearchSkip[] = [];
  const bandCounts: Record<string, number> = {};

  const stopTarget = config.stopTarget ?? V1_STOP_TARGET;
  const delay = Math.max(0, config.entryDelayBars ?? 0);
  const shadowMinScore = config.shadowMinScore ?? 60;

  const closed1h = candles1h.filter((c) => c.isClosed);
  const closed15m = candles15m.filter((c) => c.isClosed);

  // The authoritative track carries position state; shadow trades do not.
  let authoritativeOpenUntil = -1;

  for (let i = MIN_HISTORY; i < closed15m.length - (delay + 1); i += 1) {
    const candle = closed15m[i];

    // No look-ahead: only candles up to and including this one are visible.
    const hist15m = closed15m.slice(0, i + 1);
    const hist1h = closed1h.filter((c) => c.openTime <= candle.openTime);
    if (hist1h.length < MIN_HISTORY) continue;

    const evaluation = evaluateSignal(config.symbol, hist1h, hist15m);
    if (evaluation.kind !== "SIGNAL") continue;

    const { score } = evaluation;
    if (score.total < shadowMinScore) continue;
    if (score.stopPrice === null || score.targetPrice === null) continue;

    const band = scoreBand(score.total);
    bandCounts[band] = (bandCounts[band] ?? 0) + 1;

    const atrPct = readAtrPct(score.components);
    const isAuthoritative = score.total >= config.minCandidateScore;

    if (!isAuthoritative && !config.includeShadowBands) continue;

    // An authoritative trade is blocked while one is already open. A shadow
    // trade is never blocked - it is measuring the setup, not a portfolio.
    if (isAuthoritative && candle.openTime <= authoritativeOpenUntil) {
      skips.push({ signalTime: candle.openTime, score: score.total, band, reason: "OPEN_POSITION_LIMIT" });
      continue;
    }

    // --- The trade plan under test -------------------------------------
    // Stop distance comes from the strategy, scaled by the variant. Target is
    // then a multiple of THAT distance, so a wider stop does not silently
    // keep a nearer target.
    const referencePrice = score.entryPrice;
    const baseStopDistance = referencePrice - score.stopPrice;
    if (baseStopDistance <= 0) continue;

    const stopDistance = baseStopDistance * stopTarget.stopDistanceMultiple;
    const stopPrice = referencePrice - stopDistance;
    const targetPrice = referencePrice + stopDistance * stopTarget.targetRMultiple;
    const riskReward = stopTarget.targetRMultiple;

    // --- Entry: never before the next bar, plus any modelled delay ------
    const entryIndex = i + 1 + delay;
    if (entryIndex >= closed15m.length) break;
    const entryCandle = closed15m[entryIndex];
    const entryPrice = entryCandle.open * (1 + config.slippageBps / 10_000); // against us

    // Authoritative filters mirror the live owner settings.
    if (isAuthoritative) {
      if (riskReward < config.minRiskReward) {
        skips.push({ signalTime: candle.openTime, score: score.total, band, reason: "MIN_RISK_REWARD_NOT_MET" });
        continue;
      }
      if (atrPct !== null && atrPct > config.maxAtrPct) {
        skips.push({ signalTime: candle.openTime, score: score.total, band, reason: "EXCESSIVE_VOLATILITY" });
        continue;
      }
    }

    // --- Sizing: ALWAYS re-derived from the same risk budget ------------
    // This is what makes stop/target variants comparable. Keeping position
    // size fixed while changing stop distance would silently change the risk
    // taken, and every downstream R would be measured against a different
    // unit - the comparison would be meaningless.
    const sized = computePositionSizeFromBudget(
      { entryPrice, stopPrice, targetPrice },
      { equity: config.equity, availableBalance: config.equity, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 },
      config.riskBudget,
      config.instrument,
      { feeBps: config.feeBps, slippageBps: config.slippageBps },
    );

    if (!sized.approved) {
      skips.push({ signalTime: candle.openTime, score: score.total, band, reason: sized.reason });
      continue;
    }

    const { qty } = sized.sizing;

    // --- Walk forward to the exit --------------------------------------
    let exitIndex = -1;
    let outcome: ResearchTrade["outcome"] = "OPEN_AT_END";
    let rawExitPrice: number | null = null;

    for (let j = entryIndex; j < closed15m.length; j += 1) {
      const bar = closed15m[j];
      const hitStop = bar.low <= stopPrice;
      const hitTarget = bar.high >= targetPrice;
      if (hitStop) {
        // Stop wins a same-bar tie: we cannot resolve intra-bar order, so we
        // assume the unfavourable one.
        outcome = "STOP";
        rawExitPrice = stopPrice;
        exitIndex = j;
        break;
      }
      if (hitTarget) {
        outcome = "TARGET";
        rawExitPrice = targetPrice;
        exitIndex = j;
        break;
      }
    }

    const pathEnd = exitIndex === -1 ? closed15m.length - 1 : exitIndex;
    const path = closed15m.slice(entryIndex, pathEnd + 1);
    const excursions = calculateLongExcursions(entryPrice, stopPrice, path);

    const entryNotional = qty * entryPrice;
    const entryFee = entryNotional * (config.feeBps / 10_000);
    const entrySlip = entryNotional * (config.slippageBps / 10_000);

    const base = {
      symbol: config.symbol,
      track: (isAuthoritative ? "AUTHORITATIVE" : "SHADOW") as TradeTrack,
      signalTime: candle.openTime,
      entryTime: entryCandle.openTime,
      entryPrice,
      stopPrice,
      targetPrice,
      qty,
      riskBudget: config.riskBudget,
      plannedRisk: qty * (entryPrice - stopPrice),
      score: score.total,
      band,
      classification: score.classification,
      regime: evaluation.regime,
      atrPct,
      volatility: volatilityBand(atrPct),
      components: componentMap(score.components),
      mfeR: excursions.mfeR,
      maeR: excursions.maeR,
      mfePrice: excursions.mfePrice,
      maePrice: excursions.maePrice,
      barsHeld: path.length,
    };

    if (exitIndex === -1 || rawExitPrice === null) {
      // Unresolved at the end of data. Recorded so the funnel stays honest,
      // but carries null P/L so it can never be counted as a win or a loss.
      trades.push({
        ...base,
        exitTime: null,
        exitPrice: null,
        fees: entryFee,
        slippage: entrySlip,
        grossPnl: null,
        pnl: null,
        rMultiple: null,
        outcome: "OPEN_AT_END",
      });
      continue;
    }

    const exitPrice = rawExitPrice * (1 - config.slippageBps / 10_000); // against us
    const exitNotional = qty * exitPrice;
    const exitFee = exitNotional * (config.feeBps / 10_000);
    const exitSlip = exitNotional * (config.slippageBps / 10_000);

    const grossPnl = (exitPrice - entryPrice) * qty;
    const pnl = grossPnl - entryFee - exitFee;
    const plannedRisk = qty * (entryPrice - stopPrice);
    const rMultiple = plannedRisk > 0 ? pnl / plannedRisk : null;

    trades.push({
      ...base,
      exitTime: closed15m[exitIndex].openTime,
      exitPrice,
      fees: entryFee + exitFee,
      slippage: entrySlip + exitSlip,
      grossPnl,
      pnl,
      rMultiple,
      outcome,
    });

    if (isAuthoritative) {
      // Only the authoritative track holds a position slot.
      authoritativeOpenUntil = closed15m[exitIndex].openTime;
    }
  }

  return { config, trades, skips, bandCounts };
}

function readAtrPct(components: ScoreComponent[]): number | null {
  const vol = components.find((c) => c.name === "volatility");
  const value = vol?.detail?.atrPct;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function componentMap(components: ScoreComponent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of components) out[c.name] = c.pointsEarned;
  return out;
}

/** Only the authoritative track represents what V1 would actually have done. */
export function authoritative(trades: ResearchTrade[]): ResearchTrade[] {
  return trades.filter((t) => t.track === "AUTHORITATIVE");
}

export function shadow(trades: ResearchTrade[]): ResearchTrade[] {
  return trades.filter((t) => t.track === "SHADOW");
}
