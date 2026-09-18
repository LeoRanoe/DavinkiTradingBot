import { describe, expect, it } from "vitest";
import { buildGoldInstrument, GOLD_INSTRUMENT_ID, GOLD_PIP_SIZE } from "./instrument";

describe("buildGoldInstrument", () => {
  it("produces the canonical METAL:<PROVIDER>:XAU/USD id with a METAL asset class", () => {
    const instrument = buildGoldInstrument();
    expect(instrument.id).toBe(GOLD_INSTRUMENT_ID);
    expect(instrument.id).toMatch(/^METAL:[A-Z]+:XAU\/USD$/);
    expect(instrument.assetClass).toBe("METAL");
    expect(instrument.pipSize).toBe(GOLD_PIP_SIZE);
  });
});
