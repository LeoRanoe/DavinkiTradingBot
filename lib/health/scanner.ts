import type { SystemHealthLevel } from "@/components/dashboard/system-status-badge";

/**
 * Single source of truth for scanner health, used by the app layout header,
 * the dashboard, and the System page so the three never disagree.
 *
 * This is a pure function of the latest `job_runs` row and the current
 * time - no I/O, no side effects, so it is trivially unit-testable and
 * cannot itself become a source of staleness.
 *
 * Rules (see CLAUDE.md task notes for rationale):
 * - never run                              -> UNKNOWN
 * - latest run FAILED                      -> ERROR
 * - latest run significantly stale         -> ERROR
 * - latest run currently RUNNING           -> WARNING
 * - latest run mildly stale                -> WARNING
 * - latest run SUCCEEDED or NOOP, fresh    -> HEALTHY
 *
 * A recovered scanner (a fresh SUCCEEDED/NOOP row) always reports HEALTHY,
 * even if an older row in the same table was FAILED - only the latest
 * authoritative run is consulted, never history beyond it.
 */

export type ScannerJobStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "NOOP";

export interface ScannerJobInfo {
  status: ScannerJobStatus;
  startedAt: string;
}

// Thresholds: the scanner runs every 5 minutes, so a run older than one
// missed cycle is a warning sign, and older than two is treated as broken.
export const SCANNER_WARNING_AGE_MS = 7 * 60_000;
export const SCANNER_ERROR_AGE_MS = 12 * 60_000;

export function scannerHealthLevel(
  lastRun: ScannerJobInfo | null | undefined,
  now: number,
): SystemHealthLevel {
  if (!lastRun) return "UNKNOWN";

  const ageMs = now - new Date(lastRun.startedAt).getTime();

  if (lastRun.status === "FAILED") return "ERROR";
  if (ageMs > SCANNER_ERROR_AGE_MS) return "ERROR";
  if (lastRun.status === "RUNNING") return "WARNING";
  if (ageMs > SCANNER_WARNING_AGE_MS) return "WARNING";
  if (lastRun.status === "SUCCEEDED" || lastRun.status === "NOOP") return "HEALTHY";
  return "WARNING";
}

export function scannerHealthLabel(lastRun: ScannerJobInfo | null | undefined): string {
  return lastRun ? `Scanner: ${lastRun.status}` : "Scanner: UNKNOWN";
}
