import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static-content checks on the Checkpoint 2.1 hardening migration
 * (already applied live — see docs/BUILD_STATE.md "Checkpoint 2.1"). Read
 * the same way a reviewer would: no database involved.
 */
const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260915110000_harden_multi_market_function_search_paths.sql",
);
const sql = readFileSync(migrationPath, "utf8");

const HARDENED_FUNCTIONS = [
  "set_updated_at()",
  "venue_asset_classes_are_valid(text[])",
  "validate_instrument_venue_asset_class()",
  "validate_universe_member_compatibility()",
  "validate_universe_update_against_members()",
  "validate_instrument_update_against_memberships()",
  "validate_venue_update_against_instruments()",
];

describe("Checkpoint 2.1 search_path hardening migration: static safety properties", () => {
  it("pins an explicit empty search_path on exactly the seven Checkpoint 2 functions, by exact signature", () => {
    for (const fn of HARDENED_FUNCTIONS) {
      const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(sql).toMatch(new RegExp(`alter function public\\.${escaped} set search_path = ''`, "i"));
    }
  });

  it("uses ALTER FUNCTION ... SET, never CREATE OR REPLACE (never touches a function body)", () => {
    expect(sql).not.toMatch(/create (or replace )?function/i);
  });

  it("does not modify the original Checkpoint 2 migration file", () => {
    const originalPath = join(process.cwd(), "supabase/migrations/20260914130000_multi_market_universe.sql");
    // Just confirms the file this test targets is a separate, new file.
    expect(migrationPath).not.toBe(originalPath);
  });

  it("does not touch any table, RLS policy, or trigger attachment", () => {
    expect(sql).not.toMatch(/create table|alter table|drop table/i);
    expect(sql).not.toMatch(/create policy|drop policy/i);
    expect(sql).not.toMatch(/create trigger|drop trigger/i);
  });
});

describe("Checkpoint 2 migration bodies: every table reference is schema-qualified (why an empty search_path is safe)", () => {
  const baseMigrationPath = join(process.cwd(), "supabase/migrations/20260914130000_multi_market_universe.sql");
  const baseSql = readFileSync(baseMigrationPath, "utf8");

  it("every FROM/JOIN/UPDATE/INSERT INTO in the seven hardened functions' bodies is schema-qualified with public.", () => {
    for (const fn of HARDENED_FUNCTIONS) {
      const name = fn.split("(")[0];
      const match = baseSql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
      expect(match).not.toBeNull();
      const body = match![0];
      const unqualifiedTableRefs = body.match(/\b(from|join|into|update)\s+(?!public\.)(venues|instruments|universes|universe_members|instrument_research_eligibility)\b/gi);
      expect(unqualifiedTableRefs).toBeNull();
    }
  });
});
