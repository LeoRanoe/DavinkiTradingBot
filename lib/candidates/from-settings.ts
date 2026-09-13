import type { AccountState, InstrumentRules } from "@/lib/risk/types";
import type { ScoreResult } from "@/lib/strategy/v1/score";
import {
  toCostModel,
  toEntryProtectionConfig,
  toRiskLimits,
  toVolatilityConfig,
  type OwnerRiskSettings,
} from "@/lib/settings/risk-settings";
import { buildTradeCandidate } from "./build-candidate";
import type { CandidateBuildResult } from "./types";

export type ScanCandidateInput = {
  /** The signals row id, generated up front so candidateId === signalId === the persisted row. */
  signalId: string;
  symbol: string;
  strategyVersionId: string;
  strategyVersionLabel: string;
  timeframe: string;
  closedCandleTimeMs: number;
  regime: string;
  score: ScoreResult;
  /** Fresh market price, NOT the signal candle's close. */
  referencePrice: number;
  marketDataTimestampMs: number;
  nowMs: number;
  account: AccountState;
  /** Exchange rules read dynamically from the venue - never hardcoded. */
  instrument: InstrumentRules;
  settings: OwnerRiskSettings;
  strategyApproved: boolean;
  existingActiveCandidateKeys?: ReadonlySet<string> | readonly string[];
};

/**
 * Adapts the owner's stored risk configuration into the deterministic
 * candidate pipeline. This is the single place the scanner (and, from
 * Milestone 2, the approval revalidation path) turns settings into the
 * typed configs `buildTradeCandidate` consumes - so both paths are
 * guaranteed to read the same owner settings the same way.
 */
export function buildCandidateForScan(input: ScanCandidateInput): CandidateBuildResult {
  return buildTradeCandidate({
    candidateId: input.signalId,
    signalId: input.signalId,
    symbol: input.symbol,
    strategyVersionId: input.strategyVersionId,
    strategyVersionLabel: input.strategyVersionLabel,
    timeframe: input.timeframe,
    closedCandleTimeMs: input.closedCandleTimeMs,
    regime: input.regime,
    score: input.score,
    referencePrice: input.referencePrice,
    marketDataTimestampMs: input.marketDataTimestampMs,
    nowMs: input.nowMs,
    account: input.account,
    instrument: input.instrument,
    riskLimits: toRiskLimits(input.settings),
    costModel: toCostModel(input.settings),
    entryProtection: toEntryProtectionConfig(input.settings),
    volatility: toVolatilityConfig(input.settings),
    tradingMode: input.settings.tradingMode,
    strategyApproved: input.strategyApproved,
    existingActiveCandidateKeys: input.existingActiveCandidateKeys,
  });
}
