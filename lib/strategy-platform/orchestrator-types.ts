import type { CanonicalCandle, Instrument, StrategyAssignmentMode, StrategyContract, Timeframe } from "./types";

/**
 * Shared input shapes for the orchestrator and the modules it composes
 * (evaluation-plan, compatibility, portfolio-risk). Kept separate from
 * types.ts because these describe ORCHESTRATION inputs (assignments,
 * accounts, venues) - concepts the core StrategyContract/Opportunity layer
 * deliberately knows nothing about.
 */

/** One enabled StrategyAssignment, with everything the orchestrator needs already resolved (no DB access inside the orchestrator itself - see docs/architecture/strategy-platform.md "Orchestrator"). */
export type AssignmentInput = {
  assignmentId: string;
  userId: string;
  strategyConfigurationId: string;
  strategyVersionId: string;
  strategyDefinitionId: string;
  strategy: StrategyContract;
  /** Validated parameters for this configuration - passed through to StrategyContext.strategyParameters verbatim (and recorded as Opportunity.parameterSnapshot). */
  parameters: Record<string, unknown>;
  instrumentIds: string[];
  mode: StrategyAssignmentMode;
  priority: number;
  /** Effective mode already resolved by mode-authorization.ts (assignment request AND system/user authorization) - the orchestrator trusts this, it does not re-derive authorization itself. */
  effectiveMode: StrategyAssignmentMode;
};

export type VenueCapabilities = {
  supportsShort: boolean;
  supportedAssetClasses: Instrument["assetClass"][];
};

/** A single (instrument, timeframe) market-data requirement, deduplicated across every assignment that needs it. */
export type DataRequirement = { instrumentId: string; timeframe: Timeframe };

/** Supplies candles for one requirement - the orchestrator calls this exactly once per distinct requirement, never once per assignment. */
export type MarketDataProvider = (requirement: DataRequirement) => Promise<CanonicalCandle[]> | CanonicalCandle[];

export type PortfolioState = {
  /** Currently open risk, expressed as a fraction of equity, per instrumentId. */
  openRiskByInstrument: Record<string, number>;
  /** Currently open risk per strategyDefinitionId. */
  openRiskByStrategy: Record<string, number>;
  /** Currently open risk per Instrument["assetClass"]. */
  openRiskByAssetClass: Record<string, number>;
  /** Currently open position count per strategyDefinitionId. */
  openPositionsByStrategy: Record<string, number>;
  totalOpenPositions: number;
  totalOpenRisk: number;
};
