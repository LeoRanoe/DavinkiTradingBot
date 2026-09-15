import type { StrategyDefinition, StrategyParameterSet } from "./strategy";

/**
 * Runtime strategy/parameter-set registry invariant (Checkpoint 3A.1 §3).
 * `StrategyParameterSet`'s TypeScript shape does not, by itself, stop a
 * caller from constructing an ad-hoc object that reuses a registered
 * `id` with mutated `params` or a mismatched `timeframe` — TypeScript
 * only checks structural shape, not "is this the actual preregistered
 * object". This function is the runtime check the engine calls before
 * every trial so that can never happen silently.
 *
 * Checks, in order:
 *   1. `paramSet.strategyId === strategy.id` — the parameter set must
 *      declare the strategy it was actually passed to run against.
 *   2. `paramSet.id` must exist in `strategy.parameterSets` — only
 *      preregistered parameter sets may ever be run (CLAUDE.md "Strategy
 *      versions are immutable", applied at the parameter-set level).
 *   3. The REGISTERED parameter set for that id must have the same
 *      `timeframe` and the same `params` (deep-equal) as the one
 *      supplied — rejects an ad-hoc mutated parameter object that reuses
 *      an existing id.
 */
export function assertRegisteredParameterSet<TParams extends Record<string, unknown>>(
  strategy: StrategyDefinition<TParams>,
  paramSet: StrategyParameterSet<TParams>,
): void {
  if (paramSet.strategyId !== strategy.id) {
    throw new Error(
      `assertRegisteredParameterSet: parameter set "${paramSet.id}" declares strategyId="${paramSet.strategyId}", ` +
        `but was passed to run against strategy "${strategy.id}".`,
    );
  }

  const registered = strategy.parameterSets.find((p) => p.id === paramSet.id);
  if (!registered) {
    throw new Error(
      `assertRegisteredParameterSet: parameter set id "${paramSet.id}" is not registered on strategy "${strategy.id}". ` +
        `Only preregistered parameter sets (strategy.parameterSets) may ever be run.`,
    );
  }

  if (registered.timeframe !== paramSet.timeframe) {
    throw new Error(
      `assertRegisteredParameterSet: parameter set "${paramSet.id}" timeframe mismatch - ` +
        `registered=${registered.timeframe}, supplied=${paramSet.timeframe}.`,
    );
  }

  if (JSON.stringify(registered.params) !== JSON.stringify(paramSet.params)) {
    throw new Error(
      `assertRegisteredParameterSet: parameter set "${paramSet.id}" params mismatch - the supplied params do not ` +
        `equal the registered/preregistered values. An ad-hoc parameter object reusing an existing id is rejected.`,
    );
  }
}
