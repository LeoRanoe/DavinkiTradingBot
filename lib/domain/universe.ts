import type { Instrument, InstrumentId } from "./instrument";

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
 * `liveEnabled` field. There is nothing for any future code to read as
 * true; the DB migration additionally CHECKs any such column false, as
 * defense in depth matching `system_settings.live_trading_enabled`.
 */
export type UniversePurpose = "PRODUCTION" | "PAPER" | "SHADOW" | "HISTORICAL";

export type UniverseDefinition = {
  id: string;
  key: string; // e.g. "crypto-core"
  name: string;
  purpose: UniversePurpose;
  enabled: boolean;
};

export type UniverseMember = {
  universeId: string;
  instrument: Instrument;
  researchEnabled: boolean;
  shadowEnabled: boolean;
  /**
   * Whether this instrument may open a PAPER position. Strategy V1's
   * current BTC/USDT + ETH/USDT PAPER trading is NOT driven by this flag —
   * it comes from the frozen `lib/strategy/v1/config.ts` list. This flag
   * only governs future generic-pipeline strategies (v2+), none of which
   * exist yet, so as of Checkpoint 2 no code reads it for authorization.
   */
  paperEnabled: boolean;
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
  /** Only instruments in the universe with researchEnabled = true. */
  getResearchUniverse(universeKey: string): Promise<Instrument[]>;
  /** Owner-only in practice (enforced by RLS + route auth, not here). */
  setMemberFlags(
    universeKey: string,
    instrumentId: InstrumentId,
    flags: Partial<Pick<UniverseMember, "researchEnabled" | "shadowEnabled" | "paperEnabled">>,
  ): Promise<void>;
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

  async setMemberFlags(
    universeKey: string,
    instrumentId: InstrumentId,
    flags: Partial<Pick<UniverseMember, "researchEnabled" | "shadowEnabled" | "paperEnabled">>,
  ): Promise<void> {
    const list = this.members.get(universeKey);
    if (!list) throw new Error(`Unknown universe: ${universeKey}`);
    const idx = list.findIndex((m) => m.instrument.id === instrumentId);
    if (idx === -1) throw new Error(`Instrument ${instrumentId} is not a member of ${universeKey}`);
    list[idx] = { ...list[idx], ...flags };
  }
}
