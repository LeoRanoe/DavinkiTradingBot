import { describe, expect, it } from "vitest";
import { selectOpportunities, type Opportunity } from "../opportunity";

function op(instrumentId: string, strength: number): Opportunity {
  return {
    strategyVersion: "v2-trb",
    instrumentId,
    timestamp: 0,
    side: "LONG",
    strength,
    entryModel: { price: 1 },
    initialStop: { price: 0.9 },
    reason: "test",
  };
}

describe("selectOpportunities", () => {
  it("picks the strongest opportunities regardless of input array order (no first-symbol-wins)", () => {
    const forward = [op("A", 1), op("B", 3), op("C", 2)];
    const reversed = [op("C", 2), op("B", 3), op("A", 1)];

    const selForward = selectOpportunities(forward, 1);
    const selReversed = selectOpportunities(reversed, 1);

    expect(selForward.map((o) => o.instrumentId)).toEqual(["B"]);
    expect(selReversed.map((o) => o.instrumentId)).toEqual(["B"]);
  });

  it("breaks exact ties deterministically by instrumentId, not by array position", () => {
    const forward = [op("Z", 5), op("A", 5)];
    const reversed = [op("A", 5), op("Z", 5)];
    expect(selectOpportunities(forward, 1)[0].instrumentId).toBe("A");
    expect(selectOpportunities(reversed, 1)[0].instrumentId).toBe("A");
  });

  it("never returns more than maxSelections", () => {
    const many = [op("A", 1), op("B", 2), op("C", 3)];
    expect(selectOpportunities(many, 2)).toHaveLength(2);
  });
});
