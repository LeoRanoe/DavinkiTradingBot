import { describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATES, cloneDefinition, getStrategyTemplate } from "./templates";
import { validateDslDefinition } from "./dsl/validate";

describe("strategy templates", () => {
  it("every template is a valid, deterministic DslDefinition", () => {
    for (const template of STRATEGY_TEMPLATES) {
      const result = validateDslDefinition(template.definition);
      expect(result.ok, `${template.id}: ${!result.ok && result.errors.join(", ")}`).toBe(true);
    }
  });

  it("has the three named starter templates, clearly labeled (not built-ins)", () => {
    const ids = STRATEGY_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["ema-trend", "rsi-pullback", "breakout"]));
  });

  it("getStrategyTemplate resolves by id and returns undefined for an unknown one", () => {
    expect(getStrategyTemplate("ema-trend")?.name).toBe("EMA Trend");
    expect(getStrategyTemplate("does-not-exist")).toBeUndefined();
  });

  it("cloneDefinition never mutates the source (duplicate-as-custom-strategy safety)", () => {
    const template = getStrategyTemplate("ema-trend")!;
    const clone = cloneDefinition(template.definition);
    (clone as { timeframes: string[] }).timeframes.push("M5");
    expect(template.definition.timeframes).not.toContain("M5");
  });
});
