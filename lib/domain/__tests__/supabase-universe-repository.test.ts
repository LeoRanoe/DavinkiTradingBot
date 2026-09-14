import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseUniverseRepository } from "../repository/supabase-universe-repository";

/**
 * These tests mock the Supabase client entirely - they never touch a real
 * database. The tables this repository targets
 * (supabase/migrations/20260914130000_multi_market_universe.sql) have NOT
 * been applied to the live project; that migration is proposed only.
 */

const instrumentRow = {
  id: "instr-uuid-1",
  canonical_id: "CRYPTO:BYBIT:SOL/USDT",
  asset_class: "CRYPTO_SPOT",
  venue_id: "BYBIT",
  venue_symbol: "SOLUSDT",
  base_asset: "SOL",
  quote_asset: "USDT",
  settlement_asset: "USDT",
  price_increment: null,
  size_increment: null,
  min_size: null,
  max_size: null,
  contract_multiplier: null,
  pip_size: null,
  lot_size: null,
  allows_long: true,
  allows_short: false,
  trading_calendar: "CRYPTO_24_7",
  is_active: true,
  metadata: { researchCandidate: true },
};

const universeRow = { id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", asset_class: "CRYPTO_SPOT", venue_id: "BYBIT", enabled: true };

function makeQueryBuilder(finalResult: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.maybeSingle = vi.fn(async () => finalResult);
  // Non-maybeSingle calls resolve when awaited directly (PostgREST builder is thenable).
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

describe("SupabaseUniverseRepository", () => {
  it("listUniverseMembers issues a small, bounded number of queries (never one per instrument) and maps asset_class/venue_id", async () => {
    const memberRows = [
      {
        universe_id: "u1",
        instrument_id: "instr-uuid-1",
        research_enabled: true,
        shadow_enabled: false,
        paper_enabled: false,
        instruments: instrumentRow,
      },
    ];
    const eligibilityRows = [{ instrument_id: "instr-uuid-1", status: "UNKNOWN", checked_at: null }];

    const from = vi.fn((table: string) => {
      if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
      if (table === "universe_members") return makeQueryBuilder({ data: memberRows, error: null });
      if (table === "instrument_research_eligibility") return makeQueryBuilder({ data: eligibilityRows, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const client = { from } as unknown as SupabaseClient;

    const repo = new SupabaseUniverseRepository(client);
    const members = await repo.listUniverseMembers("crypto-core");

    // Exactly three `.from()` calls total (universes, universe_members,
    // instrument_research_eligibility), regardless of how many members are
    // returned - this is the property that matters, not the exact number.
    expect(from).toHaveBeenCalledTimes(3);
    expect(members).toHaveLength(1);
    expect(members[0].instrument.venueSymbol).toBe("SOLUSDT");
    expect(members[0].instrument.isActive).toBe(true);
    expect(members[0].researchEnabled).toBe(true);
    expect(members[0].paperEnabled).toBe(false);
    expect(members[0].eligibilityStatus).toBe("UNKNOWN");
    expect(members[0].eligibilityCheckedAt).toBeNull();
  });

  it("maps a nullable provider exchange-rule column to undefined, never to a fabricated 0", async () => {
    const memberRows = [
      {
        universe_id: "u1",
        instrument_id: "instr-uuid-1",
        research_enabled: true,
        shadow_enabled: false,
        paper_enabled: false,
        instruments: instrumentRow, // price_increment/size_increment/min_size are all null
      },
    ];
    const from = vi.fn((table: string) => {
      if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
      if (table === "universe_members") return makeQueryBuilder({ data: memberRows, error: null });
      return makeQueryBuilder({ data: [], error: null });
    });
    const client = { from } as unknown as SupabaseClient;

    const repo = new SupabaseUniverseRepository(client);
    const members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].instrument.priceIncrement).toBeUndefined();
    expect(members[0].instrument.sizeIncrement).toBeUndefined();
    expect(members[0].instrument.minSize).toBeUndefined();
  });

  it("maps checked_at from a real timestamp once a provider verification has actually run", async () => {
    const memberRows = [
      {
        universe_id: "u1",
        instrument_id: "instr-uuid-1",
        research_enabled: true,
        shadow_enabled: false,
        paper_enabled: false,
        instruments: instrumentRow,
      },
    ];
    const checkedAtIso = "2026-09-15T00:00:00.000Z";
    const eligibilityRows = [{ instrument_id: "instr-uuid-1", status: "ELIGIBLE", checked_at: checkedAtIso }];
    const from = vi.fn((table: string) => {
      if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
      if (table === "universe_members") return makeQueryBuilder({ data: memberRows, error: null });
      if (table === "instrument_research_eligibility") return makeQueryBuilder({ data: eligibilityRows, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const client = { from } as unknown as SupabaseClient;

    const repo = new SupabaseUniverseRepository(client);
    const members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].eligibilityStatus).toBe("ELIGIBLE");
    expect(members[0].eligibilityCheckedAt).toBe(Date.parse(checkedAtIso));
  });

  it("getResearchUniverse filters to researchEnabled members only (selection, not eligibility)", async () => {
    const memberRows = [
      {
        universe_id: "u1",
        instrument_id: "instr-uuid-1",
        research_enabled: false,
        shadow_enabled: false,
        paper_enabled: false,
        instruments: instrumentRow,
      },
    ];
    const from = vi.fn((table: string) => {
      if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
      return makeQueryBuilder({ data: memberRows, error: null });
    });
    const client = { from } as unknown as SupabaseClient;

    const repo = new SupabaseUniverseRepository(client);
    expect(await repo.getResearchUniverse("crypto-core")).toEqual([]);
  });

  describe("getEligibleResearchUniverse (fail-closed)", () => {
    function reposWith(memberRows: unknown[], universeOverrides: Partial<typeof universeRow> = {}) {
      const from = vi.fn((table: string) => {
        if (table === "universes") return makeQueryBuilder({ data: { ...universeRow, ...universeOverrides }, error: null });
        if (table === "universe_members") return makeQueryBuilder({ data: memberRows, error: null });
        return makeQueryBuilder({ data: [], error: null });
      });
      return new SupabaseUniverseRepository({ from } as unknown as SupabaseClient);
    }

    it("RESEARCH_ENABLED + UNKNOWN -> NOT eligible (no eligibility row at all)", async () => {
      const repo = reposWith([
        { universe_id: "u1", instrument_id: "instr-uuid-1", research_enabled: true, shadow_enabled: false, paper_enabled: false, instruments: instrumentRow },
      ]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("RESEARCH_ENABLED + INELIGIBLE -> NOT eligible", async () => {
      const from = vi.fn((table: string) => {
        if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
        if (table === "universe_members")
          return makeQueryBuilder({
            data: [{ universe_id: "u1", instrument_id: "instr-uuid-1", research_enabled: true, shadow_enabled: false, paper_enabled: false, instruments: instrumentRow }],
            error: null,
          });
        if (table === "instrument_research_eligibility")
          return makeQueryBuilder({ data: [{ instrument_id: "instr-uuid-1", status: "INELIGIBLE", checked_at: null }], error: null });
        throw new Error(`unexpected table ${table}`);
      });
      const repo = new SupabaseUniverseRepository({ from } as unknown as SupabaseClient);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("RESEARCH_ENABLED + ELIGIBLE -> eligible", async () => {
      const from = vi.fn((table: string) => {
        if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
        if (table === "universe_members")
          return makeQueryBuilder({
            data: [{ universe_id: "u1", instrument_id: "instr-uuid-1", research_enabled: true, shadow_enabled: false, paper_enabled: false, instruments: instrumentRow }],
            error: null,
          });
        if (table === "instrument_research_eligibility")
          return makeQueryBuilder({ data: [{ instrument_id: "instr-uuid-1", status: "ELIGIBLE", checked_at: "2026-09-15T00:00:00.000Z" }], error: null });
        throw new Error(`unexpected table ${table}`);
      });
      const repo = new SupabaseUniverseRepository({ from } as unknown as SupabaseClient);
      const eligible = await repo.getEligibleResearchUniverse("crypto-core");
      expect(eligible.map((i) => i.venueSymbol)).toEqual(["SOLUSDT"]);
    });

    it("disabled universe -> none eligible, even if the member is ELIGIBLE", async () => {
      const from = vi.fn((table: string) => {
        if (table === "universes") return makeQueryBuilder({ data: { ...universeRow, enabled: false }, error: null });
        if (table === "universe_members")
          return makeQueryBuilder({
            data: [{ universe_id: "u1", instrument_id: "instr-uuid-1", research_enabled: true, shadow_enabled: false, paper_enabled: false, instruments: instrumentRow }],
            error: null,
          });
        if (table === "instrument_research_eligibility")
          return makeQueryBuilder({ data: [{ instrument_id: "instr-uuid-1", status: "ELIGIBLE", checked_at: "2026-09-15T00:00:00.000Z" }], error: null });
        throw new Error(`unexpected table ${table}`);
      });
      const repo = new SupabaseUniverseRepository({ from } as unknown as SupabaseClient);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("inactive instrument -> not eligible, even if ELIGIBLE and research-selected", async () => {
      const inactiveInstrument = { ...instrumentRow, is_active: false };
      const from = vi.fn((table: string) => {
        if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
        if (table === "universe_members")
          return makeQueryBuilder({
            data: [{ universe_id: "u1", instrument_id: "instr-uuid-1", research_enabled: true, shadow_enabled: false, paper_enabled: false, instruments: inactiveInstrument }],
            error: null,
          });
        if (table === "instrument_research_eligibility")
          return makeQueryBuilder({ data: [{ instrument_id: "instr-uuid-1", status: "ELIGIBLE", checked_at: "2026-09-15T00:00:00.000Z" }], error: null });
        throw new Error(`unexpected table ${table}`);
      });
      const repo = new SupabaseUniverseRepository({ from } as unknown as SupabaseClient);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("not research-selected -> not eligible, even if ELIGIBLE", async () => {
      const from = vi.fn((table: string) => {
        if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
        if (table === "universe_members")
          return makeQueryBuilder({
            data: [{ universe_id: "u1", instrument_id: "instr-uuid-1", research_enabled: false, shadow_enabled: false, paper_enabled: false, instruments: instrumentRow }],
            error: null,
          });
        if (table === "instrument_research_eligibility")
          return makeQueryBuilder({ data: [{ instrument_id: "instr-uuid-1", status: "ELIGIBLE", checked_at: "2026-09-15T00:00:00.000Z" }], error: null });
        throw new Error(`unexpected table ${table}`);
      });
      const repo = new SupabaseUniverseRepository({ from } as unknown as SupabaseClient);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });
  });

  it("setMemberFlags resolves the instrument's internal uuid before updating (does not filter universe_members by the canonical string id)", async () => {
    const eqCalls: Array<[string, unknown]> = [];

    const updateBuilder: Record<string, unknown> = {};
    updateBuilder.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return updateBuilder;
    });
    updateBuilder.then = (resolve: (v: unknown) => void) => resolve({ error: null });

    const from = vi.fn((table: string) => {
      if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
      if (table === "instruments") return makeQueryBuilder({ data: { id: "instr-uuid-1" }, error: null });
      if (table === "universe_members") {
        return { update: vi.fn(() => updateBuilder) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const client = { from } as unknown as SupabaseClient;

    const repo = new SupabaseUniverseRepository(client);
    await repo.setMemberFlags("crypto-core", "CRYPTO:BYBIT:SOL/USDT", { researchEnabled: true });

    expect(eqCalls).toContainEqual(["instrument_id", "instr-uuid-1"]);
    expect(eqCalls).not.toContainEqual(["instrument_id", "CRYPTO:BYBIT:SOL/USDT"]);
  });
});
