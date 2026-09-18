import { describe, expect, it } from "vitest";
import { runGoldScan } from "./scan";
import { classifySession, JEANFX_DEFAULT_SESSION_WINDOWS } from "@/lib/strategy/jeanfx-v1/primitives/sessions";
import {
  bearishBiasCandles,
  bearishEntryCandles,
  bullishBiasCandles,
  bullishEntryCandles,
  bullishStructureCandles,
  mirroredBearishStructureCandles,
} from "@/lib/strategy/jeanfx-v1/primitives/__fixtures__/bullish-scenario";
import type { CanonicalCandle } from "../types";

const EQUITY = 100_000;

function shift(candles: CanonicalCandle[], offsetMs: number): CanonicalCandle[] {
  return candles.map((c) => ({ ...c, openTime: c.openTime + offsetMs }));
}

/** The shared JeanFX fixture's confirmation candle lands at 1970-01-01T10:40:00Z - LONDON-active (GMT, local hour 10) but not NEW_YORK (EST, local hour 5). Used as-is for the LONDON scenarios below. */
function londonScenario(direction: "LONG" | "SHORT") {
  const structure = direction === "LONG" ? bullishStructureCandles() : mirroredBearishStructureCandles();
  const bias = direction === "LONG" ? bullishBiasCandles() : bearishBiasCandles();
  const fvgFormedAt = structure[structure.length - 1].openTime;
  const entry = direction === "LONG" ? bullishEntryCandles(fvgFormedAt) : bearishEntryCandles(fvgFormedAt);
  const now = entry[entry.length - 1].openTime; // the confirmation candle's own openTime
  return { bias, structure, entry, now };
}

describe("runGoldScan - executes within the JeanFX funnel (LONDON)", () => {
  it("LONG: full funnel (sweep -> MSS/BOS -> FVG -> retrace -> confirmation -> ready -> executed)", () => {
    const { bias, structure, entry, now } = londonScenario("LONG");
    expect(classifySession(now, JEANFX_DEFAULT_SESSION_WINDOWS)).toContain("LONDON");

    const result = runGoldScan({ now, candlesByTimeframe: { bias, structure, entry }, equity: EQUITY, tradesAlreadyOpenedThisSession: 0 });

    expect(result.intent).not.toBeNull();
    expect(result.intent!.direction).toBe("LONG");
    expect(result.intent!.session).toBe("LONDON");
    expect(result.intent!.qty).toBeGreaterThan(0);
    expect(result.intent!.rMultiple).toBeGreaterThanOrEqual(3.0); // JeanFX's own target selection already enforces rrMinimum
    expect(result.funnel.liquiditySweeps).toBeGreaterThanOrEqual(1);
    expect(result.funnel.mssBos).toBeGreaterThanOrEqual(1);
    expect(result.funnel.fvgs).toBeGreaterThanOrEqual(1);
    expect(result.funnel.retraces).toBeGreaterThanOrEqual(1);
    expect(result.funnel.confirmations).toBeGreaterThanOrEqual(1);
    expect(result.funnel.readySetups).toBe(1);
    expect(result.funnel.executed).toBe(1);
  });

  it("SHORT: mirrored setup also executes, with SHORT-appropriate stop/target ordering", () => {
    const { bias, structure, entry, now } = londonScenario("SHORT");
    const result = runGoldScan({ now, candlesByTimeframe: { bias, structure, entry }, equity: EQUITY, tradesAlreadyOpenedThisSession: 0 });

    expect(result.intent).not.toBeNull();
    expect(result.intent!.direction).toBe("SHORT");
    expect(result.intent!.stop).toBeGreaterThan(result.intent!.entry);
    expect(result.intent!.target).toBeLessThan(result.intent!.entry);
    expect(result.funnel.executed).toBe(1);
  });
});

