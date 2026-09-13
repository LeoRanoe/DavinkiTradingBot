import { z } from "zod";
import type { CostModel, RiskLimits, RiskMode } from "@/lib/risk/types";
import type { EntryProtectionConfig } from "@/lib/risk/entry-protection";
import type { VolatilityConfig } from "@/lib/risk/volatility";
import type { TradingMode } from "@/lib/types/trading-mode";

/**
 * Owner-configurable risk configuration (Task A / Milestone 1).
 *
 * RISK IS NOT POSITION SIZE. The configured risk is the approximate amount
 * the owner intends to lose if the stop is hit; position size is derived
 * from that budget and the stop distance
 * (see lib/risk/position-sizing.ts).
 *
 * Every bound in `riskSettingsUpdateSchema` mirrors a CHECK constraint in
 * supabase/migrations/20260913190000_milestone1_owner_risk_and_candidates.sql,
 * so validation holds even if a request bypasses this application layer.
 */
export type ExecutionPolicy = "APPROVAL_REQUIRED" | "AUTO";

export type OwnerRiskSettings = {
  tradingMode: TradingMode;
  riskMode: RiskMode;
  /** Fraction of equity risked per trade in PERCENT_OF_EQUITY mode, e.g. 0.01 = 1%. */
  maxRiskPerTradePct: number;
  /** Dollar risk per trade in FIXED_AMOUNT mode. */
  fixedRiskAmount: number;
  maxOpenPositions: number;
  maxNewTradesPerDay: number;
  /** The daily-loss lock: new trades stop after this many losing trades in a UTC day. */
  maxLosingTradesPerDay: number;
  minCandidateScore: number;
  minRiskReward: number;
  maxEntryDriftPct: number;
  candidateExpiryMinutes: number;
  maxMarketDataAgeSeconds: number;
  maxAtrPct: number;
  feeBps: number;
  slippageBps: number;
  executionPolicy: ExecutionPolicy;
  signalExpiryMinutes: number;
};

/**
 * Starting PAPER equity when no portfolio snapshot exists yet. Matches
 * docs/RISK_MODEL.md. Deliberately a constant rather than something that
 * grows on its own - progress toward a goal never changes risk sizing
 * (Task A section 9).
 */
export const INITIAL_PAPER_EQUITY = 10;

/** Mirrors the database column defaults exactly. */
export const DEFAULT_RISK_SETTINGS: OwnerRiskSettings = {
  tradingMode: "OBSERVE",
  riskMode: "PERCENT_OF_EQUITY",
  maxRiskPerTradePct: 0.01,
  fixedRiskAmount: 1,
  maxOpenPositions: 1,
  maxNewTradesPerDay: 2,
  maxLosingTradesPerDay: 2,
  minCandidateScore: 80,
  minRiskReward: 1.5,
  maxEntryDriftPct: 0.002,
  candidateExpiryMinutes: 10,
  maxMarketDataAgeSeconds: 120,
  maxAtrPct: 0.05,
  feeBps: 10,
  slippageBps: 5,
  executionPolicy: "APPROVAL_REQUIRED",
  signalExpiryMinutes: 30,
};

type SystemSettingsRowLike = {
  trading_mode?: TradingMode | null;
  risk_mode?: string | null;
  max_risk_per_trade_pct?: number | string | null;
  fixed_risk_amount?: number | string | null;
  max_open_positions?: number | string | null;
  max_new_trades_per_day?: number | string | null;
  max_losing_trades_per_day?: number | string | null;
  min_candidate_score?: number | string | null;
  min_risk_reward?: number | string | null;
  max_entry_drift_pct?: number | string | null;
  candidate_expiry_minutes?: number | string | null;
  max_market_data_age_seconds?: number | string | null;
  max_atr_pct?: number | string | null;
  fee_bps?: number | string | null;
  slippage_bps?: number | string | null;
  execution_policy?: string | null;
  signal_expiry_minutes?: number | string | null;
};

