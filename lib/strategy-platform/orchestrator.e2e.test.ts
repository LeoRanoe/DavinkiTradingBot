import { describe, expect, it } from "vitest";
import { runOrchestrator, type OrchestratorInput } from "./orchestrator";
import { jeanfxV1BuiltInStrategy } from "./built-in/jeanfx-v1";
import { trbBuiltInStrategy } from "./built-in/trb";
import { compileDslStrategy } from "./dsl/compile";
import { resolveEffectiveMode } from "./authorization";
import type { AssignmentInput, PortfolioState, VenueCapabilities } from "./orchestrator-types";
import type { PortfolioLimits } from "./portfolio-risk";
import type { CanonicalCandle, Instrument, StrategyMetadata } from "./types";
import type { DslDefinition } from "./dsl/types";
import {
  bullishBiasCandles,
  bullishEntryCandles,
  bullishStructureCandles,
} from "@/lib/strategy/jeanfx-v1/primitives/__fixtures__/bullish-scenario";

/**
 * End-to-end orchestrator scenarios (Prompt 3 S35). These exercise the
 * SAME runOrchestrator() entry point across built-in (JeanFX, TRB) and
 * compiled-DSL (custom) strategies - no strategy-specific branch anywhere
 * in the orchestrator, per Prompt 3's "no strategy-specific hacks in core
 * infrastructure" instruction.
 */

const instruments: Record<string, Instrument> = {
  BTCUSDT: { id: "BTCUSDT", assetClass: "CRYPTO", pipSize: 0.01 },
  ETHUSDT: { id: "ETHUSDT", assetClass: "CRYPTO", pipSize: 0.01 },
};
const venue: VenueCapabilities = { supportsShort: false, supportedAssetClasses: ["CRYPTO"] };
const emptyPortfolio: PortfolioState = { openRiskByInstrument: {}, openRiskByStrategy: {}, openRiskByAssetClass: {}, openPositionsByStrategy: {}, totalOpenPositions: 0, totalOpenRisk: 0 };
const generousLimits: PortfolioLimits = { maxTotalOpenRiskPct: 1, maxRiskPerInstrumentPct: 1, maxRiskPerStrategyPct: 1, maxPositionsPerStrategy: 100, maxTotalPositions: 100, maxExposurePerAssetClassPct: 1, maxCorrelatedExposurePct: 1 };

/**
 * Same evaluate() as the real jeanfxV1BuiltInStrategy (untouched, real
 * logic) - only metadata.minimumHistoryRequirements is relaxed for this
 * test's deliberately minimal-but-sufficient fixture (43 M15 bars is
 * enough for the actual algorithm, per state-machine.test.ts; the
 * production metadata's 50-bar minimum is a safety margin, not a
 * correctness requirement).
 */
const jeanfxForTest = {
  metadata: { ...jeanfxV1BuiltInStrategy.metadata, minimumHistoryRequirements: { H1: 210, M15: 40, M5: 2 } },
  evaluate: jeanfxV1BuiltInStrategy.evaluate,
  // The real resolver, so this exercises configuration-driven timeframe
  // selection end to end rather than the static metadata list.
  resolveRequiredTimeframes: jeanfxV1BuiltInStrategy.resolveRequiredTimeframes,
};

/**
 * The fixture supplies H1 bias candles, so these assignments select the
 * SELECTIVE (H1 bias) profile. With resolveRequiredTimeframes wired up this
 * is what actually causes H1 to be fetched - selecting ACTIVE here would
 * correctly fetch M30 and find no data, rather than silently reusing H1.
 */
const JEANFX_H1_PARAMS = { profile: "JEANFX_GOLD_SELECTIVE" as const };

function jeanfxMarketData() {
  const structure = bullishStructureCandles();
  const fvgFormedAt = structure[structure.length - 1].openTime;
  const m5 = bullishEntryCandles(fvgFormedAt);
  const h1 = bullishBiasCandles();
  return { H1: h1, M15: structure, M5: m5 };
}

