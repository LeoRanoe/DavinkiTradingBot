import { describe, expect, it } from "vitest";
import { formatDailySummary, type DailySnapshot } from "./daily";

function snapshot(overrides: Partial<DailySnapshot> = {}): DailySnapshot {
  return {
    utcDate: "2026-09-17",
    dayNumber: 4,
    totalDays: 14,
    candidates: 3,
    tradesOpened: 2,
    tradesClosed: 2,
    wins: 1,
    losses: 1,
    realizedPnl: 1.1,
    realizedR: 1.1,
    cumulativeR: 2.3,
    equity: 22.4,
    maxDrawdown: 0.8,
    averageMfeR: 1.4,
    averageMaeR: 0.5,
    counterfactualTotal: 24,
    counterfactualSettled: 20,
    scannerHealth: "OK",
    newsHealth: "OK",
    qwenHealth: "OK",
    evidence: "LOW_EVIDENCE",
    bySymbol: {
      BTCUSDT: { trades: 4, netPnl: 2.1, r: 1.8 },
      ETHUSDT: { trades: 3, netPnl: -0.4, r: 0.5 },
    },
    ...overrides,
  };
}

describe("daily research summary", () => {
  it("reports the research day and the headline figures", () => {
    const text = formatDailySummary(snapshot());
    expect(text).toContain("Day 4 / 14");
    expect(text).toContain("Cumulative         +2.30R");
    expect(text).toContain("Equity             $22.40");
  });

  it("keeps actual and counterfactual counts visibly separate", () => {
    const text = formatDailySummary(snapshot());
    expect(text).toContain("Actual");
    expect(text).toContain("Counterfactual     24 (20 settled)");
    // The counterfactual count must never be folded into the trade figures.
    expect(text).not.toContain("Trades closed      26");
  });

  it("breaks the window down by asset", () => {
    const text = formatDailySummary(snapshot());
    expect(text).toContain("BTCUSDT");
    expect(text).toContain("ETHUSDT");
  });

  it("always states that one day is not a result", () => {
    // Guards against the summary ever reading as a daily verdict.
    expect(formatDailySummary(snapshot())).toContain("This is a record, not a verdict");
  });

  it("carries the evidence level rather than implying significance", () => {
    expect(formatDailySummary(snapshot({ evidence: "EXTREMELY_LOW_EVIDENCE" }))).toContain(
      "EXTREMELY_LOW_EVIDENCE",
    );
  });

  it("surfaces degraded integrations and stays silent when all are healthy", () => {
    const degraded = formatDailySummary(snapshot({ scannerHealth: "STALE (45m)", newsHealth: "FAILED" }));
    expect(degraded).toContain("Scanner: STALE (45m)");
    expect(degraded).toContain("News: FAILED");

    const healthy = formatDailySummary(snapshot());
    expect(healthy).not.toContain("Scanner:");
    expect(healthy).not.toContain("News:");
  });

  it("handles a day with no activity without inventing figures", () => {
    const text = formatDailySummary(
      snapshot({
        candidates: 0, tradesOpened: 0, tradesClosed: 0, wins: 0, losses: 0,
        realizedPnl: 0, realizedR: null, cumulativeR: null, averageMfeR: null,
        averageMaeR: null, bySymbol: {}, evidence: "NO_DATA",
      }),
    );

    expect(text).toContain("Trades closed      0 (0W / 0L)");
    expect(text).toContain("Cumulative         n/a");
    expect(text).toContain("NO_DATA");
    // No excursion line at all rather than a fabricated 0.00R.
    expect(text).not.toContain("Avg MFE / MAE");
  });

  it("renders a negative day without dressing it up", () => {
    const text = formatDailySummary(snapshot({ realizedPnl: -1.4, realizedR: -1, cumulativeR: -0.6 }));
    expect(text).toContain("-$1.40");
    expect(text).toContain("Cumulative         -0.60R");
  });
});
