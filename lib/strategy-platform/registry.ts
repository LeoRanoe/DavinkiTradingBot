import type { StrategyContract } from "./types";
import { v1BuiltInStrategy } from "./built-in/v1";
import { jeanfxV1BuiltInStrategy } from "./built-in/jeanfx-v1";
import { trbBuiltInStrategy } from "./built-in/trb";

/**
 * The single canonical built-in strategy registry. No application route or
 * job should ever hardcode `if (strategy === "jeanfx")` - resolve through
 * this module instead, by slug.
 */
export const BUILT_IN_STRATEGIES: readonly StrategyContract[] = [
  v1BuiltInStrategy,
  jeanfxV1BuiltInStrategy,
  trbBuiltInStrategy,
];

export function getBuiltInStrategy(slug: string): StrategyContract | undefined {
  return BUILT_IN_STRATEGIES.find((s) => s.metadata.slug === slug);
}

export function listBuiltInStrategies(): readonly StrategyContract[] {
  return BUILT_IN_STRATEGIES;
}
