import { calculateCounterfactualOutcome } from "./counterfactual";
import type { CandidatePlan, CounterfactualOutcome, OutcomeCandle } from "./types";

/** Dependency-injected batch runner so research jobs are explicitly separate from scanning/execution. */
export async function settleCounterfactualResearch<T extends { id: string; plan: CandidatePlan }>(
  rows: T[],
  loadCandles: (row: T) => Promise<OutcomeCandle[]>,
  persist: (id: string, outcome: CounterfactualOutcome) => Promise<void>,
): Promise<{ settled: number; failures: number }> {
  let settled = 0;
  let failures = 0;
  for (const row of rows) {
    try {
      await persist(row.id, calculateCounterfactualOutcome(row.plan, await loadCandles(row)));
      settled += 1;
    } catch {
      // Counterfactual failures are isolated research failures. They never
      // roll back actual outcomes, portfolio equity, or scanner state.
      failures += 1;
    }
  }
  return { settled, failures };
}
