import type { Direction, Timeframe, TradingSession } from "../types";

/**
 * Safe declarative strategy DSL - see docs/architecture/strategy-platform.md
 * "User strategy DSL". Every node is data, never code: there is no eval(),
 * new Function(), or VM anywhere in this module or dsl/evaluate.ts - see
 * dsl/registry.ts for the extensible primitive set. As of this checkpoint
 * that includes SWING_HIGH/SWING_LOW/BOS/LIQUIDITY_SWEEP/FVG/
 * CANDLE_PATTERN/ATR, each a thin wrapper over the exact same pure
 * functions lib/strategy/jeanfx-v1's state machine uses
 * (lib/strategy/jeanfx-v1/primitives/*) - not reimplemented here. MSS
 * stays exclusive to JeanFX's own hardcoded detection (it needs
 * reversal-vs-prior-structure context a single stateless per-candle DSL
 * condition can't cleanly express), and OHLC is left out as redundant with
 * PRICE(field).
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
  | { type: "ATR"; period: number }
  | { type: "HIGHEST"; period: number; child: DslNode }
  | { type: "LOWEST"; period: number; child: DslNode }
  | { type: "SWING_HIGH"; leftRightBars: number }
  | { type: "SWING_LOW"; leftRightBars: number }
  | { type: "BULLISH_CANDLE" }
  | { type: "BEARISH_CANDLE" }
  | { type: "CANDLE_PATTERN"; pattern: "BULLISH_ENGULFING" | "BEARISH_ENGULFING" | "HAMMER" | "SHOOTING_STAR" }
  | { type: "BOS"; direction: "LONG" | "SHORT"; leftRightBars: number }
  | { type: "LIQUIDITY_SWEEP"; side: "BUY_SIDE" | "SELL_SIDE"; leftRightBars: number; equalHighLowAtrMultiple: number; atrPeriod: number }
  | { type: "FVG"; direction: "LONG" | "SHORT" };

/**
 * Stop builder (spec Prompt 2 S11). BELOW_SWING/BELOW_SIGNAL_LOW only make
 * sense for a LONG entry; ABOVE_SWING/ABOVE_SIGNAL_HIGH only for SHORT -
 * validate.ts checks this against DslDefinition.side, not just the shape.
 */
export type DslStopSpec =
  | { kind: "FIXED_PERCENT"; pct: number }
  | { kind: "ATR_MULTIPLE"; atrPeriod: number; multiple: number }
  | { kind: "BELOW_SWING"; leftRightBars: number; bufferPct: number }
  | { kind: "ABOVE_SWING"; leftRightBars: number; bufferPct: number }
  | { kind: "BELOW_SIGNAL_LOW"; bufferPct: number }
  | { kind: "ABOVE_SIGNAL_HIGH"; bufferPct: number };

/** Target builder (spec Prompt 2 S12). No arbitrary code - a closed set of deterministic formulas, same as DslStopSpec. */
export type DslTargetSpec =
  | { kind: "R_MULTIPLE"; multiple: number }
  | { kind: "FIXED_PERCENT"; pct: number }
  | { kind: "NEXT_SWING"; leftRightBars: number }
  | { kind: "NEXT_LIQUIDITY_POOL"; leftRightBars: number; equalHighLowAtrMultiple: number; atrPeriod: number };

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
