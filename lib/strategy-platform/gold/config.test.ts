import { describe, expect, it } from "vitest";
import { JEANFX_GOLD_ACTIVE_CONFIG, JEANFX_GOLD_SELECTIVE_CONFIG, JEANFX_GOLD_RISK_LIMITS, selectGoldTimeframes } from "./config";
import { validateJeanfxUserConfig } from "@/lib/strategy/jeanfx-v1/config";

describe("JeanFX Gold configuration profiles", () => {
  it("ACTIVE defaults to M30 bias with London + New York sessions, never crypto-style ALL", () => {
    expect(JEANFX_GOLD_ACTIVE_CONFIG.biasTimeframe).toBe("M30");
    expect(JEANFX_GOLD_ACTIVE_CONFIG.sessionFilter).toBe("LONDON_AND_NEW_YORK");
    expect(JEANFX_GOLD_ACTIVE_CONFIG.sessionFilter).not.toBe("ALL");
    expect(JEANFX_GOLD_ACTIVE_CONFIG.riskPct).toBe(0.01);
  });

  it("SELECTIVE uses H1 bias with the same session/risk discipline", () => {
    expect(JEANFX_GOLD_SELECTIVE_CONFIG.biasTimeframe).toBe("H1");
    expect(JEANFX_GOLD_SELECTIVE_CONFIG.sessionFilter).toBe("LONDON_AND_NEW_YORK");
    expect(JEANFX_GOLD_SELECTIVE_CONFIG.riskPct).toBe(0.01);
  });

  it("both profiles validate cleanly against the strategy's own JeanfxUserConfig validator", () => {
    expect(validateJeanfxUserConfig(JEANFX_GOLD_ACTIVE_CONFIG).ok).toBe(true);
    expect(validateJeanfxUserConfig(JEANFX_GOLD_SELECTIVE_CONFIG).ok).toBe(true);
  });

  it("risk limits match the brief exactly: 1% max risk, RR >= 3.0, max 3 trades/session", () => {
    expect(JEANFX_GOLD_RISK_LIMITS).toEqual({ riskPctMax: 0.01, rrMinimum: 3.0, maxTradesPerSession: 3 });
  });
});

describe("selectGoldTimeframes - M30/M15/M5 (or H1/M15/M5) synchronization", () => {
  it("ACTIVE profile: bias=M30, structure=M15, entry=M5", () => {
    expect(selectGoldTimeframes(JEANFX_GOLD_ACTIVE_CONFIG)).toEqual({ bias: "M30", structure: "M15", entry: "M5" });
  });

  it("SELECTIVE profile: bias=H1, structure and entry unchanged", () => {
    expect(selectGoldTimeframes(JEANFX_GOLD_SELECTIVE_CONFIG)).toEqual({ bias: "H1", structure: "M15", entry: "M5" });
  });
});
