/**
 * JeanFX v1 - pure domain types.
 *
 * See docs/strategies/jeanfx-v1-spec.md for the full rationale, every
 * IMPLEMENTATION ASSUMPTION, and unresolved ambiguities.
 *
 * Deliberately framework/exchange independent: strategy functions built on
 * these types take Instrument + CanonicalCandle[], never a Bybit symbol or
 * client type (see spec S17, forex/gold readiness).
 */

import type { SwingPoint } from "./primitives/swings";
export type { SwingPoint } from "./primitives/swings";
import type { Direction } from "@/lib/strategy-platform/types";
export type { CanonicalCandle, Direction, Instrument, AssetClass, TradingSession } from "@/lib/strategy-platform/types";

/** Research-only status; distinct from V1's DRAFT/PAPER_APPROVED/LIVE_APPROVED
 * ladder so JeanFX cannot inherit a promotion path meant for another strategy. */
export type JeanfxStatus = "RESEARCH_ONLY" | "PAPER_APPROVED" | "LIVE_APPROVED";

export type LiquiditySide = "BUY_SIDE" | "SELL_SIDE";

export type LiquidityPool = {
  side: LiquiditySide;
  level: number;
  /** Candle openTime(s) this pool derives from (single swing, or the cluster for equal highs/lows). */
  sourceCandleTimes: number[];
  kind: "EQUAL_HIGH_LOW" | "PRIOR_SWING" | "SESSION_HIGH_LOW";
  swept: boolean;
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

/**
 * State machine states - see docs/strategies/jeanfx-v1-spec.md and
 * state-machine.ts. Bullish and bearish setups share the same state names
 * and the same walk function, distinguished by the `direction` field on
 * each transition/result - never a separate parallel enum, so bullish and
 * bearish progress can never be conflated.
 */
export type JeanfxStateName =
  | "WAITING_FOR_BIAS"
  | "WAITING_FOR_LIQUIDITY_SWEEP"
  | "WAITING_FOR_STRUCTURE_CONFIRMATION"
  | "WAITING_FOR_FVG"
  | "WAITING_FOR_RETRACE"
  | "WAITING_FOR_CONFIRMATION"
  | "READY"
  | "INVALIDATED";

/** Every state transition carries why, when, and at what price - never a bare state change. */
export type JeanfxStateTransition = {
  state: JeanfxStateName;
  direction: Direction;
  reasonCode: string;
  timestamp: number; // candle openTime that caused the transition
  priceLevel: number | null;
};

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
  | { kind: "NO_SIGNAL"; state: JeanfxStateName; reasonCode: string; transitions: JeanfxStateTransition[] }
  | { kind: "SETUP"; strategyVersionLabel: string; setup: JeanfxSetup; transitions: JeanfxStateTransition[] };
