import { atr } from "@/lib/indicators/atr";
import { latestSwingHigh, latestSwingLow } from "./primitives/swings";
import { detectSweep } from "./primitives/sweep";
import { detectStructureEvent } from "./primitives/structure";
import { detectFvgAt, isDisplacementCandle, isFvgInvalidated, touchesFvg } from "./primitives/fvg";
import { isBearishEngulfing, isBullishEngulfing, isHammer, isShootingStar } from "./primitives/candles";
import { classifySession, JEANFX_DEFAULT_SESSION_WINDOWS, type SessionWindow } from "./primitives/sessions";
import { buildLiquidityMap, type TrackedLiquidityPool } from "./primitives/liquidity";
import { determineLiquidityBias, type BiasResult } from "./primitives/bias";
import type { JeanfxV1Params, JeanfxConfirmationPatternsChoice, JeanfxSessionFilterChoice } from "./config";
import type {
  CanonicalCandle,
  Direction,
  JeanfxSetup,
  JeanfxStateName,
  JeanfxStateTransition,
  LiquidityPool,
  SwingPoint,
} from "./types";

/**
 * JeanFX deterministic state machine.
 *
 * DESIGN NOTE (not a source rule - an implementation choice): rather than
 * persisting engine state between evaluation calls, state is DERIVED by
 * walking the full closed-candle history once per evaluation, maintaining
 * local state as it goes (never inferring the sequence from a single
 * candle without context). Given the same candle history, this always
 * reproduces the same trajectory, so it is exactly as deterministic as
 * literal persisted state while needing no engine-state storage and never
 * risking drift from a stored value going stale. See
 * docs/architecture/strategy-platform.md and
 * docs/strategies/jeanfx-v1-spec.md for why this was chosen.
 *
 * Two phases, matching the multi-timeframe design:
 *  - Phase A walks the STRUCTURE timeframe (M15) candles to find a sweep,
 *    then the MSS that must follow it, then the FVG inside that
 *    displacement leg.
 *  - Phase B scans the ENTRY timeframe (M5) candles - starting after the
 *    FVG's 3rd candle closed - for retracement into the FVG and a valid
 *    confirmation candle.
 */

export type JeanfxWalkResult = {
  state: JeanfxStateName;
  transitions: JeanfxStateTransition[];
  setup: JeanfxSetup | null;
};

function sessionFilterToWindows(choice: JeanfxSessionFilterChoice): SessionWindow[] | null {
  if (choice === "ALL") return null; // null = no session gating at all
  const london = JEANFX_DEFAULT_SESSION_WINDOWS.find((w) => w.session === "LONDON")!;
  const ny = JEANFX_DEFAULT_SESSION_WINDOWS.find((w) => w.session === "NEW_YORK")!;
  if (choice === "LONDON") return [london];
  if (choice === "NEW_YORK") return [ny];
  return [london, ny];
}

function confirmationAllowed(pattern: "BULLISH_ENGULFING" | "BEARISH_ENGULFING" | "HAMMER" | "SHOOTING_STAR", choice: JeanfxConfirmationPatternsChoice): boolean {
  const isEngulfing = pattern === "BULLISH_ENGULFING" || pattern === "BEARISH_ENGULFING";
  if (choice === "BOTH") return true;
  if (choice === "ENGULFING") return isEngulfing;
  return !isEngulfing; // HAMMER_SHOOTING_STAR
}

/**
 * SOURCE RULE - JeanFX HTF bias is a LIQUIDITY read, not a trend read.
 *
 * Maps liquidity on the bias timeframe and asks which pool price is drawing
 * toward; the true direction is away from that draw (see primitives/bias.ts
 * for the source quotes this is derived from).
 *
 * EMA50/EMA200 are deliberately NOT consulted: they appear nowhere in the
 * JeanFX source and previously turned JeanFX into generic trend-following.
 */
