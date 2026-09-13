import type { Candle } from "@/lib/bybit/types";
import type { AccountState, InstrumentRules } from "@/lib/risk/types";
import type { SignalRow } from "@/lib/candidates/persistence";
import { DEFAULT_RISK_SETTINGS, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import type { ApprovalStore, MarketDataPort, TradeInsert } from "../approval";
import type { PositionStore, TradeRow } from "../position-manager";

/**
 * In-memory doubles for the Milestone 2 ports.
 *
 * These deliberately model the DATABASE GUARANTEES, not just the happy path:
 *  - `claim` performs its compare-and-set synchronously with no await in
 *    between, exactly like a single-statement `UPDATE ... WHERE
 *    approval_status = 'PENDING'`. That is what makes the concurrency tests
 *    meaningful rather than decorative.
 *  - `insertTrade` enforces the partial unique index on trades.signal_id.
 *  - `closeTrade` performs the OPEN -> CLOSED compare-and-set the same way.
 */
export type FakeDb = {
  signals: Map<string, SignalRow>;
  trades: TradeRow[];
  tradeEvents: Array<{ tradeId: string; eventType: string; payload: Record<string, unknown> }>;
  snapshots: Array<{ mode: string; equity: number; takenAtIso: string }>;
  audits: Array<{ actor: string; action: string; metadata: Record<string, unknown> }>;
  settings: OwnerRiskSettings;
  strategyVersion: { status: string; versionLabel: string } | null;
  instrument: InstrumentRules | null;
  account: AccountState;
  failTradeInsert?: string;
};

export const TEST_SIGNAL_ID = "11111111-2222-4333-8444-555555555555";
export const TEST_STRATEGY_VERSION_ID = "99999999-8888-4777-8666-555555555555";

export function makeInstrument(overrides: Partial<InstrumentRules> = {}): InstrumentRules {
  return {
    tickSize: 0.01,
    qtyStep: 0.0001,
    minOrderQty: 0.0001,
    minOrderAmt: 5,
    maxOrderQty: null,
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<AccountState> = {}): AccountState {
  return {
    equity: 1000,
    availableBalance: 1000,
    openPositionsCount: 0,
    tradesOpenedTodayUtc: 0,
    losingTradesTodayUtc: 0,
    ...overrides,
  };
}

/** A PENDING candidate row as the Milestone 1 scanner would have persisted it. */
export function makePendingSignal(overrides: Partial<SignalRow> = {}): SignalRow {
  const createdAt = new Date("2026-01-03T18:00:00Z").toISOString();
  return {
    id: TEST_SIGNAL_ID,
    strategy_version_id: TEST_STRATEGY_VERSION_ID,
    symbol: "BTCUSDT",
    timeframe: "15M",
    candle_time: new Date("2026-01-03T17:45:00Z").toISOString(),
    regime: "EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50",
    score: 99,
    classification: "CANDIDATE",
    entry_price: 148.8,
    planned_entry: 148.8,
    minimum_allowed_entry: 148.5024,
    maximum_allowed_entry: 149.0976,
    stop_price: 147.3,
    target_price: 151.8,
    stop_pct: 0.010080645161290322,
    risk_reward: 2,
    reason: "fixture",
    approval_status: "PENDING",
    expires_at: new Date("2026-01-03T18:10:00Z").toISOString(),
    approved_at: null,
    ai_explanation: null,
    created_at: createdAt,
    trading_mode: "PAPER",
    reference_price: 148.8,
    reference_price_at: createdAt,
    volatility_state: "NORMAL",
    rejection_reason: null,
    rejection_detail: null,
    risk_snapshot: null,
    indicator_snapshot: {
      ema20: 149.1,
      ema50: 147.9,
      ema200: 140.2,
      rsi14: 55,
      atr14: 1.0,
      atrPct: 0.0067,
      relativeVolume: 1.1,
    } as never,
    owner_decision: null,
    decision_at: null,
    decision_source: null,
    approval_delay_ms: null,
    processed_at: null,
    news_risk: null,
    news_snapshot: null,
    ...overrides,
  };
}

export function makeDb(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    signals: new Map([[TEST_SIGNAL_ID, makePendingSignal()]]),
    trades: [],
    tradeEvents: [],
    snapshots: [],
    audits: [],
    settings: { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER", maxRiskPerTradePct: 0.005 },
    strategyVersion: { status: "PAPER_APPROVED", versionLabel: "v1" },
    instrument: makeInstrument(),
    account: makeAccount(),
    ...overrides,
  };
}

let tradeCounter = 0;

export function createFakeApprovalStore(db: FakeDb): ApprovalStore {
  return {
    async claim(signalId, nowIso) {
      // Synchronous compare-and-set: no await between the read and the write,
      // mirroring `UPDATE signals SET ... WHERE approval_status = 'PENDING'`.
      const row = db.signals.get(signalId);
      if (!row || row.approval_status !== "PENDING") return null;
      const claimed: SignalRow = { ...row, approval_status: "OPENING", processed_at: nowIso };
      db.signals.set(signalId, claimed);
      return claimed;
    },
    async currentStatus(signalId) {
      return db.signals.get(signalId)?.approval_status ?? null;
    },
    async finalizeRejection({ signalId, status, reason, detail, nowIso }) {
      const row = db.signals.get(signalId);
      if (!row || row.approval_status !== "OPENING") return;
      db.signals.set(signalId, {
        ...row,
        approval_status: status,
        rejection_reason: reason,
        rejection_detail: detail,
        processed_at: nowIso,
      });
    },
    async finalizeApproval({ signalId, source, nowIso, approvalDelayMs }) {
      const row = db.signals.get(signalId);
      if (!row || row.approval_status !== "OPENING") return;
      db.signals.set(signalId, {
        ...row,
        approval_status: "APPROVED",
        owner_decision: "APPROVED",
        decision_at: nowIso,
        decision_source: source,
        approval_delay_ms: approvalDelayMs,
        approved_at: nowIso,
        processed_at: nowIso,
      });
    },
    async recordOwnerRejection({ signalId, source, nowIso }) {
      const row = db.signals.get(signalId);
      if (!row) return { ok: false, state: null };
      if (row.approval_status !== "PENDING") return { ok: false, state: row.approval_status };
      db.signals.set(signalId, {
        ...row,
        approval_status: "REJECTED",
        owner_decision: "REJECTED",
        decision_at: nowIso,
        decision_source: source,
        approval_delay_ms: Math.max(0, new Date(nowIso).getTime() - new Date(row.created_at).getTime()),
        processed_at: nowIso,
      });
      return { ok: true, symbol: row.symbol };
    },
    async insertTrade(row: TradeInsert) {
      if (db.failTradeInsert) return { ok: false as const, duplicate: false, message: db.failTradeInsert };
      // The partial unique index on trades.signal_id.
      if (row.signal_id && db.trades.some((t) => t.signal_id === row.signal_id)) {
        return {
          ok: false as const,
          duplicate: true,
          message: 'duplicate key value violates unique constraint "trades_one_per_signal"',
        };
      }
      tradeCounter += 1;
      const id = `trade-${tradeCounter}`;
      db.trades.push({
        id,
        signal_id: row.signal_id ?? null,
        strategy_version_id: row.strategy_version_id,
        trading_mode: row.trading_mode,
        symbol: row.symbol,
        side: row.side ?? "LONG",
        status: row.status ?? "OPEN",
        entry_price: row.entry_price ?? null,
        stop_price: row.stop_price ?? null,
        target_price: row.target_price ?? null,
        qty: row.qty ?? null,
        notional: row.notional ?? null,
        risk_amount: row.risk_amount ?? null,
        risk_reward: row.risk_reward ?? null,
        risk_budget: row.risk_budget ?? null,
        modeled_max_loss: row.modeled_max_loss ?? null,
        entry_fee: row.entry_fee ?? null,
        exit_fee: null,
        fees: row.fees ?? 0,
        slippage: row.slippage ?? 0,
        exit_price: null,
        exit_reason: null,
        equity_after: null,
        pnl: null,
        r_multiple: null,
        rejection_reason: null,
        opened_at: row.opened_at ?? null,
        closed_at: null,
        created_at: new Date().toISOString(),
      });
      return { ok: true as const, tradeId: id };
    },
    async insertTradeEvent(tradeId, eventType, payload) {
      db.tradeEvents.push({ tradeId, eventType, payload });
    },
    async loadSettings() {
      return db.settings;
    },
    async loadStrategyVersion() {
      return db.strategyVersion;
    },
    async loadInstrument() {
      return db.instrument;
    },
    async loadAccount() {
      return db.account;
    },
    async audit(actor, action, metadata) {
      db.audits.push({ actor, action, metadata });
    },
  };
}

export function createFakePositionStore(db: FakeDb, initialEquity = 1000): PositionStore {
  return {
    async loadOpenTrades(mode) {
      return db.trades.filter((t) => t.trading_mode === mode && t.status === "OPEN");
    },
    async closeTrade(args) {
      // Compare-and-set OPEN -> CLOSED, performed synchronously.
      const trade = db.trades.find((t) => t.id === args.tradeId);
      if (!trade || trade.status !== "OPEN") return false;
      trade.status = "CLOSED";
      trade.exit_price = args.exitPrice;
      trade.exit_reason = args.exitReason;
      trade.pnl = args.netPnl;
      trade.r_multiple = args.realizedR;
      trade.exit_fee = args.exitFee;
      trade.fees = args.totalFees;
      trade.slippage = args.realizedSlippage;
      trade.equity_after = args.equityAfter;
      trade.closed_at = args.closedAtIso;
      return true;
    },
    async insertTradeEvent(tradeId, eventType, payload) {
      db.tradeEvents.push({ tradeId, eventType, payload });
    },
    async latestEquity() {
      const last = db.snapshots[db.snapshots.length - 1];
      return last?.equity ?? initialEquity;
    },
    async insertPortfolioSnapshot({ mode, equity, takenAtIso }) {
      db.snapshots.push({ mode, equity, takenAtIso });
    },
  };
}

export function makeCandles(
  timeframe: "1H" | "15M",
  closes: number[],
  opts: { volumes?: number[]; startIso?: string; highOffset?: number; lowOffset?: number } = {},
): Candle[] {
  const intervalMs = timeframe === "1H" ? 3_600_000 : 900_000;
  const baseTime = Date.parse(opts.startIso ?? "2026-01-01T00:00:00Z");
  return closes.map((close, i) => ({
    symbol: "BTCUSDT",
    timeframe,
    openTime: baseTime + i * intervalMs,
    open: close,
    high: close + (opts.highOffset ?? 0.5),
    low: close - (opts.lowOffset ?? 0.5),
    close,
    volume: opts.volumes?.[i] ?? 100,
    isClosed: true,
  }));
}

/** A market port returning a fixed price and a flat, non-triggering candle series. */
export function createFakeMarket(opts: {
  lastPrice?: number;
  serverTimeMs?: number;
  candles?: Candle[];
  throwOn?: "ticker" | "candles";
}): MarketDataPort {
  return {
    async ticker() {
      if (opts.throwOn === "ticker") throw new Error("Bybit unavailable");
      return {
        lastPrice: opts.lastPrice ?? 148.8,
        serverTimeMs: opts.serverTimeMs ?? Date.parse("2026-01-03T18:01:00Z"),
      };
    },
    async candles() {
      if (opts.throwOn === "candles") throw new Error("Bybit unavailable");
      return (
        opts.candles ??
        makeCandles(
          "15M",
          Array.from({ length: 40 }, () => 148.8),
          { startIso: "2026-01-03T08:00:00Z" },
        )
      );
    },
  };
}
