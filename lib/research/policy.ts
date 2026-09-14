/**
 * Effective execution policy.
 *
 * `system_settings.execution_policy` records what the owner CONFIGURED.
 * It is not, by itself, what the system DOES. AUTO is additionally
 * conditional on:
 *
 *   - trading mode being PAPER, and
 *   - a research window being active right now.
 *
 * So when the 14-day window elapses, automatic execution stops on the very
 * next evaluation - even if nothing has yet rewritten the stored column, even
 * if the reconciling scan never ran, and even if the row still says AUTO.
 * The stored value is reconciled back to APPROVAL_REQUIRED separately (see
 * the scanner's expiry handling), but correctness never depends on that
 * write having happened. Time alone is sufficient to end AUTO.
 *
 * Pure: `now` is always supplied by the caller.
 */

import type { ExecutionPolicy } from "@/lib/settings/risk-settings";
import { isResearchWindowActive, type ResearchWindow } from "./window";

export type EffectivePolicyInput = {
  configuredPolicy: ExecutionPolicy;
  tradingMode: string;
  researchWindow: ResearchWindow | null | undefined;
  now: number;
};

export type EffectivePolicyResult = {
  policy: ExecutionPolicy;
  /** True when the owner configured AUTO but it is not currently in force. */
  degraded: boolean;
  reason: string;
};

export function effectiveExecutionPolicy(input: EffectivePolicyInput): EffectivePolicyResult {
  const { configuredPolicy, tradingMode, researchWindow, now } = input;

  if (configuredPolicy !== "AUTO") {
    return {
      policy: "APPROVAL_REQUIRED",
      degraded: false,
      reason: "Approval required: qualified candidates are sent to Telegram for the owner to approve.",
    };
  }

  if (tradingMode !== "PAPER") {
    return {
      policy: "APPROVAL_REQUIRED",
      degraded: true,
      reason: `Automatic execution applies to PAPER only; current trading mode is ${tradingMode}.`,
    };
  }

  if (!isResearchWindowActive(researchWindow, now)) {
    return {
      policy: "APPROVAL_REQUIRED",
      degraded: true,
      reason:
        "The automatic PAPER research window is not active. Automatic execution has stopped and approval is required again.",
    };
  }

  return {
    policy: "AUTO",
    degraded: false,
    reason:
      "Automatic PAPER research execution is active. Candidates are executed by the same deterministic revalidation pipeline the owner's approval uses - no safety check is bypassed.",
  };
}

/** Convenience predicate for the scanner's per-candidate branch. */
export function isAutoExecutionActive(input: EffectivePolicyInput): boolean {
  return effectiveExecutionPolicy(input).policy === "AUTO";
}
