-- Checkpoint 2.1 — security hardening only: pin an explicit empty
-- search_path on the seven functions Checkpoint 2's migration
-- (20260914130000_multi_market_universe.sql) introduced, to clear the
-- Supabase Security Advisor's `function_search_path_mutable` (WARN)
-- finding on each of them. See docs/BUILD_STATE.md "Checkpoint 2.1" for
-- the full writeup.
--
-- ADDITIVE ONLY. Does not edit 20260914130000_multi_market_universe.sql,
-- does not touch V1, the scanner, PAPER AUTO, the research session,
-- equity, risk, or LIVE. No table, row, RLS policy, or trigger attachment
-- changes here - only each function's own configuration.
--
-- SECURITY INVOKER is unchanged (none of these functions were ever
-- SECURITY DEFINER, and none becomes one here) - a mutable search_path is
-- a real risk primarily for SECURITY DEFINER functions (a caller could get
-- one to resolve an unqualified name against an attacker-controlled
-- schema placed earlier in *their* search_path), but pinning it on every
-- function regardless is the Postgres/Supabase best practice this
-- advisory finding asks for, and costs nothing here since every table
-- reference below was already schema-qualified.
--
-- WHY `SET search_path = ''` is safe for all seven, verified by re-reading
-- every body in 20260914130000_multi_market_universe.sql before writing
-- this migration:
--   - Every table reference in every one of these seven functions is
--     already written as `public.venues` / `public.instruments` /
--     `public.universes` / `public.universe_members` (never a bare table
--     name), so an empty search_path resolves them identically.
--   - The only unqualified identifiers used are built-ins - `now()`,
--     `cardinality()`, `count()`, and the `= any(array)` construct - all
--     of which resolve via `pg_catalog`, which Postgres always searches
--     first regardless of search_path (see the "Schema Search Path"
--     chapter of the Postgres docs: pg_catalog is implicitly searched
--     whether or not it appears in search_path).
--   - None of the seven reference `extensions`-schema objects (e.g.
--     `gen_random_uuid()`, which only appears in column DEFAULTs on the
--     tables themselves, not inside any of these seven function bodies).
--
-- ALTER FUNCTION ... SET search_path is used rather than CREATE OR REPLACE
-- (which would require re-pasting each full body and risks an accidental
-- behavior change) - this only ever sets configuration, never touches the
-- function body, and is idempotent: re-running it is a no-op.

alter function public.set_updated_at() set search_path = '';

alter function public.venue_asset_classes_are_valid(text[]) set search_path = '';

alter function public.validate_instrument_venue_asset_class() set search_path = '';

alter function public.validate_universe_member_compatibility() set search_path = '';

alter function public.validate_universe_update_against_members() set search_path = '';

alter function public.validate_instrument_update_against_memberships() set search_path = '';

alter function public.validate_venue_update_against_instruments() set search_path = '';
