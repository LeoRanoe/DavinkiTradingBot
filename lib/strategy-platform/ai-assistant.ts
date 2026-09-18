import { validateDslDefinition } from "./dsl/validate";
import type { DslDefinition } from "./dsl/types";

/**
 * AI assistant boundary (Prompt 3 S24/S25). This is a CONTRACT/HOOK, not a
 * live integration - no LLM provider is called anywhere in this file. It
 * exists so that whenever an AI assistant is wired up (Qwen, per
 * CLAUDE.md's existing `lib/qwen/` integration pattern, or otherwise), it
 * has exactly one narrow door into the strategy platform, and that door
 * cannot bypass validation, ownership, or execution authorization -
 * mirroring CLAUDE.md's "Qwen/AI never decides trades" invariant one layer
 * up, for strategy *creation* instead of trade *execution*.
 *
 * Hard boundary (enforced by this module's shape, not just documented):
 *  - An AI proposal is always a `DslDefinition`, the same declarative,
 *    sandbox-free data shape a human author would produce - never
 *    generated code, never a live StrategyContract.
 *  - `reviewAiProposal()` is the ONLY way a proposal becomes usable, and it
 *    runs the exact same `validateDslDefinition()` any hand-authored
 *    strategy goes through - no separate, looser "AI path".
 *  - Nothing here ever writes to strategy_definitions/strategy_platform_versions
 *    or touches strategy_assignments.mode. Saving an accepted proposal is
 *    the ordinary strategy-creation flow (POST /api/strategies), which the
 *    signed-in user must explicitly trigger - an AiDslProposal cannot walk
 *    itself into the database, let alone into PAPER/LIVE.
 */

export type AiDslProposal = {
  /** Always DRAFT until a human explicitly saves it - see docs/user-strategies.md "AI assistant boundary". */
  status: "DRAFT";
  /** What the user asked for, verbatim - kept for audit/explainability, never re-interpreted by this module. */
  userPrompt: string;
  /** The proposed rules - untrusted input until reviewAiProposal() validates it. */
  draft: DslDefinition;
  /** Plain-language explanation of the proposal, for the UI preview - not itself validated logic. */
  explanation: string;
};

export type AiProposalReview = { ok: true; proposal: AiDslProposal } | { ok: false; errors: string[] };

/**
 * The single choke point between an AI-produced draft and anything the
 * platform will accept. Re-runs the identical validator a human-authored
 * strategy goes through (schema, primitive allow-list, depth/count/
 * lookback limits) - an AI proposal gets no leniency and no shortcut.
 */
export function reviewAiProposal(proposal: AiDslProposal): AiProposalReview {
  const validation = validateDslDefinition(proposal.draft);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return { ok: true, proposal };
}

/**
 * What an AI assistant is allowed to do in this system, restated as data
 * so it can be asserted in tests rather than only claimed in prose
 * (Prompt 3 S24). Every "must NOT" here has no corresponding function
 * anywhere in lib/strategy-platform/ai-assistant.ts - there is no
 * `activatePaper()`, no `setLiveAuthorization()`, no `mutateExistingVersion()`
 * exported from this module, by construction, not by convention alone.
 */
export const AI_ASSISTANT_BOUNDARY = {
  allowed: ["explain a strategy", "describe rules in plain language", "help build a DSL draft", "summarize a backtest result", "flag possible mistakes in a draft"],
  forbidden: [
    "silently modify an existing strategy version's rules",
    "change a saved configuration's parameters without the user's explicit save",
    "activate PAPER mode",
    "activate LIVE mode",
    "invent or fabricate market data",
    "override or bypass the deterministic risk engine",
  ],
} as const;
