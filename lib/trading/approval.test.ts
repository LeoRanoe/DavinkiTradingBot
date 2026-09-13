import { describe, expect, it } from "vitest";
import { approveCandidate, rejectCandidateByOwner } from "./approval";
import {
  createFakeApprovalStore,
  createFakeMarket,
  makeAccount,
  makeCandles,
  makeDb,
  makeInstrument,
  makePendingSignal,
  TEST_SIGNAL_ID,
  type FakeDb,
} from "./__fixtures__/fakes";

const NOW = Date.parse("2026-01-03T18:02:00Z");
const now = () => NOW;

function setup(dbOverrides: Partial<FakeDb> = {}, marketOverrides: Parameters<typeof createFakeMarket>[0] = {}) {
  const db = makeDb(dbOverrides);
  const store = createFakeApprovalStore(db);
  const market = createFakeMarket({ serverTimeMs: NOW - 1000, ...marketOverrides });
  return { db, store, market, deps: { store, market, now } };
}

describe("APPROVE - happy path", () => {
  it("opens exactly one PAPER position after full revalidation", async () => {
    const { db, deps } = setup();
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);

    expect(result.kind).toBe("EXECUTED");
    if (result.kind !== "EXECUTED") return;

    expect(db.trades).toHaveLength(1);
    const trade = db.trades[0];
    expect(trade.status).toBe("OPEN");
    expect(trade.trading_mode).toBe("PAPER");
    expect(trade.signal_id).toBe(TEST_SIGNAL_ID);
    // The fill is worse than the reference price - slippage against us.
    expect(trade.entry_price!).toBeGreaterThan(148.8);
    expect(trade.entry_fee!).toBeGreaterThan(0);
    expect(trade.modeled_max_loss!).toBeGreaterThan(0);
    expect(db.tradeEvents.some((e) => e.eventType === "OPENED")).toBe(true);
  });

  it("records the owner decision, source and approval delay on the candidate", async () => {
    const { db, deps } = setup();
    await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);

    const signal = db.signals.get(TEST_SIGNAL_ID)!;
    expect(signal.approval_status).toBe("APPROVED");
    expect(signal.owner_decision).toBe("APPROVED");
    expect(signal.decision_source).toBe("TELEGRAM");
    // Candidate created 18:00:00, approved 18:02:00.
    expect(signal.approval_delay_ms).toBe(120_000);
  });

  it("sizes from CURRENT settings and CURRENT equity, not the values stored on the candidate", async () => {
    const rich = setup({ account: makeAccount({ equity: 4000, availableBalance: 4000 }) });
    const poor = setup({ account: makeAccount({ equity: 1000, availableBalance: 1000 }) });

    const a = await approveCandidate(TEST_SIGNAL_ID, "DASHBOARD", rich.deps);
    const b = await approveCandidate(TEST_SIGNAL_ID, "DASHBOARD", poor.deps);
    if (a.kind !== "EXECUTED" || b.kind !== "EXECUTED") throw new Error("expected executions");

    expect(a.candidate.risk.riskBudget).toBeCloseTo(20); // 0.5% of 4000
    expect(b.candidate.risk.riskBudget).toBeCloseTo(5); // 0.5% of 1000
    expect(a.candidate.risk.positionNotional).toBeGreaterThan(b.candidate.risk.positionNotional);
  });
});

describe("APPROVE - idempotency and concurrency", () => {
  it("a double-tap produces one position; the second press reports ALREADY_PROCESSED", async () => {
    const { db, deps } = setup();
    const first = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    const second = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);

    expect(first.kind).toBe("EXECUTED");
    expect(second.kind).toBe("ALREADY_PROCESSED");
    expect(db.trades).toHaveLength(1);
  });

  it("two CONCURRENT approvals race safely - exactly one wins the atomic claim", async () => {
    const { db, deps } = setup();
    const [a, b] = await Promise.all([
      approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps),
      approveCandidate(TEST_SIGNAL_ID, "DASHBOARD", deps),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["ALREADY_PROCESSED", "EXECUTED"]);
    expect(db.trades).toHaveLength(1);
  });

  it("a duplicate webhook delivery after execution cannot open a second position", async () => {
    const { db, deps } = setup();
    await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);

    // Telegram retries the same callback three more times.
    for (let i = 0; i < 3; i++) {
      const retry = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
      expect(retry.kind).toBe("ALREADY_PROCESSED");
    }
    expect(db.trades).toHaveLength(1);
  });

  it("the unique index is a second line of defence if a claim were ever bypassed", async () => {
    const { db, deps } = setup();
    await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);

    // Force the candidate back to PENDING, simulating a bypassed claim.
    const signal = db.signals.get(TEST_SIGNAL_ID)!;
    db.signals.set(TEST_SIGNAL_ID, { ...signal, approval_status: "PENDING" });

    const again = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(again.kind).toBe("ALREADY_PROCESSED");
    expect(db.trades).toHaveLength(1);
  });

  it("an unknown candidate is NOT_FOUND, not an error", async () => {
    const { deps } = setup();
    const result = await approveCandidate("00000000-0000-4000-8000-000000000000", "TELEGRAM", deps);
    expect(result.kind).toBe("NOT_FOUND");
  });
});

