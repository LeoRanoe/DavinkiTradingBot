/**
 * Strategy platform - canonical, exchange/strategy-agnostic contract.
 *
 * This is the core of the multi-strategy architecture: MARKET DATA ->
 * STRATEGY ENGINE -> OPPORTUNITIES -> PORTFOLIO/RISK POLICY -> EXECUTION.
 * Nothing here is coupled to JeanFX, TRB, V1, Bybit, crypto, or forex -
 * see docs/architecture/strategy-platform.md.
 *
 * Strategies (built-in or user-defined) only ever produce StrategyDecision
 * values from a StrategyContext. They never place orders, touch account
 * balances, access credentials, or authorize their own execution mode -
 * that boundary is enforced structurally: no field on any type below can
 * carry an order id, exchange credential, or execution authorization.
 */

export type Direction = "LONG" | "SHORT";

export type Timeframe = "H1" | "M30" | "M15" | "M5";

export type TradingSession = "ASIA" | "LONDON" | "NEW_YORK";

export type AssetClass = "CRYPTO" | "FOREX" | "METAL";

export type Instrument = {
  /** Canonical id, e.g. "BTCUSDT", "XAUUSD", "EURUSD" - never a venue-specific symbol. */
  id: string;
  assetClass: AssetClass;
  pipSize: number;
};

export type CanonicalCandle = {
  instrumentId: string;
  timeframe: Timeframe;
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
};

/**
 * StrategyDefinitionType / StrategyLifecycleStatus mirror the DB enums in
 * supabase/migrations/*_strategy_platform.sql - see that file and
 * docs/architecture/strategy-platform.md for the full lifecycle model.
 */
export type StrategyDefinitionType = "BUILT_IN" | "USER_DEFINED";

export type StrategyLifecycleStatus =
  | "DRAFT"
  | "RESEARCH_ONLY"
  | "PAPER_ELIGIBLE"
  | "PAPER_ACTIVE"
  | "LIVE_ELIGIBLE"
  | "ARCHIVED";

export type StrategyAssignmentMode = "RESEARCH" | "SHADOW" | "PAPER" | "LIVE";

export type StrategyVisibility = "PRIVATE" | "UNLISTED" | "PUBLIC";

export type StrategyMetadata = {
  slug: string;
  displayName: string;
  description: string;
  type: StrategyDefinitionType;
  status: StrategyLifecycleStatus;
  requiredTimeframes: Timeframe[];
  supportedAssetClasses: AssetClass[];
  supportedSides: Direction[];
  /** Minimum closed-candle count required per timeframe before evaluate() can run. */
  minimumHistoryRequirements: Partial<Record<Timeframe, number>>;
  /** Informational only - names of indicators/features this strategy consumes. */
  requiredFeatures: string[];
};

export type CurrentPositionSnapshot = {
  side: Direction;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number | null;
  openedAt: number;
} | null;

export type StrategyContext = {
  instrument: Instrument;
  /** Evaluation instant (ms epoch). Only candles with openTime+duration <= now may be used. */
  now: number;
  candlesByTimeframe: Partial<Record<Timeframe, CanonicalCandle[]>>;
  marketSession: TradingSession[] | null;
  currentPosition: CurrentPositionSnapshot;
  strategyParameters: Record<string, unknown>;
  /** Optional precomputed feature data (e.g. news risk) - never required by the contract. */
  features?: Record<string, unknown>;
};

export type EntryModel = { price: number; kind: string };
export type StopModel = { price: number; kind: string };
export type TargetModel = { price: number; kind: string; rMultiple?: number };
export type PartialExitPlan = { sizePct: number; atRMultiple: number };

export type StrategyDecision =
  | { type: "NO_ACTION"; reason: string }
  | {
      type: "ENTER_LONG" | "ENTER_SHORT";
      entry: EntryModel;
      stop: StopModel;
      target: TargetModel;
      partialExitPlan: PartialExitPlan | null;
      reasonCodes: string[];
      featureSnapshot: Record<string, unknown>;
      /** Only set when the strategy defines a confidence value mathematically - never a placeholder. */
      confidence: number | null;
    }
  | { type: "EXIT"; reason: string }
  | { type: "UPDATE_STOP"; newStop: number; reason: string }
  | { type: "PARTIAL_EXIT"; sizePct: number; reason: string };

/**
 * The canonical strategy contract. Every built-in and user-defined strategy
 * (once compiled from the DSL) implements this shape. evaluate() is pure:
 * no IO, no clock reads beyond ctx.now, no randomness.
 */
export interface StrategyContract {
  metadata: StrategyMetadata;
  evaluate(ctx: StrategyContext): StrategyDecision;
  /**
   * Timeframes this strategy needs GIVEN a specific configuration.
   *
   * `metadata.requiredTimeframes` is static, so a strategy whose timeframes
   * depend on user configuration (JeanFX: M30 bias vs H1 bias) would
   * otherwise have market data fetched for the wrong timeframe while still
   * appearing to work - it would silently evaluate H1 candles as if they
   * were the M30 the operator selected. Strategies with configurable
   * timeframes MUST implement this; the orchestrator prefers it over
   * metadata.requiredTimeframes whenever it is present.
   */
  resolveRequiredTimeframes?(parameters: Record<string, unknown>): Timeframe[];
  /** Optional: manage an already-open position (trail stop, partial exit, exit). */
  evaluatePositionManagement?(ctx: StrategyContext): StrategyDecision;
}

/**
 * Generic opportunity - the sole output of the strategy engine layer, per
 * the MARKET DATA -> STRATEGY ENGINE -> OPPORTUNITIES -> RISK -> EXECUTION
 * flow. Confidence is optional and only present when a strategy defines one
 * mathematically (JeanFX does not; V1's 100-point score is V1-specific and
 * is not forced onto this generic shape).
 */
export type Opportunity = {
  /** Full attribution (Prompt 3 S3) - every opportunity must be traceable to exactly who/what produced it. */
  userId: string;
  strategyDefinitionId: string;
  strategyVersionId: string;
  strategyConfigurationId: string | null;
  strategyAssignmentId: string | null;
  instrumentId: string;
  side: Direction;
  signalTime: number;
  entry: EntryModel;
  stop: StopModel;
  target: TargetModel;
  partialExitPlan: PartialExitPlan | null;
  reasonCodes: string[];
  /** The exact parameters the strategy was evaluated with - so a signal remains explainable even after a configuration is later edited (a new version/configuration, never a mutation of this snapshot). */
  parameterSnapshot: Record<string, unknown>;
  featureSnapshot: Record<string, unknown>;
  confidence: number | null;
  /** Set by the assignment that produced this opportunity; used by conflict resolution. */
  priority: number;
};

/**
 * Per-run scanner/orchestrator observability (Prompt 3 S29). Aggregate
 * counts only - one row per orchestrator run, never one record per
 * no-op rule evaluation (that would flood the DB/logs for no benefit).
 */
export type ScanObservability = {
  assignmentsEvaluated: number;
  strategyEvaluations: number;
  instrumentsEvaluated: number;
  opportunitiesGenerated: number;
  conflicts: number;
  riskRejected: number;
  executed: number;
  shadowed: number;
  /** Per-strategy-definition breakdown, keyed by strategyDefinitionId. */
  byStrategy: Record<string, { evaluations: number; opportunities: number; errors: number }>;
  errors: EvaluationError[];
};

/** One assignment's evaluation failing must never abort any other (Prompt 3 S30). */
export type EvaluationError = {
  strategyAssignmentId: string;
  strategyDefinitionId: string;
  instrumentId: string;
  message: string;
};
