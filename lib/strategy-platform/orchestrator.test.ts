import { describe, expect, it, vi } from "vitest";
import { runOrchestrator, type OrchestratorInput } from "./orchestrator";
import type { AssignmentInput, PortfolioState, VenueCapabilities } from "./orchestrator-types";
import type { CanonicalCandle, Instrument, StrategyContract, StrategyDecision } from "./types";
import type { PortfolioLimits } from "./portfolio-risk";

function strategyThatAlwaysEnters(slug: string, decision: StrategyDecision): StrategyContract {
  return {
    metadata: {
      slug,
      displayName: slug,
      description: "",
      type: "BUILT_IN",
      status: "RESEARCH_ONLY",
      requiredTimeframes: ["H1"],
      supportedAssetClasses: ["CRYPTO"],
      supportedSides: ["LONG", "SHORT"],
      minimumHistoryRequirements: {},
      requiredFeatures: [],
    },
    evaluate: () => decision,
  };
}

const longDecision: StrategyDecision = {
  type: "ENTER_LONG",
  entry: { price: 100, kind: "MARKET" },
  stop: { price: 95, kind: "TEST" },
  target: { price: 115, kind: "TEST" },
  partialExitPlan: null,
  reasonCodes: ["TEST"],
  featureSnapshot: {},
  confidence: null,
};

function assignment(overrides: Partial<AssignmentInput>): AssignmentInput {
  return {
    assignmentId: "a-1",
    userId: "user-1",
    strategyConfigurationId: "c-1",
    strategyVersionId: "v-1",
    strategyDefinitionId: "jeanfx",
    strategy: strategyThatAlwaysEnters("jeanfx", longDecision),
    parameters: {},
    instrumentIds: ["BTCUSDT"],
    mode: "PAPER",
    priority: 100,
    effectiveMode: "PAPER",
    ...overrides,
  };
}

const instruments: Record<string, Instrument> = { BTCUSDT: { id: "BTCUSDT", assetClass: "CRYPTO", pipSize: 0.01 }, ETHUSDT: { id: "ETHUSDT", assetClass: "CRYPTO", pipSize: 0.01 } };
const venue: VenueCapabilities = { supportsShort: false, supportedAssetClasses: ["CRYPTO"] };
const emptyPortfolio: PortfolioState = { openRiskByInstrument: {}, openRiskByStrategy: {}, openRiskByAssetClass: {}, openPositionsByStrategy: {}, totalOpenPositions: 0, totalOpenRisk: 0 };
const generousLimits: PortfolioLimits = { maxTotalOpenRiskPct: 1, maxRiskPerInstrumentPct: 1, maxRiskPerStrategyPct: 1, maxPositionsPerStrategy: 100, maxTotalPositions: 100, maxExposurePerAssetClassPct: 1, maxCorrelatedExposurePct: 1 };

function baseInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    now: Date.now(),
    assignments: [assignment({})],
    instruments,
    venue,
    marketDataProvider: () => [{ instrumentId: "BTCUSDT", timeframe: "H1", openTime: 0, open: 100, high: 101, low: 99, close: 100, volume: 1, isClosed: true }] as CanonicalCandle[],
    portfolio: emptyPortfolio,
    limits: generousLimits,
    riskPctOf: () => 0.01,
    ...overrides,
  };
}

