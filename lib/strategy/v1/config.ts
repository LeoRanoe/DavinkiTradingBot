/**
 * Strategy V1 - deterministic research baseline.
 *
 * This is NOT claimed to be optimal. It is a simple, interpretable starting
 * point so the platform can generate real signals, paper trade them, and
 * measure whether the approach has positive expectancy after costs. See
 * docs/STRATEGY_V1.md for the full rationale and known limitations.
 *
 * These parameters are versioned: a change to any of these values must ship
 * as a NEW strategy_versions row, never a mutation of an existing one.
 */
export const STRATEGY_V1_VERSION_LABEL = "v1";

export const STRATEGY_V1_PARAMS = {
  symbols: ["BTCUSDT", "ETHUSDT"] as const,
  regimeTimeframe: "1H" as const,
  entryTimeframe: "15M" as const,

  ema: { fast: 20, mid: 50, slow: 200 },
  rsiPeriod: 14,
  atrPeriod: 14,
  volumeAveragePeriod: 20,
  swingLookback: 3,

  // Score weights must sum to 100.
  weights: {
    trend: 25,
    pullback: 20,
    momentum: 15,
    volume: 15,
    riskReward: 15,
    volatility: 10,
  },

  classification: {
    ignoreMax: 59,
    logMax: 69,
    watchMax: 79,
    // 80-100 => CANDIDATE
  },

  // Risk/reward target used when scoring the R/R component and when the
  // strategy proposes a take-profit distance as a multiple of stop distance.
  targetRMultiple: 2,

  // Healthy ATR-as-%-of-price band used for the volatility component.
  volatilityBandPct: { min: 0.003, max: 0.03 },

  // Momentum "reset" RSI band - price cooled off from strength without
  // being oversold/overbought.
  momentumRsiBand: { min: 40, max: 65 },

  relativeVolumeFullCreditAt: 1.2,
  relativeVolumeZeroCreditAt: 0.5,
} as const;

export type StrategyV1Params = typeof STRATEGY_V1_PARAMS;
