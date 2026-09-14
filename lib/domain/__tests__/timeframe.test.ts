import { describe, expect, it } from "vitest";
import { CANONICAL_TIMEFRAMES, isCanonicalTimeframe } from "../timeframe";

describe("canonical timeframes", () => {
  it("includes the full generic set, not just 15M/1H", () => {
    expect(CANONICAL_TIMEFRAMES).toEqual(["1M", "5M", "15M", "30M", "1H", "4H", "1D", "1W"]);
  });

  it("isCanonicalTimeframe is a proper type guard", () => {
    expect(isCanonicalTimeframe("1H")).toBe(true);
    expect(isCanonicalTimeframe("4H")).toBe(true);
    expect(isCanonicalTimeframe("2H")).toBe(false);
    expect(isCanonicalTimeframe("bogus")).toBe(false);
  });
});