describe("APPROVE - revalidation rejects instead of executing", () => {
  async function expectRejection(
    dbOverrides: Partial<FakeDb>,
    marketOverrides: Parameters<typeof createFakeMarket>[0],
    reason: string,
  ) {
    const { db, deps } = setup(dbOverrides, marketOverrides);
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.reason).toBe(reason);
    expect(db.trades).toHaveLength(0);
    return db;
  }

  it("price outside the allowed entry range - no chasing", async () => {
    const db = await expectRejection({}, { lastPrice: 152 }, "ENTRY_OUTSIDE_ALLOWED_RANGE");
    expect(db.signals.get(TEST_SIGNAL_ID)!.approval_status).toBe("REJECTED");
  });

  it("price still inside the allowed range executes normally", async () => {
    const { deps } = setup({}, { lastPrice: 148.9 });
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(result.kind).toBe("EXECUTED");
  });

  it("stale ticker", async () => {
    await expectRejection({}, { serverTimeMs: NOW - 10 * 60_000 }, "STALE_MARKET_DATA");
  });

  it("expired candidate - and it is recorded as EXPIRED, not REJECTED", async () => {
    const db = makeDb({
      signals: new Map([
        [TEST_SIGNAL_ID, makePendingSignal({ expires_at: new Date(NOW - 60_000).toISOString() })],
      ]),
    });
    const store = createFakeApprovalStore(db);
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", {
      store,
      market: createFakeMarket({ serverTimeMs: NOW - 1000 }),
      now,
    });
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.reason).toBe("CANDIDATE_EXPIRED");
    expect(db.signals.get(TEST_SIGNAL_ID)!.approval_status).toBe("EXPIRED");
    expect(db.trades).toHaveLength(0);
  });

  it("volatility that became excessive since the candidate was created", async () => {
    // A violently wide fresh candle series lifts ATR above the 5% ceiling.
    const wild = makeCandles("15M", Array.from({ length: 40 }, (_, i) => 148.8 + (i % 2 === 0 ? 12 : -12)), {
      startIso: "2026-01-03T08:00:00Z",
      highOffset: 9,
      lowOffset: 9,
    });
    await expectRejection({}, { candles: wild }, "EXCESSIVE_VOLATILITY");
  });

  it("strategy version no longer approved for trading", async () => {
    await expectRejection({ strategyVersion: { status: "DRAFT", versionLabel: "v1" } }, {}, "STRATEGY_NOT_APPROVED");
  });

  it("risk settings changed so the minimum R/R is no longer met", async () => {
    const db = makeDb();
    db.settings = { ...db.settings, minRiskReward: 5 };
    await expectRejection({ settings: db.settings }, {}, "MIN_RISK_REWARD_NOT_MET");
  });

  it("balance fell so the risk-compliant size is below the exchange minimum", async () => {
    await expectRejection(
      { account: makeAccount({ equity: 5, availableBalance: 5 }) },
      {},
      "MIN_ORDER_RISK_CONFLICT",
    );
  });

  it("exchange metadata changed to a higher minimum since the candidate was created", async () => {
    await expectRejection({ instrument: makeInstrument({ minOrderAmt: 10_000 }) }, {}, "MIN_ORDER_RISK_CONFLICT");
  });

  it("exchange metadata unavailable - fails closed rather than guessing", async () => {
    await expectRejection({ instrument: null }, {}, "INVALID_EXCHANGE_METADATA");
  });

  it("open-position limit reached", async () => {
    await expectRejection({ account: makeAccount({ openPositionsCount: 1 }) }, {}, "OPEN_POSITION_LIMIT");
  });

  it("daily trade limit reached", async () => {
    await expectRejection({ account: makeAccount({ tradesOpenedTodayUtc: 2 }) }, {}, "DAILY_TRADE_LIMIT");
  });

  it("daily loss lock reached", async () => {
    await expectRejection({ account: makeAccount({ losingTradesTodayUtc: 2 }) }, {}, "DAILY_LOSS_LOCK");
  });

  it("market data unavailable - fails closed", async () => {
    await expectRejection({}, { throwOn: "ticker" }, "MISSING_MARKET_DATA");
  });

  it("candle feed unavailable - fails closed", async () => {
    await expectRejection({}, { throwOn: "candles" }, "MISSING_MARKET_DATA");
  });
});

