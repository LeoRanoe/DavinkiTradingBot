import type { Database } from "@/lib/supabase/database.types";
import type { TradingMode } from "@/lib/types/trading-mode";
import type { ScoreResult } from "@/lib/strategy/v1/score";
import type { CandidateBuildResult } from "./types";

export type SignalInsertRow = Database["public"]["Tables"]["signals"]["Insert"];

export type SignalRowInput = {
  strategyVersionId: string;
  symbol: string;
  timeframe: string;
  candleTimeMs: number;
  regime: string;
  score: ScoreResult;
  tradingMode: TradingMode;
  reason: string;
  /** Present only when the strategy produced a CANDIDATE classification and the candidate pipeline ran. */
  result?: CandidateBuildResult;
  referencePrice?: number;
  referencePriceAtMs?: number;
  /** Owner's approval-window bound; the effective expiry is the stricter of this and the candidate's own expiry. */
  signalExpiryMinutes: number;
  candidateExpiryMinutes: number;
  nowMs: number;
};

/**
 * Builds the single `signals` row that represents this evaluation.
 *
 * The signals row IS the candidate - there is no parallel candidates table
 * and no second state machine. The existing unique constraint on
 * (strategy_version_id, symbol, timeframe, candle_time) remains the only
 * deduplication mechanism.
 *
 * approval_status encodes the lifecycle, `rejection_reason` says who/what
 * rejected it:
 *   PENDING                          -> passed deterministic risk, awaiting the owner
 *   REJECTED + rejection_reason      -> the deterministic risk/candidate layer rejected it
 *   NOT_APPLICABLE                   -> never reached candidate classification (LOG/WATCH)
 */
export function buildSignalRow(input: SignalRowInput): SignalInsertRow {
  const candleTimeIso = new Date(input.candleTimeMs).toISOString();

  const base: SignalInsertRow = {
    strategy_version_id: input.strategyVersionId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    candle_time: candleTimeIso,
    regime: input.regime,
    score: input.score.total,
    classification: input.score.classification,
    entry_price: input.score.entryPrice,
    stop_price: input.score.stopPrice,
    target_price: input.score.targetPrice,
    risk_reward: input.score.riskReward,
    reason: input.reason,
    trading_mode: input.tradingMode,
    reference_price: input.referencePrice ?? null,
    reference_price_at: input.referencePriceAtMs ? new Date(input.referencePriceAtMs).toISOString() : null,
    approval_status: "NOT_APPLICABLE",
    expires_at: null,
  };

  // A strategy classification below CANDIDATE never reaches the risk layer:
  // preserve the existing behavior exactly (logged for research, not actionable).
  if (!input.result) return base;

  if (input.result.kind === "REJECTED") {
    const { rejection } = input.result;
    return {
      ...base,
      approval_status: "REJECTED",
      rejection_reason: rejection.reason,
      rejection_detail: rejection.detail,
      volatility_state: rejection.reason === "EXCESSIVE_VOLATILITY" ? "EXCESSIVE" : null,
    };
  }

  const { candidate } = input.result;

  // Honor BOTH owner-configured bounds: the candidate's own short entry-
  // protection expiry and the approval-window setting. The stricter one wins,
  // so enabling one can never silently extend the other.
  const candidateExpiryMs = new Date(candidate.lifecycle.expiresAt).getTime();
  const approvalWindowMs = input.nowMs + input.signalExpiryMinutes * 60_000;
  const effectiveExpiryMs = Math.min(candidateExpiryMs, approvalWindowMs);

  return {
    ...base,
    approval_status: "PENDING",
    expires_at: new Date(effectiveExpiryMs).toISOString(),
    planned_entry: candidate.position.plannedEntry,
    minimum_allowed_entry: candidate.position.minimumAllowedEntry,
    maximum_allowed_entry: candidate.position.maximumAllowedEntry,
    stop_price: candidate.position.stopPrice,
    target_price: candidate.position.targetPrice,
    stop_pct: candidate.position.stopPct,
    risk_reward: candidate.position.riskReward,
    reference_price: candidate.position.referencePrice,
    volatility_state: candidate.volatilityState,
    risk_snapshot: candidate.risk as unknown as Database["public"]["Tables"]["signals"]["Insert"]["risk_snapshot"],
    indicator_snapshot: candidate.indicators as unknown as Database["public"]["Tables"]["signals"]["Insert"]["indicator_snapshot"],
  };
}