describe("runGoldScan - session gating (brief S3: LONDON + NEW_YORK only, never crypto-style ALL)", () => {
  it("evaluates nothing outside London/New York entirely", () => {
    const outsideBothSessions = Date.UTC(1970, 0, 1, 3, 0, 0); // London local 3 (closed), NY local 22 prior day (closed)
    const result = runGoldScan({ now: outsideBothSessions, candlesByTimeframe: { bias: [], structure: [], entry: [] }, equity: EQUITY, tradesAlreadyOpenedThisSession: 0 });
    expect(result.intent).toBeNull();
    expect(result.funnel.readySetups).toBe(0);
  });

  it("executes a NEW_YORK-only setup (outside London's window, inside New York's)", () => {
    // Shift the shared fixture so its confirmation candle lands at 18:40 UTC on a January day:
    // London (GMT, UTC+0) local hour 18 - closed (>= 17). New York (EST, UTC-5) local hour 13 - open ([8,17)).
    const base = londonScenario("LONG");
    const targetConfirmationTime = Date.UTC(1970, 0, 2, 18, 40, 0);
    const offset = targetConfirmationTime - base.now;

    const bias = shift(base.bias, offset);
    const structure = shift(base.structure, offset);
    const entry = shift(base.entry, offset);
    const now = base.now + offset;

    const sessions = classifySession(now, JEANFX_DEFAULT_SESSION_WINDOWS);
    expect(sessions).toContain("NEW_YORK");
    expect(sessions).not.toContain("LONDON");

    const result = runGoldScan({ now, candlesByTimeframe: { bias, structure, entry }, equity: EQUITY, tradesAlreadyOpenedThisSession: 0 });
    expect(result.intent).not.toBeNull();
    expect(result.intent!.session).toBe("NEW_YORK");
  });
});

describe("runGoldScan - maxTradesPerSession (brief S9: cap 3)", () => {
  it("refuses to evaluate once the session's trade cap is already reached", () => {
    const { bias, structure, entry, now } = londonScenario("LONG");
    const result = runGoldScan({ now, candlesByTimeframe: { bias, structure, entry }, equity: EQUITY, tradesAlreadyOpenedThisSession: 3 });
    expect(result.intent).toBeNull();
    expect(result.funnel.readySetups).toBe(0); // never even evaluated - the cap gate runs before the state machine
  });

  it("still evaluates at 2 already-opened trades (cap not yet reached)", () => {
    const { bias, structure, entry, now } = londonScenario("LONG");
    const result = runGoldScan({ now, candlesByTimeframe: { bias, structure, entry }, equity: EQUITY, tradesAlreadyOpenedThisSession: 2 });
    expect(result.intent).not.toBeNull();
  });
});

describe("runGoldScan - PAPER-only / LIVE unreachable", () => {
  it("GoldScanResult carries no mode field at all - there is no value that could ever mean LIVE", () => {
    const { bias, structure, entry, now } = londonScenario("LONG");
    const result = runGoldScan({ now, candlesByTimeframe: { bias, structure, entry }, equity: EQUITY, tradesAlreadyOpenedThisSession: 0 });
    expect(result.intent).not.toBeNull();
    expect(Object.keys(result.intent!)).not.toContain("mode");
    expect(JSON.stringify(result)).not.toMatch(/LIVE/);
  });
});

describe("DST-awareness (brief: reuse the already-implemented DST-aware session logic)", () => {
  it("the same UTC hour classifies New York differently across the US DST boundary", () => {
    // 12:00 UTC: EST (winter, UTC-5) -> local 7, closed (< 8). EDT (after March DST start, UTC-4) -> local 8, open.
    const winterUtcNoon = Date.UTC(2026, 0, 14, 12, 0, 0); // January - EST
    const springUtcNoon = Date.UTC(2026, 3, 14, 12, 0, 0); // April - EDT (after the second Sunday of March)

    expect(classifySession(winterUtcNoon, JEANFX_DEFAULT_SESSION_WINDOWS)).not.toContain("NEW_YORK");
    expect(classifySession(springUtcNoon, JEANFX_DEFAULT_SESSION_WINDOWS)).toContain("NEW_YORK");
  });
});
