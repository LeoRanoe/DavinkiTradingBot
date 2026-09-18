import { describe, expect, it } from "vitest";
import { describeDslDefinition } from "./describe";
import { getStrategyTemplate } from "../templates";

describe("describeDslDefinition", () => {
  it("produces a readable plain-English summary for the EMA Trend template", () => {
    const summary = describeDslDefinition(getStrategyTemplate("ema-trend")!.definition);
    expect(summary).toContain("Trades LONG");
    expect(summary).toContain("crosses above");
    expect(summary).toContain("ATR");
    expect(summary).toContain("2R");
  });

  it("renders nested ALL/ANY groups with indentation, not raw JSON", () => {
    const summary = describeDslDefinition(getStrategyTemplate("rsi-pullback")!.definition);
    expect(summary).toContain("all of:");
    expect(summary).not.toContain("{");
  });

  it("never throws for any of the starter templates", () => {
    for (const t of ["ema-trend", "rsi-pullback", "breakout"]) {
      expect(() => describeDslDefinition(getStrategyTemplate(t)!.definition)).not.toThrow();
    }
  });
});
