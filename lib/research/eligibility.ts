/**
 * The single authority on "may this strategy version execute right now?".
 *
 * Both the scanner (candidate generation) and the approval/revalidation path
 * call this. That is the whole point: if the two disagreed, the scanner could
 * advertise a candidate the executor would refuse, or - far worse - the
 * executor could open a position the scanner would never have proposed.
 *
 * Everything is a pure function of explicit inputs, including `now`.
 */

import { isResearchWindowActive, type ResearchWindow } from "./window";

/** Mirrors `strategy_versions.status`. Unknown values are treated as ineligible. */
export type StrategyStatus = "DRAFT" | "BACKTESTING" | "PAPER_APPROVED" | "DEMO_APPROVED" | "RETIRED" | (string & {});

export type EligibilityInput = {
  strategyStatus: StrategyStatus | null | undefined;
  tradingMode: string;
  researchWindow: ResearchWindow | null | undefined;
  now: number;
};

/**
 * Why a strategy is allowed to execute. This distinction is load-bearing and
 * is surfaced verbatim to the owner:
 *
 *   PAPER_APPROVED  - the strategy has a formal validation status. Permanent
 *                     until the owner changes it; independent of any window.
 *   PAPER_RESEARCH  - the strategy is still DRAFT. It is executing ONLY
 *                     because a time-boxed research window is open, and it
 *                     stops the moment that window ends. This is evidence
 *                     collection, NOT validation and NOT a profitability claim.
 */
export type EligibilityBasis = "PAPER_APPROVED" | "PAPER_RESEARCH";

export type EligibilityResult =
  | { eligible: true; basis: EligibilityBasis; detail: string }
  | { eligible: false; basis: null; detail: string };

const FORMALLY_APPROVED: ReadonlySet<string> = new Set(["PAPER_APPROVED", "DEMO_APPROVED"]);

/**
 * Rules, in order:
 *
 *   LIVE                                   -> ALWAYS false, unconditionally.
 *   PAPER_APPROVED / DEMO_APPROVED         -> eligible (no window needed).
 *   DRAFT + active PAPER research window   -> eligible, research basis only.
 *   DRAFT + no active window               -> not eligible.
 *   anything else (BACKTESTING, RETIRED)   -> not eligible.
 *
 * A research window can only ever unlock PAPER. It is not a general-purpose
 * override: the LIVE check is first and has no exception, so no combination
 * of window state and strategy status can produce a LIVE authorization here.
 */
export function isStrategyEligibleForPaper(input: EligibilityInput): EligibilityResult {
  const { strategyStatus, tradingMode, researchWindow, now } = input;

  // Checked first, before anything else can matter. LIVE is refused here, in
  // the risk engine, and by database CHECK constraints - three independent
  // layers, none of which may be removed.
  if (tradingMode === "LIVE") {
    return {
      eligible: false,
      basis: null,
      detail: "LIVE trading is permanently disabled in this build.",
    };
  }

  if (!strategyStatus) {
    return {
      eligible: false,
      basis: null,
      detail: "Strategy version has no recorded status; refusing to execute an unknown strategy.",
    };
  }

  if (FORMALLY_APPROVED.has(strategyStatus)) {
    return {
      eligible: true,
      basis: "PAPER_APPROVED",
      detail: `Strategy is ${strategyStatus} and is eligible independently of any research window.`,
    };
  }

  if (strategyStatus !== "DRAFT") {
    return {
      eligible: false,
      basis: null,
      detail: `Strategy status ${strategyStatus} is not eligible for execution.`,
    };
  }

  // DRAFT from here down. The ONLY route to execution is an open window, and
  // only in PAPER.
  if (tradingMode !== "PAPER") {
    return {
      eligible: false,
      basis: null,
      detail: `A DRAFT strategy may only execute in PAPER during a research window; current mode is ${tradingMode}.`,
    };
  }

  if (!isResearchWindowActive(researchWindow, now)) {
    return {
      eligible: false,
      basis: null,
      detail:
        "Strategy version is DRAFT and no PAPER research window is active. DRAFT is not executable outside an explicitly time-bounded research period.",
    };
  }

  return {
    eligible: true,
    basis: "PAPER_RESEARCH",
    detail:
      "Strategy version is DRAFT and executing under an active, time-bounded PAPER research window. This is evidence collection only - it does not mean the strategy is validated or profitable.",
  };
}

/**
 * Owner-facing label for the strategy's execution standing. Deliberately
 * never renders "PAPER_APPROVED" for a DRAFT strategy in a research window -
 * misreading research participation as approval is the exact confusion this
 * whole separation exists to prevent.
 */
export function describeStrategyStanding(result: EligibilityResult, strategyStatus: string | null | undefined): string {
  if (result.eligible && result.basis === "PAPER_RESEARCH") return `${strategyStatus} - research only`;
  if (result.eligible && result.basis === "PAPER_APPROVED") return String(strategyStatus);
  return `${strategyStatus ?? "UNKNOWN"} - not executable`;
}