describe("APPROVE - trading mode", () => {
  it("OBSERVE never opens a position", async () => {
    const db = makeDb();
    db.settings = { ...db.settings, tradingMode: "OBSERVE" };
    const { deps, db: used } = setup({ settings: db.settings });
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.reason).toBe("TRADING_MODE_BLOCK");
    expect(used.trades).toHaveLength(0);
  });

  it("DEMO is refused because Bybit Demo execution is not implemented", async () => {
    const db = makeDb();
    db.settings = { ...db.settings, tradingMode: "DEMO" };
    const { deps } = setup({ settings: db.settings });
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.reason).toBe("TRADING_MODE_BLOCK");
  });

  it("LIVE remains impossible even if a LIVE mode reached the approval path", async () => {
    const db = makeDb();
    db.settings = { ...db.settings, tradingMode: "LIVE" };
    const { deps, db: used } = setup({ settings: db.settings });
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.reason).toBe("TRADING_MODE_BLOCK");
    expect(used.trades).toHaveLength(0);
  });
});

describe("REJECT", () => {
  it("marks the candidate REJECTED_BY_OWNER without opening anything", async () => {
    const { db, store } = setup();
    const result = await rejectCandidateByOwner(TEST_SIGNAL_ID, "TELEGRAM", { store, now });

    expect(result.kind).toBe("REJECTED_BY_OWNER");
    const signal = db.signals.get(TEST_SIGNAL_ID)!;
    expect(signal.approval_status).toBe("REJECTED");
    expect(signal.owner_decision).toBe("REJECTED");
    expect(signal.decision_source).toBe("TELEGRAM");
    expect(signal.approval_delay_ms).toBe(120_000);
    // An OWNER rejection leaves rejection_reason null; that is what
    // distinguishes it from an engine rejection.
    expect(signal.rejection_reason).toBeNull();
    expect(db.trades).toHaveLength(0);
  });

  it("retains the candidate data for later counterfactual analysis", async () => {
    const { db, store } = setup();
    await rejectCandidateByOwner(TEST_SIGNAL_ID, "TELEGRAM", { store, now });
    const signal = db.signals.get(TEST_SIGNAL_ID)!;
    expect(signal.score).toBe(99);
    expect(signal.planned_entry).toBe(148.8);
    expect(signal.indicator_snapshot).toBeTruthy();
  });

  it("a rejected candidate can no longer be approved", async () => {
    const { db, store, deps } = setup();
    await rejectCandidateByOwner(TEST_SIGNAL_ID, "TELEGRAM", { store, now });
    const approve = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(approve.kind).toBe("ALREADY_PROCESSED");
    expect(db.trades).toHaveLength(0);
  });

  it("a duplicate reject callback is a no-op", async () => {
    const { store } = setup();
    await rejectCandidateByOwner(TEST_SIGNAL_ID, "TELEGRAM", { store, now });
    const second = await rejectCandidateByOwner(TEST_SIGNAL_ID, "TELEGRAM", { store, now });
    expect(second.kind).toBe("ALREADY_PROCESSED");
  });

  it("an already-approved candidate cannot then be rejected", async () => {
    const { store, deps } = setup();
    await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    const result = await rejectCandidateByOwner(TEST_SIGNAL_ID, "TELEGRAM", { store, now });
    expect(result.kind).toBe("ALREADY_PROCESSED");
  });

  it("rejecting an unknown candidate is NOT_FOUND", async () => {
    const { store } = setup();
    const result = await rejectCandidateByOwner("00000000-0000-4000-8000-000000000000", "TELEGRAM", {
      store,
      now,
    });
    expect(result.kind).toBe("NOT_FOUND");
  });
});
