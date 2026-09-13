/**
 * Typed trade-rejection reasons (spec section 44). Every rejection the risk
 * engine can produce must be one of these - never a free-text-only reason.
 */
export type RejectionReason =
  | "NO_BULLISH_REGIME"
  | "SCORE_TOO_LOW"
  | "INVALID_RISK_REWARD"
  | "MIN_RISK_REWARD_NOT_MET"
  | "INSUFFICIENT_BALANCE"
  | "MIN_ORDER_RISK_CONFLICT"
  | "DAILY_TRADE_LIMIT"
  | "DAILY_LOSS_LOCK"
  | "OPEN_POSITION_LIMIT"
  | "STALE_SIGNAL"
  | "STALE_MARKET_DATA"
  | "CANDIDATE_EXPIRED"
  | "ENTRY_OUTSIDE_ALLOWED_RANGE"
  | "EXCESSIVE_VOLATILITY"
  | "DUPLICATE_CANDIDATE"
  | "INCOMPLETE_CANDLE"
  | "MISSING_MARKET_DATA"
  | "INVALID_EXCHANGE_METADATA"
  | "TRADING_MODE_BLOCK"
  | "STRATEGY_NOT_APPROVED";

export type InstrumentRules = {
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  minOrderAmt: number;
  maxOrderQty: number | null;
};

/**
 * How the owner's configured risk is translated into a dollar risk budget
 * for one trade (spec Milestone 1 "risk modes").
 *   PERCENT_OF_EQUITY - riskBudget = equity * maxRiskPerTradePct
 *   FIXED_AMOUNT       - riskBudget = min(fixedRiskAmount, equity)
 * Risk is the intended approximate amount lost if the stop is hit - it is
 * NEVER position size, and switching/growing risk never happens
 * automatically (spec section 9).
 */
export type RiskMode = "PERCENT_OF_EQUITY" | "FIXED_AMOUNT";

export type RiskLimits = {
  maxRiskPerTradePct: number; // e.g. 0.01 for 1%. Used when riskMode is PERCENT_OF_EQUITY (or unset, for backward compatibility).
  maxOpenPositions: number;
  maxNewTradesPerDay: number;
  maxLosingTradesPerDay: number;
  /** Defaults to "PERCENT_OF_EQUITY" when omitted (legacy callers). */
  riskMode?: RiskMode;
  /** Dollar risk budget when riskMode is "FIXED_AMOUNT". Ignored otherwise. */
  fixedRiskAmount?: number;
  /** Owner-configurable minimum strategy score (0-100) a candidate must clear. */
  minCandidateScore?: number;
  /** Owner-configurable minimum risk/reward a candidate must clear. */
  minRiskReward?: number;
};

/** Conservative fee + slippage assumptions applied to modeled loss/profit. */
export type CostModel = {
  feeBps: number;
  slippageBps: number;
};

export type AccountState = {
  equity: number;
  openPositionsCount: number;
  tradesOpenedTodayUtc: number;
  losingTradesTodayUtc: number;
  /**
   * Usable quote-currency balance right now. Defaults to `equity` when
   * omitted. Spot position notional must never exceed this - if it reduces
   * the risk-compliant size below the intended risk budget, that is allowed
   * (it only ever REDUCES exposure, never increases it).
   */
  availableBalance?: number;
};

export type TradeProposal = {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
};

export type PositionSizing = {
  qty: number;
  notional: number;
  /** Loss if the stop is hit, from price alone (no fees/slippage). Legacy field, unchanged semantics. */
  riskAmount: number;
  riskReward: number;
  /** Dollar risk budget the sizing was computed against. */
  riskBudget: number;
  entryFee: number;
  exitFee: number;
  /** Combined entry+exit slippage cost modeled against notional. */
  slippageCost: number;
  /** riskAmount + entryFee + exitFee + slippageCost - the realistic worst case if the stop is hit. */
  estimatedActualRisk: number;
  /** Alias of estimatedActualRisk, named to match the owner-facing "modeled max loss" field. */
  modeledMaxLoss: number;
  /** Gross target profit minus modeled fees/slippage. */
  estimatedTargetProfit: number;
};

export type RiskDecision =
  | { approved: true; sizing: PositionSizing }
  | { approved: false; reason: RejectionReason; detail: string };
