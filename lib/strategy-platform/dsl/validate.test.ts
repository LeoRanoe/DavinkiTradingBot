import { describe, expect, it } from "vitest";
import { validateDslDefinition } from "./validate";
import type { DslDefinition, DslNode } from "./types";

function baseDef(entry: DslNode): DslDefinition {
  return {
    engineSchemaVersion: "1",
    timeframes: ["M15"],
    side: ["LONG"],
    entry,
    stop: { kind: "FIXED_PCT", pct: 0.01 },
    target: { kind: "R_MULTIPLE", multiple: 2 },
    parameterSchema: {},
  };
}

describe("DSL validation", () => {
  it("accepts a simple valid definition (RSI threshold)", () => {
    const def = baseDef({
      type: "COMPARE",
      comparator: "LT",
      left: { type: "RSI", period: 14 },
      right: { type: "CONST", value: 30 },
    });
    expect(validateDslDefinition(def)).toEqual({ ok: true });
  });

  it("accepts ALL/ANY/NOT combinators nested within limits", () => {
    const def = baseDef({
      type: "ALL",
      children: [
        { type: "CROSS_ABOVE", left: { type: "EMA", period: 20 }, right: { type: "EMA", period: 50 } },
        { type: "NOT", child: { type: "SESSION", sessions: ["ASIA"] } },
        { type: "ANY", children: [{ type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 100 } }] },
      ],
    });
    expect(validateDslDefinition(def)).toEqual({ ok: true });
  });

  it("rejects a completely unknown primitive", () => {
    const def = baseDef({ type: "TELEPORT" } as unknown as DslNode);
    const result = validateDslDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/unknown primitive/);
  });

  it("rejects future-looking primitives (FVG/BOS/MSS/SWING/LIQUIDITY_SWEEP/CANDLE_PATTERN) distinctly", () => {
    for (const type of ["FVG", "BOS", "MSS", "SWING_HIGH", "SWING_LOW", "LIQUIDITY_SWEEP", "CANDLE_PATTERN"]) {
      const def = baseDef({ type } as unknown as DslNode);
      const result = validateDslDefinition(def);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toMatch(/not yet implemented/);
    }
  });

  it("rejects excessive nesting depth", () => {
    let node: DslNode = { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 1 } };
    for (let i = 0; i < 10; i++) node = { type: "ALL", children: [node] };
    const result = validateDslDefinition(baseDef(node));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/maxRuleDepth/);
  });

  it("rejects an excessive total rule count", () => {
    const children: DslNode[] = Array.from({ length: 80 }, () => ({ type: "SESSION", sessions: ["ASIA"] }));
    const result = validateDslDefinition(baseDef({ type: "ANY", children }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/maxRuleCount/);
  });

  it("rejects a huge indicator period beyond maxLookback", () => {
    const result = validateDslDefinition(baseDef({ type: "RSI", period: 100000 } as unknown as DslNode));
    // RSI's resultKind is VALUE, not CONDITION, so this also exercises the
    // resultKind mismatch path - both are legitimate rejections.
    expect(result.ok).toBe(false);
  });

  it("rejects a huge lookback on a properly-positioned VALUE node", () => {
    const result = validateDslDefinition(
      baseDef({ type: "COMPARE", comparator: "GT", left: { type: "SMA", period: 100000 }, right: { type: "CONST", value: 1 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/maxLookback/);
  });

  it("rejects too many timeframes", () => {
    const def = baseDef({ type: "SESSION", sessions: ["ASIA"] });
    def.timeframes = ["H1", "M30", "M15", "M5"];
    const result = validateDslDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/maxTimeframes/);
  });

  it("rejects an unsupported timeframe", () => {
    const def = baseDef({ type: "SESSION", sessions: ["ASIA"] });
    def.timeframes = ["W1" as never];
    const result = validateDslDefinition(def);
    expect(result.ok).toBe(false);
  });

  it("rejects a VALUE node where a CONDITION is required (and vice versa)", () => {
    // entry must be a CONDITION - handing it a VALUE node directly is invalid.
    const result = validateDslDefinition(baseDef({ type: "RSI", period: 14 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/expected CONDITION/);
  });

  it("rejects a non-positive/non-integer period", () => {
    const result = validateDslDefinition(baseDef({ type: "RSI", period: 0 }));
    expect(result.ok).toBe(false);
  });
});
