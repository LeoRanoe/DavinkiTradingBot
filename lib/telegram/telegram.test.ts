import { describe, expect, it } from "vitest";
import {
  buildCandidateKeyboard,
  formatApprovalRejectedMessage,
  formatCandidateMessage,
  formatTradeClosedMessage,
  parseCallbackData,
} from "./client";
import type { TradeCandidate } from "@/lib/candidates/types";
import type { ClosedPosition } from "@/lib/trading/position-manager";

const candidate: TradeCandidate = {
  candidateId: "c1",
  signalId: "11111111-2222-4333-8444-555555555555",
  symbol: "BTCUSDT",
  side: "LONG",
  marketType: "SPOT",
  venue: "BYBIT",
  strategyVersionId: "s1",
  strategyVersionLabel: "v1",
  timeframe: "15M",
  closedCandleTime: "2026-01-03T17:45:00.000Z",
  marketRegime: "EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50",
  strategyScore: 91,
  scoreComponents: [],
  classification: "CANDIDATE",
  indicators: { ema20: 1, ema50: 1, ema200: 1, rsi14: 55, atr14: 1, atrPct: 0.0067, relativeVolume: 1.1 },
  volatilityState: "NORMAL",
  setupReasons: [],
  position: {
    referencePrice: 148.8,
    plannedEntry: 148.8,
    minimumAllowedEntry: 148.5,
    maximumAllowedEntry: 149.1,
    stopPrice: 147.3,
    stopPct: 0.0101,
    targetPrice: 151.8,
    riskReward: 2,
    plannedR: 2,
  },
  risk: {
    equity: 20,
    availableBalance: 20,
    riskMode: "PERCENT_OF_EQUITY",
    configuredRisk: 0.01,
    riskBudget: 0.2,
    estimatedActualRisk: 0.19,
    positionNotional: 19.84,
    quantity: 0.1333,
    roundedQuantity: 0.1333,
    expectedEntryFee: 0.0198,
    expectedExitFee: 0.0198,
    expectedSlippage: 0.0198,
    modeledMaxLoss: 0.25,
    estimatedTargetProfit: 0.34,
  },
  lifecycle: {
    createdAt: "2026-01-03T18:00:00.000Z",
    expiresAt: "2026-01-03T18:10:00.000Z",
    state: "CANDIDATE",
    rejectionReason: null,
    rejectionDetail: null,
  },
  news: { riskLevel: null, summary: null, eventIds: [] },
};

describe("callback payload parsing", () => {
  it("accepts a well-formed approve/reject payload addressing an opaque UUID", () => {
    expect(parseCallbackData("approve:11111111-2222-4333-8444-555555555555")).toEqual({
      action: "approve",
      signalId: "11111111-2222-4333-8444-555555555555",
    });
    expect(parseCallbackData("reject:11111111-2222-4333-8444-555555555555")?.action).toBe("reject");
  });

  it("rejects anything that is not exactly action:uuid", () => {
    for (const bad of [
      null,
      undefined,
      42,
      "",
      "approve",
      "approve:",
      "approve:not-a-uuid",
      "delete:11111111-2222-4333-8444-555555555555",
      "approve:11111111-2222-4333-8444-555555555555; drop table trades",
      "approve:11111111-2222-4333-8444-555555555555 extra",
      { action: "approve" },
    ]) {
      expect(parseCallbackData(bad), String(bad)).toBeNull();
    }
  });

  it("callback data stays inside Telegram's 64-byte limit", () => {
    const data = `approve:11111111-2222-4333-8444-555555555555`;
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("candidate keyboard", () => {
  it("offers APPROVE, REJECT and a VIEW deep link into the app", () => {
    const kb = buildCandidateKeyboard("11111111-2222-4333-8444-555555555555", "https://example.app/");
    const row = kb.inline_keyboard[0];
    expect(row.map((b) => b.text)).toEqual(["APPROVE", "REJECT", "VIEW"]);
    expect(row[0].callback_data).toBe("approve:11111111-2222-4333-8444-555555555555");
    expect(row[2].url).toBe("https://example.app/signals/11111111-2222-4333-8444-555555555555");
  });

  it("omits VIEW rather than linking somewhere wrong when no app URL is configured", () => {
    const kb = buildCandidateKeyboard("11111111-2222-4333-8444-555555555555", null);
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(["APPROVE", "REJECT"]);
  });
});

describe("candidate message", () => {
  const text = formatCandidateMessage({ candidate, riskModeLabel: "1.00% of equity", validForMinutes: 7 });

  it("shows the real calculated values the owner is approving", () => {
    expect(text).toContain("BTCUSDT");
    expect(text).toContain("91 / 100");
    expect(text).toContain("$148.80"); // entry
    expect(text).toContain("$147.30"); // stop
    expect(text).toContain("$151.80"); // target
    expect(text).toContain("2.00"); // R/R
    expect(text).toContain("1.00% of equity");
    expect(text).toContain("Valid for      7 minutes");
  });

  it("shows the allowed entry range, not just a single price", () => {
    expect(text).toContain("$148.50 - $149.10");
  });

  it("distinguishes risk budget from position size", () => {
    expect(text).toContain("Risk budget");
    expect(text).toContain("Position size");
    expect(text).toContain("$0.2000");
    expect(text).toContain("$19.84");
  });

  it("omits News entirely rather than showing a placeholder analysis", () => {
    expect(text.toLowerCase()).not.toContain("news");
  });

  it("contains no formatting characters that Telegram Markdown would mangle", () => {
    // The regime string contains underscores; the message is sent as plain
    // text precisely so those cannot break parsing.
    expect(text).toContain("EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50");
  });
});

describe("outcome messages", () => {
  it("explains a cancelled trade in the owner's terms when price ran away", () => {
    const text = formatApprovalRejectedMessage({
      symbol: "BTCUSDT",
      reason: "ENTRY_OUTSIDE_ALLOWED_RANGE",
      detail: "…",
    });
    expect(text).toContain("Trade cancelled");
    expect(text).toContain("ENTRY_OUTSIDE_ALLOWED_RANGE");
    expect(text).toContain("outside the allowed entry range");
    expect(text).toContain("wait for another setup");
  });

  it("reports a target result factually, without gambling language", () => {
    const closed: ClosedPosition = {
      tradeId: "t1",
      symbol: "BTCUSDT",
      entryPrice: 100.05,
      exitPrice: 105.95,
      exitReason: "TARGET",
      qty: 3,
      grossPnl: 17.7,
      netPnl: 17.1,
      realizedR: 2.1,
      totalFees: 0.6,
      realizedSlippage: 0.3,
      equityBefore: 1000,
      equityAfter: 1017.1,
    };
    const text = formatTradeClosedMessage(closed, "v1");
    expect(text).toContain("PAPER TARGET HIT");
    expect(text).toContain("+2.10R");
    expect(text).toContain("New equity");
    for (const word of ["win", "jackpot", "moon", "profit!", "🚀", "congrat"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it("reports a stop result with the same neutral structure", () => {
    const closed: ClosedPosition = {
      tradeId: "t1",
      symbol: "BTCUSDT",
      entryPrice: 100.05,
      exitPrice: 96.95,
      exitReason: "STOP",
      qty: 3,
      grossPnl: -9.3,
      netPnl: -9.9,
      realizedR: -1,
      totalFees: 0.6,
      realizedSlippage: 0.3,
      equityBefore: 1000,
      equityAfter: 990.1,
    };
    const text = formatTradeClosedMessage(closed, "v1");
    expect(text).toContain("PAPER STOP HIT");
    expect(text).toContain("-1.00R");
  });
});
