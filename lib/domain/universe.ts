import type { AssetClass, Instrument, InstrumentId, VenueId } from "./instrument";
import type { ResearchEligibilityStatus } from "./eligibility";

/**
 * Research-universe domain types (CLAUDE.md §12/§14, Checkpoint 2 §4/§5).
 *
 * `purpose` on UniverseDefinition is an ORGANIZATIONAL LABEL ONLY — it never
 * authorizes anything. The only things that authorize an instrument for a
 * capability are the explicit booleans on UniverseMember. This is the
 * "safer model" called for in Checkpoint 2 §4: you cannot accidentally grant
 * PAPER by mislabeling a universe's purpose "PRODUCTION".
 *
 * LIVE is not a boolean here at all — see `UniverseMember`, which has no
 * `liveEnabled` field. There is no such column on any table in the
 * proposed migration either — nothing exists for any future code to read
 * as true, which is a different (and stronger) statement than "a column
 * exists and is CHECKed false" (Checkpoint 2 review §9).
 *
 * `paperEnabled` on UniverseMember has NO permanent CHECK forcing it false
 * — unlike LIVE, a legitimate future owner-approved PAPER promotion must be
 * able to set it true, so such a CHECK would be wrong, not extra safety.
 * What keeps it false today: the seed/default is false for every current
 * row, `UniverseRepository.setMemberFlags` deliberately cannot set it at
 * all (final pre-apply guardrail patch §6 — see that method's doc comment),
 * and no execution consumer exists yet (no strategy v2+ reads this column).
 * See the migration file for the full statement.
 */
export type UniversePurpose = "PRODUCTION" | "PAPER" | "SHADOW" | "HISTORICAL";

export type UniverseDefinition = {
  id: string;
  key: string; // e.g. "crypto-core"
  name: string;
  purpose: UniversePurpose;
  assetClass: AssetClass;
  venueId: VenueId | null;
  enabled: boolean;
};

export type UniverseMember = {
  universeId: string;
  instrument: Instrument;
  researchEnabled: boolean;
  shadowEnabled: boolean;
  /** See the paperEnabled note above — no permanent CHECK forces this false. */
  paperEnabled: boolean;
  /**
   * Checkpoint 2 review §2/§8: defaults to "UNKNOWN" / null for a member
   * with no `instrument_research_eligibility` row at all — never assume
   * ELIGIBLE by omission.
   */
  eligibilityStatus: ResearchEligibilityStatus;
  /**
   * Null until an actual runtime provider verification has run
   * (Checkpoint 2 review §1). A manual/web venue confirmation never
   * populates this — see docs/BUILD_STATE.md "MANUAL VENUE EVIDENCE vs
   * RUNTIME PROVIDER VERIFICATION".
   */
  eligibilityCheckedAt: number | null;
};

/**
 * Generic research-universe API (CLAUDE.md §14): callers ask for a
 * universe by key and get canonical Instrument objects — never venue
 * symbol strings, never a hardcoded array. No strategy may import this and
 * then branch on `venueSymbol` (see lib/domain/instrument.ts §3 rule).
 */
export interface UniverseRepository {
  listInstruments(): Promise<Instrument[]>;
  getInstrument(instrumentId: InstrumentId): Promise<Instrument | null>;
  listUniverses(): Promise<UniverseDefinition[]>;
  getUniverse(key: string): Promise<UniverseDefinition | null>;
  /** All members of a universe in one batched call — never N+1 per instrument. */
  listUniverseMembers(universeKey: string): Promise<UniverseMember[]>;
  /**
   * Instruments the OWNER HAS SELECTED for research in this universe
   * (`member.researchEnabled = true`) — regardless of eligibility status.
   * This exists so UI/config can still show an UNKNOWN or even INELIGIBLE
   * instrument the owner has chosen to track. It is deliberately NOT the
   * "safe to actually run a trial on" set — use `getEligibleResearchUniverse`
   * for that (Checkpoint 2 review §2: selection and eligibility are
   * different questions and must not be conflated).
   */
  getResearchUniverse(universeKey: string): Promise<Instrument[]>;
  /**
   * FAIL-CLOSED: instruments a future historical/shadow strategy may
   * actually consume. Requires ALL of: the universe itself is enabled,
   * the member is research-selected, the instrument is active, AND
   * `instrument_research_eligibility.status = 'ELIGIBLE'`. An UNKNOWN or
   * INELIGIBLE instrument — however research-selected — is excluded. No
   * strategy should ever be able to mistake "the owner picked this for
   * research" for "this has actually passed eligibility".
   */
  getEligibleResearchUniverse(universeKey: string): Promise<Instrument[]>;
  /**
   * Owner-only in practice (enforced by RLS + route auth, not here).
   *
   * Final pre-apply guardrail patch §6: deliberately does NOT accept
   * `paperEnabled`. PAPER promotion is not a generic flag flip alongside
   * research/shadow selection - it is the one setting with an actual
   * execution consequence once a generic-pipeline strategy exists, so it
   * needs its own dedicated, more heavily guarded path (analogous to
   * `strategy_versions.status` moving to `PAPER_APPROVED`) rather than
   * riding through the same call as "the owner ticked a research
   * checkbox". No such dedicated path exists yet in this checkpoint -
   * `paper_enabled` stays false for everything until one is built.
   */
  setMemberFlags(
    universeKey: string,
    instrumentId: InstrumentId,
    flags: Partial<Pick<UniverseMember, "researchEnabled" | "shadowEnabled">>,
  ): Promise<void>;
}

