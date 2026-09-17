import { assertValidCostModel, type CostModel } from "../cost-model";

/**
 * Checkpoint 3B.0 §9: four locked cost scenarios. Fee is Bybit's public
 * VIP-0 Spot reference (10 bps per fill); the slippage values are MODEL
 * ASSUMPTIONS used to test sensitivity, NOT a claim about actual
 * historical Bybit execution slippage - see each scenario's own doc
 * comment. These are frozen for the checkpoint: do not add, remove, or
 * retune a scenario after any performance result has been observed.
 */
export const COST_FEE_ONLY: CostModel = {
  entryFeeBps: 10,
  exitFeeBps: 10,
  entrySlippageBps: 0,
  exitSlippageBps: 0,
};

/** Primary evaluation assumption (§12) - all profitability labeling rules are evaluated against this scenario. */
export const COST_BASELINE: CostModel = {
  entryFeeBps: 10,
  exitFeeBps: 10,
  entrySlippageBps: 2,
  exitSlippageBps: 2,
};

export const COST_STRESS: CostModel = {
  entryFeeBps: 10,
  exitFeeBps: 10,
  entrySlippageBps: 5,
  exitSlippageBps: 5,
};

export const COST_HEAVY_STRESS: CostModel = {
  entryFeeBps: 10,
  exitFeeBps: 10,
  entrySlippageBps: 10,
  exitSlippageBps: 10,
};

export const LOCKED_COST_SCENARIOS = {
  COST_FEE_ONLY,
  COST_BASELINE,
  COST_STRESS,
  COST_HEAVY_STRESS,
} as const satisfies Record<string, CostModel>;

export type CostScenarioName = keyof typeof LOCKED_COST_SCENARIOS;

for (const [name, model] of Object.entries(LOCKED_COST_SCENARIOS)) {
  try {
    assertValidCostModel(model);
  } catch (err) {
    throw new Error(`Checkpoint 3B.0 cost-scenarios: locked scenario "${name}" failed validation - ${(err as Error).message}`);
  }
}
