import { describe, expect, it } from "vitest";
import type { EquityCurvePoint, ResearchTradeRecord } from "../engine";
import { computeResearchMetrics } from "../metrics";

function closedTrade(overrides: Partial<ResearchTradeRecord> = {}): ResearchTradeRecord {
  return {
    signalTime: 0,
    signalReason: "TEST",
    entryCandleIndex: 0,
    entryTime: 0,
    entryPrice: 100,
    initialStopPrice: 97,
    riskBudget: 100,
    qty: 1,
    entryFee: 0,
    entrySlippageCost: 0,
    exitCandleIndex: 5,
    exitTime: 5,
    exitPrice: 103,
    exitReason: "TEST",
    exitFee: 0,
    exitSlippageCost: 0,
    pnl: 300,
    rMultiple: 3,
    holdingBars: 5,
    outcome: "CLOSED",
    ...overrides,
  };
}

describe("computeResearchMetrics (§17)", () => {
  it("computes tradeCount/wins/losses/winRate from CLOSED trades only", () => {
    const win = closedTrade({ pnl: 100, rMultiple: 1 });
    const loss = closedTrade({ pnl: -50, rMultiple: -0.5 });
    const openAtEnd = closedTrade({ outcome: "OPEN_AT_END", pnl: null, rMultiple: null, exitPrice: null, exitTime: null, exitCandleIndex: null, holdingBars: null });
    const curve: EquityCurvePoint[] = [
      { time: 0, equity: 10_000 },
      { time: 1, equity: 10_100 },
      { time: 2, equity: 10_050 },
    ];
    const metrics = computeResearchMetrics([win, loss, openAtEnd], 10_000, curve);
    expect(metrics.tradeCount).toBe(2);
    expect(metrics.openPositionsAtEnd).toBe(1);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(1);
    expect(metrics.winRate).toBeCloseTo(0.5, 10);
  });

  it("expectancyR is the mean R, medianR is the median R", () => {
    const trades = [closedTrade({ rMultiple: 1 }), closedTrade({ rMultiple: 2 }), closedTrade({ rMultiple: -1 })];
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    const metrics = computeResearchMetrics(trades, 10_000, curve);
    expect(metrics.expectancyR).toBeCloseTo((1 + 2 - 1) / 3, 10);
    expect(metrics.medianR).toBe(1);
  });

  it("profitFactor = grossProfit / grossLoss", () => {
    const trades = [closedTrade({ pnl: 300 }), closedTrade({ pnl: -100 })];
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    const metrics = computeResearchMetrics(trades, 10_000, curve);
    expect(metrics.profitFactor).toBeCloseTo(3, 10);
  });

  it("maxLosingStreak counts the longest consecutive run of pnl<=0 trades in order", () => {
    const trades = [
      closedTrade({ pnl: 10 }),
      closedTrade({ pnl: -10 }),
      closedTrade({ pnl: -20 }),
      closedTrade({ pnl: -5 }),
      closedTrade({ pnl: 15 }),
      closedTrade({ pnl: -1 }),
    ];
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    expect(computeResearchMetrics(trades, 10_000, curve).maxLosingStreak).toBe(3);
  });

  it("maxDrawdownPct is computed on the realized equity curve", () => {
    const curve: EquityCurvePoint[] = [
      { time: 0, equity: 10_000 },
      { time: 1, equity: 11_000 }, // peak
      { time: 2, equity: 9_900 }, // dd = (11000-9900)/11000 ≈ 0.1
    ];
    const metrics = computeResearchMetrics([closedTrade()], 10_000, curve);
    expect(metrics.maxDrawdownPct).toBeCloseTo((11_000 - 9_900) / 11_000, 6);
  });

  it("averageHoldingBars/medianHoldingBars computed from CLOSED trades' holdingBars", () => {
    const trades = [closedTrade({ holdingBars: 2 }), closedTrade({ holdingBars: 4 }), closedTrade({ holdingBars: 6 })];
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    const metrics = computeResearchMetrics(trades, 10_000, curve);
    expect(metrics.averageHoldingBars).toBeCloseTo(4, 10);
    expect(metrics.medianHoldingBars).toBe(4);
  });

  it("totalCosts sums fee + slippage across every trade, including an open-at-end position's entry side", () => {
    const closed = closedTrade({ entryFee: 1, entrySlippageCost: 2, exitFee: 3, exitSlippageCost: 4 });
    const open = closedTrade({ outcome: "OPEN_AT_END", entryFee: 5, entrySlippageCost: 6, exitFee: 0, exitSlippageCost: 0, pnl: null, rMultiple: null, exitPrice: null, exitTime: null, exitCandleIndex: null, holdingBars: null });
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    const metrics = computeResearchMetrics([closed, open], 10_000, curve);
    expect(metrics.totalCosts).toBeCloseTo(1 + 2 + 3 + 4 + 5 + 6, 10);
  });

  it("handles zero closed trades without throwing (all null rather than NaN)", () => {
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    const metrics = computeResearchMetrics([], 10_000, curve);
    expect(metrics.tradeCount).toBe(0);
    expect(metrics.winRate).toBeNull();
    expect(metrics.expectancyR).toBeNull();
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.maxDrawdownR).toBeNull();
  });
});
