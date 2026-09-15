import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static-content checks on the PROPOSED (not applied) Checkpoint 2
 * migration. These don't touch any database - they read the SQL file the
 * same way a reviewer would, and assert the safety properties this
 * checkpoint promised: additive-only, no LIVE authorization surface, no
 * PAPER auto-enrollment, idempotency guards present.
 */
const migrationPath = join(process.cwd(), "supabase/migrations/20260914130000_multi_market_universe.sql");
const sql = readFileSync(migrationPath, "utf8");

describe("Checkpoint 2 migration: static safety properties", () => {
  it("contains no DROP TABLE / DROP COLUMN statements (only DROP POLICY IF EXISTS before recreating one)", () => {
    expect(/drop\s+table/i.test(sql)).toBe(false);
    expect(/drop\s+column/i.test(sql)).toBe(false);
  });

  it("never sets paper_enabled = true anywhere (no new instrument may PAPER trade from this migration)", () => {
    // Only real SQL assignment forms, not the prose explaining their absence.
    expect(/set\s+paper_enabled\s*=\s*true/i.test(sql)).toBe(false);
    expect(/default\s+true.*paper_enabled|paper_enabled\s+boolean\s+not\s+null\s+default\s+true/i.test(sql)).toBe(false);
    // The seeding INSERT explicitly passes `false` as the paper_enabled value.
    expect(sql).toMatch(/select u\.id, i\.id, true, false, false/);
  });

  it("declares no live_enabled column anywhere - LIVE has no authorization surface in this schema (mentioned only in prose explaining its absence)", () => {
    expect(/live_enabled\s+(boolean|bool)\b/i.test(sql)).toBe(false);
    expect(/add\s+column\s+live_enabled/i.test(sql)).toBe(false);
  });

  it("does not ALTER, INSERT/UPDATE into, or add a constraint on system_settings", () => {
    const mutatingStatement = /(alter table public\.system_settings|insert into public\.system_settings|update public\.system_settings)/i;
    expect(mutatingStatement.test(sql)).toBe(false);
  });

  it("does not ALTER or write to strategy_versions, signals, trades, or orders (mentioned only in prose comments explaining they're untouched)", () => {
    for (const table of ["strategy_versions", "signals", "trades", "orders"]) {
      const mutatingStatement = new RegExp(
        `(alter table public\\.${table}\\b|insert into public\\.${table}\\b|update public\\.${table}\\b|references public\\.${table}\\b)`,
        "i",
      );
      expect(mutatingStatement.test(sql)).toBe(false);
    }
  });

  it("every CREATE TABLE uses IF NOT EXISTS (idempotent, safe to re-run)", () => {
    const createTableLines = sql.match(/create table[^\n]*/gi) ?? [];
    expect(createTableLines.length).toBeGreaterThan(0);
    for (const line of createTableLines) {
      expect(line.toLowerCase()).toContain("if not exists");
    }
  });

  it("every seed INSERT uses ON CONFLICT DO NOTHING (idempotent, non-destructive re-run)", () => {
    const insertBlocks = sql.split(/insert into/i).slice(1);
    for (const block of insertBlocks) {
      expect(block.toLowerCase()).toContain("on conflict");
    }
  });

  it("enables RLS on every new table and restricts mutation to the owner role", () => {
    for (const table of ["venues", "instruments", "universes", "universe_members", "instrument_research_eligibility"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
    expect(sql.match(/app_metadata'->>'role'\)\s*=\s*'owner'/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("marks the file as NOT applied to the live project, explicitly", () => {
    expect(sql).toMatch(/HAS NOT BEEN APPLIED TO THE LIVE PROJECT/);
  });

  it("Checkpoint 2 review §1: instrument_research_eligibility.checked_at is nullable with no default", () => {
    expect(sql).not.toMatch(/checked_at\s+timestamptz\s+not\s+null/i);
    expect(sql).not.toMatch(/checked_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
    expect(sql).toMatch(/checked_at\s+timestamptz,/);
  });

  it("Checkpoint 2 review §3: instruments' provider-owned exchange rules are nullable, with no NOT NULL and no seeded value", () => {
    expect(sql).not.toMatch(/price_increment\s+numeric\s+not\s+null/i);
    expect(sql).not.toMatch(/size_increment\s+numeric\s+not\s+null/i);
    expect(sql).not.toMatch(/min_size\s+numeric\s+not\s+null/i);
    // The seed INSERT's explicit column list must not name any of them.
    const seedColumnList = sql.match(/insert into public\.instruments\s*\n\s*\(([^)]+)\)/i)?.[1] ?? "";
    for (const column of ["price_increment", "size_increment", "min_size"]) {
      expect(seedColumnList).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("Checkpoint 2 review §4: universes.asset_class has its own CHECK constraint, not just a column", () => {
    expect(sql).toMatch(/universes_asset_class_valid/);
    expect(sql).toMatch(/alter table public\.universes add constraint universes_asset_class_valid/i);
  });

  it("Checkpoint 2 review §5: the venue asset_classes validity function uses cardinality(), not array_length() (which returns NULL, not 0, for an empty array - and a NULL CHECK result passes)", () => {
    const functionBody = sql.match(/returns boolean language sql immutable as \$\$([\s\S]*?)\$\$;/)?.[1] ?? "";
    expect(functionBody).toMatch(/cardinality\(classes\)\s*>\s*0/);
    expect(functionBody).not.toMatch(/array_length/);
  });

  it("Checkpoint 2 review §6: every constraint-existence guard is scoped to its own table via conrelid, not conname alone", () => {
    const guardBlocks = sql.match(/if not exists \(\s*select 1 from pg_constraint[^)]*\)/gi) ?? [];
    expect(guardBlocks.length).toBeGreaterThanOrEqual(7); // one per CHECK constraint added below
    for (const block of guardBlocks) {
      expect(block).toMatch(/conrelid\s*=\s*'public\.\w+'::regclass/);
    }
  });

  it("Checkpoint 2 review §9: does not claim a permanent CHECK forces paper_enabled false (no such constraint exists)", () => {
    expect(sql).not.toMatch(/check\s*\(\s*paper_enabled\s*=\s*false\s*\)/i);
    expect(sql).not.toMatch(/add constraint\s+\S*paper\S*/i);
  });

  it("final guardrail patch §2: instrument_research_eligibility has a CHECK requiring checked_at when status is ELIGIBLE", () => {
    expect(sql).toMatch(/add constraint eligibility_checked_at_required_when_eligible/i);
    expect(sql).toMatch(/check\s*\(\s*status\s*<>\s*'ELIGIBLE'\s*or\s*checked_at\s+is\s+not\s+null\s*\)/i);
  });

  it("final guardrail patch §3: instrument_research_eligibility has NO owner (or any client-role) mutation policy - read-only for every client role", () => {
    expect(sql).not.toMatch(/create policy "owner_manage_eligibility"/i);
    // Only the read policy exists for this table; no `for all`/`for insert`/`for update` policy is created on it.
    const eligibilityPolicyBlock = sql.slice(sql.indexOf("public.instrument_research_eligibility for select"));
    const createPolicyStatements = eligibilityPolicyBlock.match(/create policy[^;]*on public\.instrument_research_eligibility[^;]*;/gi) ?? [];
    for (const stmt of createPolicyStatements) {
      expect(stmt).toMatch(/for select/i);
    }
  });

  it("final guardrail patch §4: universe_members has a cross-table compatibility trigger (asset_class + venue) - a plain CHECK cannot express this", () => {
    expect(sql).toMatch(/validate_universe_member_compatibility/);
    expect(sql).toMatch(/create trigger universe_members_validate_compatibility/i);
    expect(sql).toMatch(/before insert or update on public\.universe_members/i);
  });

  it("final guardrail patch §5: instruments has a venue/asset-class compatibility trigger", () => {
    expect(sql).toMatch(/validate_instrument_venue_asset_class/);
    expect(sql).toMatch(/create trigger instruments_validate_venue_asset_class/i);
    expect(sql).toMatch(/before insert or update on public\.instruments/i);
  });

  it("final guardrail patch §6: universe_members' seed INSERT still only ever writes paper_enabled = false (setMemberFlags cannot write it at all at the app layer)", () => {
    expect(sql).toMatch(/insert into public\.universe_members[\s\S]*?paper_enabled\)/i);
    expect(sql).toMatch(/select u\.id, i\.id, true, false, false/);
  });

  it("final guardrail patch §8: a shared set_updated_at() trigger function exists and is attached to every table with an updated_at column", () => {
    expect(sql).toMatch(/create or replace function public\.set_updated_at\(\)/);
    expect(sql).toMatch(/new\.updated_at = now\(\)/);
    const triggersByTable: Record<string, string> = {
      instruments: "instruments_set_updated_at",
      universes: "universes_set_updated_at",
      universe_members: "universe_members_set_updated_at",
      instrument_research_eligibility: "eligibility_set_updated_at",
    };
    for (const [table, trigger] of Object.entries(triggersByTable)) {
      expect(sql).toMatch(new RegExp(`create trigger ${trigger}\\s+before update on public\\.${table}`, "i"));
    }
  });

  describe("cross-table invariant completion: parent-row UPDATEs are validated against existing children", () => {
    it("universes.asset_class/venue_id UPDATE is validated against existing universe_members", () => {
      expect(sql).toMatch(/validate_universe_update_against_members/);
      expect(sql).toMatch(/create trigger universes_validate_update_against_members\s+before update of asset_class, venue_id on public\.universes/i);
    });

    it("instruments.asset_class/venue_id UPDATE is validated against existing universe_members referencing it", () => {
      expect(sql).toMatch(/validate_instrument_update_against_memberships/);
      expect(sql).toMatch(
        /create trigger instruments_validate_update_against_memberships\s+before update of asset_class, venue_id on public\.instruments/i,
      );
    });

    it("venues.asset_classes UPDATE is validated against existing instruments on that venue", () => {
      expect(sql).toMatch(/validate_venue_update_against_instruments/);
      expect(sql).toMatch(/create trigger venues_validate_update_against_instruments\s+before update of asset_classes on public\.venues/i);
    });

    it("none of the three parent-update triggers silently cascades/remaps a child row - each only RAISEs or returns NEW unchanged", () => {
      for (const name of [
        "validate_universe_update_against_members",
        "validate_instrument_update_against_memberships",
        "validate_venue_update_against_instruments",
      ]) {
        const fnMatch = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
        expect(fnMatch).not.toBeNull();
        const body = fnMatch![0];
        expect(body).toMatch(/raise exception/i);
        expect(body).not.toMatch(/update public\./i);
        expect(body).not.toMatch(/delete from public\./i);
      }
    });
  });
});
