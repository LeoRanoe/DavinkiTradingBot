import { describe, expect, it } from "vitest";
import { sma, latestSma } from "./sma";

describe("sma", () => {
  it("computes a trailing simple average once the window is full", () => {
    const values = [1, 2, 3, 4, 5];
    const result = sma(values, 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo((1 + 2 + 3) / 3);
    expect(result[3]).toBeCloseTo((2 + 3 + 4) / 3);
    expect(result[4]).toBeCloseTo((3 + 4 + 5) / 3);
  });

  it("returns null via latestSma when not enough data", () => {
    expect(latestSma([1, 2], 5)).toBeNull();
  });

  it("throws on a non-positive period", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
  });
});
