import { describe, expect, it } from "vitest";
import { resolveConflicts } from "./conflict";
import type { Opportunity } from "./types";

function makeOpportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    userId: "user-1",
    strategyDefinitionId: "def-1",
    strategyVersionId: "ver-1",
    strategyConfigurationId: "cfg-1",
    strategyAssignmentId: "asn-1",
    instrumentId: "BTCUSDT",
    side: "LONG",
    signalTime: 1,
    entry: { price: 100, kind: "MARKET" },
    stop: { price: 95, kind: "STRUCTURE" },
    target: { price: 115, kind: "LIQUIDITY" },
    partialExitPlan: null,
    reasonCodes: [],
    parameterSnapshot: {},
    featureSnapshot: {},
    confidence: null,
    priority: 100,
    ...overrides,
  };
}

describe("conflict resolution", () => {
  it("same-direction opportunities for one instrument all coexist as executable", () => {
    const jeanfx = makeOpportunity({ strategyDefinitionId: "jeanfx", side: "LONG" });
    const trb = makeOpportunity({ strategyDefinitionId: "trb", side: "LONG" });
    const [result] = resolveConflicts([jeanfx, trb]);
    expect(result.executable).toEqual([jeanfx, trb]);
    expect(result.blocked).toEqual([]);
  });

  it("opposing signals block execution under the conservative default, never netted away", () => {
    const long = makeOpportunity({ strategyDefinitionId: "jeanfx", side: "LONG" });
    const short = makeOpportunity({ strategyDefinitionId: "mean-reversion", side: "SHORT" });
    const [result] = resolveConflicts([long, short]);
    expect(result.executable).toEqual([]);
    expect(result.blocked).toHaveLength(2);
    // Never silently netted: both original opportunities are still visible.
    expect(result.allOpportunities).toEqual([long, short]);
  });

  it("is deterministic and independent of iteration/array order", () => {
    const long = makeOpportunity({ strategyDefinitionId: "jeanfx", side: "LONG" });
    const short = makeOpportunity({ strategyDefinitionId: "mean-reversion", side: "SHORT" });
    const forward = resolveConflicts([long, short]);
    const backward = resolveConflicts([short, long]);
    expect(forward[0].blocked.length).toBe(backward[0].blocked.length);
    expect(forward[0].executable.length).toBe(backward[0].executable.length);
  });

  it("HIGHEST_PRIORITY resolves opposing signals deterministically to the higher-priority side", () => {
    const long = makeOpportunity({ strategyDefinitionId: "jeanfx", side: "LONG", priority: 200 });
    const short = makeOpportunity({ strategyDefinitionId: "mean-reversion", side: "SHORT", priority: 100 });
    const [result] = resolveConflicts([long, short], "HIGHEST_PRIORITY");
    expect(result.executable).toEqual([long]);
    expect(result.blocked).toEqual([short]);
  });

  it("HIGHEST_PRIORITY blocks everything on an exact priority tie", () => {
    const long = makeOpportunity({ strategyDefinitionId: "jeanfx", side: "LONG", priority: 100 });
    const short = makeOpportunity({ strategyDefinitionId: "mean-reversion", side: "SHORT", priority: 100 });
    const [result] = resolveConflicts([long, short], "HIGHEST_PRIORITY");
    expect(result.executable).toEqual([]);
    expect(result.blocked).toHaveLength(2);
  });

  it("PORTFOLIO_SELECTOR is not implemented and fails loudly rather than silently resolving", () => {
    const long = makeOpportunity({ side: "LONG" });
    const short = makeOpportunity({ strategyDefinitionId: "other", side: "SHORT" });
    expect(() => resolveConflicts([long, short], "PORTFOLIO_SELECTOR")).toThrow(/not implemented/i);
  });

  it("groups independently per instrument", () => {
    const btcLong = makeOpportunity({ instrumentId: "BTCUSDT", side: "LONG" });
    const ethShort = makeOpportunity({ instrumentId: "ETHUSDT", side: "SHORT" });
    const results = resolveConflicts([btcLong, ethShort]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.blocked.length === 0)).toBe(true);
  });
});
