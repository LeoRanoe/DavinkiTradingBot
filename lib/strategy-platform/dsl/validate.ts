import type { DslDefinition, DslNode, DslValidationResult } from "./types";
import { isFuturePrimitive, isImplementedPrimitive, resultKindOf, type PrimitiveResultKind } from "./registry";
import { DSL_LIMITS } from "./limits";

const VALID_TIMEFRAMES = new Set(["H1", "M30", "M15", "M5"]);
const VALID_SESSIONS = new Set(["ASIA", "LONDON", "NEW_YORK"]);
const VALID_COMPARATORS = new Set(["GT", "GTE", "LT", "LTE", "EQ"]);
const VALID_PRICE_FIELDS = new Set(["open", "high", "low", "close"]);
const VALID_CANDLE_PATTERNS = new Set(["BULLISH_ENGULFING", "BEARISH_ENGULFING", "HAMMER", "SHOOTING_STAR"]);

type WalkState = { errors: string[]; nodeCount: number };

function checkPeriod(period: unknown, errors: string[], label: string) {
  if (typeof period !== "number" || !Number.isInteger(period) || period <= 0) {
    errors.push(`${label}: period must be a positive integer`);
    return;
  }
  if (period > DSL_LIMITS.maxLookback) {
    errors.push(`${label}: period ${period} exceeds maxLookback (${DSL_LIMITS.maxLookback})`);
  }
}

/**
 * Recursively validates a node, enforcing: known primitive (implemented vs
 * future vs unknown, each reported distinctly), correct resultKind in
 * context, depth/count limits, and per-primitive param bounds. Never throws
 * - all failures accumulate into WalkState.errors so a caller sees every
 * problem at once, not just the first.
 */
function walk(node: unknown, expectedKind: PrimitiveResultKind, depth: number, state: WalkState): void {
  state.nodeCount++;
  if (state.nodeCount > DSL_LIMITS.maxRuleCount) {
    state.errors.push(`rule count exceeds maxRuleCount (${DSL_LIMITS.maxRuleCount})`);
    return;
  }
  if (depth > DSL_LIMITS.maxRuleDepth) {
    state.errors.push(`rule nesting exceeds maxRuleDepth (${DSL_LIMITS.maxRuleDepth})`);
    return;
  }
  if (typeof node !== "object" || node === null || typeof (node as { type?: unknown }).type !== "string") {
    state.errors.push("node is not a valid DSL node (missing string 'type')");
    return;
  }
  const n = node as DslNode;

  if (isFuturePrimitive(n.type)) {
    state.errors.push(`primitive '${n.type}' is recognized but not yet implemented (IMPLEMENTATION ASSUMPTION boundary)`);
    return;
  }
  if (!isImplementedPrimitive(n.type)) {
    state.errors.push(`unknown primitive '${n.type}'`);
    return;
  }
  const actualKind = resultKindOf(n.type);
  if (actualKind !== expectedKind) {
    state.errors.push(`primitive '${n.type}' produces ${actualKind}, expected ${expectedKind} in this position`);
    return;
  }

  switch (n.type) {
    case "ALL":
    case "ANY":
      if (!Array.isArray(n.children) || n.children.length === 0) {
        state.errors.push(`${n.type}: children must be a non-empty array`);
        return;
      }
      for (const child of n.children) walk(child, "CONDITION", depth + 1, state);
      return;
    case "NOT":
      walk(n.child, "CONDITION", depth + 1, state);
      return;
    case "COMPARE":
      if (!VALID_COMPARATORS.has(n.comparator)) state.errors.push(`COMPARE: unknown comparator '${n.comparator}'`);
      walk(n.left, "VALUE", depth + 1, state);
      walk(n.right, "VALUE", depth + 1, state);
      return;
    case "CROSS_ABOVE":
    case "CROSS_BELOW":
      walk(n.left, "VALUE", depth + 1, state);
      walk(n.right, "VALUE", depth + 1, state);
      return;
    case "SESSION":
      if (!Array.isArray(n.sessions) || n.sessions.length === 0 || n.sessions.some((s) => !VALID_SESSIONS.has(s))) {
        state.errors.push("SESSION: sessions must be a non-empty array of valid TradingSession values");
      }
      return;
    case "PERCENT_CHANGE":
      checkPeriod(n.period, state.errors, "PERCENT_CHANGE");
      if (n.comparator !== "GT" && n.comparator !== "LT") state.errors.push("PERCENT_CHANGE: comparator must be GT or LT");
      if (typeof n.valuePct !== "number" || !Number.isFinite(n.valuePct)) {
        state.errors.push("PERCENT_CHANGE: valuePct must be a finite number");
      }
      if (n.child) walk(n.child, "VALUE", depth + 1, state);
      return;
    case "PRICE":
      if (!VALID_PRICE_FIELDS.has(n.field)) state.errors.push(`PRICE: invalid field '${n.field}'`);
      return;
    case "VOLUME":
      return;
    case "CONST":
      if (typeof n.value !== "number" || !Number.isFinite(n.value)) state.errors.push("CONST: value must be a finite number");
      return;
    case "EMA":
    case "SMA":
      checkPeriod(n.period, state.errors, n.type);
      if (n.child) walk(n.child, "VALUE", depth + 1, state);
      return;
    case "RSI":
    case "ATR":
      checkPeriod(n.period, state.errors, n.type);
      return;
    case "HIGHEST":
    case "LOWEST":
      checkPeriod(n.period, state.errors, n.type);
      walk(n.child, "VALUE", depth + 1, state);
      return;
    case "SWING_HIGH":
    case "SWING_LOW":
      checkPeriod(n.leftRightBars, state.errors, n.type);
      return;
    case "BULLISH_CANDLE":
    case "BEARISH_CANDLE":
      return;
    case "CANDLE_PATTERN":
      if (!VALID_CANDLE_PATTERNS.has(n.pattern)) state.errors.push(`CANDLE_PATTERN: unknown pattern '${n.pattern}'`);
      return;
    case "BOS":
      if (n.direction !== "LONG" && n.direction !== "SHORT") state.errors.push("BOS: direction must be 'LONG' or 'SHORT'");
      checkPeriod(n.leftRightBars, state.errors, "BOS.leftRightBars");
      return;
    case "LIQUIDITY_SWEEP":
      if (n.side !== "BUY_SIDE" && n.side !== "SELL_SIDE") state.errors.push("LIQUIDITY_SWEEP: side must be 'BUY_SIDE' or 'SELL_SIDE'");
      checkPeriod(n.leftRightBars, state.errors, "LIQUIDITY_SWEEP.leftRightBars");
      checkPeriod(n.atrPeriod, state.errors, "LIQUIDITY_SWEEP.atrPeriod");
      if (!Number.isFinite(n.equalHighLowAtrMultiple) || n.equalHighLowAtrMultiple <= 0) {
        state.errors.push("LIQUIDITY_SWEEP: equalHighLowAtrMultiple must be a positive finite number");
      }
      return;
    case "FVG":
      if (n.direction !== "LONG" && n.direction !== "SHORT") state.errors.push("FVG: direction must be 'LONG' or 'SHORT'");
      return;
  }
}

