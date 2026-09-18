import { describe, expect, it } from "vitest";
import { candle } from "./__fixtures__/candle";
import { breaksStructure, detectStructureEvent } from "./structure";
import type { SwingPoint } from "./swings";

const swingHigh: SwingPoint = { kind: "SWING_HIGH", candleTime: 0, price: 100, index: 0 };
const swingLow: SwingPoint = { kind: "SWING_LOW", candleTime: 0, price: 100, index: 0 };

describe("BOS/MSS structure break (verbatim brief definition)", () => {
  it("a bullish break requires a CLOSE beyond the swing high, not just a wick", () => {
    expect(breaksStructure(candle({ openTime: 1, high: 105, close: 99 }), "LONG", swingHigh)).toBe(false);
    expect(breaksStructure(candle({ openTime: 1, close: 101 }), "LONG", swingHigh)).toBe(true);
  });

  it("a bearish break requires a close below the swing low", () => {
    expect(breaksStructure(candle({ openTime: 1, low: 95, close: 101 }), "SHORT", swingLow)).toBe(false);
    expect(breaksStructure(candle({ openTime: 1, close: 99 }), "SHORT", swingLow)).toBe(true);
  });

  it("detectStructureEvent tags the requested kind (BOS vs MSS) without changing the break test itself", () => {
    const c = candle({ openTime: 5, close: 101 });
    const mss = detectStructureEvent(c, "LONG", swingHigh, "MSS");
    const bos = detectStructureEvent(c, "LONG", swingHigh, "BOS");
    expect(mss).toMatchObject({ kind: "MSS", direction: "LONG", confirmingCandleTime: 5 });
    expect(bos).toMatchObject({ kind: "BOS" });
    expect(mss?.brokenSwing).toBe(swingHigh);
  });

  it("returns null when the swing isn't broken", () => {
    expect(detectStructureEvent(candle({ openTime: 5, close: 99 }), "LONG", swingHigh, "MSS")).toBeNull();
  });
});
