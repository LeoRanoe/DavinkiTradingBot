/**
 * RulePrimitiveRegistry - the single allow-list validate.ts and evaluate.ts
 * consult before touching any DslNode. Adding a primitive later means:
 * (1) add its variant to DslNode in types.ts, (2) add one entry here,
 * (3) add its case to validate.ts/evaluate.ts, (4) add tests. No other file
 * needs to change - this is the registry's extensibility contract.
 *
 * IMPLEMENTED_PRIMITIVES are usable today. As of this checkpoint that
 * includes the SMC/ICT structure primitives (SWING_HIGH/SWING_LOW/BOS/
 * LIQUIDITY_SWEEP/FVG/CANDLE_PATTERN) and ATR, all implemented by wrapping
 * the exact same pure functions lib/strategy/jeanfx-v1's own state machine
 * uses (lib/strategy/jeanfx-v1/primitives/*) - JeanFX's build-out is what
 * promoted these from future to implemented, per
 * docs/architecture/strategy-platform.md. FUTURE_PRIMITIVES remains for
 * whatever isn't wired up yet. Referencing a FUTURE_PRIMITIVE or any
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
  ATR: "VALUE",
  HIGHEST: "VALUE",
  LOWEST: "VALUE",
  SWING_HIGH: "VALUE",
  SWING_LOW: "VALUE",
  BULLISH_CANDLE: "CONDITION",
  BEARISH_CANDLE: "CONDITION",
  CANDLE_PATTERN: "CONDITION",
  BOS: "CONDITION",
  LIQUIDITY_SWEEP: "CONDITION",
  FVG: "CONDITION",
};

export const FUTURE_PRIMITIVES: ReadonlySet<string> = new Set(["OHLC", "MSS"]);

export function isImplementedPrimitive(name: string): boolean {
  return name in IMPLEMENTED_PRIMITIVES;
}

export function isFuturePrimitive(name: string): boolean {
  return FUTURE_PRIMITIVES.has(name);
}

export function resultKindOf(name: string): PrimitiveResultKind | null {
  return IMPLEMENTED_PRIMITIVES[name] ?? null;
}