export function determineHtfBias(biasCandles: CanonicalCandle[], params: JeanfxV1Params): BiasResult {
  const mapParams = {
    swingLeftRightBars: params.swing.leftBars,
    equalHighLowAtrMultiple: params.equalHighLowAtrMultiple,
    atrPeriod: params.atrPeriod,
  };
  const pools: TrackedLiquidityPool[] = [
    ...buildLiquidityMap(biasCandles, "BUY_SIDE", mapParams, JEANFX_DEFAULT_SESSION_WINDOWS),
    ...buildLiquidityMap(biasCandles, "SELL_SIDE", mapParams, JEANFX_DEFAULT_SESSION_WINDOWS),
  ];

  // No lookahead: only pools confirmed by the final closed bias candle count.
  const lastIndex = biasCandles.length - 1;
  const visible = pools.filter((p) => p.confirmedAtIndex <= lastIndex);

  const atrSeries = atr(biasCandles, params.atrPeriod);
  const lastAtr = Number.isFinite(atrSeries[lastIndex]) ? atrSeries[lastIndex] : 0;
  const tolerance = params.biasAmbiguityAtrMultiple * lastAtr;

  return determineLiquidityBias(biasCandles, visible, tolerance);
}

type TrackedPool = TrackedLiquidityPool;

/**
 * SOURCE RULE: liquidity is equal highs/lows, previous highs/lows AND
 * session highs/lows ("Map equal highs, equal lows, session highs and
 * previous highs/lows"). All three kinds feed the SWEEP hunt - previously
 * session pools were only ever used as targets, so JeanFX could not sweep
 * the very liquidity the source says London goes after.
 */
function buildTrackedPools(structureCandles: CanonicalCandle[], side: "BUY_SIDE" | "SELL_SIDE", params: JeanfxV1Params): TrackedPool[] {
  return buildLiquidityMap(
    structureCandles,
    side,
    { swingLeftRightBars: params.swing.leftBars, equalHighLowAtrMultiple: params.equalHighLowAtrMultiple, atrPeriod: params.atrPeriod },
    JEANFX_DEFAULT_SESSION_WINDOWS,
  );
}

/**
 * Phase A: walk the structure timeframe. Returns the transitions produced,
 * plus (if reached) the active sweep/structure-event/FVG to hand to Phase B.
 */
