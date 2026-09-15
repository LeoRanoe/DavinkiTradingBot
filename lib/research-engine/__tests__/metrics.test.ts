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
    rawEntryPrice: 100,
    initialStopPrice: 97,
    targetRiskBudget: 100,
    actualInitialRisk: 100,
    capitalCapped: false,
    qty: 1,
    entryFee: 0,
    entrySlippageCost: 0,
    exitCandleIndex: 5,
    exitTime: 5,
    exitPrice: 103,
    rawExitPrice: 103,
    exitReason: "TEST",
    exitFee: 0,
    exitSlippageCost: 0,
    grossPnl: 300,
    pnl: 300,
    rMultiple: 3,
    holdingBars: 5,
    outcome: "CLOSED",
    ...overrides,
  };
}

function openAtEndTrade(overrides: Partial<ResearchTradeRecord> = {}): ResearchTradeRecord {
  return closedTrade({
    outcome: "OPEN_AT_END",
    pnl: null,
    grossPnl: null,
    rMultiple: null,
    exitPrice: null,
    rawExitPrice: null,
    exitTime: null,
    exitCandleIndex: null,
    holdingBars: null,
    exitFee: 0,
    exitSlippageCost: 0,
    ...overrides,
  });
}

describe("computeResearchMetrics (§17)", () => {
  it("computes tradeCount/wins/losses/winRate from CLOSED trades only", () => {
    const win = closedTrade({ pnl: 100, rMultiple: 1 });
    const loss = closedTrade({ pnl: -50, rMultiple: -0.5 });
    const openAtEnd = openAtEndTrade();
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

  describe("§7 gross vs net reconciliation, §8 OPEN_AT_END Convention A", () => {
    it("grossReturn is computed from grossPnl (raw execution), not pnl (which is already net of costs)", () => {
      const trade = closedTrade({ grossPnl: 320, pnl: 300, entryFee: 5, entrySlippageCost: 5, exitFee: 5, exitSlippageCost: 5 });
      const curve: EquityCurvePoint[] = [
        { time: 0, equity: 10_000 },
        { time: 1, equity: 10_300 },
      ];
      const metrics = computeResearchMetrics([trade], 10_000, curve);
      expect(metrics.grossReturn).toBeCloseTo(320, 10);
      expect(metrics.netReturn).toBeCloseTo(300, 10);
    });

    it("totalCosts (CLOSED-only) reconciles exactly: grossReturn - totalCosts ≈ netReturn", () => {
      const trades = [
        closedTrade({ grossPnl: 320, pnl: 300, entryFee: 5, entrySlippageCost: 5, exitFee: 5, exitSlippageCost: 5 }),
        closedTrade({ grossPnl: -80, pnl: -100, entryFee: 5, entrySlippageCost: 5, exitFee: 5, exitSlippageCost: 5 }),
      ];
      const curve: EquityCurvePoint[] = [
        { time: 0, equity: 10_000 },
        { time: 1, equity: 10_300 },
        { time: 2, equity: 10_200 },
      ];
      const metrics = computeResearchMetrics(trades, 10_000, curve);
      expect(metrics.grossReturn - metrics.totalCosts).toBeCloseTo(metrics.netReturn, 6);
    });

    it("totalCosts excludes an OPEN_AT_END position's entry-side cost entirely (Convention A)", () => {
      const closed = closedTrade({ entryFee: 1, entrySlippageCost: 2, exitFee: 3, exitSlippageCost: 4 });
      const open = openAtEndTrade({ entryFee: 5, entrySlippageCost: 6 });
      const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
      const metrics = computeResearchMetrics([closed, open], 10_000, curve);
      expect(metrics.totalCosts).toBeCloseTo(1 + 2 + 3 + 4, 10); // closed-only, never 5+6
    });

    it("openPositionEntryCosts reports an OPEN_AT_END position's entry cost separately, never folded into totalCosts", () => {
      const open = openAtEndTrade({ entryFee: 5, entrySlippageCost: 6 });
      const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
      const metrics = computeResearchMetrics([open], 10_000, curve);
      expect(metrics.openPositionEntryCosts).toBeCloseTo(11, 10);
      expect(metrics.totalCosts).toBe(0);
      // An open position never contributes to gross/net return - it's unrealized.
      expect(metrics.grossReturn).toBe(0);
      expect(metrics.netReturn).toBe(0);
    });

    it("an OPEN_AT_END position never counts toward grossReturn/netReturn even alongside CLOSED trades", () => {
      const closed = closedTrade({ grossPnl: 320, pnl: 300 });
      const open = openAtEndTrade({ entryFee: 100, entrySlippageCost: 50 });
      const curve: EquityCurvePoint[] = [
        { time: 0, equity: 10_000 },
        { time: 1, equity: 10_300 },
      ];
      const metrics = computeResearchMetrics([closed, open], 10_000, curve);
      expect(metrics.grossReturn).toBeCloseTo(320, 10);
      expect(metrics.netReturn).toBeCloseTo(300, 10);
      expect(metrics.openPositionEntryCosts).toBeCloseTo(150, 10);
    });
  });

  it("handles zero closed trades without throwing (all null rather than NaN)", () => {
    const curve: EquityCurvePoint[] = [{ time: 0, equity: 10_000 }];
    const metrics = computeResearchMetrics([], 10_000, curve);
    expect(metrics.tradeCount).toBe(0);
    expect(metrics.winRate).toBeNull();
    expect(metrics.expectancyR).toBeNull();
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.maxDrawdownR).toBeNull();
    expect(metrics.totalCosts).toBe(0);
    expect(metrics.openPositionEntryCosts).toBe(0);
  });
});
