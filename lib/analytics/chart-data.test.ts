import { describe, expect, it } from "vitest";
import { closedCandles, cumulativeR, drawdownSeries } from "./chart-data";

describe("chart data", () => {
  it("excludes open candles and sorts closed market history", () => expect(closedCandles([{ time: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 }, { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: false }])).toHaveLength(1));
  it("calculates drawdown from the running equity peak", () => expect(drawdownSeries([{ time: 1, equity: 10 }, { time: 2, equity: 9 }])[1].drawdown).toBe(-10));
  it("uses actual realized R only when accumulating R", () => expect(cumulativeR([{ time: 1, r: 1, pnl: 1, symbol: "BTC" }, { time: 2, r: null, pnl: null, symbol: "ETH" }, { time: 3, r: -0.5, pnl: -1, symbol: "BTC" }]).map((point) => point.cumulativeR)).toEqual([1, 0.5]));
});
