import type { TradingMode } from "@/lib/types/trading-mode";
import { evaluateTradeRisk } from "@/lib/risk/engine";
import { candidateKey, isDuplicateCandidate } from "@/lib/risk/duplicate-candidate";
import { checkEntryProtection, computeEntryZone, computeExpiry, type EntryProtectionConfig } from "@/lib/risk/entry-protection";
import { checkVolatility, type VolatilityConfig } from "@/lib/risk/volatility";
import type { AccountState, CostModel, InstrumentRules, RiskLimits } from "@/lib/risk/types";
import type { ScoreResult } from "@/lib/strategy/v1/score";
import type { CandidateBuildResult, IndicatorSnapshot, TradeCandidate } from "./types";

export type BuildCandidateInput = {
  candidateId: string;
  signalId: string;
  symbol: string;
  strategyVersionId: string;
  strategyVersionLabel: string;
  timeframe: string;
  closedCandleTimeMs: number;
  regime: string;
  score: ScoreResult;
  /** Fresh reference price (e.g. latest ticker), distinct from the signal candle's close. */
  referencePrice: number;
  marketDataTimestampMs: number;
  nowMs: number;
  account: AccountState;
  instrument: InstrumentRules;
  riskLimits: RiskLimits;
  costModel: CostModel;
  entryProtection: EntryProtectionConfig;
  volatility: VolatilityConfig;
  tradingMode: TradingMode;
  strategyApproved: boolean;
  existingActiveCandidateKeys?: ReadonlySet<string> | readonly string[];
};

function roundToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  return Math.round(price / tickSize) * tickSize;
}

function extractIndicatorSnapshot(score: ScoreResult): IndicatorSnapshot {
  const byName = Object.fromEntries(score.components.map((c) => [c.name, c.detail]));
  const trend = byName.trend ?? {};
  const momentum = byName.momentum ?? {};
  const volume = byName.volume ?? {};
  const volatility = byName.volatility ?? {};

  const atrPct = typeof volatility.atrPct === "number" ? volatility.atrPct : null;
  const atr14 = atrPct !== null ? atrPct * score.entryPrice : null;

  return {
    ema20: typeof trend.ema20 === "number" ? trend.ema20 : null,
    ema50: typeof trend.ema50 === "number" ? trend.ema50 : null,
    ema200: typeof trend.ema200 === "number" ? trend.ema200 : null,
    rsi14: typeof momentum.rsi === "number" ? momentum.rsi : null,
    atr14,
    atrPct,
    relativeVolume: typeof volume.relativeVolume === "number" ? volume.relativeVolume : null,
  };
}

function setupReasons(score: ScoreResult): string[] {
  return score.components
    .filter((c) => c.pointsEarned >= c.pointsPossible * 0.6)
    .map((c) => `${c.name}: ${c.pointsEarned}/${c.pointsPossible}`);
}

/**
 * Assembles the COMPLETE trade candidate (spec Milestone 1) from an
 * already-scored, already-regime-gated setup: entry protection, volatility
 * protection, duplicate prevention, and the deterministic risk engine, in
 * that order. Produces either a fully valid, financially complete candidate
 * or a precise typed rejection - never a partially-built object and never
 * an AI-influenced decision anywhere in this pipeline.
 */