function num(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parses a `system_settings` row into typed settings, falling back to the
 * documented defaults for anything missing. Numerics are coerced because
 * Postgres `numeric` can arrive as a string depending on the client.
 *
 * LIVE can never survive this boundary: a LIVE trading_mode (which the DB
 * CHECK constraint already forbids) is coerced back to OBSERVE rather than
 * trusted, and an AUTO execution policy is only honored for PAPER/DEMO.
 */
export function riskSettingsFromRow(row: SystemSettingsRowLike | null | undefined): OwnerRiskSettings {
  const d = DEFAULT_RISK_SETTINGS;
  if (!row) return { ...d };

  const tradingMode: TradingMode =
    row.trading_mode === "PAPER" || row.trading_mode === "DEMO" || row.trading_mode === "OBSERVE"
      ? row.trading_mode
      : "OBSERVE";

  const riskMode: RiskMode = row.risk_mode === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENT_OF_EQUITY";

  const requestedPolicy: ExecutionPolicy = row.execution_policy === "AUTO" ? "AUTO" : "APPROVAL_REQUIRED";
  const executionPolicy: ExecutionPolicy =
    requestedPolicy === "AUTO" && (tradingMode === "PAPER" || tradingMode === "DEMO")
      ? "AUTO"
      : "APPROVAL_REQUIRED";

  return {
    tradingMode,
    riskMode,
    maxRiskPerTradePct: num(row.max_risk_per_trade_pct, d.maxRiskPerTradePct),
    fixedRiskAmount: num(row.fixed_risk_amount, d.fixedRiskAmount),
    maxOpenPositions: num(row.max_open_positions, d.maxOpenPositions),
    maxNewTradesPerDay: num(row.max_new_trades_per_day, d.maxNewTradesPerDay),
    maxLosingTradesPerDay: num(row.max_losing_trades_per_day, d.maxLosingTradesPerDay),
    minCandidateScore: num(row.min_candidate_score, d.minCandidateScore),
    minRiskReward: num(row.min_risk_reward, d.minRiskReward),
    maxEntryDriftPct: num(row.max_entry_drift_pct, d.maxEntryDriftPct),
    candidateExpiryMinutes: num(row.candidate_expiry_minutes, d.candidateExpiryMinutes),
    maxMarketDataAgeSeconds: num(row.max_market_data_age_seconds, d.maxMarketDataAgeSeconds),
    maxAtrPct: num(row.max_atr_pct, d.maxAtrPct),
    feeBps: num(row.fee_bps, d.feeBps),
    slippageBps: num(row.slippage_bps, d.slippageBps),
    executionPolicy,
    signalExpiryMinutes: num(row.signal_expiry_minutes, d.signalExpiryMinutes),
  };
}

export function toRiskLimits(settings: OwnerRiskSettings): RiskLimits {
  return {
    maxRiskPerTradePct: settings.maxRiskPerTradePct,
    maxOpenPositions: settings.maxOpenPositions,
    maxNewTradesPerDay: settings.maxNewTradesPerDay,
    maxLosingTradesPerDay: settings.maxLosingTradesPerDay,
    riskMode: settings.riskMode,
    fixedRiskAmount: settings.fixedRiskAmount,
    minCandidateScore: settings.minCandidateScore,
    minRiskReward: settings.minRiskReward,
  };
}

export function toCostModel(settings: OwnerRiskSettings): CostModel {
  return { feeBps: settings.feeBps, slippageBps: settings.slippageBps };
}

export function toEntryProtectionConfig(settings: OwnerRiskSettings): EntryProtectionConfig {
  return {
    maxEntryDriftPct: settings.maxEntryDriftPct,
    candidateExpiryMinutes: settings.candidateExpiryMinutes,
    maxMarketDataAgeMs: settings.maxMarketDataAgeSeconds * 1000,
  };
}

export function toVolatilityConfig(settings: OwnerRiskSettings): VolatilityConfig {
  return { maxAtrPct: settings.maxAtrPct };
}

/**
 * Server-side validation for owner risk updates. Bounds mirror the database
 * CHECK constraints exactly - the client form is a convenience, never the
 * authority. Every field is optional so the owner can patch one setting.
 */
export const riskSettingsUpdateSchema = z
  .object({
    riskMode: z.enum(["PERCENT_OF_EQUITY", "FIXED_AMOUNT"]),
    maxRiskPerTradePct: z.number().gt(0).max(0.1),
    fixedRiskAmount: z.number().gt(0).max(100_000),
    maxOpenPositions: z.number().int().min(1).max(10),
    maxNewTradesPerDay: z.number().int().min(1).max(50),
    maxLosingTradesPerDay: z.number().int().min(1).max(50),
    minCandidateScore: z.number().int().min(0).max(100),
    minRiskReward: z.number().min(0).max(100),
    maxEntryDriftPct: z.number().gt(0).max(0.5),
    candidateExpiryMinutes: z.number().int().min(1).max(240),
    maxMarketDataAgeSeconds: z.number().int().min(10).max(3600),
    maxAtrPct: z.number().gt(0).max(1),
    feeBps: z.number().min(0).max(1000),
    slippageBps: z.number().min(0).max(1000),
    // LIVE is not representable here at all: the enum has two values and
    // neither implies real-money trading. AUTO stays a PAPER/DEMO-only
    // future capability, additionally enforced by a DB CHECK constraint.
    executionPolicy: z.enum(["APPROVAL_REQUIRED", "AUTO"]),
    signalExpiryMinutes: z.number().int().min(1).max(1440),
  })
  .partial();

export type RiskSettingsUpdate = z.infer<typeof riskSettingsUpdateSchema>;

/** Maps a validated update onto `system_settings` column names. */
export function riskSettingsUpdateToRow(update: RiskSettingsUpdate): Record<string, number | string> {
  const row: Record<string, number | string> = {};
  if (update.riskMode !== undefined) row.risk_mode = update.riskMode;
  if (update.maxRiskPerTradePct !== undefined) row.max_risk_per_trade_pct = update.maxRiskPerTradePct;
  if (update.fixedRiskAmount !== undefined) row.fixed_risk_amount = update.fixedRiskAmount;
  if (update.maxOpenPositions !== undefined) row.max_open_positions = update.maxOpenPositions;
  if (update.maxNewTradesPerDay !== undefined) row.max_new_trades_per_day = update.maxNewTradesPerDay;
  if (update.maxLosingTradesPerDay !== undefined) row.max_losing_trades_per_day = update.maxLosingTradesPerDay;
  if (update.minCandidateScore !== undefined) row.min_candidate_score = update.minCandidateScore;
  if (update.minRiskReward !== undefined) row.min_risk_reward = update.minRiskReward;
  if (update.maxEntryDriftPct !== undefined) row.max_entry_drift_pct = update.maxEntryDriftPct;
  if (update.candidateExpiryMinutes !== undefined) row.candidate_expiry_minutes = update.candidateExpiryMinutes;
  if (update.maxMarketDataAgeSeconds !== undefined) row.max_market_data_age_seconds = update.maxMarketDataAgeSeconds;
  if (update.maxAtrPct !== undefined) row.max_atr_pct = update.maxAtrPct;
  if (update.feeBps !== undefined) row.fee_bps = update.feeBps;
  if (update.slippageBps !== undefined) row.slippage_bps = update.slippageBps;
  if (update.executionPolicy !== undefined) row.execution_policy = update.executionPolicy;
  if (update.signalExpiryMinutes !== undefined) row.signal_expiry_minutes = update.signalExpiryMinutes;
  return row;
}

/**
 * Optional starting points. A preset only POPULATES owner-editable fields -
 * it is validated by exactly the same schema and DB constraints as a manual
 * edit, and nothing ever selects one automatically. In particular, a small
 * or slow-growing account never escalates itself to GROWTH_EXPERIMENT
 * (Task A sections 6 and 9).
 */
export type RiskPresetName = "CONSERVATIVE" | "BALANCED" | "GROWTH_EXPERIMENT";

export const RISK_PRESETS: Record<RiskPresetName, Required<Omit<RiskSettingsUpdate, "executionPolicy">>> = {
  CONSERVATIVE: {
    riskMode: "PERCENT_OF_EQUITY",
    maxRiskPerTradePct: 0.005,
    fixedRiskAmount: 0.5,
    maxOpenPositions: 1,
    maxNewTradesPerDay: 1,
    maxLosingTradesPerDay: 1,
    minCandidateScore: 85,
    minRiskReward: 2,
    maxEntryDriftPct: 0.0015,
    candidateExpiryMinutes: 10,
    maxMarketDataAgeSeconds: 120,
    maxAtrPct: 0.03,
    feeBps: 10,
    slippageBps: 5,
    signalExpiryMinutes: 30,
  },
  BALANCED: {
    riskMode: "PERCENT_OF_EQUITY",
    maxRiskPerTradePct: 0.01,
    fixedRiskAmount: 1,
    maxOpenPositions: 1,
    maxNewTradesPerDay: 2,
    maxLosingTradesPerDay: 2,
    minCandidateScore: 80,
    minRiskReward: 1.5,
    maxEntryDriftPct: 0.002,
    candidateExpiryMinutes: 10,
    maxMarketDataAgeSeconds: 120,
    maxAtrPct: 0.05,
    feeBps: 10,
    slippageBps: 5,
    signalExpiryMinutes: 30,
  },
  GROWTH_EXPERIMENT: {
    riskMode: "PERCENT_OF_EQUITY",
    maxRiskPerTradePct: 0.02,
    fixedRiskAmount: 2,
    maxOpenPositions: 1,
    maxNewTradesPerDay: 3,
    maxLosingTradesPerDay: 2,
    minCandidateScore: 80,
    minRiskReward: 1.5,
    maxEntryDriftPct: 0.0025,
    candidateExpiryMinutes: 10,
    maxMarketDataAgeSeconds: 120,
    maxAtrPct: 0.06,
    feeBps: 10,
    slippageBps: 5,
    signalExpiryMinutes: 30,
  },
};