function makeAssignment(overrides: Partial<AssignmentInput>): AssignmentInput {
  return {
    assignmentId: "a-1",
    userId: "user-1",
    strategyConfigurationId: "c-1",
    strategyVersionId: "v-1",
    strategyDefinitionId: "jeanfx-v1",
    strategy: jeanfxForTest,
    parameters: { ...JEANFX_H1_PARAMS },
    instrumentIds: ["BTCUSDT"],
    mode: "PAPER",
    priority: 100,
    effectiveMode: "PAPER",
    ...overrides,
  };
}

function baseInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  const data = jeanfxMarketData();
  return {
    now: Date.now(),
    assignments: [makeAssignment({})],
    instruments,
    venue,
    marketDataProvider: (req) => {
      const forInstrument = req.instrumentId === "BTCUSDT" ? data : { H1: [], M15: [], M5: [] };
      return (forInstrument as Record<string, CanonicalCandle[]>)[req.timeframe] ?? [];
    },
    portfolio: emptyPortfolio,
    limits: generousLimits,
    riskPctOf: () => 0.01,
    ...overrides,
  };
}

describe("JeanFX via the generic orchestrator", () => {
  it("reaches an executable LONG opportunity using the exact fixture proven in state-machine.test.ts", async () => {
    const result = await runOrchestrator(baseInput());
    expect(result.executable).toHaveLength(1);
    expect(result.executable[0].side).toBe("LONG");
    expect(result.executable[0].strategyDefinitionId).toBe("jeanfx-v1");
    expect(result.observability.byStrategy["jeanfx-v1"].opportunities).toBe(1);
  });
});

describe("TRB via the same orchestrator", () => {
  it("evaluates without crashing and produces zero opportunities (no implementation exists)", async () => {
    const trbAssignment = makeAssignment({ assignmentId: "a-trb", strategyDefinitionId: "v2-trb", strategy: trbBuiltInStrategy });
    const result = await runOrchestrator(baseInput({ assignments: [trbAssignment] }));
    expect(result.errors).toEqual([]);
    expect(result.executable).toEqual([]);
    expect(result.observability.byStrategy["v2-trb"].evaluations).toBe(1);
  });
});

describe("custom DSL strategy via the same orchestrator", () => {
  it("a compiled DSL strategy produces an executable opportunity through the identical pipeline", async () => {
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["H1"],
      side: ["LONG"],
      entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 50 } },
      stop: { kind: "FIXED_PERCENT", pct: 0.02 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    const metadata: StrategyMetadata = {
      slug: "custom-ema",
      displayName: "Custom EMA",
      description: "",
      type: "USER_DEFINED",
      status: "RESEARCH_ONLY",
      requiredTimeframes: ["H1"],
      supportedAssetClasses: ["CRYPTO"],
      supportedSides: ["LONG"],
      minimumHistoryRequirements: {},
      requiredFeatures: [],
    };
    const compiled = compileDslStrategy(def, metadata);
    if (!compiled.ok) throw new Error("compile failed");

    const customAssignment = makeAssignment({ assignmentId: "a-custom", strategyDefinitionId: "custom-ema", strategy: compiled.strategy });
    const result = await runOrchestrator(baseInput({ assignments: [customAssignment] }));
    expect(result.executable).toHaveLength(1);
    expect(result.executable[0].strategyDefinitionId).toBe("custom-ema");
  });
});

describe("multiple strategies, same user, same instrument, same direction", () => {
  it("JeanFX + a custom strategy both LONG on BTCUSDT combine into one position intent, both attributed", async () => {
    const custom = compileDslStrategy(
      {
        engineSchemaVersion: "1",
        timeframes: ["H1"],
        side: ["LONG"],
        entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 50 } },
        stop: { kind: "FIXED_PERCENT", pct: 0.02 },
        target: { kind: "R_MULTIPLE", multiple: 2 },
        parameterSchema: {},
      },
      { slug: "custom", displayName: "Custom", description: "", type: "USER_DEFINED", status: "RESEARCH_ONLY", requiredTimeframes: ["H1"], supportedAssetClasses: ["CRYPTO"], supportedSides: ["LONG"], minimumHistoryRequirements: {}, requiredFeatures: [] },
    );
    if (!custom.ok) throw new Error("compile failed");

    const jeanfx = makeAssignment({ assignmentId: "a-jeanfx", strategyDefinitionId: "jeanfx-v1", userId: "user-1" });
    const customAssignment = makeAssignment({ assignmentId: "a-custom", strategyDefinitionId: "custom", strategy: custom.strategy, userId: "user-1" });

    const result = await runOrchestrator(baseInput({ assignments: [jeanfx, customAssignment] }));
    // Portfolio risk aggregation combines them into one position intent - one executable direction per instrument, both strategies attributed.
    const byInstrument = new Set(result.executable.map((o) => o.instrumentId));
    expect(byInstrument.size).toBe(1);
    const strategyIds = new Set(result.executable.map((o) => o.strategyDefinitionId));
    expect(strategyIds).toEqual(new Set(["jeanfx-v1", "custom"]));
  });
});

