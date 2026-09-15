import { createHash } from "node:crypto";
import type { InstrumentId } from "@/lib/domain/instrument";
import type { CanonicalTimeframe } from "@/lib/domain/timeframe";
import type { CostModel } from "./cost-model";
import type { ChronologicalSplit } from "./split";

/**
 * Immutable research-trial record (Checkpoint 3A §19). Pure in-memory
 * code only — NO database persistence in this checkpoint (§27: "Prefer
 * pure code... If persistence is genuinely required, DESIGN the migration
 * and report it for review first"). No migration is proposed here; if
 * Checkpoint 3B needs durable storage for a trial history, that is a
 * separate, explicitly reviewed decision.
 *
 * The purpose is to know exactly what was tested: every field a reviewer
 * would need to reproduce a trial byte-for-byte, plus a fingerprint that
 * changes if any of them does.
 */
export type ResearchTrialStatus = "REGISTERED" | "COMPLETED" | "ABANDONED";

export type DateRange = { startMs: number; endMs: number };

export type ResearchTrial = {
  id: string;
  strategyVersion: string;
  parameterSetId: string;
  instrumentId: InstrumentId;
  timeframe: CanonicalTimeframe;
  dataStart: number;
  dataEnd: number;
  development: DateRange;
  validation: DateRange;
  holdout: DateRange;
  costAssumptions: CostModel;
  /** SHA-256 of every field above except `id`/`status`/`registeredAt` — changes if any input to the trial changes. */
  configFingerprint: string;
  status: ResearchTrialStatus;
  registeredAt: number;
};

export type RegisterTrialInput = {
  strategyVersion: string;
  parameterSetId: string;
  instrumentId: InstrumentId;
  timeframe: CanonicalTimeframe;
  candleOpenTimes: readonly number[]; // full oldest-first candle openTime array the split was computed over
  split: ChronologicalSplit;
  costAssumptions: CostModel;
  now?: number;
};

function dateRangeFromSplit(openTimes: readonly number[], range: { startIndex: number; endIndex: number }): DateRange {
  if (range.endIndex <= range.startIndex || openTimes.length === 0) {
    return { startMs: 0, endMs: 0 };
  }
  return { startMs: openTimes[range.startIndex], endMs: openTimes[range.endIndex - 1] };
}

export function computeConfigFingerprint(
  input: Omit<ResearchTrial, "id" | "status" | "registeredAt" | "configFingerprint">,
): string {
  // Stable stringify: sort object keys recursively so field order in code
  // never changes the fingerprint - only actual values do.
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, stable(v)]),
      );
    }
    return value;
  };
  const json = JSON.stringify(stable(input));
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Registers a trial deterministically from a chronological split already
 * computed over one candle array. Never inspects trial RESULTS (there are
 * none here — this only records what will be/was tested, not any
 * outcome), so registering a trial can never be influenced by having seen
 * its own holdout performance.
 */
export function registerResearchTrial(input: RegisterTrialInput): ResearchTrial {
  const dataStart = input.candleOpenTimes[0] ?? 0;
  const dataEnd = input.candleOpenTimes[input.candleOpenTimes.length - 1] ?? 0;
  const development = dateRangeFromSplit(input.candleOpenTimes, input.split.development);
  const validation = dateRangeFromSplit(input.candleOpenTimes, input.split.validation);
  const holdout = dateRangeFromSplit(input.candleOpenTimes, input.split.holdout);

  const fingerprintInput = {
    strategyVersion: input.strategyVersion,
    parameterSetId: input.parameterSetId,
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    dataStart,
    dataEnd,
    development,
    validation,
    holdout,
    costAssumptions: input.costAssumptions,
  };
  const configFingerprint = computeConfigFingerprint(fingerprintInput);

  return {
    id: `${input.strategyVersion}:${input.parameterSetId}:${input.instrumentId}:${configFingerprint.slice(0, 16)}`,
    ...fingerprintInput,
    configFingerprint,
    status: "REGISTERED",
    registeredAt: input.now ?? Date.now(),
  };
}
