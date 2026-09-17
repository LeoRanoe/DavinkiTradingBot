import type { Direction, Timeframe, TradingSession } from "../types";

/**
 * Safe declarative strategy DSL - see docs/architecture/strategy-platform.md
 * "User strategy DSL". Every node is data, never code: there is no eval(),
 * new Function(), or VM anywhere in this module or dsl/evaluate.ts - see
 * dsl/registry.ts for the extensible primitive set actually implemented in
 * this checkpoint, and the future-looking primitives deliberately left
 * unregistered (FVG/LIQUIDITY_SWEEP/BOS/MSS/SWING_HIGH/SWING_LOW/
 * CANDLE_PATTERN) so a user-authored strategy cannot reference them yet.
 */

export type Comparator = "GT" | "GTE" | "LT" | "LTE" | "EQ";

/**
 * DslNode: a discriminated union of every implemented primitive. `type`
 * doubles as the registry key. Nodes are either VALUE-producing (resolve to
 * a numeric series aligned to the entry-timeframe candles) or
 * CONDITION-producing (resolve to a boolean) - see registry.ts resultKind.
 */
export type DslNode =
  | { type: "ALL"; children: DslNode[] }
  | { type: "ANY"; children: DslNode[] }
  | { type: "NOT"; child: DslNode }
  | { type: "COMPARE"; comparator: Comparator; left: DslNode; right: DslNode }
  | { type: "CROSS_ABOVE"; left: DslNode; right: DslNode }
  | { type: "CROSS_BELOW"; left: DslNode; right: DslNode }
  | { type: "SESSION"; sessions: TradingSession[] }
  | { type: "PERCENT_CHANGE"; period: number; comparator: "GT" | "LT"; valuePct: number; child?: DslNode }
  | { type: "PRICE"; field: "open" | "high" | "low" | "close" }
  | { type: "VOLUME" }
  | { type: "CONST"; value: number }
  | { type: "EMA"; period: number; child?: DslNode }
  | { type: "SMA"; period: number; child?: DslNode }
  | { type: "RSI"; period: number }
  | { type: "HIGHEST"; period: number; child: DslNode }
  | { type: "LOWEST"; period: number; child: DslNode };

export type DslStopSpec =
  | { kind: "ATR_MULTIPLE"; atrPeriod: number; multiple: number }
  | { kind: "FIXED_PCT"; pct: number };

export type DslTargetSpec = { kind: "R_MULTIPLE"; multiple: number } | { kind: "FIXED_PCT"; pct: number };

export type DslParameterSchema = Record<
  string,
  { type: "number" | "string" | "boolean"; default: number | string | boolean }
>;

/**
 * The immutable definition snapshot stored on a strategy_platform_versions
 * row for a USER_DEFINED strategy (see supabase/migrations/*_strategy_platform.sql).
 */
export type DslDefinition = {
  engineSchemaVersion: "1";
  timeframes: Timeframe[];
  side: Direction[];
  entry: DslNode; // must validate as CONDITION-kind
  stop: DslStopSpec;
  target: DslTargetSpec;
  parameterSchema: DslParameterSchema;
};

export type DslValidationResult = { ok: true } | { ok: false; errors: string[] };

export type DslEvalResult<T> = { ok: true; value: T } | { ok: false; reason: string };
