import type { ScoreComponent } from "@/lib/strategy/v1/score";
import type { RejectionReason, RiskMode } from "@/lib/risk/types";

/**
 * Full candidate lifecycle (spec Milestone 1 "Candidate lifecycle"). The
 * deterministic builder in this module only ever produces CANDIDATE or
 * REJECTED - the remaining states are later transitions owned by the
 * approval/execution/monitoring flow (Milestone 2), extending the same
 * object rather than a second competing state model.
 */
export type CandidateState =
  | "CANDIDATE"
  | "PENDING_APPROVAL"
  | "REJECTED"
  | "REJECTED_BY_OWNER"
  | "EXPIRED"
  | "OPENING"
  | "OPEN"
  | "STOPPED"
  | "TARGET_HIT"
  | "CLOSED"
  | "CANCELLED"
  | "ERROR";

export type IndicatorSnapshot = {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  atrPct: number | null;
  relativeVolume: number | null;
};

export type NewsFields = {
  /** Left empty structurally until the News milestone (spec Milestone 3). */
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null;
  summary: string | null;
  eventIds: string[];
};

export type CandidatePosition = {
  referencePrice: number;
  plannedEntry: number;
  minimumAllowedEntry: number;
  maximumAllowedEntry: number;
  stopPrice: number;
  stopPct: number;
  targetPrice: number;
  riskReward: number;
  plannedR: number;
};

export type CandidateRisk = {
  equity: number;
  availableBalance: number;
  riskMode: RiskMode;
  configuredRisk: number; // pct (as a fraction) or fixed dollar amount, depending on riskMode
  riskBudget: number;
  estimatedActualRisk: number;
  positionNotional: number;
  quantity: number;
  roundedQuantity: number;
  expectedEntryFee: number;
  expectedExitFee: number;
  expectedSlippage: number;
  modeledMaxLoss: number;
  estimatedTargetProfit: number;
};

export type CandidateLifecycle = {
  createdAt: string; // ISO
  expiresAt: string; // ISO
  state: CandidateState;
  rejectionReason: RejectionReason | null;
  rejectionDetail: string | null;
};

export type TradeCandidate = {
  candidateId: string;
  signalId: string;
  symbol: string;
  side: "LONG";
  marketType: "SPOT";
  venue: "BYBIT";
  strategyVersionId: string;
  strategyVersionLabel: string;
  timeframe: string;
  closedCandleTime: string; // ISO
  marketRegime: string;
  strategyScore: number;
  scoreComponents: ScoreComponent[];
  classification: "IGNORE" | "LOG" | "WATCH" | "CANDIDATE";
  indicators: IndicatorSnapshot;
  volatilityState: "NORMAL" | "EXCESSIVE";
  setupReasons: string[];
  position: CandidatePosition;
  risk: CandidateRisk;
  lifecycle: CandidateLifecycle;
  news: NewsFields;
};

/** A rejection that never reached a full candidate - no position/risk breakdown was computable. */
export type CandidateRejection = {
  signalId: string;
  symbol: string;
  strategyVersionId: string;
  strategyVersionLabel: string;
  timeframe: string;
  closedCandleTime: string;
  reason: RejectionReason;
  detail: string;
};

export type CandidateBuildResult =
  | { kind: "CANDIDATE"; candidate: TradeCandidate }
  | { kind: "REJECTED"; rejection: CandidateRejection };