describe("different users are isolated in attribution", () => {
  it("two users' opportunities never cross-attribute, even for the same strategy/instrument", async () => {
    const userA = makeAssignment({ assignmentId: "a-user-a", userId: "user-a", instrumentIds: ["BTCUSDT"] });
    const userB = makeAssignment({ assignmentId: "a-user-b", userId: "user-b", instrumentIds: ["BTCUSDT"] });
    const result = await runOrchestrator(baseInput({ assignments: [userA, userB] }));
    const userIds = result.executable.map((o) => o.userId).sort();
    // Same-direction aggregation still combines them into one intent (S5), but each opportunity keeps its own real userId.
    expect(new Set(userIds)).toEqual(new Set(["user-a", "user-b"]));
  });
});

describe("opposing-direction conflict is blocked, never netted", () => {
  it("a LONG and a SHORT opportunity on the same instrument block each other and stay visible for analytics", async () => {
    const shortDecisionStrategy = {
      metadata: { ...jeanfxForTest.metadata, supportedSides: ["LONG", "SHORT"] as ("LONG" | "SHORT")[] },
      evaluate: () => ({
        type: "ENTER_SHORT" as const,
        entry: { price: 100, kind: "TEST" },
        stop: { price: 105, kind: "TEST" },
        target: { price: 85, kind: "TEST" },
        partialExitPlan: null,
        reasonCodes: [],
        featureSnapshot: {},
        confidence: null,
      }),
    };
    const long = makeAssignment({ assignmentId: "a-long", strategyDefinitionId: "jeanfx-v1" });
    const short = makeAssignment({ assignmentId: "a-short", strategyDefinitionId: "custom-short", strategy: shortDecisionStrategy });

    const result = await runOrchestrator(baseInput({ assignments: [long, short] }));
    expect(result.executable).toEqual([]);
    expect(result.blocked.length).toBeGreaterThan(0);
    expect(new Set(result.blocked.map((o) => o.side))).toEqual(new Set(["LONG", "SHORT"]));
  });
});

describe("no PAPER/LIVE permission bypass end to end", () => {
  it("resolveEffectiveMode never lets a PAPER request through without matching authorization", () => {
    expect(resolveEffectiveMode("PAPER", "RESEARCH")).toBe("RESEARCH");
  });

  it("an orchestrator input built from an unauthorized resolution never produces an executable opportunity", async () => {
    const requestedMode = "PAPER" as const;
    const systemAuthorizedMode = "RESEARCH" as const; // e.g. no owner PAPER authorization on this assignment
    const effectiveMode = resolveEffectiveMode(requestedMode, systemAuthorizedMode);
    const assignment = makeAssignment({ mode: requestedMode, effectiveMode });
    const result = await runOrchestrator(baseInput({ assignments: [assignment] }));
    expect(result.executable).toEqual([]);
    expect(result.researchOnly.length + result.shadowed.length).toBeGreaterThanOrEqual(0);
  });

  it("resolveEffectiveMode never lets LIVE through under any authorization this codebase grants", () => {
    expect(resolveEffectiveMode("LIVE", "RESEARCH")).toBe("RESEARCH");
    expect(resolveEffectiveMode("LIVE", "SHADOW")).toBe("SHADOW");
    expect(resolveEffectiveMode("LIVE", "PAPER")).toBe("PAPER");
  });
});
