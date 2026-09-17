/**
 * DSL safety limits (see docs/architecture/strategy-platform.md "DSL safety").
 * Enforced at both validate() (static, before a definition is ever saved)
 * and evaluate() (runtime, defense in depth) - see validate.ts / evaluate.ts.
 */
export const DSL_LIMITS = {
  /** Max nesting depth of ALL/ANY/NOT combinators and nested indicator refs. */
  maxRuleDepth: 6,
  /** Max total node count across the whole definition (conditions + indicator refs). */
  maxRuleCount: 60,
  /** Max period accepted by any indicator (EMA/SMA/RSI/ATR/HIGHEST/LOWEST/PERCENT_CHANGE lookback). */
  maxLookback: 500,
  /** Max distinct timeframes a single strategy version may request. */
  maxTimeframes: 3,
  /** Max instruments a single strategy configuration may run against. */
  maxInstrumentsPerConfiguration: 25,
} as const;

export type DslLimits = typeof DSL_LIMITS;
