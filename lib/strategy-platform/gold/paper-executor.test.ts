import { describe, expect, it } from "vitest";
import { checkGoldExit, closeGoldPaperTrade, computeGoldFee, simulateGoldEntryFill, simulateGoldExitFill, type OpenGoldPaperTrade } from "./paper-executor";

const NO_COST = { spread: 0, slippageBps: 0, feeBps: 0 };
const WITH_SPREAD = { spread: 0.5, slippageBps: 0, feeBps: 0 };

describe("simulateGoldEntryFill / simulateGoldExitFill", () => {
  it("LONG buys at mid + half-spread on entry, sells at mid - half-spread on exit - spread always costs the trader", () => {
    expect(simulateGoldEntryFill(2400, "LONG", WITH_SPREAD)).toBeCloseTo(2400.25, 5);
    expect(simulateGoldExitFill(2400, "LONG", WITH_SPREAD)).toBeCloseTo(2399.75, 5);
  });

  it("SHORT sells at mid - half-spread on entry, buys back at mid + half-spread on exit", () => {
    expect(simulateGoldEntryFill(2400, "SHORT", WITH_SPREAD)).toBeCloseTo(2399.75, 5);
    expect(simulateGoldExitFill(2400, "SHORT", WITH_SPREAD)).toBeCloseTo(2400.25, 5);
  });

  it("with zero costs, fill equals mid exactly", () => {
    expect(simulateGoldEntryFill(2400, "LONG", NO_COST)).toBe(2400);
    expect(simulateGoldExitFill(2400, "SHORT", NO_COST)).toBe(2400);
  });
});

describe("checkGoldExit", () => {
  it("LONG: stop is below entry, target is above - stop wins on an ambiguous candle", () => {
    const trade: OpenGoldPaperTrade = { direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2430, qty: 1 };
    expect(checkGoldExit(trade, { high: 2440, low: 2380 })).toEqual({ shouldExit: true, outcome: "STOP", exitPrice: 2390 });
    expect(checkGoldExit(trade, { high: 2431, low: 2395 })).toEqual({ shouldExit: true, outcome: "TARGET", exitPrice: 2430 });
    expect(checkGoldExit(trade, { high: 2405, low: 2395 })).toEqual({ shouldExit: false });
  });

  it("SHORT: stop is above entry, target is below - direction-aware, not mirrored via price negation", () => {
    const trade: OpenGoldPaperTrade = { direction: "SHORT", entryPrice: 2400, stopPrice: 2410, targetPrice: 2370, qty: 1 };
    expect(checkGoldExit(trade, { high: 2420, low: 2360 })).toEqual({ shouldExit: true, outcome: "STOP", exitPrice: 2410 });
    expect(checkGoldExit(trade, { high: 2405, low: 2365 })).toEqual({ shouldExit: true, outcome: "TARGET", exitPrice: 2370 });
    expect(checkGoldExit(trade, { high: 2405, low: 2395 })).toEqual({ shouldExit: false });
  });
});

describe("closeGoldPaperTrade", () => {
  it("computes positive PnL and R-multiple for a winning LONG", () => {
    const trade: OpenGoldPaperTrade = { direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2430, qty: 1 };
    const result = closeGoldPaperTrade(trade, 2430, 0, 0);
    expect(result.pnl).toBeCloseTo(30, 5);
    expect(result.rMultiple).toBeCloseTo(3.0, 5);
  });

  it("computes negative PnL and negative R-multiple for a losing SHORT", () => {
    const trade: OpenGoldPaperTrade = { direction: "SHORT", entryPrice: 2400, stopPrice: 2410, targetPrice: 2370, qty: 1 };
    const result = closeGoldPaperTrade(trade, 2410, 0, 0);
    expect(result.pnl).toBeCloseTo(-10, 5);
    expect(result.rMultiple).toBeCloseTo(-1.0, 5);
  });

  it("spread affects PnL: a spread-inclusive fill nets less profit than a spread-free fill for the same nominal move", () => {
    const noSpreadEntry = simulateGoldEntryFill(2400, "LONG", NO_COST);
    const withSpreadEntry = simulateGoldEntryFill(2400, "LONG", WITH_SPREAD);
    const exit = simulateGoldExitFill(2430, "LONG", NO_COST);

    const noSpreadTrade: OpenGoldPaperTrade = { direction: "LONG", entryPrice: noSpreadEntry, stopPrice: 2390, targetPrice: 2430, qty: 1 };
    const withSpreadTrade: OpenGoldPaperTrade = { direction: "LONG", entryPrice: withSpreadEntry, stopPrice: 2390, targetPrice: 2430, qty: 1 };

    const noSpreadResult = closeGoldPaperTrade(noSpreadTrade, exit, 0, 0);
    const withSpreadResult = closeGoldPaperTrade(withSpreadTrade, exit, 0, 0);

    expect(withSpreadResult.pnl).toBeLessThan(noSpreadResult.pnl);
  });

  it("subtracts entry + exit fees from gross PnL", () => {
    const trade: OpenGoldPaperTrade = { direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2430, qty: 2 };
    const entryFee = computeGoldFee(2400 * 2, 5); // 5 bps
    const exitFee = computeGoldFee(2430 * 2, 5);
    const result = closeGoldPaperTrade(trade, 2430, entryFee, exitFee);
    expect(result.grossPnl).toBeCloseTo(60, 5);
    expect(result.fees).toBeCloseTo(entryFee + exitFee, 5);
    expect(result.pnl).toBeCloseTo(60 - (entryFee + exitFee), 5);
  });
});
