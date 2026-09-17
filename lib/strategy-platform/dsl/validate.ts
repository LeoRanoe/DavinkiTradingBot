import type { DslDefinition, DslNode, DslValidationResult } from "./types";
import { isFuturePrimitive, isImplementedPrimitive, resultKindOf, type PrimitiveResultKind } from "./registry";
import { DSL_LIMITS } from "./limits";

const VALID_TIMEFRAMES = new Set(["H1", "M30", "M15", "M5"]);
const VALID_SESSIONS = new Set(["ASIA", "LONDON", "NEW_YORK"]);
const VALID_COMPARATORS = new Set(["GT", "GTE", "LT", "LTE", "EQ"]);
const VALID_PRICE_FIELDS = new Set(["open", "high", "low", "close"]);

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
      checkPeriod(n.period, state.errors, "RSI");
      return;
    case "HIGHEST":
    case "LOWEST":
      checkPeriod(n.period, state.errors, n.type);
      walk(n.child, "VALUE", depth + 1, state);
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

  if (def.stop.kind === "ATR_MULTIPLE") {
    checkPeriod(def.stop.atrPeriod, errors, "stop.atrPeriod");
    if (!Number.isFinite(def.stop.multiple) || def.stop.multiple <= 0) errors.push("stop.multiple must be a positive finite number");
  } else if (def.stop.kind === "FIXED_PCT") {
    if (!Number.isFinite(def.stop.pct) || def.stop.pct <= 0) errors.push("stop.pct must be a positive finite number");
  } else {
    errors.push("stop: unknown kind");
  }

  if (def.target.kind === "R_MULTIPLE") {
    if (!Number.isFinite(def.target.multiple) || def.target.multiple <= 0) errors.push("target.multiple must be a positive finite number");
  } else if (def.target.kind === "FIXED_PCT") {
    if (!Number.isFinite(def.target.pct) || def.target.pct <= 0) errors.push("target.pct must be a positive finite number");
  } else {
    errors.push("target: unknown kind");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
