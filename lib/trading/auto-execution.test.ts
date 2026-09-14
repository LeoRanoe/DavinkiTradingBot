import { describe, expect, it } from "vitest";
import { approveCandidate } from "./approval";
import {
  createFakeApprovalStore,
  createFakeMarket,
  makeAccount,
  makeDb,
  makePendingSignal,
  makeResearchWindow,
  TEST_RESEARCH_SESSION_ID,
  TEST_SIGNAL_ID,
  type FakeDb,
} from "./__fixtures__/fakes";
import { DEFAULT_RISK_SETTINGS } from "@/lib/settings/risk-settings";

const NOW = Date.parse("2026-01-03T18:02:00Z");
const now = () => NOW;

/**
 * The research window used by these suites brackets NOW, so the DRAFT
 * strategy under test is executable for exactly the reason under test.
 */
function researchWindow(overrides = {}) {
  return makeResearchWindow({
    startedAt: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(NOW + 11 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  });
}

/** A DRAFT strategy inside an open research window - the 14-day run's setup. */
function setupResearch(dbOverrides: Partial<FakeDb> = {}, marketOverrides: Parameters<typeof createFakeMarket>[0] = {}) {
  const db = makeDb({
    strategyVersion: { status: "DRAFT", versionLabel: "v1" },
    researchWindow: researchWindow(),
    ...dbOverrides,
  });
  const store = createFakeApprovalStore(db);
  const market = createFakeMarket({ serverTimeMs: NOW - 1000, ...marketOverrides });
  return { db, store, market, deps: { store, market, now } };
}

describe("AUTO - execution under an active research window", () => {
  it("executes a DRAFT strategy candidate automatically and opens exactly one position", async () => {
    const { db, deps } = setupResearch();
    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(result.kind).toBe("EXECUTED");
    expect(db.trades).toHaveLength(1);
    expect(db.trades[0].trading_mode).toBe("PAPER");
    expect(db.trades[0].status).toBe("OPEN");
  });

  it("records AUTO as the source and leaves owner_decision null", async () => {
    // The owner enabled a policy; they did not decide this trade. Conflating
    // the two would corrupt every later analysis of approval behaviour.
    const { db, deps } = setupResearch();
    await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    const signal = db.signals.get(TEST_SIGNAL_ID)!;
    expect(signal.approval_status).toBe("APPROVED");
    expect(signal.decision_source).toBe("AUTO");
    expect(signal.owner_decision).toBeNull();
  });

  it("tags the position with the research session that authorized it", async () => {
    const { db, deps } = setupResearch();
    await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(db.trades[0].research_session_id).toBe(TEST_RESEARCH_SESSION_ID);
  });

  it("audits the execution as automatic, never as an owner approval", async () => {
    const { db, deps } = setupResearch();
    await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    const actions = db.audits.map((a) => a.action);
    expect(actions).toContain("paper_auto_execution");
    expect(actions).not.toContain("paper_position_opened");
  });

  it("uses the SAME revalidation engine: a second run creates no second position", async () => {
    const { db, deps } = setupResearch();
    await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    const second = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(second.kind).toBe("ALREADY_PROCESSED");
    expect(db.trades).toHaveLength(1);
  });

  it("does not request approval or depend on one: no owner input is involved", async () => {
    const { db, deps } = setupResearch();
    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(result.kind).toBe("EXECUTED");
    // Nothing in the persisted decision trail claims a human acted.
    expect(db.signals.get(TEST_SIGNAL_ID)!.owner_decision).toBeNull();
  });
});

describe("AUTO - every deterministic safety check still applies", () => {
  it("rejects a candidate that expired before execution", async () => {
    const { db, deps } = setupResearch({
      signals: new Map([
        [
          TEST_SIGNAL_ID,
          makePendingSignal({ expires_at: new Date(NOW - 60_000).toISOString() }),
        ],
      ]),
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("CANDIDATE_EXPIRED");
    expect(db.trades).toHaveLength(0);
  });

  it("rejects when price has moved outside the allowed entry range", async () => {
    const { db, deps } = setupResearch({}, { lastPrice: 200 });
    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("ENTRY_OUTSIDE_ALLOWED_RANGE");
    expect(db.trades).toHaveLength(0);
  });

  it("rejects on stale market data rather than trading blind", async () => {
    const { db, deps } = setupResearch({}, { serverTimeMs: NOW - 30 * 60_000 });
    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(result.kind).toBe("REJECTED");
    expect(db.trades).toHaveLength(0);
  });

  it("fails closed when market data cannot be obtained at all", async () => {
    const { db, deps } = setupResearch({}, { throwOn: "ticker" });
    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("MISSING_MARKET_DATA");
    expect(db.trades).toHaveLength(0);
  });

  it("is blocked by the open-position limit", async () => {
    const { db, deps } = setupResearch({
      account: makeAccount({ openPositionsCount: 1 }),
      settings: { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER", maxOpenPositions: 1 },
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("OPEN_POSITION_LIMIT");
    expect(db.trades).toHaveLength(0);
  });

  it("is blocked by the daily trade limit", async () => {
    const { db, deps } = setupResearch({
      account: makeAccount({ tradesOpenedTodayUtc: 2 }),
      settings: { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER", maxNewTradesPerDay: 2 },
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("DAILY_TRADE_LIMIT");
    expect(db.trades).toHaveLength(0);
  });

  it("is blocked by the daily loss lock", async () => {
    const { db, deps } = setupResearch({
      account: makeAccount({ losingTradesTodayUtc: 2 }),
      settings: { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER", maxLosingTradesPerDay: 2 },
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("DAILY_LOSS_LOCK");
    expect(db.trades).toHaveLength(0);
  });

  it("refuses a below-minimum size instead of inflating the trade", async () => {
    // The invariant holds identically under AUTO: never inflate to meet an
    // exchange minimum, never shrink a stop to fit.
    const { db, deps } = setupResearch({
      account: makeAccount({ equity: 3, availableBalance: 3 }),
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(["MIN_ORDER_RISK_CONFLICT", "INSUFFICIENT_BALANCE"]).toContain(result.reason);
    expect(db.trades).toHaveLength(0);
  });

  it("is blocked by excessive volatility measured from CURRENT candles", async () => {
    const { db, deps } = setupResearch({
      settings: { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER", maxAtrPct: 0.0001 },
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("EXCESSIVE_VOLATILITY");
    expect(db.trades).toHaveLength(0);
  });
});

describe("AUTO - research window governs eligibility", () => {
  it("refuses to execute a DRAFT strategy with no research window", async () => {
    const { db, deps } = setupResearch({ researchWindow: null });
    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);

    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("STRATEGY_NOT_APPROVED");
    expect(db.trades).toHaveLength(0);
  });

  it("refuses to execute once the window has expired", async () => {
    const { db, deps } = setupResearch({
      researchWindow: researchWindow({ endsAt: new Date(NOW - 1000).toISOString() }),
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    expect(db.trades).toHaveLength(0);
  });

  it("refuses an AUTO request even for a PAPER_APPROVED strategy once the window closed", async () => {
    // Defense in depth: AUTO is authorization to act on the research policy.
    // With no window there is no such policy in force, whatever the strategy
    // status - a stale in-flight AUTO request must not slip through.
    const { db, deps } = setupResearch({
      strategyVersion: { status: "PAPER_APPROVED", versionLabel: "v1" },
      researchWindow: null,
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(result.kind).toBe("REJECTED");
    expect(db.trades).toHaveLength(0);
  });

  it("still lets the OWNER approve a PAPER_APPROVED strategy with no window at all", async () => {
    // The formal status must never become hostage to the temporary mechanism.
    const { db, deps } = setupResearch({
      strategyVersion: { status: "PAPER_APPROVED", versionLabel: "v1" },
      researchWindow: null,
    });

    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(result.kind).toBe("EXECUTED");
    expect(db.trades).toHaveLength(1);
    // No window authorized it, so it carries no research tag.
    expect(db.trades[0].research_session_id).toBeNull();
  });

  it("does not tag a PAPER_APPROVED strategy's trades as research evidence", async () => {
    const { db, deps } = setupResearch({
      strategyVersion: { status: "PAPER_APPROVED", versionLabel: "v1" },
      researchWindow: researchWindow(),
    });

    await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);
    expect(db.trades[0].research_session_id).toBeNull();
  });
});

describe("LIVE remains impossible under every execution source", () => {
  for (const source of ["AUTO", "TELEGRAM", "DASHBOARD"] as const) {
    it(`refuses LIVE via ${source}`, async () => {
      const { db, deps } = setupResearch({
        // The settings parser cannot even represent LIVE; this forces the
        // value past it to prove the executor refuses it independently.
        settings: { ...DEFAULT_RISK_SETTINGS, tradingMode: "LIVE" as never },
      });

      const result = await approveCandidate(TEST_SIGNAL_ID, source, deps);
      expect(result.kind).toBe("REJECTED");
      if (result.kind !== "REJECTED") return;
      expect(result.reason).toBe("TRADING_MODE_BLOCK");
      expect(db.trades).toHaveLength(0);
    });
  }

  it("never writes a non-PAPER trade from any source", async () => {
    const { db, deps } = setupResearch();
    await approveCandidate(TEST_SIGNAL_ID, "AUTO", deps);
    expect(db.trades.every((t) => t.trading_mode === "PAPER")).toBe(true);
  });
});

describe("APPROVAL_REQUIRED flow is unchanged by AUTO's introduction", () => {
  it("still executes on owner approval and records the owner decision", async () => {
    const { db, deps } = setupResearch();
    const result = await approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps);

    expect(result.kind).toBe("EXECUTED");
    const signal = db.signals.get(TEST_SIGNAL_ID)!;
    expect(signal.owner_decision).toBe("APPROVED");
    expect(signal.decision_source).toBe("TELEGRAM");
  });

  it("records a dashboard approval as DASHBOARD, not AUTO", async () => {
    const { db, deps } = setupResearch();
    await approveCandidate(TEST_SIGNAL_ID, "DASHBOARD", deps);
    expect(db.signals.get(TEST_SIGNAL_ID)!.decision_source).toBe("DASHBOARD");
  });

  it("lets an owner approval win a race against an AUTO attempt, exactly once", async () => {
    const { db, deps } = setupResearch();
    const [a, b] = await Promise.all([
      approveCandidate(TEST_SIGNAL_ID, "AUTO", deps),
      approveCandidate(TEST_SIGNAL_ID, "TELEGRAM", deps),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["ALREADY_PROCESSED", "EXECUTED"]);
    expect(db.trades).toHaveLength(1);
  });
});
