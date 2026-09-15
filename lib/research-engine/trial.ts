import { createHash } from "node:crypto";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import type { InstrumentId } from "@/lib/domain/instrument";
import type { CanonicalTimeframe } from "@/lib/domain/timeframe";
import type { CostModel } from "./cost-model";
import type { NormalizedRiskConfig } from "./position-sizing";
import type { ChronologicalSplit } from "./split";

/**
 * Immutable research-trial record (Checkpoint 3A §19, hardened
 * Checkpoint 3A.1 §10). Pure in-memory code only — NO database
 * persistence in this checkpoint (§27: "Prefer pure code... If
 * persistence is genuinely required, DESIGN the migration and report it
 * for review first"). No migration is proposed here; if Checkpoint 3B
 * needs durable storage for a trial history, that is a separate,
 * explicitly reviewed decision.
 *
 * The purpose is to know exactly what was tested: every field a reviewer
 * would need to reproduce a trial byte-for-byte (§10), plus a fingerprint
 * that changes if any of them does:
 *   - `parameterValues` (not just `parameterSetId`) — a parameter-set id
 *     alone does not prove which VALUES were actually used if the id
 *     were ever (incorrectly) reused; see registry-guard.ts for the
 *     runtime check that this stays true at run time.
 *   - `dataFingerprint` — a SHA-256 over every candle actually used
 *     (instrumentId, timeframe, openTime, OHLCV, isClosed, in order), so
 *     a single price change anywhere in the dataset changes the
 *     fingerprint. `dataStart`/`dataEnd` alone only bound a range; they
 *     do not prove the candles inside it are identical.
 *   - `riskAssumptions` — the normalized sizing config used, so a
 *     riskPct change is visible without inspecting results.
 *   - `codeVersion` — a caller-supplied code/git identifier (this module
 *     performs no IO, so it never invokes git itself - the caller reads
 *     the commit SHA and passes it in). Two runs on different code are
 *     always distinguishable even if every other input matches.
 *
 * This module does NOT claim byte-for-byte reproducibility on its own —
 * it records the inputs needed to reproduce a run and detects when any
 * of them differ. Actually reproducing a run still requires the same
 * engine code at `codeVersion`, which this module cannot itself verify.
 */
export type ResearchTrialStatus = "REGISTERED" | "COMPLETED" | "ABANDONED";

export type DateRange = { startMs: number; endMs: number };

export type ResearchTrial = {
  id: string;
  strategyVersion: string;
  parameterSetId: string;
  parameterValues: Readonly<Record<string, unknown>>;
  instrumentId: InstrumentId;
  timeframe: CanonicalTimeframe;
  dataStart: number;
  dataEnd: number;
  development: DateRange;
  validation: DateRange;
  holdout: DateRange;
  costAssumptions: CostModel;
  riskAssumptions: NormalizedRiskConfig;
  /** SHA-256 over every candle used (instrumentId, timeframe, openTime, OHLCV, isClosed, in order). */
  dataFingerprint: string;
  /** Caller-supplied code/git identifier (e.g. a commit SHA) - this module performs no IO and never derives it itself. */
  codeVersion: string;
  /** SHA-256 of every field above except `id`/`status`/`registeredAt` — changes if any input to the trial changes. */
  configFingerprint: string;
  status: ResearchTrialStatus;
  registeredAt: number;
};

export type RegisterTrialInput = {
  strategyVersion: string;
  parameterSetId: string;
  parameterValues: Readonly<Record<string, unknown>>;
  instrumentId: InstrumentId;
  timeframe: CanonicalTimeframe;
  /** Full oldest-first candle array the split was computed over - used for both date ranges and the data fingerprint. */
  candles: readonly CanonicalCandle[];
  split: ChronologicalSplit;
  costAssumptions: CostModel;
  riskAssumptions: NormalizedRiskConfig;
  codeVersion: string;
  now?: number;
};

function dateRangeFromSplit(candles: readonly CanonicalCandle[], range: { startIndex: number; endIndex: number }): DateRange {
  if (range.endIndex <= range.startIndex || candles.length === 0) {
    return { startMs: 0, endMs: 0 };
  }
  return { startMs: candles[range.startIndex].openTime, endMs: candles[range.endIndex - 1].openTime };
}

/**
 * §10 data fingerprint: SHA-256 over every candle in order, keyed on
 * exactly the fields that determine what the engine actually saw
 * (instrumentId, timeframe, openTime, OHLCV, isClosed). A single price
 * change anywhere in the array changes this hash.
 */
export function computeCandleDataFingerprint(candles: readonly CanonicalCandle[]): string {
  const projected = candles.map((c) => ({
    instrumentId: c.instrumentId,
    timeframe: c.timeframe,
    openTime: c.openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    isClosed: c.isClosed,
  }));
  return createHash("sha256").update(JSON.stringify(projected)).digest("hex");
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
  const dataStart = input.candles[0]?.openTime ?? 0;
  const dataEnd = input.candles[input.candles.length - 1]?.openTime ?? 0;
  const development = dateRangeFromSplit(input.candles, input.split.development);
  const validation = dateRangeFromSplit(input.candles, input.split.validation);
  const holdout = dateRangeFromSplit(input.candles, input.split.holdout);
  const dataFingerprint = computeCandleDataFingerprint(input.candles);

  const fingerprintInput = {
    strategyVersion: input.strategyVersion,
    parameterSetId: input.parameterSetId,
    parameterValues: input.parameterValues,
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    dataStart,
    dataEnd,
    development,
    validation,
    holdout,
    costAssumptions: input.costAssumptions,
    riskAssumptions: input.riskAssumptions,
    dataFingerprint,
    codeVersion: input.codeVersion,
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