export function buildTradeCandidate(input: BuildCandidateInput): CandidateBuildResult {
  const { score } = input;
  const closedCandleTimeIso = new Date(input.closedCandleTimeMs).toISOString();

  const baseRejection = {
    signalId: input.signalId,
    symbol: input.symbol,
    strategyVersionId: input.strategyVersionId,
    strategyVersionLabel: input.strategyVersionLabel,
    timeframe: input.timeframe,
    closedCandleTime: closedCandleTimeIso,
  };

  const minScore = input.riskLimits.minCandidateScore ?? 80;
  if (score.total < minScore) {
    return {
      kind: "REJECTED",
      rejection: {
        ...baseRejection,
        reason: "SCORE_TOO_LOW",
        detail: `Score ${score.total} is below the configured minimum ${minScore}.`,
      },
    };
  }

  if (score.stopPrice === null || score.targetPrice === null || score.riskReward === null) {
    return {
      kind: "REJECTED",
      rejection: {
        ...baseRejection,
        reason: "INVALID_RISK_REWARD",
        detail: "Strategy could not determine a valid stop/target for this setup.",
      },
    };
  }

  const minRiskReward = input.riskLimits.minRiskReward ?? 0;
  if (score.riskReward < minRiskReward) {
    return {
      kind: "REJECTED",
      rejection: {
        ...baseRejection,
        reason: "MIN_RISK_REWARD_NOT_MET",
        detail: `Risk/reward ${score.riskReward.toFixed(2)} is below the configured minimum ${minRiskReward.toFixed(2)}.`,
      },
    };
  }

  const key = candidateKey({
    strategyVersionId: input.strategyVersionId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    candleTimeMs: input.closedCandleTimeMs,
  });
  if (input.existingActiveCandidateKeys && isDuplicateCandidate(key, input.existingActiveCandidateKeys)) {
    return {
      kind: "REJECTED",
      rejection: {
        ...baseRejection,
        reason: "DUPLICATE_CANDIDATE",
        detail: "An active candidate already exists for this strategy version, symbol, timeframe, and candle.",
      },
    };
  }

  const plannedEntry = score.entryPrice;
  const zone = computeEntryZone(plannedEntry, input.entryProtection.maxEntryDriftPct);
  const createdAtMs = input.nowMs;
  const expiresAtMs = computeExpiry(createdAtMs, input.entryProtection.candidateExpiryMinutes);

  const protectionReason = checkEntryProtection({
    referencePrice: input.referencePrice,
    marketDataTimestampMs: input.marketDataTimestampMs,
    zone,
    createdAtMs,
    expiresAtMs,
    nowMs: input.nowMs,
    maxMarketDataAgeMs: input.entryProtection.maxMarketDataAgeMs,
  });
  if (protectionReason) {
    return {
      kind: "REJECTED",
      rejection: {
        ...baseRejection,
        reason: protectionReason,
        detail: `Entry protection check failed: ${protectionReason}.`,
      },
    };
  }

  const indicators = extractIndicatorSnapshot(score);
  const volatilityReason = checkVolatility(indicators.atrPct, input.volatility);
  if (volatilityReason) {
    return {
      kind: "REJECTED",
      rejection: {
        ...baseRejection,
        reason: volatilityReason,
        detail: `ATR is ${((indicators.atrPct ?? 0) * 100).toFixed(2)}% of price, above the configured max ${(input.volatility.maxAtrPct * 100).toFixed(2)}%.`,
      },
    };
  }

  // Full fresh-market revalidation: size against the current reference price,
  // not the stale candle-close price that produced the signal.
  const decision = evaluateTradeRisk({
    tradingMode: input.tradingMode,
    strategyApproved: input.strategyApproved,
    proposal: { entryPrice: input.referencePrice, stopPrice: score.stopPrice, targetPrice: score.targetPrice },
    account: input.account,
    limits: input.riskLimits,
    instrument: input.instrument,
    signalExpired: false,
    costModel: input.costModel,
  });

  if (!decision.approved) {
    return {
      kind: "REJECTED",
      rejection: { ...baseRejection, reason: decision.reason, detail: decision.detail },
    };
  }

  const { sizing } = decision;
  const stopPct = (input.referencePrice - score.stopPrice) / input.referencePrice;
  const riskMode = input.riskLimits.riskMode ?? "PERCENT_OF_EQUITY";
  const configuredRisk = riskMode === "FIXED_AMOUNT" ? (input.riskLimits.fixedRiskAmount ?? 0) : input.riskLimits.maxRiskPerTradePct;

  const candidate: TradeCandidate = {
    candidateId: input.candidateId,
    signalId: input.signalId,
    symbol: input.symbol,
    side: "LONG",
    marketType: "SPOT",
    venue: "BYBIT",
    strategyVersionId: input.strategyVersionId,
    strategyVersionLabel: input.strategyVersionLabel,
    timeframe: input.timeframe,
    closedCandleTime: closedCandleTimeIso,
    marketRegime: input.regime,
    strategyScore: score.total,
    scoreComponents: score.components,
    classification: score.classification,
    indicators,
    volatilityState: "NORMAL",
    setupReasons: setupReasons(score),
    position: {
      referencePrice: input.referencePrice,
      plannedEntry: roundToTick(plannedEntry, input.instrument.tickSize),
      minimumAllowedEntry: roundToTick(zone.minimumAllowedEntry, input.instrument.tickSize),
      maximumAllowedEntry: roundToTick(zone.maximumAllowedEntry, input.instrument.tickSize),
      stopPrice: roundToTick(score.stopPrice, input.instrument.tickSize),
      stopPct,
      targetPrice: roundToTick(score.targetPrice, input.instrument.tickSize),
      riskReward: sizing.riskReward,
      plannedR: sizing.riskReward,
    },
    risk: {
      equity: input.account.equity,
      availableBalance: input.account.availableBalance ?? input.account.equity,
      riskMode,
      configuredRisk,
      riskBudget: sizing.riskBudget,
      estimatedActualRisk: sizing.estimatedActualRisk,
      positionNotional: sizing.notional,
      quantity: sizing.qty,
      roundedQuantity: sizing.qty,
      expectedEntryFee: sizing.entryFee,
      expectedExitFee: sizing.exitFee,
      expectedSlippage: sizing.slippageCost,
      modeledMaxLoss: sizing.modeledMaxLoss,
      estimatedTargetProfit: sizing.estimatedTargetProfit,
    },
    lifecycle: {
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      state: "CANDIDATE",
      rejectionReason: null,
      rejectionDetail: null,
    },
    news: { riskLevel: null, summary: null, eventIds: [] },
  };

  return { kind: "CANDIDATE", candidate };
}