function walkStructure(structureCandles: CanonicalCandle[], direction: Direction, params: JeanfxV1Params) {
  const transitions: JeanfxStateTransition[] = [];
  const liquiditySide = direction === "LONG" ? "SELL_SIDE" : "BUY_SIDE"; // LONG looks for a sell-side sweep first
  const structureSide = direction === "LONG" ? "BUY_SIDE" : "SELL_SIDE"; // the swing that must be broken for MSS
  const leftRight = params.swing.leftBars;

  const pools = buildTrackedPools(structureCandles, liquiditySide, params);
  const push = (state: JeanfxStateName, reasonCode: string, timestamp: number, priceLevel: number | null) =>
    transitions.push({ state, direction, reasonCode, timestamp, priceLevel });

  let state: JeanfxStateName = "WAITING_FOR_LIQUIDITY_SWEEP";
  let activeSweep: ReturnType<typeof detectSweep> = null;
  let sweepIndex = -1;
  let requiredSwing: SwingPoint | null = null;
  let activeStructureEvent: ReturnType<typeof detectStructureEvent> = null;
  let mssIndex = -1;
  let activeFvg: ReturnType<typeof detectFvgAt> = null;

  const resetToHunting = () => {
    state = "WAITING_FOR_LIQUIDITY_SWEEP";
    activeSweep = null;
    sweepIndex = -1;
    requiredSwing = null;
    activeStructureEvent = null;
    mssIndex = -1;
  };

  for (let i = 0; i < structureCandles.length; i++) {
    const candle = structureCandles[i];
    const visiblePools = pools.filter((p) => p.confirmedAtIndex <= i && !p.swept);

    if (state === "WAITING_FOR_LIQUIDITY_SWEEP") {
      const sweep = detectSweep(structureCandles, i, visiblePools);
      if (sweep) {
        // Mark the pool swept in the tracked list so it can't retrigger.
        const idx = pools.findIndex((p) => p.level === sweep.pool.level && p.side === sweep.pool.side);
        if (idx >= 0) pools[idx] = { ...pools[idx], swept: true };
        const swing = structureSide === "BUY_SIDE" ? latestSwingHigh(structureCandles.slice(0, i + 1), leftRight) : latestSwingLow(structureCandles.slice(0, i + 1), leftRight);
        if (swing) {
          requiredSwing = swing;
          activeSweep = sweep;
          sweepIndex = i;
          state = "WAITING_FOR_STRUCTURE_CONFIRMATION";
          push(state, "LIQUIDITY_SWEPT", candle.openTime, sweep.pool.level);
        }
      }
      continue;
    }

    if (state === "WAITING_FOR_STRUCTURE_CONFIRMATION" && requiredSwing) {
      if (i - sweepIndex > params.mssTimeoutBars) {
        resetToHunting();
        push(state, "MSS_TIMEOUT", candle.openTime, null);
        continue;
      }
      const event = detectStructureEvent(candle, direction, requiredSwing, "MSS");
      if (event) {
        activeStructureEvent = event;
        mssIndex = i;
        state = "WAITING_FOR_FVG";
        push(state, "MSS_CONFIRMED", candle.openTime, requiredSwing.price);
      }
      continue;
    }

    if (state === "WAITING_FOR_FVG" && activeStructureEvent) {
      if (i - mssIndex > params.fvgTimeoutBars) {
        resetToHunting();
        push(state, "FVG_TIMEOUT", candle.openTime, null);
        continue;
      }
      if (i >= mssIndex) {
        const fvg = detectFvgAt(structureCandles, i);
        if (fvg && fvg.direction === direction && isDisplacementCandle(structureCandles, i, params.displacementAtrMultiple, params.atrPeriod)) {
          activeFvg = fvg;
          state = "WAITING_FOR_RETRACE";
          push(state, "FVG_FORMED", candle.openTime, fvg.direction === "LONG" ? fvg.rangeLow : fvg.rangeHigh);
        }
      }
      continue;
    }

    // Once an FVG is found, Phase A's job is done - Phase B (entry timeframe) takes over.
    if (state === "WAITING_FOR_RETRACE") break;
  }

  return { transitions, state, activeSweep, activeStructureEvent, activeFvg, requiredSwing };
}

/** Phase B: scan the entry timeframe for retracement into the FVG and a valid confirmation candle. */
function walkEntry(
  entryCandles: CanonicalCandle[],
  direction: Direction,
  fvg: NonNullable<ReturnType<typeof detectFvgAt>>,
  fvgFormedAt: number,
  confirmationChoice: JeanfxConfirmationPatternsChoice,
  params: JeanfxV1Params,
) {
  const transitions: JeanfxStateTransition[] = [];
  const push = (state: JeanfxStateName, reasonCode: string, timestamp: number, priceLevel: number | null) =>
    transitions.push({ state, direction, reasonCode, timestamp, priceLevel });

  const relevant = entryCandles.filter((c) => c.openTime > fvgFormedAt);
  let state: JeanfxStateName = "WAITING_FOR_RETRACE";
  let touched = false;

  for (let i = 0; i < relevant.length; i++) {
    const candle = relevant[i];

    if (isFvgInvalidated(fvg, [candle], 0)) {
      state = "INVALIDATED";
      push(state, "FVG_INVALIDATED", candle.openTime, direction === "LONG" ? fvg.rangeLow : fvg.rangeHigh);
      return { transitions, state, confirmation: null as null | { pattern: string; candleTime: number } };
    }

    if (!touched) {
      if (touchesFvg(fvg, candle)) {
        touched = true;
        state = "WAITING_FOR_CONFIRMATION";
        push(state, "RETRACED_INTO_FVG", candle.openTime, candle.close);
      }
      continue;
    }

    // touched: now look for a valid confirmation candle (needs the prior candle for engulfing).
    const prior = i > 0 ? relevant[i - 1] : null;
    const confirmParams = params.confirmation;
    let pattern: "BULLISH_ENGULFING" | "BEARISH_ENGULFING" | "HAMMER" | "SHOOTING_STAR" | null = null;

    if (direction === "LONG") {
      if (prior && isBullishEngulfing(prior, candle) && confirmationAllowed("BULLISH_ENGULFING", confirmationChoice)) pattern = "BULLISH_ENGULFING";
      else if (isHammer(candle, confirmParams) && confirmationAllowed("HAMMER", confirmationChoice)) pattern = "HAMMER";
    } else {
      if (prior && isBearishEngulfing(prior, candle) && confirmationAllowed("BEARISH_ENGULFING", confirmationChoice)) pattern = "BEARISH_ENGULFING";
      else if (isShootingStar(candle, confirmParams) && confirmationAllowed("SHOOTING_STAR", confirmationChoice)) pattern = "SHOOTING_STAR";
    }

    if (pattern) {
      state = "READY";
      push(state, "CONFIRMATION_CANDLE", candle.openTime, candle.close);
      return { transitions, state, confirmation: { pattern, candleTime: candle.openTime } };
    }
  }

  return { transitions, state, confirmation: null as null | { pattern: string; candleTime: number } };
}

