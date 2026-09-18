import { describe, expect, it } from "vitest";
import { computeJeanfxGoldPerformance } from "./performance";
import type { JeanfxGoldPaperTradeRow } from "./db";

function row(overrides: Partial<JeanfxGoldPaperTradeRow>): JeanfxGoldPaperTradeRow {
  return {
    id: "1",
    user_id: "u1",
    strategy_definition_id: "d1",
    strategy_version_id: "v1",
    strategy_configuration_id: "c1",
    strategy_assignment_id: "a1",
    instrument_id: "METAL:TWELVEDATA:XAU/USD",
    direction: "LONG",
    entry_price: 2400,
    stop_price: 2390,
    target_price: 2430,
    spread: 0.3,
    slippage_bps: 2,
    fees: 1,
    qty: 1,
    status: "CLOSED",
    exit_price: 2430,
    exit_reason: "TARGET",
    pnl: 29,
    r_multiple: 2.9,
    reason_codes: [],
    feature_snapshot: null,
    session: "LONDON",
    opened_at: new Date().toISOString(),
    closed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeJeanfxGoldPerformance", () => {
  it("separates open from closed trades and computes metrics from closed ones only", () => {
    const open = row({ id: "open-1", status: "OPEN", exit_price: null, exit_reason: null, pnl: null, r_multiple: null, closed_at: null });
    const win = row({ id: "win-1", pnl: 29, r_multiple: 2.9 });
    const loss = row({ id: "loss-1", pnl: -10, r_multiple: -1, exit_reason: "STOP" });

    const result = computeJeanfxGoldPerformance([open, win, loss], 100_000);

    expect(result.openTrades).toHaveLength(1);
    expect(result.closedTrades).toHaveLength(2);
    expect(result.metrics.tradeCount).toBe(2);
    expect(result.metrics.wins).toBe(1);
    expect(result.metrics.losses).toBe(1);
    expect(result.metrics.netReturn).toBeCloseTo(19, 5);
  });

  it("never counts an OPEN trade's null pnl into netReturn/costs", () => {
    const open = row({ id: "open-2", status: "OPEN", exit_price: null, exit_reason: null, pnl: null, r_multiple: null, closed_at: null, fees: 999 });
    const result = computeJeanfxGoldPerformance([open], 100_000);
    expect(result.metrics.totalFees).toBe(0);
    expect(result.metrics.netReturn).toBe(0);
  });
});
