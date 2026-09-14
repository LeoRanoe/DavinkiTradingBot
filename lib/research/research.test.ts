import { describe, expect, it } from "vitest";
import { isStrategyEligibleForPaper } from "./eligibility";
import { effectiveExecutionPolicy } from "./policy";
import {
  DAY_MS,
  formatResearchDay,
  formatTimeRemaining,
  needsExpiryReconciliation,
  planResearchWindow,
  RESEARCH_MAX_DAYS,
  researchProgress,
  researchWindowFromRow,
  researchWindowState,
  type ResearchWindow,
} from "./window";
import { buildResearchReport, scoreBand, volatilityBand } from "./report";
import type { LearningTrade } from "@/lib/learning/types";

const START = Date.parse("2026-02-01T00:00:00Z");
const END = START + 14 * DAY_MS;

function makeWindow(overrides: Partial<ResearchWindow> = {}): ResearchWindow {
  return {
    id: "window-1",
    startedAt: new Date(START).toISOString(),
    endsAt: new Date(END).toISOString(),
    status: "ACTIVE",
    plannedDays: 14,
    startingEquity: 20,
    targetEquity: 50,
    strategyVersionId: "strategy-v1",
    label: "14-day PAPER research",
    endedNotifiedAt: null,
    ...overrides,
  };
}

describe("research window state", () => {
  it("is NOT_CONFIGURED when no session exists", () => {
    expect(researchWindowState(null, START)).toBe("NOT_CONFIGURED");
  });

  it("starts correctly and is ACTIVE at the midpoint", () => {
    expect(researchWindowState(makeWindow(), START)).toBe("ACTIVE");
    expect(researchWindowState(makeWindow(), START + 7 * DAY_MS)).toBe("ACTIVE");
  });

  it("expires exactly at ends_at, not a moment later", () => {
    expect(researchWindowState(makeWindow(), END - 1)).toBe("ACTIVE");
    expect(researchWindowState(makeWindow(), END)).toBe("EXPIRED");
    expect(researchWindowState(makeWindow(), END + DAY_MS)).toBe("EXPIRED");
  });

  it("ignores a stale stored ACTIVE status once the window has elapsed", () => {
    // The critical property: a missed or delayed reconciling scan can never
    // keep a window alive past its end. Real time is the authority.
    const stale = makeWindow({ status: "ACTIVE" });
    expect(stale.status).toBe("ACTIVE");
    expect(researchWindowState(stale, END + 30 * DAY_MS)).toBe("EXPIRED");
  });

  it("treats an unrecognized stored status as EXPIRED, never ACTIVE", () => {
    const unknown = researchWindowFromRow({
      id: "w",
      started_at: new Date(START).toISOString(),
      ends_at: new Date(END).toISOString(),
      status: "SOMETHING_NEW",
    });
    expect(unknown?.status).toBe("EXPIRED");
    expect(researchWindowState(unknown, START + DAY_MS)).toBe("EXPIRED");
  });

  it("flags exactly one reconciliation, and none once already expired", () => {
    expect(needsExpiryReconciliation(makeWindow(), START + DAY_MS)).toBe(false);
    expect(needsExpiryReconciliation(makeWindow(), END + 1)).toBe(true);
    expect(needsExpiryReconciliation(makeWindow({ status: "EXPIRED" }), END + 1)).toBe(false);
  });
});

describe("research progress", () => {
  it("reports Day 1 on the first day and Day 14 on the last", () => {
    expect(formatResearchDay(makeWindow(), START)).toBe("Day 1 of 14");
    expect(formatResearchDay(makeWindow(), START + 2 * DAY_MS + 3600_000)).toBe("Day 3 of 14");
    expect(formatResearchDay(makeWindow(), END - 1)).toBe("Day 14 of 14");
  });

  it("never reports a day beyond the planned total", () => {
    expect(researchProgress(makeWindow(), END + 100 * DAY_MS).day).toBe(14);
  });

  it("formats remaining time without ever going negative", () => {
    expect(formatTimeRemaining(0)).toBe("ended");
    expect(formatTimeRemaining(-5000)).toBe("ended");
    expect(formatTimeRemaining(2 * DAY_MS + 3 * 3600_000)).toBe("2 days 3 hours");
  });
});

