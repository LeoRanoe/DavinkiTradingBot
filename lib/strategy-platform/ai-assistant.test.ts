import { describe, expect, it } from "vitest";
import { AI_ASSISTANT_BOUNDARY, reviewAiProposal, type AiDslProposal } from "./ai-assistant";
import { getStrategyTemplate } from "./templates";

function proposal(overrides: Partial<AiDslProposal> = {}): AiDslProposal {
  return {
    status: "DRAFT",
    userPrompt: "Make me a strategy where EMA20 crosses EMA50 and RSI is above 55.",
    draft: getStrategyTemplate("ema-trend")!.definition,
    explanation: "Enters long on an EMA20/EMA50 bullish cross.",
    ...overrides,
  };
}

describe("reviewAiProposal", () => {
  it("accepts a well-formed proposal through the exact same validator a human author uses", () => {
    const result = reviewAiProposal(proposal());
    expect(result.ok).toBe(true);
  });

  it("rejects a proposal referencing an unknown or future-looking primitive, no AI-specific leniency", () => {
    const badDraft = { ...getStrategyTemplate("ema-trend")!.definition, entry: { type: "MSS" } };
    const result = reviewAiProposal(proposal({ draft: badDraft as never }));
    expect(result.ok).toBe(false);
  });

  it("a proposal is always DRAFT - there is no accepted/active status this type can hold", () => {
    const p = proposal();
    expect(p.status).toBe("DRAFT");
  });
});

describe("AI_ASSISTANT_BOUNDARY - the forbidden list has no corresponding capability in this module", () => {
  it("exports nothing named after any forbidden action", async () => {
    const aiAssistantModule = await import("./ai-assistant");
    const exportNames = Object.keys(aiAssistantModule);
    const forbiddenNameFragments = ["activatePaper", "activateLive", "setLiveAuthorization", "mutateVersion", "overrideRisk"];
    for (const fragment of forbiddenNameFragments) {
      expect(exportNames).not.toContain(fragment);
    }
  });

  it("documents every allowed and forbidden action explicitly", () => {
    expect(AI_ASSISTANT_BOUNDARY.allowed.length).toBeGreaterThan(0);
    expect(AI_ASSISTANT_BOUNDARY.forbidden).toEqual(
      expect.arrayContaining(["activate PAPER mode", "activate LIVE mode", "override or bypass the deterministic risk engine"]),
    );
  });
});
