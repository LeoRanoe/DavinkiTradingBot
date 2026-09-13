import type { Database } from "@/lib/supabase/database.types";
import type { TradingMode } from "@/lib/types/trading-mode";
import type { ScoreComponent, ScoreResult } from "@/lib/strategy/v1/score";
import type { CandidateBuildResult, IndicatorSnapshot } from "./types";

export type SignalInsertRow = Database["public"]["Tables"]["signals"]["Insert"];
export type SignalRow = Database["public"]["Tables"]["signals"]["Row"];

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

/**
 * Rebuilds the strategy `ScoreResult` for a persisted candidate so an
 * approval can be revalidated WITHOUT re-deriving a historical decision
 * (Milestone 1 persisted the snapshot precisely so this is possible).
 *
 * Two deliberate choices:
 *  - `entryPrice` is the ORIGINAL `planned_entry`, so entry drift on
 *    approval is measured against the plan the owner was shown, not against
 *    a moving reference.
 *  - `atrPctOverride` lets the caller substitute a FRESH ATR reading, so the
 *    volatility gate re-evaluates current conditions instead of replaying
 *    the conditions that existed when the candidate was created.
 */
export function reconstructScoreResult(
  row: Pick<
    SignalRow,
    | "score"
    | "classification"
    | "planned_entry"
    | "entry_price"
    | "stop_price"
    | "target_price"
    | "risk_reward"
    | "indicator_snapshot"
  >,
  opts: { atrPctOverride?: number | null } = {},
): ScoreResult {
  const indicators = (row.indicator_snapshot ?? {}) as Partial<IndicatorSnapshot>;
  const atrPct =
    opts.atrPctOverride !== undefined ? opts.atrPctOverride : (indicators.atrPct ?? null);

  const components: ScoreComponent[] = [
    {
      name: "trend",
      pointsEarned: 0,
      pointsPossible: 0,
      detail: {
        ema20: indicators.ema20 ?? null,
        ema50: indicators.ema50 ?? null,
        ema200: indicators.ema200 ?? null,
      },
    },
    { name: "momentum", pointsEarned: 0, pointsPossible: 0, detail: { rsi: indicators.rsi14 ?? null } },
    {
      name: "volume",
      pointsEarned: 0,
      pointsPossible: 0,
      detail: { relativeVolume: indicators.relativeVolume ?? null },
    },
    { name: "volatility", pointsEarned: 0, pointsPossible: 0, detail: { atrPct } },
  ];

  return {
    total: row.score,
    classification: row.classification,
    entryPrice: row.planned_entry ?? row.entry_price ?? 0,
    stopPrice: row.stop_price,
    targetPrice: row.target_price,
    riskReward: row.risk_reward,
    components,
  };
}
