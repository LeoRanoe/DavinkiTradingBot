import type { AssetClass } from "@/lib/domain/instrument";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import type { CanonicalTimeframe } from "@/lib/domain/timeframe";
import type { Opportunity } from "@/lib/domain/opportunity";

/**
 * Generic multi-strategy research contract (Checkpoint 3A §2). This exists
 * so future families (V3 MA, V4 TSMOM, V5 BBMR) can plug into the same
 * research engine without inheriting Strategy V1's fixed 100-point score
 * or 1H+15M assumption. Production trading code
 * (lib/strategy/v1/, app/api/jobs/scan/route.ts, lib/trading/, lib/risk/)
 * must not import anything under lib/research-engine/ — this namespace is
 * research-only and is not wired into any route or job.
 *
 * Strategies are PURE and NEVER perform IO: no Supabase, no market-data
 * fetch, no order placement, no account-state mutation, no Qwen call, no
 * PAPER/LIVE authorization. All of that is engine/caller responsibility.
 */

/**
 * A strategy's `status` here is deliberately a closed set that excludes
 * every execution-authorization value Strategy V1 uses
 * (`strategy_versions.status` also allows PAPER_APPROVED/DEMO_APPROVED) —
 * a research-engine strategy has no path to becoming approved for
 * anything through this type alone.
 */
export type ResearchStrategyStatus = "DRAFT" | "RESEARCH_ONLY";

/**
 * One immutable, preregistered parameter configuration for a strategy.
 * `id` must be stable and unique — it is the trial-registry's join key
 * (see trial.ts) and must never be silently redefined once results exist
 * for it (CLAUDE.md "Strategy versions are immutable", applied at the
 * parameter-set granularity a research family actually needs).
 */
export interface StrategyParameterSet<TParams extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly strategyId: string;
  readonly timeframe: CanonicalTimeframe;
  readonly params: Readonly<TParams>;
}

export type EntryEvaluation =
  | { kind: "OPPORTUNITY"; opportunity: Opportunity }
  | { kind: "NO_OPPORTUNITY"; reason: string };

export type ExitEvaluation =
  | { kind: "EXIT"; reason: string; features?: Record<string, unknown> }
  | { kind: "HOLD" };

/**
 * `evaluateEntry`/`evaluateExit` receive `closedCandles`, whose LAST
 * element is always the closed bar currently being evaluated (bar t). This
 * is a structural no-lookahead guarantee, not a documentation promise: the
 * engine only ever calls these with `fullHistory.slice(0, t + 1)`, so a
 * strategy cannot read a future bar even by an indexing mistake — there is
 * nothing after the array's end to read. `closedCandles` is oldest-first
 * and contains ONLY closed candles (the engine filters before ever
 * calling a strategy — see candle-integrity.ts).
 */
export interface StrategyDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly status: ResearchStrategyStatus;
  readonly supportedAssetClasses: readonly AssetClass[];
  /** Preregistered, immutable. The engine/trial runner must never evaluate a parameter set not in this list. */
  readonly parameterSets: readonly StrategyParameterSet<TParams>[];

  evaluateEntry(
    closedCandles: readonly CanonicalCandle[],
    params: StrategyParameterSet<TParams>,
  ): EntryEvaluation;

  evaluateExit(
    closedCandles: readonly CanonicalCandle[],
    params: StrategyParameterSet<TParams>,
  ): ExitEvaluation;
}
