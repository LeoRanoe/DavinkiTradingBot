import { describe, expect, it } from "vitest";
import { checkVolatility } from "./volatility";

describe("volatility protection (spec Milestone 1: deterministic, never Qwen's call)", () => {
  it("rejects when ATR/price exceeds the configured maximum", () => {
    expect(checkVolatility(0.08, { maxAtrPct: 0.05 })).toBe("EXCESSIVE_VOLATILITY");
  });

  it("allows a technically valid setup within the volatility band", () => {
    expect(checkVolatility(0.02, { maxAtrPct: 0.05 })).toBeNull();
  });

  it("does not reject on missing ATR data - that is an upstream score/regime concern", () => {
    expect(checkVolatility(null, { maxAtrPct: 0.05 })).toBeNull();
  });
});
