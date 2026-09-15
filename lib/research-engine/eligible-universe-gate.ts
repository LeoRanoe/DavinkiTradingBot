import type { Instrument } from "@/lib/domain/instrument";
import type { UniverseRepository } from "@/lib/domain/universe";

/**
 * Checkpoint 3A §20-§22: the ONLY approved way a real historical trial
 * runner may obtain instruments to test is
 * `UniverseRepository.getEligibleResearchUniverse()` — never
 * `getResearchUniverse()` as a bypass (that returns owner-SELECTED
 * instruments regardless of eligibility status, including UNKNOWN ones).
 * This module exists so that rule has exactly one call site to audit,
 * rather than being re-implemented ad hoc wherever a trial runner is
 * eventually wired up.
 *
 * Unit tests for the strategy contract / engine itself are NOT required
 * to go through this gate — they may construct synthetic Instrument
 * objects directly (§22, explicitly allowed). This module is only for the
 * "real Checkpoint 3B historical run" path.
 */
export type ApprovedResearchInstrumentsResult = {
  eligibleInstruments: Instrument[];
  researchSelectedCount: number;
  blockedByEligibilityCount: number;
  report: string;
};

export async function getApprovedResearchInstruments(
  repository: UniverseRepository,
  universeKey: string,
): Promise<ApprovedResearchInstrumentsResult> {
  const [eligible, allMembers] = await Promise.all([
    repository.getEligibleResearchUniverse(universeKey),
    repository.listUniverseMembers(universeKey),
  ]);
  const researchSelected = allMembers.filter((m) => m.researchEnabled);
  const blockedByEligibilityCount = researchSelected.length - eligible.length;

  const report =
    eligible.length > 0
      ? `${eligible.length}/${researchSelected.length} research-selected instrument(s) are ELIGIBLE and may be used for a real historical trial.`
      : `0/${researchSelected.length} research-selected instrument(s) are ELIGIBLE yet. ` +
        `${blockedByEligibilityCount} blocked pending runtime provider verification ` +
        `(lib/domain/discovery/bybit-instrument-discovery.ts) - a manual/web confirmation of venue listing ` +
        `does not satisfy this. See docs/BUILD_STATE.md "MANUAL VENUE EVIDENCE vs RUNTIME PROVIDER VERIFICATION".`;

  return { eligibleInstruments: eligible, researchSelectedCount: researchSelected.length, blockedByEligibilityCount, report };
}