describe("planResearchWindow", () => {
  it("computes an exact 14-day window", () => {
    const planned = planResearchWindow({ startedAtMs: START, days: 14, startingEquity: 20 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(Date.parse(planned.endsAt) - Date.parse(planned.startedAt)).toBe(14 * DAY_MS);
  });

  it("refuses a window longer than the maximum", () => {
    // A window that cannot end is indistinguishable from permanently
    // enabling automatic execution.
    const planned = planResearchWindow({
      startedAtMs: START,
      days: RESEARCH_MAX_DAYS + 1,
      startingEquity: 20,
    });
    expect(planned.ok).toBe(false);
  });

  it("refuses a non-positive duration or starting equity", () => {
    expect(planResearchWindow({ startedAtMs: START, days: 0, startingEquity: 20 }).ok).toBe(false);
    expect(planResearchWindow({ startedAtMs: START, days: 14, startingEquity: 0 }).ok).toBe(false);
  });
});

describe("isStrategyEligibleForPaper", () => {
  const active = makeWindow();

  it("blocks DRAFT outside a research window", () => {
    const result = isStrategyEligibleForPaper({
      strategyStatus: "DRAFT",
      tradingMode: "PAPER",
      researchWindow: null,
      now: START,
    });
    expect(result.eligible).toBe(false);
  });

  it("allows DRAFT for PAPER inside a research window, on the research basis only", () => {
    const result = isStrategyEligibleForPaper({
      strategyStatus: "DRAFT",
      tradingMode: "PAPER",
      researchWindow: active,
      now: START + DAY_MS,
    });
    expect(result.eligible).toBe(true);
    expect(result.basis).toBe("PAPER_RESEARCH");
    // The wording must never imply the strategy is validated.
    expect(result.detail).toContain("does not mean the strategy is validated");
  });

  it("blocks DRAFT again the moment the window expires", () => {
    const result = isStrategyEligibleForPaper({
      strategyStatus: "DRAFT",
      tradingMode: "PAPER",
      researchWindow: active,
      now: END,
    });
    expect(result.eligible).toBe(false);
  });

  it("NEVER allows DRAFT for LIVE, even with an active window", () => {
    const result = isStrategyEligibleForPaper({
      strategyStatus: "DRAFT",
      tradingMode: "LIVE",
      researchWindow: active,
      now: START + DAY_MS,
    });
    expect(result.eligible).toBe(false);
    expect(result.detail).toContain("permanently disabled");
  });

  it("NEVER allows LIVE for any strategy status", () => {
    for (const status of ["DRAFT", "BACKTESTING", "PAPER_APPROVED", "DEMO_APPROVED", "RETIRED"]) {
      const result = isStrategyEligibleForPaper({
        strategyStatus: status,
        tradingMode: "LIVE",
        researchWindow: active,
        now: START + DAY_MS,
      });
      expect(result.eligible).toBe(false);
    }
  });

  it("keeps a PAPER_APPROVED strategy eligible independently of any window", () => {
    // The formal status must not become hostage to the temporary mechanism.
    for (const window of [null, active, makeWindow({ status: "EXPIRED" })]) {
      const result = isStrategyEligibleForPaper({
        strategyStatus: "PAPER_APPROVED",
        tradingMode: "PAPER",
        researchWindow: window,
        now: END + 90 * DAY_MS,
      });
      expect(result.eligible).toBe(true);
      expect(result.basis).toBe("PAPER_APPROVED");
    }
  });

  it("does not make BACKTESTING or RETIRED executable inside a window", () => {
    for (const status of ["BACKTESTING", "RETIRED"]) {
      expect(
        isStrategyEligibleForPaper({
          strategyStatus: status,
          tradingMode: "PAPER",
          researchWindow: active,
          now: START + DAY_MS,
        }).eligible,
      ).toBe(false);
    }
  });

  it("refuses an unknown or missing strategy status", () => {
    expect(
      isStrategyEligibleForPaper({
        strategyStatus: null,
        tradingMode: "PAPER",
        researchWindow: active,
        now: START + DAY_MS,
      }).eligible,
    ).toBe(false);
  });
});

describe("effectiveExecutionPolicy", () => {
  const active = makeWindow();

  it("is AUTO only with AUTO configured, PAPER mode and an active window", () => {
    const result = effectiveExecutionPolicy({
      configuredPolicy: "AUTO",
      tradingMode: "PAPER",
      researchWindow: active,
      now: START + DAY_MS,
    });
    expect(result.policy).toBe("AUTO");
    expect(result.degraded).toBe(false);
  });

  it("falls back to APPROVAL_REQUIRED after the window expires, even while the column still says AUTO", () => {
    // This is what makes AUTO stop by itself on day 14: no write is needed.
    const result = effectiveExecutionPolicy({
      configuredPolicy: "AUTO",
      tradingMode: "PAPER",
      researchWindow: active,
      now: END,
    });
    expect(result.policy).toBe("APPROVAL_REQUIRED");
    expect(result.degraded).toBe(true);
  });

  it("falls back when there is no window at all", () => {
    expect(
      effectiveExecutionPolicy({
        configuredPolicy: "AUTO",
        tradingMode: "PAPER",
        researchWindow: null,
        now: START,
      }).policy,
    ).toBe("APPROVAL_REQUIRED");
  });

  it("never yields AUTO outside PAPER", () => {
    for (const mode of ["OBSERVE", "DEMO", "LIVE"]) {
      expect(
        effectiveExecutionPolicy({
          configuredPolicy: "AUTO",
          tradingMode: mode,
          researchWindow: active,
          now: START + DAY_MS,
        }).policy,
      ).toBe("APPROVAL_REQUIRED");
    }
  });

  it("leaves a configured APPROVAL_REQUIRED untouched", () => {
    const result = effectiveExecutionPolicy({
      configuredPolicy: "APPROVAL_REQUIRED",
      tradingMode: "PAPER",
      researchWindow: active,
      now: START + DAY_MS,
    });
    expect(result.policy).toBe("APPROVAL_REQUIRED");
    expect(result.degraded).toBe(false);
  });
});

describe("research evidence report", () => {
  const window = makeWindow();
  const funnel = { candidates: 10, riskValidCandidates: 6, executed: 4, executedAutomatically: 4 };

  function trade(overrides: Partial<LearningTrade> = {}): LearningTrade {
    return {
      id: `t-${Math.random()}`,
      actual: true,
      symbol: "BTCUSDT",
      strategyVersion: "v1",
      score: 88,
      regime: "BULLISH",
      newsRisk: "LOW",
      openedAt: START,
      closedAt: START + 3600_000,
      pnl: 1,
      fees: 0.02,
      slippage: 0.01,
      rMultiple: 1,
      ...overrides,
    };
  }

  it("bands scores exactly on the spec's boundaries", () => {
    expect(scoreBand(79)).toBe("BELOW_80");
    expect(scoreBand(80)).toBe("80-84");
    expect(scoreBand(85)).toBe("85-89");
    expect(scoreBand(90)).toBe("90-94");
    expect(scoreBand(95)).toBe("95-100");
    expect(scoreBand(100)).toBe("95-100");
    expect(scoreBand(null)).toBe("BELOW_80");
  });

  it("bands volatility and treats missing data as UNKNOWN, never as LOW", () => {
    expect(volatilityBand(0.005)).toBe("LOW");
    expect(volatilityBand(0.02)).toBe("MEDIUM");
    expect(volatilityBand(0.04)).toBe("HIGH");
    expect(volatilityBand(null)).toBe("UNKNOWN");
  });

  it("reports no data honestly and never calls it a failure", () => {
    const report = buildResearchReport({ window, trades: [], funnel });
    expect(report.overall.sampleCount).toBe(0);
    expect(report.evidenceLevel).toBe("NO_DATA");
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.evidenceStatement).toContain("No trade is a valid outcome");
  });

  it("says INSUFFICIENT EVIDENCE on a small winning sample rather than calling it profitable", () => {
    // Five straight wins looks excellent and proves nothing.
    const report = buildResearchReport({
      window,
      trades: Array.from({ length: 5 }, () => trade({ pnl: 2, rMultiple: 2 })),
      funnel,
    });
    expect(report.overall.wins).toBe(5);
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.evidenceStatement).toContain("Insufficient evidence");
  });

  it("only reaches OWNER_REVIEW with a sufficient and genuinely positive sample", () => {
    const report = buildResearchReport({
      window,
      trades: Array.from({ length: 25 }, (_, i) =>
        trade({ pnl: i % 3 === 0 ? -1 : 1.5, rMultiple: i % 3 === 0 ? -1 : 1.5 }),
      ),
      funnel,
    });
    expect(report.evidenceLevel).toBe("INITIAL_EVIDENCE");
    expect(report.recommendation).toBe("OWNER_REVIEW_FOR_PAPER_APPROVAL");
  });

  it("keeps DRAFT on a large but losing sample", () => {
    const report = buildResearchReport({
      window,
      trades: Array.from({ length: 25 }, () => trade({ pnl: -1, rMultiple: -1 })),
      funnel,
    });
    expect(report.recommendation).toBe("KEEP_DRAFT");
  });

  it("never mixes counterfactual rows into actual PAPER performance", () => {
    const report = buildResearchReport({
      window,
      trades: [
        trade({ pnl: 1, rMultiple: 1 }),
        // A hypothetical fill from a rejected candidate: research data, but
        // not PAPER performance.
        trade({ actual: false, pnl: 100, rMultiple: 50 }),
      ],
      funnel,
    });
    expect(report.overall.sampleCount).toBe(1);
    expect(report.overall.netPnl).toBe(1);
  });

  it("breaks results down by the dimensions the research period must answer", () => {
    const report = buildResearchReport({
      window,
      trades: [
        trade({ symbol: "BTCUSDT", score: 82, regime: "BULLISH", newsRisk: "LOW" }),
        trade({ symbol: "ETHUSDT", score: 96, regime: "NEUTRAL", newsRisk: "HIGH" }),
      ],
      funnel,
    });
    expect(Object.keys(report.bySymbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(Object.keys(report.byScoreBand).sort()).toEqual(["80-84", "95-100"]);
    expect(Object.keys(report.byRegime).sort()).toEqual(["BULLISH", "NEUTRAL"]);
    expect(Object.keys(report.byNewsRisk).sort()).toEqual(["HIGH", "LOW"]);
    expect(report.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("carries the experiment's starting and target equity without letting the target affect anything", () => {
    const report = buildResearchReport({ window, trades: [], funnel, endingEquity: 21.5 });
    expect(report.startingEquity).toBe(20);
    expect(report.targetEquity).toBe(50);
    expect(report.endingEquity).toBe(21.5);
    // Reaching the target must not change the recommendation.
    const atTarget = buildResearchReport({ window, trades: [], funnel, endingEquity: 50 });
    expect(atTarget.recommendation).toBe("KEEP_DRAFT");
  });
});
