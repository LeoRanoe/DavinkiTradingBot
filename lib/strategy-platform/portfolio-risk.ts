import type { PortfolioState } from "./orchestrator-types";
import type { AssetClass, Direction, Instrument, Opportunity } from "./types";

/**
 * Portfolio-level risk limits (Prompt 3 S4). Generic - no strategy-specific
 * hacks; every limit applies identically to JeanFX, TRB, and any custom
 * strategy. All percentages are fractions of equity (0.01 = 1%).
 */
export type PortfolioLimits = {
  maxTotalOpenRiskPct: number;
  maxRiskPerInstrumentPct: number;
  maxRiskPerStrategyPct: number;
  maxPositionsPerStrategy: number;
  maxTotalPositions: number;
  maxExposurePerAssetClassPct: number;
  /**
   * Architecture hook for "max same-direction correlated exposure"
   * (Prompt 3 S4's last bullet). With the default `NO_CORRELATION_MODELING`
   * policy every instrument is its own correlation group, so this cap has
   * no additional effect beyond `maxRiskPerInstrumentPct` - correlation
   * modeling is NOT pretended to be solved here. A real correlation policy
   * (e.g. grouping BTC/ETH, or majors by base currency) can be plugged in
   * later via `CorrelationPolicy` without changing this function's shape.
   */
  maxCorrelatedExposurePct: number;
};

export type CorrelationPolicy = {
  groupOf: (instrumentId: string) => string;
};

/** Conservative default: no correlation is assumed between different instruments. */
export const NO_CORRELATION_MODELING: CorrelationPolicy = { groupOf: (instrumentId) => instrumentId };

/**
 * One physical position intent per (instrument, direction), aggregating
 * every contributing opportunity's risk rather than opening N separate
 * positions that would silently double exposure (Prompt 3 S5 example:
 * JeanFX LONG ETH + TRB LONG ETH -> one ETH LONG intent, combined risk
 * capped, attribution to both strategies preserved).
 */
export type PositionIntent = {
  instrumentId: string;
  side: Direction;
  combinedRiskPct: number;
  contributingOpportunities: Opportunity[];
};

export type RejectedOpportunity = { opportunity: Opportunity; reason: string };

export type PortfolioRiskResult = {
  intents: PositionIntent[];
  rejected: RejectedOpportunity[];
};

