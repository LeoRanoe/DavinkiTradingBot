import { describe, expect, it } from "vitest";
import {
  SCANNER_ERROR_AGE_MS,
  SCANNER_WARNING_AGE_MS,
  scannerHealthLevel,
} from "./scanner";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const minutesAgo = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

describe("scannerHealthLevel", () => {
  it("reports UNKNOWN when the scanner has never run", () => {
    expect(scannerHealthLevel(null, NOW)).toBe("UNKNOWN");
    expect(scannerHealthLevel(undefined, NOW)).toBe("UNKNOWN");
  });

  it("reports HEALTHY for a fresh SUCCEEDED run", () => {
    expect(scannerHealthLevel({ status: "SUCCEEDED", startedAt: minutesAgo(1) }, NOW)).toBe("HEALTHY");
  });

  it("reports HEALTHY for a fresh NOOP run - a valid no-trade cycle", () => {
    expect(scannerHealthLevel({ status: "NOOP", startedAt: minutesAgo(1) }, NOW)).toBe("HEALTHY");
  });

  it("reports ERROR for the latest FAILED run regardless of age", () => {
    expect(scannerHealthLevel({ status: "FAILED", startedAt: minutesAgo(1) }, NOW)).toBe("ERROR");
  });

  it("clears ERROR once a newer run recovers - only the latest run is consulted", () => {
    // Simulates: an older FAILED row exists in job_runs, but the caller
    // always passes only the latest authoritative row.
    const recovered = { status: "SUCCEEDED" as const, startedAt: minutesAgo(1) };
    expect(scannerHealthLevel(recovered, NOW)).toBe("HEALTHY");
  });

  it("reports WARNING while a run is currently RUNNING", () => {
    expect(scannerHealthLevel({ status: "RUNNING", startedAt: minutesAgo(1) }, NOW)).toBe("WARNING");
  });

  it("reports WARNING for a mildly stale successful run", () => {
    const ageMins = SCANNER_WARNING_AGE_MS / 60_000 + 1;
    expect(scannerHealthLevel({ status: "SUCCEEDED", startedAt: minutesAgo(ageMins) }, NOW)).toBe("WARNING");
  });

  it("reports ERROR for a significantly stale run even if it once succeeded", () => {
    const ageMins = SCANNER_ERROR_AGE_MS / 60_000 + 1;
    expect(scannerHealthLevel({ status: "SUCCEEDED", startedAt: minutesAgo(ageMins) }, NOW)).toBe("ERROR");
  });

  it("stays HEALTHY at the freshness boundary", () => {
    const ageMins = SCANNER_WARNING_AGE_MS / 60_000;
    expect(scannerHealthLevel({ status: "SUCCEEDED", startedAt: minutesAgo(ageMins) }, NOW)).toBe("HEALTHY");
  });
});
