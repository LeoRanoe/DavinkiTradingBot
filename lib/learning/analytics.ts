import type { EvidenceLevel, LearningTrade } from "./types";

export const INITIAL_EVIDENCE_MIN_SAMPLE = 20;

export function evidenceLevel(sampleCount: number): EvidenceLevel {
  if (sampleCount === 0) return "NO_DATA";
  if (sampleCount < 5) return "EXTREMELY_LOW_EVIDENCE";
  if (sampleCount < INITIAL_EVIDENCE_MIN_SAMPLE) return "LOW_EVIDENCE";
  return "INITIAL_EVIDENCE";
}

export type PerformanceMetrics = {
  sampleCount: number; wins: number; losses: number; breakeven: number; winRate: number | null;
  averageWin: number | null; averageLoss: number | null; averageR: number | null; medianR: number | null;
  expectancyR: number | null; profitFactor: number | null; grossProfit: number; grossLoss: number;
  netPnl: number; fees: number; slippage: number; maxDrawdown: number; maxLosingStreak: number;
  averageMfeR: number | null; averageMaeR: number | null; averageDurationMinutes: number | null;
  evidenceLevel: EvidenceLevel;
};

/** Aggregate completed rows only. Callers deliberately pass actual or hypothetical rows separately. */
export function calculatePerformance(records: LearningTrade[]): PerformanceMetrics {
  const closed = records.filter((r) => r.pnl !== null && r.rMultiple !== null && r.closedAt !== null);
  const wins = closed.filter((r) => (r.pnl ?? 0) > 0);
  const losses = closed.filter((r) => (r.pnl ?? 0) < 0);
  const breakeven = closed.length - wins.length - losses.length;
  const rValues = closed.map((r) => r.rMultiple ?? 0);
  const grossProfit = wins.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, r) => sum + (r.pnl ?? 0), 0));
  let running = 0, peak = 0, maxDrawdown = 0, streak = 0, maxLosingStreak = 0;
  for (const r of closed) {
    running += r.pnl ?? 0; peak = Math.max(peak, running); maxDrawdown = Math.max(maxDrawdown, peak - running);
    if ((r.pnl ?? 0) < 0) { streak += 1; maxLosingStreak = Math.max(maxLosingStreak, streak); } else streak = 0;
  }
  const durations = closed.map((r) => (r.closedAt! - r.openedAt) / 60_000);
  return {
    sampleCount: closed.length, wins: wins.length, losses: losses.length, breakeven,
    winRate: closed.length ? wins.length / closed.length : null,
    averageWin: wins.length ? mean(wins.map((r) => r.pnl ?? 0)) : null,
    averageLoss: losses.length ? mean(losses.map((r) => r.pnl ?? 0)) : null,
    averageR: rValues.length ? mean(rValues) : null, medianR: median(rValues),
    expectancyR: rValues.length ? mean(rValues) : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : null,
    grossProfit, grossLoss, netPnl: closed.reduce((s, r) => s + (r.pnl ?? 0), 0),
    fees: closed.reduce((s, r) => s + r.fees, 0), slippage: closed.reduce((s, r) => s + r.slippage, 0),
    maxDrawdown, maxLosingStreak,
    averageMfeR: meanNullable(closed.map((r) => r.excursions?.mfeR ?? null)),
    averageMaeR: meanNullable(closed.map((r) => r.excursions?.maeR ?? null)),
    averageDurationMinutes: durations.length ? mean(durations) : null,
    evidenceLevel: evidenceLevel(closed.length),
  };
}

export function groupPerformance<T extends string>(records: LearningTrade[], key: (record: LearningTrade) => T): Record<T, PerformanceMetrics> {
  const groups = new Map<T, LearningTrade[]>();
  for (const record of records) { const value = key(record); groups.set(value, [...(groups.get(value) ?? []), record]); }
  return Object.fromEntries([...groups.entries()].map(([value, rows]) => [value, calculatePerformance(rows)])) as Record<T, PerformanceMetrics>;
}

export type DeterministicObservation = { label: "STATISTICAL_OBSERVATION"; description: string; sampleCount: number; evidenceLevel: EvidenceLevel; limitation: string };
export function compareExpectancy(label: string, left: PerformanceMetrics, right: PerformanceMetrics): DeterministicObservation | null {
  if (left.evidenceLevel !== "INITIAL_EVIDENCE" || right.evidenceLevel !== "INITIAL_EVIDENCE" || left.expectancyR === null || right.expectancyR === null) return null;
  const direction = left.expectancyR >= right.expectancyR ? "higher" : "lower";
  return { label: "STATISTICAL_OBSERVATION", description: `${label} currently has ${direction} expectancy (${left.expectancyR.toFixed(2)}R vs ${right.expectancyR.toFixed(2)}R).`, sampleCount: left.sampleCount + right.sampleCount, evidenceLevel: "INITIAL_EVIDENCE", limitation: "Observational comparison only; it does not establish causation or a strategy change." };
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const meanNullable = (values: Array<number | null>) => { const present = values.filter((v): v is number => v !== null); return present.length ? mean(present) : null; };
const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
