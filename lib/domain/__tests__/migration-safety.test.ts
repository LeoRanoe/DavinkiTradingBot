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
});