export function validateDslDefinition(def: DslDefinition): DslValidationResult {
  const errors: string[] = [];

  if (def.engineSchemaVersion !== "1") errors.push(`unsupported engineSchemaVersion '${def.engineSchemaVersion}'`);

  if (!Array.isArray(def.timeframes) || def.timeframes.length === 0) {
    errors.push("timeframes must be a non-empty array");
  } else {
    if (def.timeframes.length > DSL_LIMITS.maxTimeframes) {
      errors.push(`timeframes exceeds maxTimeframes (${DSL_LIMITS.maxTimeframes})`);
    }
    for (const tf of def.timeframes) {
      if (!VALID_TIMEFRAMES.has(tf)) errors.push(`unsupported timeframe '${tf}'`);
    }
  }

  if (!Array.isArray(def.side) || def.side.length === 0 || def.side.some((s) => s !== "LONG" && s !== "SHORT")) {
    errors.push("side must be a non-empty array of 'LONG'/'SHORT'");
  }

  const state: WalkState = { errors, nodeCount: 0 };
  walk(def.entry, "CONDITION", 0, state);

  const sides = new Set(Array.isArray(def.side) ? def.side : []);

  switch (def.stop.kind) {
    case "FIXED_PERCENT":
      if (!Number.isFinite(def.stop.pct) || def.stop.pct <= 0) errors.push("stop.pct must be a positive finite number");
      break;
    case "ATR_MULTIPLE":
      checkPeriod(def.stop.atrPeriod, errors, "stop.atrPeriod");
      if (!Number.isFinite(def.stop.multiple) || def.stop.multiple <= 0) errors.push("stop.multiple must be a positive finite number");
      break;
    case "BELOW_SWING":
    case "ABOVE_SWING":
      checkPeriod(def.stop.leftRightBars, errors, "stop.leftRightBars");
      if (!Number.isFinite(def.stop.bufferPct) || def.stop.bufferPct < 0) errors.push("stop.bufferPct must be a non-negative finite number");
      if (def.stop.kind === "BELOW_SWING" && !sides.has("LONG")) errors.push("stop BELOW_SWING only makes sense for a LONG strategy (side must include 'LONG')");
      if (def.stop.kind === "ABOVE_SWING" && !sides.has("SHORT")) errors.push("stop ABOVE_SWING only makes sense for a SHORT strategy (side must include 'SHORT')");
      break;
    case "BELOW_SIGNAL_LOW":
    case "ABOVE_SIGNAL_HIGH":
      if (!Number.isFinite(def.stop.bufferPct) || def.stop.bufferPct < 0) errors.push("stop.bufferPct must be a non-negative finite number");
      if (def.stop.kind === "BELOW_SIGNAL_LOW" && !sides.has("LONG")) errors.push("stop BELOW_SIGNAL_LOW only makes sense for a LONG strategy (side must include 'LONG')");
      if (def.stop.kind === "ABOVE_SIGNAL_HIGH" && !sides.has("SHORT")) errors.push("stop ABOVE_SIGNAL_HIGH only makes sense for a SHORT strategy (side must include 'SHORT')");
      break;
    default:
      errors.push("stop: unknown kind");
  }

  switch (def.target.kind) {
    case "R_MULTIPLE":
      if (!Number.isFinite(def.target.multiple) || def.target.multiple <= 0) errors.push("target.multiple must be a positive finite number");
      break;
    case "FIXED_PERCENT":
      if (!Number.isFinite(def.target.pct) || def.target.pct <= 0) errors.push("target.pct must be a positive finite number");
      break;
    case "NEXT_SWING":
      checkPeriod(def.target.leftRightBars, errors, "target.leftRightBars");
      break;
    case "NEXT_LIQUIDITY_POOL":
      checkPeriod(def.target.leftRightBars, errors, "target.leftRightBars");
      checkPeriod(def.target.atrPeriod, errors, "target.atrPeriod");
      if (!Number.isFinite(def.target.equalHighLowAtrMultiple) || def.target.equalHighLowAtrMultiple <= 0) {
        errors.push("target.equalHighLowAtrMultiple must be a positive finite number");
      }
      break;
    default:
      errors.push("target: unknown kind");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
