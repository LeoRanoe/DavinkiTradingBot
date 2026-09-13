import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { DEFAULT_RISK_SETTINGS } from "@/lib/settings/risk-settings";
import { manageOpenPositions } from "./position-manager";
import { createFakeMarket, createFakePositionStore, makeCandles, makeDb, type FakeDb } from "./__fixtures__/fakes";

const NOW = Date.parse("2026-01-03T20:00:00Z");
const settings = { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER" as const };

/** An open PAPER position: entry 100.05 fill, stop 97, target 106, qty 3. */
function withOpenPosition(db: FakeDb = makeDb()): FakeDb {
  db.trades.push({
    id: "trade-open",
    signal_id: "sig-1",
    strategy_version_id: "strat-1",
    trading_mode: "PAPER",
    symbol: "BTCUSDT",
    side: "LONG",
    status: "OPEN",
    entry_price: 100.05,
    stop_price: 97,
    target_price: 106,
    qty: 3,
    notional: 300.15,
    risk_amount: 9.6,
    risk_reward: 2,
    risk_budget: 9,
    modeled_max_loss: 9.9,
    entry_fee: 0.3,
    exit_fee: null,
    fees: 0.3,
    slippage: 0.15,
    exit_price: null,
    exit_reason: null,
    equity_after: null,
    equity_before: null,
    gross_pnl: null,
    mfe_price: null,
    mae_price: null,
    mfe_r: null,
    mae_r: null,
    pnl: null,
    r_multiple: null,
    rejection_reason: null,
    opened_at: new Date("2026-01-03T18:00:00Z").toISOString(),
    closed_at: null,
    created_at: new Date("2026-01-03T18:00:00Z").toISOString(),
  });
  return db;
}

/** Candles after the open that neither touch the stop nor the target. */
function quietCandles(): Candle[] {
  return makeCandles("15M", [101, 102, 101.5, 102.5], {
    startIso: "2026-01-03T19:00:00Z",
    highOffset: 0.5,
    lowOffset: 0.5,
  });
}

function candlesHitting(kind: "STOP" | "TARGET"): Candle[] {
  const closes = kind === "STOP" ? [101, 99, 96.5] : [101, 104, 107];
  return makeCandles("15M", closes, { startIso: "2026-01-03T19:00:00Z", highOffset: 0.5, lowOffset: 0.5 });
}

function run(db: FakeDb, candles: Candle[], initialEquity = 1000) {
  return manageOpenPositions({
    store: createFakePositionStore(db, initialEquity),
    market: createFakeMarket({ candles }),
    settings,
    now: () => NOW,
  });
}

describe("position manager - no exit", () => {
  it("leaves a position open when neither stop nor target is touched", async () => {
    const db = withOpenPosition();
    const result = await run(db, quietCandles());

    expect(result.closed).toHaveLength(0);
    expect(db.trades[0].status).toBe("OPEN");
    expect(db.snapshots).toHaveLength(0);
  });

  it("does nothing at all when there are no open positions", async () => {
    const db = makeDb();
    const result = await run(db, quietCandles());
    expect(result.closed).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("position manager - stop", () => {
  it("closes automatically on a stop hit, with costs applied and a negative R", async () => {
    const db = withOpenPosition();
    const result = await run(db, candlesHitting("STOP"));

    expect(result.closed).toHaveLength(1);
    const closed = result.closed[0];
    expect(closed.exitReason).toBe("STOP");
    expect(closed.netPnl).toBeLessThan(0);
    expect(closed.realizedR).toBeLessThan(0);
    // Near -1R: the modeled max loss is what actually happened, roughly.
    expect(closed.realizedR).toBeGreaterThan(-1.3);
    expect(closed.realizedR).toBeLessThan(-0.8);

    const trade = db.trades[0];
    expect(trade.status).toBe("CLOSED");
    expect(trade.exit_reason).toBe("STOP");
    expect(trade.exit_fee!).toBeGreaterThan(0);
    // fees is the round trip, charged once each.
    expect(trade.fees!).toBeCloseTo(0.3 + trade.exit_fee!);
  });

  it("exits below the stop price - exit slippage works against us", async () => {
    const db = withOpenPosition();
    const result = await run(db, candlesHitting("STOP"));
    expect(result.closed[0].exitPrice).toBeLessThan(97);
  });
});

describe("position manager - target", () => {
  it("closes automatically on a target hit with a positive result and R", async () => {
    const db = withOpenPosition();
    const result = await run(db, candlesHitting("TARGET"));

    expect(result.closed).toHaveLength(1);
    const closed = result.closed[0];
    expect(closed.exitReason).toBe("TARGET");
    expect(closed.netPnl).toBeGreaterThan(0);
    expect(closed.realizedR).toBeGreaterThan(1);
    expect(db.trades[0].status).toBe("CLOSED");
    expect(db.trades[0].exit_reason).toBe("TARGET");
  });

  it("nets less than the gross move because fees and slippage are real", async () => {
    const db = withOpenPosition();
    const result = await run(db, candlesHitting("TARGET"));
    const closed = result.closed[0];
    expect(closed.netPnl).toBeLessThan(closed.grossPnl);
    expect(closed.totalFees).toBeGreaterThan(0);
  });

  it("takes the UNFAVOURABLE side when one candle touches both stop and target", async () => {
    const db = withOpenPosition();
    const bothTouched = makeCandles("15M", [101], {
      startIso: "2026-01-03T19:40:00Z",
      highOffset: 6, // high 107 >= target
      lowOffset: 5, // low 96 <= stop
    });
    const result = await run(db, bothTouched);
    expect(result.closed[0].exitReason).toBe("STOP");
  });
});

describe("position manager - settlement is applied exactly once", () => {
  it("updates equity once and by exactly the net P/L", async () => {
    const db = withOpenPosition();
    const result = await run(db, candlesHitting("TARGET"), 1000);

    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0].equity).toBeCloseTo(1000 + result.closed[0].netPnl);
    expect(db.trades[0].equity_after).toBeCloseTo(db.snapshots[0].equity);
  });

  it("a repeated scan does not close, re-fee, or re-settle the same position", async () => {
    const db = withOpenPosition();
    const first = await run(db, candlesHitting("TARGET"));
    const feesAfterFirst = db.trades[0].fees;
    const equityAfterFirst = db.snapshots[0].equity;

    const second = await run(db, candlesHitting("TARGET"));
    const third = await run(db, candlesHitting("TARGET"));

    expect(first.closed).toHaveLength(1);
    expect(second.closed).toHaveLength(0);
    expect(third.closed).toHaveLength(0);
    expect(db.snapshots).toHaveLength(1);
    expect(db.trades[0].fees).toBe(feesAfterFirst);
    expect(db.snapshots[0].equity).toBe(equityAfterFirst);
  });

  it("two concurrent runs settle the position only once", async () => {
    const db = withOpenPosition();
    const candles = candlesHitting("STOP");
    const [a, b] = await Promise.all([run(db, candles), run(db, candles)]);

    const totalClosed = a.closed.length + b.closed.length;
    expect(totalClosed).toBe(1);
    expect(db.snapshots).toHaveLength(1);
    expect(db.tradeEvents.filter((e) => e.eventType === "STOP_HIT")).toHaveLength(1);
  });

  it("records a trade event describing the exit", async () => {
    const db = withOpenPosition();
    await run(db, candlesHitting("TARGET"));
    const event = db.tradeEvents.find((e) => e.eventType === "TARGET_HIT");
    expect(event).toBeTruthy();
    expect(event!.payload.netPnl).toBeDefined();
    expect(event!.payload.realizedR).toBeDefined();
  });
});

describe("position manager - safety", () => {
  it("only candles that closed AFTER the open can exit the position", async () => {
    const db = withOpenPosition();
    // A crash BEFORE the position was opened must not close it.
    const earlier = makeCandles("15M", [90], {
      startIso: "2026-01-03T16:00:00Z",
      highOffset: 0.5,
      lowOffset: 0.5,
    });
    const result = await run(db, earlier);
    expect(result.closed).toHaveLength(0);
    expect(db.trades[0].status).toBe("OPEN");
  });

  it("refuses to settle on stale market data rather than inventing a fill", async () => {
    const db = withOpenPosition();
    const ancient = makeCandles("15M", [96], {
      startIso: "2026-01-01T00:00:00Z",
      highOffset: 0.5,
      lowOffset: 0.5,
    });
    const result = await run(db, ancient);
    expect(result.closed).toHaveLength(0);
    expect(result.errors.join(" ")).toMatch(/stale/i);
    expect(db.trades[0].status).toBe("OPEN");
  });

  it("reports a market failure for one symbol without losing the position", async () => {
    const db = withOpenPosition();
    const result = await manageOpenPositions({
      store: createFakePositionStore(db, 1000),
      market: createFakeMarket({ throwOn: "candles" }),
      settings,
      now: () => NOW,
    });
    expect(result.closed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(db.trades[0].status).toBe("OPEN");
  });

  it("manages positions even though no NEW strategy candle arrived", async () => {
    // The candles here are ordinary market data, not a new setup signal:
    // position management is driven by the job's cadence, not by the
    // strategy's candle watermark.
    const db = withOpenPosition();
    const result = await run(db, candlesHitting("TARGET"));
    expect(result.closed).toHaveLength(1);
  });
});
