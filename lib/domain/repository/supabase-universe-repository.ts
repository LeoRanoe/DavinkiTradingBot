import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetClass, Instrument, InstrumentId, VenueId } from "../instrument";
import type { UniverseDefinition, UniverseMember, UniverseRepository, UniversePurpose } from "../universe";

/**
 * Supabase-backed UniverseRepository against the tables proposed in
 * supabase/migrations/20260914130000_multi_market_universe.sql.
 *
 * NOT WIRED INTO ANY ROUTE. That migration has not been applied to the
 * live project (Checkpoint 2 is schema-design-only per instruction — see
 * docs/BUILD_STATE.md). This class exists so the repository shape is
 * proven and unit-testable now; every test against it mocks the Supabase
 * client rather than hitting a real database.
 *
 * Deliberately untyped against `Database` (lib/supabase/database.types.ts):
 * that file is generated FROM the live schema, and the new tables don't
 * exist there yet. Once the migration is reviewed and applied, regenerate
 * types and this can switch to `SupabaseClient<Database>` for compile-time
 * column safety.
 */

type InstrumentRow = {
  id: string;
  canonical_id: string;
  asset_class: string;
  venue_id: string;
  venue_symbol: string;
  base_asset: string;
  quote_asset: string;
  settlement_asset: string;
  price_increment: number;
  size_increment: number;
  min_size: number;
  max_size: number | null;
  contract_multiplier: number | null;
  pip_size: number | null;
  lot_size: number | null;
  allows_long: boolean;
  allows_short: boolean;
  trading_calendar: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
};

type UniverseRow = {
  id: string;
  key: string;
  name: string;
  purpose: string;
  enabled: boolean;
};

type UniverseMemberRow = {
  universe_id: string;
  instrument_id: string;
  research_enabled: boolean;
  shadow_enabled: boolean;
  paper_enabled: boolean;
  instruments: InstrumentRow; // joined
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
    priceIncrement: row.price_increment,
    sizeIncrement: row.size_increment,
    minSize: row.min_size,
    maxSize: row.max_size,
    contractMultiplier: row.contract_multiplier ?? undefined,
    pipSize: row.pip_size ?? undefined,
    lotSize: row.lot_size ?? undefined,
    allowsLong: row.allows_long,
    allowsShort: row.allows_short,
    tradingCalendarId: row.trading_calendar as Instrument["tradingCalendarId"],
    metadata: row.metadata,
  };
}

export class SupabaseUniverseRepository implements UniverseRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listInstruments(): Promise<Instrument[]> {
    const { data, error } = await this.client.from("instruments").select("*").eq("is_active", true);
    if (error) throw error;
    return ((data ?? []) as InstrumentRow[]).map(rowToInstrument);
  }

  async getInstrument(instrumentId: InstrumentId): Promise<Instrument | null> {
    const { data, error } = await this.client
      .from("instruments")
      .select("*")
      .eq("canonical_id", instrumentId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToInstrument(data as InstrumentRow) : null;
  }

  async listUniverses(): Promise<UniverseDefinition[]> {
    const { data, error } = await this.client.from("universes").select("*");
    if (error) throw error;
    return ((data ?? []) as UniverseRow[]).map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      purpose: r.purpose as UniversePurpose,
      enabled: r.enabled,
    }));
  }

  async getUniverse(key: string): Promise<UniverseDefinition | null> {
    const { data, error } = await this.client.from("universes").select("*").eq("key", key).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const r = data as UniverseRow;
    return { id: r.id, key: r.key, name: r.name, purpose: r.purpose as UniversePurpose, enabled: r.enabled };
  }

  /**
   * ONE batched query with an embedded join, not one query per instrument
   * (Checkpoint 2 §13 - no N+1 as the universe grows to 5, 20, 50 members).
   */
  async listUniverseMembers(universeKey: string): Promise<UniverseMember[]> {
    const universe = await this.getUniverse(universeKey);
    if (!universe) return [];

    const { data, error } = await this.client
      .from("universe_members")
      .select("universe_id, instrument_id, research_enabled, shadow_enabled, paper_enabled, instruments(*)")
      .eq("universe_id", universe.id);
    if (error) throw error;

    return ((data ?? []) as unknown as UniverseMemberRow[]).map((row) => ({
      universeId: row.universe_id,
      instrument: rowToInstrument(row.instruments),
      researchEnabled: row.research_enabled,
      shadowEnabled: row.shadow_enabled,
      paperEnabled: row.paper_enabled,
    }));
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
    // paperEnabled may never be set true for a LIVE-adjacent reason here;
    // the DB migration's CHECK constraints are the enforcement layer, this
    // is just the typed call site. No liveEnabled field exists to set.
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

    const patch: Record<string, boolean> = {};
    if (flags.researchEnabled !== undefined) patch.research_enabled = flags.researchEnabled;
    if (flags.shadowEnabled !== undefined) patch.shadow_enabled = flags.shadowEnabled;
    if (flags.paperEnabled !== undefined) patch.paper_enabled = flags.paperEnabled;

    const { error } = await this.client
      .from("universe_members")
      .update(patch)
      .eq("universe_id", universe.id)
      .eq("instrument_id", (instrumentRow as { id: string }).id);
    if (error) throw error;
  }
}
