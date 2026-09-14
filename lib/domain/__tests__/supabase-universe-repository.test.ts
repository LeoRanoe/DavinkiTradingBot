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
  price_increment: 0.01,
  size_increment: 0.001,
  min_size: 0,
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

function makeQueryBuilder(finalResult: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.maybeSingle = vi.fn(async () => finalResult);
  // Non-maybeSingle calls resolve when awaited directly (PostgREST builder is thenable).
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

describe("SupabaseUniverseRepository", () => {
  it("listUniverseMembers issues ONE query with an embedded join, not one per instrument (no N+1)", async () => {
    const universeRow = { id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", enabled: true };
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

    const from = vi.fn((table: string) => {
      if (table === "universes") return makeQueryBuilder({ data: universeRow, error: null });
      if (table === "universe_members") return makeQueryBuilder({ data: memberRows, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const client = { from } as unknown as SupabaseClient;

    const repo = new SupabaseUniverseRepository(client);
    const members = await repo.listUniverseMembers("crypto-core");

    // Exactly two `.from()` calls total (universes, then universe_members),
    // regardless of how many members are returned.
    expect(from).toHaveBeenCalledTimes(2);
    expect(members).toHaveLength(1);
    expect(members[0].instrument.venueSymbol).toBe("SOLUSDT");
    expect(members[0].researchEnabled).toBe(true);
    expect(members[0].paperEnabled).toBe(false);
  });

  it("getResearchUniverse filters to researchEnabled members only", async () => {
    const universeRow = { id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", enabled: true };
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

  it("setMemberFlags resolves the instrument's internal uuid before updating (does not filter universe_members by the canonical string id)", async () => {
    const universeRow = { id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", enabled: true };
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
