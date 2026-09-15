import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AssetClass, Instrument, InstrumentId, VenueId } from "../instrument";
import {
  selectEligibleResearchInstruments,
  type UniverseDefinition,
  type UniverseMember,
  type UniverseRepository,
  type UniversePurpose,
} from "../universe";
import type { ResearchEligibilityStatus } from "../eligibility";

/**
 * Supabase-backed UniverseRepository against the tables in
 * supabase/migrations/20260914130000_multi_market_universe.sql, applied to
 * the live project 2026-09-15 (see docs/BUILD_STATE.md "Checkpoint 2 —
 * migration applied"). Types below are now checked against the generated
 * `Database` type (lib/supabase/database.types.ts, regenerated from the
 * live schema after the apply) rather than hand-typed row shapes.
 *
 * NOT WIRED INTO ANY ROUTE YET — no scanner, job, or UI reads or writes
 * through this class. It exists as a proven, unit-tested repository ready
 * for Checkpoint 3+ to use.
 */

type InstrumentRow = Database["public"]["Tables"]["instruments"]["Row"];
type UniverseRow = Database["public"]["Tables"]["universes"]["Row"];
type EligibilityRow = Database["public"]["Tables"]["instrument_research_eligibility"]["Row"];

// The universe_members SELECT below only requests a subset of columns plus
// an embedded `instruments(*)` relation - the generated client type doesn't
// model that shape directly, so this is a Pick of the real columns (still
// checked against the generated Row, so a renamed/removed column fails
// typecheck) joined with the real InstrumentRow for the embed.
type UniverseMemberRow = Pick<
  Database["public"]["Tables"]["universe_members"]["Row"],
  "universe_id" | "instrument_id" | "research_enabled" | "shadow_enabled" | "paper_enabled"
> & {
  instruments: InstrumentRow;
};

function rowToInstrument(row: InstrumentRow): Instrument {
  return {
    id: row.canonical_id,
    assetClass: row.asset_class as AssetClass,
    venue: row.venue_id as VenueId,
    venueSymbol: row.venue_symbol,
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    settlementAsset: row.settlement_asset,
    priceIncrement: row.price_increment ?? undefined,
    sizeIncrement: row.size_increment ?? undefined,
    minSize: row.min_size ?? undefined,
    maxSize: row.max_size,
    contractMultiplier: row.contract_multiplier ?? undefined,
    pipSize: row.pip_size ?? undefined,
    lotSize: row.lot_size ?? undefined,
    allowsLong: row.allows_long,
    allowsShort: row.allows_short,
    tradingCalendarId: row.trading_calendar as Instrument["tradingCalendarId"],
    isActive: row.is_active,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function rowToUniverse(r: UniverseRow): UniverseDefinition {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    purpose: r.purpose as UniversePurpose,
    assetClass: r.asset_class as AssetClass,
    venueId: r.venue_id,
    enabled: r.enabled,
  };
}

export class SupabaseUniverseRepository implements UniverseRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listInstruments(): Promise<Instrument[]> {
    const { data, error } = await this.client.from("instruments").select("*").eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map(rowToInstrument);
  }

  async getInstrument(instrumentId: InstrumentId): Promise<Instrument | null> {
    const { data, error } = await this.client
      .from("instruments")
      .select("*")
      .eq("canonical_id", instrumentId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToInstrument(data) : null;
  }

  async listUniverses(): Promise<UniverseDefinition[]> {
    const { data, error } = await this.client.from("universes").select("*");
    if (error) throw error;
    return (data ?? []).map(rowToUniverse);
  }

  async getUniverse(key: string): Promise<UniverseDefinition | null> {
    const { data, error } = await this.client.from("universes").select("*").eq("key", key).maybeSingle();
    if (error) throw error;
    return data ? rowToUniverse(data) : null;
  }

  /**
   * Two batched queries total (members+instruments joined, then
   * eligibility filtered by the resulting instrument ids) — never one
   * query per instrument (Checkpoint 2 §13 - no N+1 as the universe grows
   * to 5, 20, 50 members). Eligibility isn't embedded in the same query
   * because there is no direct FK from `universe_members` to
   * `instrument_research_eligibility` (only via `instruments`), and a
   * second flat `.in()` query is simpler to reason about and test than a
   * two-level nested embed for the same O(1)-queries guarantee.
   */
  async listUniverseMembers(universeKey: string): Promise<UniverseMember[]> {
    const universe = await this.getUniverse(universeKey);
    if (!universe) return [];

    const { data, error } = await this.client
      .from("universe_members")
      .select("universe_id, instrument_id, research_enabled, shadow_enabled, paper_enabled, instruments(*)")
      .eq("universe_id", universe.id);
    if (error) throw error;

    const memberRows = (data ?? []) as unknown as UniverseMemberRow[];
    const instrumentIds = memberRows.map((r) => r.instrument_id);

    const eligibilityByInstrumentId = new Map<string, { status: ResearchEligibilityStatus; checkedAt: number | null }>();
    if (instrumentIds.length > 0) {
      const { data: eligibilityRows, error: eligibilityError } = await this.client
        .from("instrument_research_eligibility")
        .select("instrument_id, status, checked_at")
        .in("instrument_id", instrumentIds);
      if (eligibilityError) throw eligibilityError;
      for (const row of (eligibilityRows ?? []) as Pick<EligibilityRow, "instrument_id" | "status" | "checked_at">[]) {
        eligibilityByInstrumentId.set(row.instrument_id, {
          status: row.status as ResearchEligibilityStatus,
          checkedAt: row.checked_at ? new Date(row.checked_at).getTime() : null,
        });
      }
    }

    return memberRows.map((row) => {
      // No eligibility row at all defaults to UNKNOWN/null - never assume
      // ELIGIBLE by omission (Checkpoint 2 review §2).
      const eligibility = eligibilityByInstrumentId.get(row.instrument_id) ?? {
        status: "UNKNOWN" as ResearchEligibilityStatus,
        checkedAt: null,
      };
      return {
        universeId: row.universe_id,
        instrument: rowToInstrument(row.instruments),
        researchEnabled: row.research_enabled,
        shadowEnabled: row.shadow_enabled,
        paperEnabled: row.paper_enabled,
        eligibilityStatus: eligibility.status,
        eligibilityCheckedAt: eligibility.checkedAt,
      };
    });
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
    const universe = await this.getUniverse(universeKey);
    if (!universe) throw new Error(`Unknown universe: ${universeKey}`);

    // instrumentId is the canonical string id (Instrument.id); universe_members
    // FKs against instruments' internal uuid, so resolve that first rather
    // than matching the wrong column.
    const { data: instrumentRow, error: lookupError } = await this.client
      .from("instruments")
      .select("id")
      .eq("canonical_id", instrumentId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!instrumentRow) throw new Error(`Unknown instrument: ${instrumentId}`);

    const patch: Database["public"]["Tables"]["universe_members"]["Update"] = {};
    if (flags.researchEnabled !== undefined) patch.research_enabled = flags.researchEnabled;
    if (flags.shadowEnabled !== undefined) patch.shadow_enabled = flags.shadowEnabled;
    // paper_enabled is intentionally not settable here - see
    // UniverseRepository.setMemberFlags's doc comment (final pre-apply
    // guardrail patch §6).

    const { error } = await this.client
      .from("universe_members")
      .update(patch)
      .eq("universe_id", universe.id)
      .eq("instrument_id", instrumentRow.id);
    if (error) throw error;
  }
}
