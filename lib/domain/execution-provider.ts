import type { Instrument } from "./instrument";

export type ExecutionSide = "LONG" | "SHORT";

export type AccountSnapshot = {
  accountCurrency: string;
  equity: number;
  availableBalance: number;
};

export type OrderValidation = { valid: true } | { valid: false; reason: string };

export type PositionSnapshot = {
  instrumentId: string;
  side: ExecutionSide;
  size: number;
  entryPrice: number;
};

export type OrderRequest = {
  instrument: Instrument;
  side: ExecutionSide;
  size: number;
  /** "PAPER" | "DEMO" only — LIVE is permanently disabled platform-wide. */
  mode: "PAPER" | "DEMO";
};

/**
 * Generic execution contract (CLAUDE.md §6). PaperExecutionProvider is the
 * only concrete implementation exercised today (lib/trading/paper.ts keeps
 * its existing concrete implementation for the frozen V1 production path;
 * this interface exists so future providers — Bybit demo/live, a forex
 * broker — can be added as adapters without changing strategy/risk code).
 *
 * LIVE trading remains impossible: this interface has no "LIVE" mode value,
 * matching the DB CHECK constraints and lib/risk/engine.ts refusal described
 * in CLAUDE.md invariant #1. Never add "LIVE" to OrderRequest.mode.
 */
export interface ExecutionProvider {
  getAccount(): Promise<AccountSnapshot>;
  getAvailableBalance(): Promise<number>;
  validateOrder(order: OrderRequest): Promise<OrderValidation>;
  placeOrder(order: OrderRequest): Promise<{ orderId: string }>;
  cancelOrder(orderId: string): Promise<void>;
  getPositions(): Promise<PositionSnapshot[]>;
}
