/** Shared, framework-free types for the controlled-learning layer. */
export type EvidenceLevel = "NO_DATA" | "EXTREMELY_LOW_EVIDENCE" | "LOW_EVIDENCE" | "INITIAL_EVIDENCE";

export type OutcomeKind = "TARGET" | "STOP" | "EXPIRED" | "NO_ENTRY" | "UNRESOLVED";

export type OutcomeCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
};

export type ExcursionMetrics = {
  mfePrice: number;
  maePrice: number;
  mfePct: number;
  maePct: number;
  mfeR: number | null;
  maeR: number | null;
};

export type CandidatePlan = {
  entryPrice: number;
  allowedEntryMin: number;
  allowedEntryMax: number;
  stopPrice: number;
  targetPrice: number;
  expiresAt: number;
};

export type CounterfactualOutcome = {
  kind: OutcomeKind;
  isHypothetical: true;
  entryTime: number | null;
  exitTime: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  rMultiple: number | null;
  excursions: ExcursionMetrics | null;
  conservativeAmbiguousCandle: boolean;
};

export type LearningTrade = {
  id: string;
  actual: boolean;
  symbol: string;
  strategyVersion: string;
  score?: number | null;
  scoreComponents?: Record<string, number | null>;
  regime?: string | null;
  volatility?: number | null;
  newsRisk?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null;
  approvalDelayMinutes?: number | null;
  stopDistancePct?: number | null;
  plannedRiskReward?: number | null;
  executionMode?: "PAPER" | "DEMO" | null;
  openedAt: number;
  closedAt: number | null;
  pnl: number | null;
  grossPnl?: number | null;
  fees: number;
  slippage: number;
  rMultiple: number | null;
  excursions?: ExcursionMetrics | null;
};
