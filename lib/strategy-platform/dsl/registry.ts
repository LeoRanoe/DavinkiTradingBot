/**
 * RulePrimitiveRegistry - the single allow-list validate.ts and evaluate.ts
 * consult before touching any DslNode. Adding a primitive later means:
 * (1) add its variant to DslNode in types.ts, (2) add one entry here,
 * (3) add its case to validate.ts/evaluate.ts, (4) add tests. No other file
 * needs to change - this is the registry's extensibility contract.
 *
 * IMPLEMENTED_PRIMITIVES are usable today. FUTURE_PRIMITIVES are named by
 * the product brief but deliberately NOT implemented yet (no SMC/ICT
 * concepts - swings, FVG, sweeps, BOS/MSS - are exposed to user-authored
 * strategies in this checkpoint; those remain exclusive to JeanFX's own
 * hardcoded detection logic). Referencing a FUTURE_PRIMITIVE or any
 * genuinely unknown name is rejected by validate.ts with a distinct,
 * honest error in each case - never silently ignored or treated as a no-op.
 */

export type PrimitiveResultKind = "VALUE" | "CONDITION";

export const IMPLEMENTED_PRIMITIVES: Readonly<Record<string, PrimitiveResultKind>> = {
  ALL: "CONDITION",
  ANY: "CONDITION",
  NOT: "CONDITION",
  COMPARE: "CONDITION",
  CROSS_ABOVE: "CONDITION",
  CROSS_BELOW: "CONDITION",
  SESSION: "CONDITION",
  PERCENT_CHANGE: "CONDITION",
  PRICE: "VALUE",
  VOLUME: "VALUE",
  CONST: "VALUE",
  EMA: "VALUE",
  SMA: "VALUE",
  RSI: "VALUE",
  HIGHEST: "VALUE",
  LOWEST: "VALUE",
};

export const FUTURE_PRIMITIVES: ReadonlySet<string> = new Set([
  "OHLC",
  "ATR",
  "CANDLE_PATTERN",
  "SWING_HIGH",
  "SWING_LOW",
  "FVG",
  "LIQUIDITY_SWEEP",
  "BOS",
  "MSS",
]);

export function isImplementedPrimitive(name: string): boolean {
  return name in IMPLEMENTED_PRIMITIVES;
}

export function isFuturePrimitive(name: string): boolean {
  return FUTURE_PRIMITIVES.has(name);
}

export function resultKindOf(name: string): PrimitiveResultKind | null {
  return IMPLEMENTED_PRIMITIVES[name] ?? null;
}
