/**
 * JeanFX v1 - pure domain types.
 *
 * Spec-only checkpoint: see docs/strategies/jeanfx-v1-spec.md for the full
 * rationale, every IMPLEMENTATION ASSUMPTION, and unresolved ambiguities.
 * No detection/state-machine logic is implemented yet - types only.
 *
 * Deliberately framework/exchange independent: strategy functions built on
 * these types take Instrument + CanonicalCandle[], never a Bybit symbol or
 * client type (see spec S17, forex/gold readiness).
 */

export type Direction = "LONG" | "SHORT";

export type TradingSession = "ASIA" | "LONDON" | "NEW_YORK";

/** Research-only status; distinct from V1's DRAFT/PAPER_APPROVED/LIVE_APPROVED
 * ladder so JeanFX cannot inherit a promotion path meant for another strategy. */
export type JeanfxStatus = "RESEARCH_ONLY" | "PAPER_APPROVED" | "LIVE_APPROVED";

export type AssetClass = "CRYPTO" | "FOREX" | "METAL";

export type Instrument = {
  /** Canonical id, e.g. "BTCUSDT", "XAUUSD", "EURUSD" - never a venue-specific symbol. */
  id: string;
  assetClass: AssetClass;
  /** Price increment for level/tolerance math; instrument-specific, not Bybit-specific. */
  pipSize: number;
};

export type CanonicalCandle = {
  instrumentId: string;
  timeframe: "H1" | "M30" | "M15" | "M5";
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
};

export type LiquiditySide = "BUY_SIDE" | "SELL_SIDE";

export type LiquidityPool = {
  side: LiquiditySide;
  level: number;
  /** Candle openTime(s) this pool derives from (single swing, or the cluster for equal highs/lows). */
  sourceCandleTimes: number[];
  kind: "EQUAL_HIGH_LOW" | "PRIOR_SWING" | "SESSION_HIGH_LOW";
  swept: boolean;
};

export type SwingPoint = {
  kind: "SWING_HIGH" | "SWING_LOW";
  candleTime: number;
  price: number;
};

export type Sweep = {
  pool: LiquidityPool;
  sweepCandleTime: number;
  sweepCandleHigh: number;
  sweepCandleLow: number;
};

export type StructureEvent = {
  kind: "BOS" | "MSS";
  direction: Direction;
  brokenSwing: SwingPoint;
  confirmingCandleTime: number;
};

export type FairValueGap = {
  direction: Direction; // LONG => bullish FVG, SHORT => bearish FVG
  /** candle1/candle2/candle3 openTimes of the 3-candle imbalance. */
  candleTimes: [number, number, number];
  rangeLow: number;
  rangeHigh: number;
  invalidated: boolean;
};

export type ConfirmationPattern = "BULLISH_ENGULFING" | "BEARISH_ENGULFING" | "HAMMER" | "SHOOTING_STAR";

export type ConfirmationCandle = {
  pattern: ConfirmationPattern;
  candleTime: number;
};

/** Bullish/bearish state machine states - see spec S6/S7. Mirrored, not
 * merged, so bullish/bearish progress can never be conflated. */
export type JeanfxState =
  | "S0_IDLE"
  | "S1_HTF_BIAS_CONFIRMED"
  | "S2_LIQUIDITY_IDENTIFIED"
  | "S3_SWEEP_CONFIRMED"
  | "S4_MSS_CONFIRMED"
  | "S5_FVG_FORMED"
  | "S6_RETRACED_INTO_FVG"
  | "S7_CONFIRMATION_CANDLE"
  | "S8_SETUP_VALID"
  | "S9_NO_TRADE";

export type NoTradeReason =
  | "NO_HTF_BIAS"
  | "NO_LIQUIDITY_IDENTIFIED"
  | "NO_SWEEP"
  | "NO_MSS_AFTER_SWEEP"
  | "NO_FVG_IN_DISPLACEMENT"
  | "NO_RETRACEMENT"
  | "FVG_INVALIDATED"
  | "NO_CONFIRMATION_CANDLE"
  | "NO_VALID_TARGET_RR"
  | "MAX_TRADES_REACHED"
  | "OUTSIDE_SESSION"
  | "MISSING_MARKET_DATA";

export type JeanfxSetup = {
  direction: Direction;
  instrumentId: string;
  sweep: Sweep;
  structureEvent: StructureEvent;
  fvg: FairValueGap;
  confirmation: ConfirmationCandle;
  entry: number;
  stop: number;
  target: LiquidityPool;
  rMultiple: number;
};

export type JeanfxEvaluation =
  | { kind: "NO_SIGNAL"; reason: NoTradeReason; state: JeanfxState }
  | { kind: "SETUP"; strategyVersionLabel: string; setup: JeanfxSetup };