/**
 * Pure, repository-independent filter implementing the fail-closed rule
 * above. Both InMemoryUniverseRepository and SupabaseUniverseRepository
 * call this rather than each re-implementing the same four-way AND, so the
 * rule can't drift between implementations.
 */
export function selectEligibleResearchInstruments(
  universe: UniverseDefinition | null,
  members: readonly UniverseMember[],
): Instrument[] {
  if (!universe || !universe.enabled) return [];
  return members
    .filter(
      (m) =>
        m.researchEnabled &&
        m.instrument.isActive &&
        m.eligibilityStatus === "ELIGIBLE" &&
        // Final pre-apply guardrail patch §1: an ELIGIBLE row with no
        // checked_at is a data bug (the DB CHECK
        // eligibility_checked_at_required_when_eligible should prevent it
        // from existing at all), not a case to trust anyway. Fail closed
        // rather than assume a null timestamp still means "verified".
        m.eligibilityCheckedAt !== null,
    )
    .map((m) => m.instrument);
}

/**
 * In-memory implementation: the safe default while no DB tables exist yet
 * (Checkpoint 2's migration is NOT applied — see docs/BUILD_STATE.md). Also
 * doubles as the fixture repository for tests. Never used by any
 * production route.
 */
export class InMemoryUniverseRepository implements UniverseRepository {
  private readonly universes = new Map<string, UniverseDefinition>();
  private readonly members = new Map<string, UniverseMember[]>(); // key -> members
  private readonly instrumentsById = new Map<InstrumentId, Instrument>();

  seedUniverse(def: UniverseDefinition, members: UniverseMember[]): void {
    this.universes.set(def.key, def);
    this.members.set(def.key, members);
    for (const m of members) this.instrumentsById.set(m.instrument.id, m.instrument);
  }

  async listInstruments(): Promise<Instrument[]> {
    return [...this.instrumentsById.values()];
  }

  async getInstrument(instrumentId: InstrumentId): Promise<Instrument | null> {
    return this.instrumentsById.get(instrumentId) ?? null;
  }

  async listUniverses(): Promise<UniverseDefinition[]> {
    return [...this.universes.values()];
  }

  async getUniverse(key: string): Promise<UniverseDefinition | null> {
    return this.universes.get(key) ?? null;
  }

  async listUniverseMembers(universeKey: string): Promise<UniverseMember[]> {
    return this.members.get(universeKey) ?? [];
  }

  async getResearchUniverse(universeKey: string): Promise<Instrument[]> {
    const members = await this.listUniverseMembers(universeKey);
    return members.filter((m) => m.researchEnabled).map((m) => m.instrument);
  }

  async getEligibleResearchUniverse(universeKey: string): Promise<Instrument[]> {
    const universe = await this.getUniverse(universeKey);
    const members = await this.listUniverseMembers(universeKey);
    return selectEligibleResearchInstruments(universe, members);
  }

  async setMemberFlags(
    universeKey: string,
    instrumentId: InstrumentId,
    flags: Partial<Pick<UniverseMember, "researchEnabled" | "shadowEnabled">>,
  ): Promise<void> {
    const list = this.members.get(universeKey);
    if (!list) throw new Error(`Unknown universe: ${universeKey}`);
    const idx = list.findIndex((m) => m.instrument.id === instrumentId);
    if (idx === -1) throw new Error(`Instrument ${instrumentId} is not a member of ${universeKey}`);
    list[idx] = { ...list[idx], ...flags };
  }

  /**
   * Test/fixture helper standing in for a real runtime provider
   * verification writing `instrument_research_eligibility`. `checkedAt`
   * must be an explicit timestamp supplied by the caller — this method
   * never stamps `Date.now()` itself, so a test (or a future real caller)
   * can prove the null → populated transition happens only on an actual
   * check, never implicitly.
   */
  async setEligibility(
    universeKey: string,
    instrumentId: InstrumentId,
    status: ResearchEligibilityStatus,
    checkedAt: number | null,
  ): Promise<void> {
    const list = this.members.get(universeKey);
    if (!list) throw new Error(`Unknown universe: ${universeKey}`);
    const idx = list.findIndex((m) => m.instrument.id === instrumentId);
    if (idx === -1) throw new Error(`Instrument ${instrumentId} is not a member of ${universeKey}`);
    list[idx] = { ...list[idx], eligibilityStatus: status, eligibilityCheckedAt: checkedAt };
  }
}