function groupKey(instrumentId: string, side: Direction): string {
  return `${instrumentId}::${side}`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Screens opportunities against portfolio-wide limits and aggregates
 * same-instrument/same-direction opportunities into one PositionIntent
 * (Prompt 3 S5). Runs BEFORE conflict resolution (see orchestrator.ts) -
 * opposing-direction handling is `conflict.ts`'s job, this module only
 * ever combines/caps SAME-direction exposure.
 *
 * Deterministic regardless of input array order: every grouping and
 * filtering pass sorts its keys before iterating.
 */
export function applyPortfolioRisk(
  opportunities: Opportunity[],
  riskPctOf: (o: Opportunity) => number,
  instrumentOf: (instrumentId: string) => Instrument,
  portfolio: PortfolioState,
  limits: PortfolioLimits,
  correlation: CorrelationPolicy = NO_CORRELATION_MODELING,
): PortfolioRiskResult {
  const rejected: RejectedOpportunity[] = [];

  // Pass 1: aggregate same-instrument/same-direction opportunities, capped at maxRiskPerInstrumentPct.
  const grouped = new Map<string, Opportunity[]>();
  for (const o of opportunities) {
    const key = groupKey(o.instrumentId, o.side);
    const list = grouped.get(key);
    if (list) list.push(o);
    else grouped.set(key, [o]);
  }

  let intents: PositionIntent[] = [];
  for (const key of [...grouped.keys()].sort()) {
    const group = grouped.get(key)!;
    const [instrumentId, side] = [group[0].instrumentId, group[0].side];
    const combinedRiskPct = sum(group.map(riskPctOf));
    const existing = portfolio.openRiskByInstrument[instrumentId] ?? 0;
    if (existing + combinedRiskPct > limits.maxRiskPerInstrumentPct) {
      for (const o of group) rejected.push({ opportunity: o, reason: `INSTRUMENT_RISK_CAP: combined ${side} risk for ${instrumentId} would exceed maxRiskPerInstrumentPct` });
      continue;
    }
    intents.push({ instrumentId, side, combinedRiskPct, contributingOpportunities: group });
  }

  // Pass 2: correlated-exposure cap (architecture hook; a no-op beyond pass 1 under the default policy).
  const correlatedTotals = new Map<string, number>();
  const survivingAfterCorrelation: PositionIntent[] = [];
  for (const intent of intents.sort((a, b) => (a.instrumentId + a.side).localeCompare(b.instrumentId + b.side))) {
    const groupId = correlation.groupOf(intent.instrumentId);
    const runningTotal = correlatedTotals.get(groupId) ?? 0;
    if (runningTotal + intent.combinedRiskPct > limits.maxCorrelatedExposurePct) {
      for (const o of intent.contributingOpportunities) rejected.push({ opportunity: o, reason: `CORRELATED_EXPOSURE_CAP: correlation group '${groupId}' would exceed maxCorrelatedExposurePct` });
      continue;
    }
    correlatedTotals.set(groupId, runningTotal + intent.combinedRiskPct);
    survivingAfterCorrelation.push(intent);
  }
  intents = survivingAfterCorrelation;

  // Pass 3: per-strategy risk cap - a strategy's opportunities across ALL instruments combined.
  const riskByStrategy = new Map<string, number>();
  for (const intent of intents) {
    for (const o of intent.contributingOpportunities) {
      riskByStrategy.set(o.strategyDefinitionId, (riskByStrategy.get(o.strategyDefinitionId) ?? 0) + riskPctOf(o));
    }
  }
  const strategyOverCap = new Set<string>();
  for (const [strategyId, addedRisk] of riskByStrategy) {
    const existing = portfolio.openRiskByStrategy[strategyId] ?? 0;
    if (existing + addedRisk > limits.maxRiskPerStrategyPct) strategyOverCap.add(strategyId);
  }
  if (strategyOverCap.size > 0) {
    const survivors: PositionIntent[] = [];
    for (const intent of intents) {
      const blocked = intent.contributingOpportunities.filter((o) => strategyOverCap.has(o.strategyDefinitionId));
      const kept = intent.contributingOpportunities.filter((o) => !strategyOverCap.has(o.strategyDefinitionId));
      for (const o of blocked) rejected.push({ opportunity: o, reason: `STRATEGY_RISK_CAP: strategy ${o.strategyDefinitionId} would exceed maxRiskPerStrategyPct` });
      if (kept.length > 0) survivors.push({ ...intent, contributingOpportunities: kept, combinedRiskPct: sum(kept.map(riskPctOf)) });
    }
    intents = survivors;
  }

  // Pass 4: per-strategy max open positions (one new position per surviving intent, per contributing strategy).
  const newPositionsByStrategy = new Map<string, number>();
  for (const intent of intents) {
    for (const strategyId of new Set(intent.contributingOpportunities.map((o) => o.strategyDefinitionId))) {
      newPositionsByStrategy.set(strategyId, (newPositionsByStrategy.get(strategyId) ?? 0) + 1);
    }
  }
  const strategyPositionsOverCap = new Set<string>();
  for (const [strategyId, added] of newPositionsByStrategy) {
    const existing = portfolio.openPositionsByStrategy[strategyId] ?? 0;
    if (existing + added > limits.maxPositionsPerStrategy) strategyPositionsOverCap.add(strategyId);
  }
  if (strategyPositionsOverCap.size > 0) {
    const survivors: PositionIntent[] = [];
    for (const intent of intents.sort((a, b) => (a.instrumentId + a.side).localeCompare(b.instrumentId + b.side))) {
      const anyOverCap = intent.contributingOpportunities.some((o) => strategyPositionsOverCap.has(o.strategyDefinitionId));
      if (anyOverCap) {
        for (const o of intent.contributingOpportunities) rejected.push({ opportunity: o, reason: `STRATEGY_POSITION_CAP: a contributing strategy would exceed maxPositionsPerStrategy` });
        continue;
      }
      survivors.push(intent);
    }
    intents = survivors;
  }

  // Pass 5: total open positions cap - deterministic acceptance order (instrumentId, then side).
  intents = intents.sort((a, b) => (a.instrumentId + a.side).localeCompare(b.instrumentId + b.side));
  let runningPositions = portfolio.totalOpenPositions;
  const acceptedByTotalCap: PositionIntent[] = [];
  for (const intent of intents) {
    if (runningPositions + 1 > limits.maxTotalPositions) {
      for (const o of intent.contributingOpportunities) rejected.push({ opportunity: o, reason: "TOTAL_POSITION_CAP: maxTotalPositions reached" });
      continue;
    }
    runningPositions += 1;
    acceptedByTotalCap.push(intent);
  }
  intents = acceptedByTotalCap;

  // Pass 6: total open risk and per-asset-class exposure caps.
  let runningTotalRisk = portfolio.totalOpenRisk;
  const runningAssetClassRisk = new Map<AssetClass, number>(Object.entries(portfolio.openRiskByAssetClass) as [AssetClass, number][]);
  const finalIntents: PositionIntent[] = [];
  for (const intent of intents) {
    const assetClass = instrumentOf(intent.instrumentId).assetClass;
    const existingClassRisk = runningAssetClassRisk.get(assetClass) ?? 0;

    if (runningTotalRisk + intent.combinedRiskPct > limits.maxTotalOpenRiskPct) {
      for (const o of intent.contributingOpportunities) rejected.push({ opportunity: o, reason: "TOTAL_OPEN_RISK_CAP: maxTotalOpenRiskPct reached" });
      continue;
    }
    if (existingClassRisk + intent.combinedRiskPct > limits.maxExposurePerAssetClassPct) {
      for (const o of intent.contributingOpportunities) rejected.push({ opportunity: o, reason: `ASSET_CLASS_CAP: ${assetClass} would exceed maxExposurePerAssetClassPct` });
      continue;
    }

    runningTotalRisk += intent.combinedRiskPct;
    runningAssetClassRisk.set(assetClass, existingClassRisk + intent.combinedRiskPct);
    finalIntents.push(intent);
  }

  return { intents: finalIntents, rejected };
}
