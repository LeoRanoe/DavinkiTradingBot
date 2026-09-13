import { latestEma } from "@/lib/indicators/ema";
import { latestRsi } from "@/lib/indicators/rsi";
import { latestAtr } from "@/lib/indicators/atr";
import { relativeVolume } from "@/lib/indicators/volume";
import { latestSwingLow } from "@/lib/indicators/swings";
import type { Candle } from "@/lib/bybit/types";
import { STRATEGY_V1_PARAMS } from "./config";

export type ScoreComponent = {
  name: "trend" | "pullback" | "momentum" | "volume" | "riskReward" | "volatility";
  pointsEarned: number;
  pointsPossible: number;
  detail: Record<string, number | null | boolean>;
};

export type ScoreResult = {
  total: number;
  classification: "IGNORE" | "LOG" | "WATCH" | "CANDIDATE";
  components: ScoreComponent[];
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  riskReward: number | null;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Strategy V1 setup score on the 15M entry timeframe. Assumes the 1H regime
 * gate has already passed (callers must check evaluateRegime first - this
 * function does not re-check the regime).
 */
export function scoreSetup(candles15m: Candle[]): ScoreResult {
  const p = STRATEGY_V1_PARAMS;
  const closes = candles15m.map((c) => c.close);
  const volumes = candles15m.map((c) => c.volume);
  const bars = candles15m.map((c) => ({ high: c.high, low: c.low, close: c.close }));
  const entryPrice = closes[closes.length - 1];

  const ema20 = latestEma(closes, p.ema.fast);
  const ema50 = latestEma(closes, p.ema.mid);
  const ema200 = latestEma(closes, p.ema.slow);
  const rsiValue = latestRsi(closes, p.rsiPeriod);
  const atrValue = latestAtr(bars, p.atrPeriod);
  const relVol = relativeVolume(volumes, p.volumeAveragePeriod);
  const swingLow = latestSwingLow(
    candles15m.map((c) => ({ high: c.high, low: c.low })),
    p.swingLookback,
  );

  const components: ScoreComponent[] = [];

  // --- Trend quality: full 15M EMA stack alignment (20 > 50 > 200). -------
  let trendPoints = 0;
  if (ema20 !== null && ema50 !== null && ema200 !== null) {
    if (ema20 > ema50 && ema50 > ema200) trendPoints = p.weights.trend;
    else if (ema20 > ema200) trendPoints = p.weights.trend * 0.5;
  }
  components.push({
    name: "trend",
    pointsEarned: round1(trendPoints),
    pointsPossible: p.weights.trend,
    detail: { ema20, ema50, ema200 },
  });

  // --- Pullback quality: price proximity to EMA20, scaled by ATR. --------
  let pullbackPoints = 0;
  let pullbackDistanceAtr: number | null = null;
  if (ema20 !== null && atrValue !== null && atrValue > 0) {
    pullbackDistanceAtr = Math.abs(entryPrice - ema20) / atrValue;
    // Within 0.25 ATR of EMA20 => full credit; beyond 1.5 ATR => zero.
    pullbackPoints = p.weights.pullback * clamp01(1 - (pullbackDistanceAtr - 0.25) / 1.25);
  }
  components.push({
    name: "pullback",
    pointsEarned: round1(pullbackPoints),
    pointsPossible: p.weights.pullback,
    detail: { pullbackDistanceAtr, ema20 },
  });

  // --- Momentum: RSI resetting within a healthy band, not overheated. ----
  let momentumPoints = 0;
  if (rsiValue !== null) {
    const { min, max } = p.momentumRsiBand;
    if (rsiValue >= min && rsiValue <= max) momentumPoints = p.weights.momentum;
    else {
      const dist = rsiValue < min ? min - rsiValue : rsiValue - max;
      momentumPoints = p.weights.momentum * clamp01(1 - dist / 20);
    }
  }
  components.push({
    name: "momentum",
    pointsEarned: round1(momentumPoints),
    pointsPossible: p.weights.momentum,
    detail: { rsi: rsiValue },
  });

  // --- Volume: relative volume vs trailing average. -----------------------
  let volumePoints = 0;
  if (relVol !== null) {
    const { relativeVolumeFullCreditAt: full, relativeVolumeZeroCreditAt: zero } = p;
    volumePoints = p.weights.volume * clamp01((relVol - zero) / (full - zero));
  }
  components.push({
    name: "volume",
    pointsEarned: round1(volumePoints),
    pointsPossible: p.weights.volume,
    detail: { relativeVolume: relVol },
  });

  // --- Risk/Reward: stop at recent swing low (or ATR fallback), target at
  // targetRMultiple x the resulting stop distance. ------------------------
  let stopPrice: number | null = null;
  if (swingLow !== null && swingLow < entryPrice) {
    stopPrice = swingLow;
  } else if (atrValue !== null) {
    stopPrice = entryPrice - atrValue * 1.5;
  }
  let riskReward: number | null = null;
  let targetPrice: number | null = null;
  let rrPoints = 0;
  if (stopPrice !== null && stopPrice < entryPrice) {
    const stopDistance = entryPrice - stopPrice;
    targetPrice = entryPrice + stopDistance * p.targetRMultiple;
    riskReward = (targetPrice - entryPrice) / stopDistance;
    rrPoints = p.weights.riskReward * clamp01(riskReward / p.targetRMultiple);
  }
  components.push({
    name: "riskReward",
    pointsEarned: round1(rrPoints),
    pointsPossible: p.weights.riskReward,
    detail: { stopPrice, targetPrice, riskReward },
  });

  // --- Volatility: ATR as % of price within a healthy band. --------------
  let volatilityPoints = 0;
  let atrPct: number | null = null;
  if (atrValue !== null && entryPrice > 0) {
    atrPct = atrValue / entryPrice;
    const { min, max } = p.volatilityBandPct;
    if (atrPct >= min && atrPct <= max) volatilityPoints = p.weights.volatility;
    else {
      const dist = atrPct < min ? min - atrPct : atrPct - max;
      volatilityPoints = p.weights.volatility * clamp01(1 - dist / min);
    }
  }
  components.push({
    name: "volatility",
    pointsEarned: round1(volatilityPoints),
    pointsPossible: p.weights.volatility,
    detail: { atrPct },
  });

  const total = Math.round(components.reduce((sum, c) => sum + c.pointsEarned, 0));
  const classification = classify(total);

  return { total, classification, components, entryPrice, stopPrice, targetPrice, riskReward };
}

function classify(score: number): ScoreResult["classification"] {
  const c = STRATEGY_V1_PARAMS.classification;
  if (score <= c.ignoreMax) return "IGNORE";
  if (score <= c.logMax) return "LOG";
  if (score <= c.watchMax) return "WATCH";
  return "CANDIDATE";
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
