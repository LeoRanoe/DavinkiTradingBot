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
    expect(guardBlocks.length).toBeGreaterThanOrEqual(6); // one per CHECK constraint added below
    for (const block of guardBlocks) {
      expect(block).toMatch(/conrelid\s*=\s*'public\.\w+'::regclass/);
    }
  });

  it("Checkpoint 2 review §9: does not claim a permanent CHECK forces paper_enabled false (no such constraint exists)", () => {
    expect(sql).not.toMatch(/check\s*\(\s*paper_enabled\s*=\s*false\s*\)/i);
    expect(sql).not.toMatch(/add constraint\s+\S*paper\S*/i);
  });
});
