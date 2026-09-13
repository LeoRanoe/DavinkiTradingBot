/**
 * Typed trade-rejection reasons (spec section 44). Every rejection the risk
 * engine can produce must be one of these - never a free-text-only reason.
 */
export type RejectionReason =
  | "NO_BULLISH_REGIME"
  | "SCORE_TOO_LOW"
  | "INVALID_RISK_REWARD"
  | "INSUFFICIENT_BALANCE"
  | "MIN_ORDER_RISK_CONFLICT"
  | "DAILY_TRADE_LIMIT"
  | "DAILY_LOSS_LOCK"
  | "OPEN_POSITION_LIMIT"
  | "STALE_SIGNAL"
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

export type RiskLimits = {
  maxRiskPerTradePct: number; // e.g. 0.01 for 1%
  maxOpenPositions: number;
  maxNewTradesPerDay: number;
  maxLosingTradesPerDay: number;
};

export type AccountState = {
  equity: number;
  openPositionsCount: number;
  tradesOpenedTodayUtc: number;
  losingTradesTodayUtc: number;
};

export type TradeProposal = {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
};

export type PositionSizing = {
  qty: number;
  notional: number;
  riskAmount: number;
  riskReward: number;
};

export type RiskDecision =
  | { approved: true; sizing: PositionSizing }
  | { approved: false; reason: RejectionReason; detail: string };
