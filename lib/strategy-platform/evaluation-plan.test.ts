import { describe, expect, it, vi } from "vitest";
import { buildEvaluationPlan, distributeMarketData, loadMarketData } from "./evaluation-plan";
import type { AssignmentInput } from "./orchestrator-types";
import type { CanonicalCandle, StrategyContract } from "./types";

function fakeStrategy(requiredTimeframes: ("H1" | "M15" | "M5")[]): StrategyContract {
  return {
    metadata: {
      slug: "fake",
      displayName: "Fake",
      description: "",
      type: "BUILT_IN",
      status: "RESEARCH_ONLY",
      requiredTimeframes,
      supportedAssetClasses: ["CRYPTO"],
      supportedSides: ["LONG"],
      minimumHistoryRequirements: {},
      requiredFeatures: [],
    },
    evaluate: () => ({ type: "NO_ACTION", reason: "test" }),
  };
}

function assignment(overrides: Partial<AssignmentInput>): AssignmentInput {
  return {
    assignmentId: "a-1",
    userId: "u-1",
    strategyConfigurationId: "c-1",
    strategyVersionId: "v-1",
    strategyDefinitionId: "d-1",
    strategy: fakeStrategy(["H1"]),
    parameters: {},
    instrumentIds: ["BTCUSDT"],
    mode: "RESEARCH",
    priority: 100,
    effectiveMode: "RESEARCH",
    ...overrides,
  };
}

describe("buildEvaluationPlan - dedupe", () => {
  it("two assignments needing the same instrument+timeframe produce one requirement, not two", () => {
    const jeanfx = assignment({ assignmentId: "a-1", strategy: fakeStrategy(["H1"]), instrumentIds: ["BTCUSDT"] });
    const custom = assignment({ assignmentId: "a-2", strategy: fakeStrategy(["H1"]), instrumentIds: ["BTCUSDT"] });
    const plan = buildEvaluationPlan([jeanfx, custom]);
    expect(plan).toEqual([{ instrumentId: "BTCUSDT", timeframe: "H1" }]);
  });

  it("distinct instruments and timeframes each get their own requirement", () => {
    const a = assignment({ assignmentId: "a-1", strategy: fakeStrategy(["H1", "M15"]), instrumentIds: ["BTCUSDT", "ETHUSDT"] });
    const plan = buildEvaluationPlan([a]);
    expect(plan).toHaveLength(4);
    expect(plan).toEqual(
      expect.arrayContaining([
        { instrumentId: "BTCUSDT", timeframe: "H1" },
        { instrumentId: "BTCUSDT", timeframe: "M15" },
        { instrumentId: "ETHUSDT", timeframe: "H1" },
        { instrumentId: "ETHUSDT", timeframe: "M15" },
      ]),
    );
  });
});

describe("loadMarketData - one provider call per distinct requirement", () => {
  it("never calls the provider twice for the same requirement", async () => {
    const jeanfx = assignment({ assignmentId: "a-1", strategy: fakeStrategy(["H1"]), instrumentIds: ["BTCUSDT"] });
    const custom = assignment({ assignmentId: "a-2", strategy: fakeStrategy(["H1"]), instrumentIds: ["BTCUSDT"] });
    const plan = buildEvaluationPlan([jeanfx, custom]);

    const provider = vi.fn(() => [] as CanonicalCandle[]);
    await loadMarketData(plan, provider);

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("distributes the same loaded candles to every consumer without re-fetching", async () => {
    const candle: CanonicalCandle = { instrumentId: "BTCUSDT", timeframe: "H1", openTime: 0, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true };
    const provider = vi.fn(() => [candle]);
    const loaded = await loadMarketData([{ instrumentId: "BTCUSDT", timeframe: "H1" }], provider);

    const forJeanfx = distributeMarketData(loaded, "BTCUSDT", ["H1"]);
    const forCustom = distributeMarketData(loaded, "BTCUSDT", ["H1"]);
    expect(forJeanfx.H1).toEqual([candle]);
    expect(forCustom.H1).toEqual([candle]);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("an instrument/timeframe with no loaded data distributes an empty array, not a crash", () => {
    const loaded = new Map();
    expect(distributeMarketData(loaded, "BTCUSDT", ["H1"])).toEqual({ H1: [] });
  });
});