describe("runOrchestrator - basic flow and attribution", () => {
  it("a PAPER assignment's opportunity carries full attribution and lands in executable", async () => {
    const result = await runOrchestrator(baseInput());
    expect(result.executable).toHaveLength(1);
    const o = result.executable[0];
    expect(o.userId).toBe("user-1");
    expect(o.strategyDefinitionId).toBe("jeanfx");
    expect(o.strategyAssignmentId).toBe("a-1");
    expect(o.instrumentId).toBe("BTCUSDT");
  });

  it("RESEARCH-mode assignments never appear in executable, only researchOnly", async () => {
    const result = await runOrchestrator(baseInput({ assignments: [assignment({ mode: "RESEARCH", effectiveMode: "RESEARCH" })] }));
    expect(result.executable).toEqual([]);
    expect(result.researchOnly).toHaveLength(1);
  });

  it("SHADOW-mode assignments never appear in executable, only shadowed", async () => {
    const result = await runOrchestrator(baseInput({ assignments: [assignment({ mode: "SHADOW", effectiveMode: "SHADOW" })] }));
    expect(result.executable).toEqual([]);
    expect(result.shadowed).toHaveLength(1);
  });

  it("a LIVE effectiveMode is refused unconditionally, defense in depth", async () => {
    const result = await runOrchestrator(baseInput({ assignments: [assignment({ mode: "PAPER", effectiveMode: "LIVE" })] }));
    expect(result.executable).toEqual([]);
    expect(result.errors.some((e) => /LIVE/.test(e.message))).toBe(true);
  });
});

describe("runOrchestrator - market data dedupe", () => {
  it("calls the provider once per distinct (instrument, timeframe) even with many assignments needing it", async () => {
    const provider = vi.fn(() => [] as CanonicalCandle[]);
    const assignments = [
      assignment({ assignmentId: "a-1", strategyDefinitionId: "jeanfx" }),
      assignment({ assignmentId: "a-2", strategyDefinitionId: "custom" }),
    ];
    await runOrchestrator(baseInput({ assignments, marketDataProvider: provider }));
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe("runOrchestrator - failure isolation (Prompt 3 S30)", () => {
  it("a throwing custom strategy does not stop other assignments from evaluating", async () => {
    const broken = assignment({
      assignmentId: "a-broken",
      strategyDefinitionId: "broken-custom",
      strategy: { metadata: strategyThatAlwaysEnters("broken", longDecision).metadata, evaluate: () => { throw new Error("boom"); } },
    });
    const healthy = assignment({ assignmentId: "a-healthy", strategyDefinitionId: "jeanfx" });
    const result = await runOrchestrator(baseInput({ assignments: [broken, healthy] }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].strategyAssignmentId).toBe("a-broken");
    expect(result.executable.some((o) => o.strategyAssignmentId === "a-healthy")).toBe(true);
  });
});

describe("runOrchestrator - determinism regardless of array order", () => {
  it("shuffled assignment order produces the same executable set", async () => {
    const a = assignment({ assignmentId: "a-1", strategyDefinitionId: "jeanfx", instrumentIds: ["BTCUSDT"] });
    const b = assignment({ assignmentId: "a-2", strategyDefinitionId: "custom", instrumentIds: ["ETHUSDT"] });
    const forward = await runOrchestrator(baseInput({ assignments: [a, b] }));
    const backward = await runOrchestrator(baseInput({ assignments: [b, a] }));
    expect(forward.executable.map((o) => o.instrumentId).sort()).toEqual(backward.executable.map((o) => o.instrumentId).sort());
  });
});

describe("runOrchestrator - incompatible assignments are skipped, not crashed on", () => {
  it("an assignment targeting an unknown instrument is recorded as incompatible", async () => {
    const result = await runOrchestrator(baseInput({ assignments: [assignment({ instrumentIds: ["UNKNOWNUSDT"] })] }));
    expect(result.incompatible).toHaveLength(1);
    expect(result.executable).toEqual([]);
  });

  it("insufficient history routes to incompatible with a human-readable reason, never a crash", async () => {
    const strictHistory: StrategyContract = {
      metadata: { ...strategyThatAlwaysEnters("strict", longDecision).metadata, minimumHistoryRequirements: { H1: 500 } },
      evaluate: () => longDecision,
    };
    const result = await runOrchestrator(baseInput({ assignments: [assignment({ strategy: strictHistory })] }));
    expect(result.incompatible).toHaveLength(1);
    expect(result.incompatible[0].reasons[0]).toMatch(/requires 500/);
  });
});
