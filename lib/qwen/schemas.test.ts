import { describe, expect, it } from "vitest";
import { qwenTradeReviewSchema } from "./schemas";

describe("Qwen post-trade review schema", () => {
  it("accepts only labelled interpretation/hypothesis structure", () => {
    expect(qwenTradeReviewSchema.safeParse({ summary: "Interpretation", observations: ["Possible late entry."], hypotheses: ["Test an entry-extension filter."], confidence: 0.4, dataLimitations: ["One trade is not evidence."] }).success).toBe(true);
    expect(qwenTradeReviewSchema.safeParse({ summary: "bad", notes: [], classification: "VALID_WIN" }).success).toBe(false);
  });
});