/**
 * Full JeanFX evaluation for one direction, given already-closed candles
 * per timeframe. No lookahead: every candle passed in must be closed - the
 * caller (the built-in StrategyContract wrapper) is responsible for that
 * filter, mirroring the same closed-candle invariant as V1 and the DSL.
 */
export function runJeanfxDirection(
  biasCandles: CanonicalCandle[],
  structureCandles: CanonicalCandle[],
  entryCandles: CanonicalCandle[],
  direction: Direction,
  params: JeanfxV1Params,
  userConfig: { confirmationPatterns: JeanfxConfirmationPatternsChoice; sessionFilter: JeanfxSessionFilterChoice },
): JeanfxWalkResult {
  const transitions: JeanfxStateTransition[] = [];
  const push = (state: JeanfxStateName, reasonCode: string, timestamp: number, priceLevel: number | null) =>
    transitions.push({ state, direction, reasonCode, timestamp, priceLevel });

  if (biasCandles.length === 0 || structureCandles.length === 0 || entryCandles.length === 0) {
    push("WAITING_FOR_BIAS", "MISSING_MARKET_DATA", 0, null);
    return { state: "WAITING_FOR_BIAS", transitions, setup: null };
  }

  const biasResult = determineHtfBias(biasCandles, params);
  const requiredBias = direction === "LONG" ? "BULLISH" : "BEARISH";
  const lastBiasTime = biasCandles[biasCandles.length - 1].openTime;
  if (biasResult.bias !== requiredBias) {
    // Carry the liquidity reason through, so the UI can say "ambiguous draw"
    // or "no liquidity mapped" rather than a bare "no bias".
    push("WAITING_FOR_BIAS", biasResult.reasonCode, lastBiasTime, biasResult.draw?.level ?? null);
    return { state: "WAITING_FOR_BIAS", transitions, setup: null };
  }
  push("WAITING_FOR_LIQUIDITY_SWEEP", "HTF_BIAS_CONFIRMED", lastBiasTime, biasResult.draw?.level ?? null);

  const structureResult = walkStructure(structureCandles, direction, params);
  transitions.push(...structureResult.transitions);

  if (structureResult.state !== "WAITING_FOR_RETRACE" || !structureResult.activeFvg || !structureResult.activeSweep || !structureResult.activeStructureEvent) {
    return { state: structureResult.state, transitions, setup: null };
  }

  const fvg = structureResult.activeFvg;
  const fvgFormedAt = fvg.candleTimes[2];
  const entryResult = walkEntry(entryCandles, direction, fvg, fvgFormedAt, userConfig.confirmationPatterns, params);
  transitions.push(...entryResult.transitions);

  if (entryResult.state !== "READY" || !entryResult.confirmation) {
    return { state: entryResult.state, transitions, setup: null };
  }

  // Session gate applies at the moment of readiness, not throughout the walk (spec S9: optional component).
  const sessionWindows = sessionFilterToWindows(userConfig.sessionFilter);
  const confirmationCandle = entryCandles.find((c) => c.openTime === entryResult.confirmation!.candleTime)!;
  if (sessionWindows) {
    const activeSessions = classifySession(confirmationCandle.openTime, sessionWindows);
    if (activeSessions.length === 0) {
      push("INVALIDATED", "OUTSIDE_SESSION", confirmationCandle.openTime, null);
      return { state: "INVALIDATED", transitions, setup: null };
    }
  }

  // Target selection (spec S12): nearest unswept liquidity pool on the opposite side, R:R >= rrMinimum.
  const targetSide = direction === "LONG" ? "BUY_SIDE" : "SELL_SIDE";
  const lastStructureIndex = structureCandles.length - 1;
  const targetCandidates = buildTrackedPools(structureCandles, targetSide, params).filter(
    (p) => p.confirmedAtIndex <= lastStructureIndex,
  );

  const entryPrice = confirmationCandle.close;
  const sweepExtreme = direction === "LONG" ? structureResult.activeSweep.sweepCandleLow : structureResult.activeSweep.sweepCandleHigh;

  // Stop (spec S11): beyond the sweep extreme, with a small ATR-relative buffer.
  const structureAtr = atr(structureCandles, params.atrPeriod);
  const sweepIndex = structureCandles.findIndex((c) => c.openTime === structureResult.activeSweep!.sweepCandleTime);
  const atrAtSweep = sweepIndex >= 0 && Number.isFinite(structureAtr[sweepIndex]) ? structureAtr[sweepIndex] : 0;
  const stopBuffer = params.stopBufferAtrMultiple * atrAtSweep;
  const stop = direction === "LONG" ? sweepExtreme - stopBuffer : sweepExtreme + stopBuffer;

  const validTargets = targetCandidates
    .filter((p) => (direction === "LONG" ? p.level > entryPrice : p.level < entryPrice))
    .sort((a, b) => (direction === "LONG" ? a.level - b.level : b.level - a.level));

  // SOURCE RULE: "Targets are placed at the next liquidity pool." The target
  // is therefore the NEXT (nearest) unswept opposing pool - full stop. The
  // 1:3 minimum is a QUALITY GATE applied to that pool, not a search
  // criterion: scanning past the next pool for a further one that happens to
  // clear 3R would manufacture the R:R the source demands, and would also
  // place the target at a level JeanFX never pointed at.
  const riskDistance = Math.abs(entryPrice - stop);
  if (riskDistance <= 0) {
    push("INVALIDATED", "INVALID_STOP_DISTANCE", confirmationCandle.openTime, null);
    return { state: "INVALIDATED", transitions, setup: null };
  }

  const chosenTarget: LiquidityPool | null = validTargets[0] ?? null;
  if (!chosenTarget) {
    push("INVALIDATED", "NO_TARGET_LIQUIDITY", confirmationCandle.openTime, null);
    return { state: "INVALIDATED", transitions, setup: null };
  }

  const achievableR = Math.abs(chosenTarget.level - entryPrice) / riskDistance;
  if (achievableR < params.rrMinimum) {
    push("INVALIDATED", "RR_BELOW_MINIMUM", confirmationCandle.openTime, chosenTarget.level);
    return { state: "INVALIDATED", transitions, setup: null };
  }

  const risk = Math.abs(entryPrice - stop);
  const reward = Math.abs(chosenTarget.level - entryPrice);

  const setup: JeanfxSetup = {
    direction,
    instrumentId: structureCandles[0].instrumentId,
    biasTimeframe: params.biasTimeframe,
    biasDraw: biasResult.draw,
    sweep: structureResult.activeSweep,
    structureEvent: structureResult.activeStructureEvent,
    fvg,
    confirmation: { pattern: entryResult.confirmation.pattern as JeanfxSetup["confirmation"]["pattern"], candleTime: entryResult.confirmation.candleTime },
    entry: entryPrice,
    stop,
    target: chosenTarget,
    rMultiple: reward / risk,
  };

  return { state: "READY", transitions, setup };
}
