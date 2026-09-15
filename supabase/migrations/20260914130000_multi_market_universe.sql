-- Checkpoint 2 of the multi-market architecture: a configurable crypto
-- research universe. See TASKS.md "Multi-market architecture — Checkpoint 2"
-- and docs/BUILD_STATE.md for the full writeup.
--
-- ============================================================================
-- THIS MIGRATION HAS NOT BEEN APPLIED TO THE LIVE PROJECT. It is proposed
-- for owner review. Do not run it against production without explicit
-- approval (per instruction for this checkpoint).
-- ============================================================================
--
-- ADDITIVE ONLY:
--   - No existing table, column, enum, policy, or grant is dropped, renamed,
--     or narrowed.
--   - `trading_mode`, `strategy_versions`, `signals`, `trades`, `orders`,
--     `system_settings`, `instrument_metadata`, `candles` are untouched.
--   - Strategy V1's production universe (lib/strategy/v1/config.ts,
--     `["BTCUSDT","ETHUSDT"]`) is NOT sourced from these new tables. Nothing
--     in app/api/jobs/scan/route.ts reads any table created here.
--   - No row inserted below sets paper_enabled = true for anything. BTC/USDT
--     and ETH/USDT are seeded here for domain-model completeness only; their
--     actual PAPER trading continues to run entirely off the frozen V1 path.
--   - LIVE stays impossible globally: there is no `live_enabled` column
--     anywhere below. Nothing in this schema has a column that could be set
--     true to authorize LIVE for an instrument - the concept does not exist
--     here, matching `system_settings.live_trading_enabled`'s CHECK-enforced
--     permanent false at the platform level (that column is NOT modified by
--     this migration).
--
-- WHY NEW TABLES RATHER THAN REUSING EXISTING ONES (§1 audit):
--   - `instrument_metadata` is keyed by Bybit venue symbol (text primary
--     key) and holds only live exchange rules refreshed by the scanner. It
--     has no asset-class/venue-independent identity, no long/short policy,
--     no calendar, and mixing "these are the exchange's current tick/qty
--     rules" with "this is a venue-independent canonical instrument" would
--     conflate two different lifecycles (exchange rules refresh every scan;
--     an instrument's canonical identity does not change). `instruments`
--     below is new; `instrument_metadata` is untouched and keeps serving V1.
--   - `strategy_versions` / `signals` / `trades` are strategy-execution
--     concepts scoped to Strategy V1 today. A research universe describes
--     WHICH MARKETS exist and what's permitted per market - orthogonal to
--     which strategy runs on them. No existing table models that.
--   - `backtests` / `paper_research_sessions` model a study over historical
--     range or a live wall-clock research window for ONE strategy version.
--     Universe membership is not either of those; it's the input a future
--     multi-instrument research pipeline reads before it ever runs a trial.

-- ---------------------------------------------------------------------------
-- Shared trigger function: updated_at that actually works (final
-- pre-apply guardrail patch §8). Every prior version of this migration
-- declared `updated_at timestamptz not null default now()` and then relied
-- on application code to set it on every UPDATE - nothing enforced that,
-- so a write through any other path (a manual SQL fix, a future admin
-- tool) would silently leave a stale updated_at. A single generic
-- BEFORE UPDATE trigger, attached per table below, removes that gap.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- venues: core instrument identity is not tied to Bybit (§3). Only BYBIT is
-- real; OANDA/IBKR are not connected and are not seeded - the point is that
-- adding one later means an INSERT here, not a schema change.
-- ---------------------------------------------------------------------------
create table if not exists public.venues (
  id text primary key,
  name text not null,
  asset_classes text[] not null,
  notes text,
  created_at timestamptz not null default now()
);

-- Constraint-supporting function, only ever used by the check below - must
-- be created before the constraint that references it.
--
-- Checkpoint 2 review §5: array_length(classes, 1) returns NULL (not 0) for
-- an empty array, and a CHECK that evaluates to NULL is treated as PASSING
-- by Postgres - so the original `array_length(classes, 1) > 0` silently
-- ADMITTED an empty asset_classes array. cardinality() returns 0 for an
-- empty array (never NULL for a non-null array), which is what this check
-- actually needs.
create or replace function public.venue_asset_classes_are_valid(classes text[])
returns boolean language sql immutable as $$
  select classes <@ array['CRYPTO_SPOT', 'FOREX']::text[] and cardinality(classes) > 0;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'venues_asset_classes_valid' and conrelid = 'public.venues'::regclass
  ) then
    alter table public.venues add constraint venues_asset_classes_valid
      check (public.venue_asset_classes_are_valid(asset_classes));
  end if;
end $$;

insert into public.venues (id, name, asset_classes, notes)
values ('BYBIT', 'Bybit', array['CRYPTO_SPOT'], 'Public V5 spot market data; the only connected venue today.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- instruments: canonical, venue-independent instrument identity (§2).
-- Deliberately NOT dozens of speculative nullable columns - only the fields
-- CLAUDE.md's Canonical Instrument Model actually names, minus fields with
-- no current or near-term reader (marginRequired, settlement metadata beyond
-- the asset code).
-- ---------------------------------------------------------------------------
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  -- e.g. "CRYPTO:BYBIT:BTC/USDT" - matches lib/domain/instrument.ts makeInstrumentId().
  canonical_id text not null unique,
  asset_class text not null,
  venue_id text not null references public.venues(id),
  venue_symbol text not null,

  base_asset text not null,
  quote_asset text not null,
  settlement_asset text not null,

  -- Provider-dependent, live exchange rules - NULLABLE, no default
  -- (Checkpoint 2 review §3). This table is canonical IDENTITY, not a cache
  -- of mutable exchange rules; the authoritative source remains
  -- `instrument_metadata` (Bybit venue-symbol-keyed, refreshed every scan
  -- via lib/bybit/client.ts getInstrumentMetadata()). NULL here means
  -- "not yet verified against a live provider" - never guess a value to
  -- fill these in. Any future generic execution code must fail closed on
  -- NULL rather than default to 0/1 (see lib/domain/exchange-rules.ts).
  price_increment numeric,
  size_increment numeric,
  min_size numeric,
  min_notional numeric,
  max_size numeric,

  contract_multiplier numeric,
  pip_size numeric,
  lot_size numeric,

  allows_long boolean not null default true,
  allows_short boolean not null default false,

  trading_calendar text not null default 'CRYPTO_24_7',

  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (venue_id, venue_symbol)
);
create index if not exists instruments_asset_class_idx on public.instruments (asset_class);

do $$
begin
  -- Checkpoint 2 review §6: conname alone is not guaranteed unique across
  -- the schema, so every existence check below is scoped to its own table
  -- via conrelid - an unrelated same-named constraint elsewhere must never
  -- suppress creation here.
  if not exists (
    select 1 from pg_constraint
    where conname = 'instruments_asset_class_valid' and conrelid = 'public.instruments'::regclass
  ) then
    alter table public.instruments add constraint instruments_asset_class_valid
      check (asset_class in ('CRYPTO_SPOT', 'FOREX'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'instruments_calendar_valid' and conrelid = 'public.instruments'::regclass
  ) then
    alter table public.instruments add constraint instruments_calendar_valid
      check (trading_calendar in ('CRYPTO_24_7', 'FX_24_5'));
  end if;
end $$;

drop trigger if exists instruments_set_updated_at on public.instruments;
create trigger instruments_set_updated_at
  before update on public.instruments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Venue/instrument supported-asset-class compatibility (final pre-apply
-- guardrail patch §5). A plain CHECK cannot reference another table, so
-- this is a trigger: an instrument's asset_class must be one of its
-- venue's declared asset_classes. Without this, nothing would stop a
-- CRYPTO_SPOT instrument being attached to a venue whose asset_classes is
-- only FOREX (or vice versa) - a silent, structurally-wrong pairing.
-- ---------------------------------------------------------------------------
create or replace function public.validate_instrument_venue_asset_class()
returns trigger language plpgsql as $$
declare
  venue_classes text[];
begin
  select asset_classes into venue_classes from public.venues where id = new.venue_id;
  if not found then
    raise exception 'Unknown venue % for instrument %', new.venue_id, new.canonical_id;
  end if;
  if not (new.asset_class = any(venue_classes)) then
    raise exception 'Instrument % has asset_class % but venue % only supports %',
      new.canonical_id, new.asset_class, new.venue_id, venue_classes;
  end if;
  return new;
end;
$$;

drop trigger if exists instruments_validate_venue_asset_class on public.instruments;
create trigger instruments_validate_venue_asset_class
  before insert or update on public.instruments
  for each row execute function public.validate_instrument_venue_asset_class();

-- ---------------------------------------------------------------------------
-- universes / universe_members: research universe + PER-MEMBER permission
-- (§4/§5). `purpose` on universes is an ORGANIZATIONAL LABEL ONLY, never an
-- authorization - see lib/domain/universe.ts for why booleans on the
-- membership row are the safer model.
--
-- LIVE, precisely stated (Checkpoint 2 review §9 - avoid overclaiming):
-- there is no `live_enabled` column on ANY table in this migration. This is
-- not a column that exists and happens to default/CHECK to false (like
-- `system_settings.live_trading_enabled`, which is a real column with a
-- permanent CHECK) - the concept of per-instrument LIVE authorization
-- simply has no column to hold it here. Nothing to flip because nothing
-- exists to flip.
-- ---------------------------------------------------------------------------
create table if not exists public.universes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  purpose text not null,
  asset_class text not null,
  venue_id text references public.venues(id),
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'universes_purpose_valid' and conrelid = 'public.universes'::regclass
  ) then
    alter table public.universes add constraint universes_purpose_valid
      check (purpose in ('PRODUCTION', 'PAPER', 'SHADOW', 'HISTORICAL'));
  end if;
  -- Checkpoint 2 review §4: instruments already CHECKs asset_class; universes
  -- had the column but no matching CHECK, so it silently accepted garbage.
  if not exists (
    select 1 from pg_constraint
    where conname = 'universes_asset_class_valid' and conrelid = 'public.universes'::regclass
  ) then
    alter table public.universes add constraint universes_asset_class_valid
      check (asset_class in ('CRYPTO_SPOT', 'FOREX'));
  end if;
end $$;

drop trigger if exists universes_set_updated_at on public.universes;
create trigger universes_set_updated_at
  before update on public.universes
  for each row execute function public.set_updated_at();

create table if not exists public.universe_members (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null references public.universes(id) on delete cascade,
  instrument_id uuid not null references public.instruments(id) on delete cascade,

  research_enabled boolean not null default false,
  shadow_enabled boolean not null default false,
  -- Whether a FUTURE generic-pipeline strategy may open a PAPER position on
  -- this member. Strategy V1's existing BTC/USDT + ETH/USDT PAPER trading
  -- does not read this column - see lib/strategy/v1/config.ts. Nothing sets
  -- this true in this migration.
  --
  -- Checkpoint 2 review §9 - stated precisely, not overclaimed: this column
  -- has NO permanent CHECK forcing it false (unlike
  -- `system_settings.live_trading_enabled`, or `trades`/`orders`' LIVE
  -- CHECKs) - a legitimate future owner-approved PAPER promotion for a
  -- generic-pipeline strategy must be able to set it true, so a CHECK that
  -- always fails would be wrong here, not extra safety. What actually
  -- keeps it false today is the combination of: (1) this seed/default is
  -- false for every current row, (2) only the owner JWT role may mutate it
  -- (RLS below), (3) no execution consumer exists yet - no strategy v2+ has
  -- been implemented that reads this column at all, and (4) any future
  -- promotion is expected to go through a separate, explicit approval step
  -- analogous to `strategy_versions.status` moving to PAPER_APPROVED. All
  -- four layers can change independently; there is no single "physically
  -- cannot become true" guarantee the way LIVE has one.
  paper_enabled boolean not null default false,

  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (universe_id, instrument_id)
);
create index if not exists universe_members_universe_idx on public.universe_members (universe_id);
create index if not exists universe_members_instrument_idx on public.universe_members (instrument_id);

drop trigger if exists universe_members_set_updated_at on public.universe_members;
create trigger universe_members_set_updated_at
  before update on public.universe_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Universe/instrument asset-class + venue compatibility (final pre-apply
-- guardrail patch §4). Another cross-table rule a plain CHECK cannot
-- express: a member's instrument must share the universe's asset_class,
-- and - when the universe pins a specific venue - the instrument's venue
-- too. Without this, a FOREX instrument could silently join a CRYPTO_SPOT
-- universe, or a Bybit instrument could join a universe pinned to a venue
-- it isn't listed on.
-- ---------------------------------------------------------------------------
create or replace function public.validate_universe_member_compatibility()
returns trigger language plpgsql as $$
declare
  u_asset_class text;
  u_venue_id text;
  i_asset_class text;
  i_venue_id text;
begin
  select asset_class, venue_id into u_asset_class, u_venue_id
    from public.universes where id = new.universe_id;
  if not found then
    raise exception 'Unknown universe % for universe_members row', new.universe_id;
  end if;

  select asset_class, venue_id into i_asset_class, i_venue_id
    from public.instruments where id = new.instrument_id;
  if not found then
    raise exception 'Unknown instrument % for universe_members row', new.instrument_id;
  end if;

  if i_asset_class <> u_asset_class then
    raise exception 'Instrument asset_class % does not match universe asset_class %', i_asset_class, u_asset_class;
  end if;

  if u_venue_id is not null and i_venue_id <> u_venue_id then
    raise exception 'Instrument venue % does not match universe-pinned venue %', i_venue_id, u_venue_id;
  end if;

  return new;
end;
$$;

drop trigger if exists universe_members_validate_compatibility on public.universe_members;
create trigger universe_members_validate_compatibility
  before insert or update on public.universe_members
  for each row execute function public.validate_universe_member_compatibility();

-- ---------------------------------------------------------------------------
-- instrument_research_eligibility: latest eligibility read per instrument
-- (§8). One row per instrument (latest snapshot) rather than a growing
-- history table - a full audit history can be added later additively if
-- needed; this checkpoint only needs "what do we currently believe, and
-- why" per lib/domain/eligibility.ts's UNKNOWN/ELIGIBLE/INELIGIBLE model.
-- ---------------------------------------------------------------------------
create table if not exists public.instrument_research_eligibility (
  instrument_id uuid primary key references public.instruments(id) on delete cascade,
  status text not null default 'UNKNOWN',
  reasons text[] not null default '{}',
  metrics jsonb not null default '{}'::jsonb,
  -- NULLABLE, NO DEFAULT (Checkpoint 2 review §1). `now()` as a default
  -- would stamp a "checked" timestamp on a row nobody has actually checked
  -- - false evidence of a recent live verification. NULL means exactly
  -- what it says: no runtime provider check has ever populated this row.
  -- Only real discoverBybitSpotInstruments()/checkBybitResearchEligibility()
  -- results may set this to a real timestamp; a manual/web confirmation
  -- (see docs/BUILD_STATE.md "MANUAL VENUE EVIDENCE") never does.
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'eligibility_status_valid' and conrelid = 'public.instrument_research_eligibility'::regclass
  ) then
    alter table public.instrument_research_eligibility add constraint eligibility_status_valid
      check (status in ('UNKNOWN', 'ELIGIBLE', 'INELIGIBLE'));
  end if;
  -- Final pre-apply guardrail patch §2: a row cannot claim ELIGIBLE without
  -- also carrying the timestamp of the check that produced it. This is the
  -- database-level twin of lib/domain/universe.ts's
  -- selectEligibleResearchInstruments(), which additionally refuses to
  -- treat a row as eligible if eligibilityCheckedAt is null (patch §1) -
  -- belt and suspenders, so the rule holds even for a write that bypasses
  -- the application layer entirely.
  if not exists (
    select 1 from pg_constraint
    where conname = 'eligibility_checked_at_required_when_eligible'
      and conrelid = 'public.instrument_research_eligibility'::regclass
  ) then
    alter table public.instrument_research_eligibility add constraint eligibility_checked_at_required_when_eligible
      check (status <> 'ELIGIBLE' or checked_at is not null);
  end if;
end $$;

drop trigger if exists eligibility_set_updated_at on public.instrument_research_eligibility;
create trigger eligibility_set_updated_at
  before update on public.instrument_research_eligibility
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cross-table update validation (final cross-table invariant completion).
--
-- validate_instrument_venue_asset_class and
-- validate_universe_member_compatibility (above) only fire on the row being
-- written - they stop a NEW mismatched instrument or membership from being
-- created. They do NOT stop the invariant being broken the other way:
-- editing a PARENT row (a universe's asset_class/venue_id, an instrument's
-- asset_class/venue_id, or a venue's asset_classes) after compatible child
-- rows already exist. None of those UPDATEs touch universe_members itself,
-- so its own trigger never fires for them. Example: a universe seeded as
-- CRYPTO_SPOT/BYBIT with BTC/USDT as a member, then
-- `UPDATE universes SET asset_class = 'FOREX'` - the membership row is
-- untouched, yet the universe/member pairing is now nonsensical.
--
-- The three triggers below close that gap by validating the PARENT'S
-- existing children before allowing the parent UPDATE, rather than ever
-- cascading/remapping a child silently.
-- ---------------------------------------------------------------------------

-- 1) Universe asset_class/venue_id changing must not orphan its own members.
create or replace function public.validate_universe_update_against_members()
returns trigger language plpgsql as $$
declare
  bad_count integer;
begin
  if new.asset_class = old.asset_class and new.venue_id is not distinct from old.venue_id then
    return new; -- nothing relevant to this rule changed
  end if;

  select count(*) into bad_count
  from public.universe_members um
  join public.instruments i on i.id = um.instrument_id
  where um.universe_id = new.id
    and (
      i.asset_class <> new.asset_class
      or (new.venue_id is not null and i.venue_id <> new.venue_id)
    );

  if bad_count > 0 then
    raise exception
      'Cannot update universe % (asset_class=%, venue_id=%): % existing member(s) would become incompatible',
      new.key, new.asset_class, new.venue_id, bad_count;
  end if;

  return new;
end;
$$;

drop trigger if exists universes_validate_update_against_members on public.universes;
create trigger universes_validate_update_against_members
  before update of asset_class, venue_id on public.universes
  for each row execute function public.validate_universe_update_against_members();

-- 2) Instrument asset_class/venue_id changing must not break any
-- universe_members row already pointing at it (in addition to the existing
-- validate_instrument_venue_asset_class, which only re-checks the
-- instrument against its OWN venue, not against memberships).
create or replace function public.validate_instrument_update_against_memberships()
returns trigger language plpgsql as $$
declare
  bad_count integer;
begin
  if new.asset_class = old.asset_class and new.venue_id is not distinct from old.venue_id then
    return new;
  end if;

  select count(*) into bad_count
  from public.universe_members um
  join public.universes u on u.id = um.universe_id
  where um.instrument_id = new.id
    and (
      new.asset_class <> u.asset_class
      or (u.venue_id is not null and new.venue_id <> u.venue_id)
    );

  if bad_count > 0 then
    raise exception
      'Cannot update instrument % (asset_class=%, venue_id=%): % existing membership(s) would become incompatible',
      new.canonical_id, new.asset_class, new.venue_id, bad_count;
  end if;

  return new;
end;
$$;

drop trigger if exists instruments_validate_update_against_memberships on public.instruments;
create trigger instruments_validate_update_against_memberships
  before update of asset_class, venue_id on public.instruments
  for each row execute function public.validate_instrument_update_against_memberships();

-- 3) Venue asset_classes shrinking must not strand any instrument already
-- on that venue. Never silently deactivates the instrument - the UPDATE is
-- simply refused.
create or replace function public.validate_venue_update_against_instruments()
returns trigger language plpgsql as $$
declare
  bad_count integer;
begin
  if new.asset_classes = old.asset_classes then
    return new;
  end if;

  select count(*) into bad_count
  from public.instruments i
  where i.venue_id = new.id
    and not (i.asset_class = any(new.asset_classes));

  if bad_count > 0 then
    raise exception
      'Cannot update venue % asset_classes to %: % existing instrument(s) would no longer have a supported asset_class',
      new.id, new.asset_classes, bad_count;
  end if;

  return new;
end;
$$;

drop trigger if exists venues_validate_update_against_instruments on public.venues;
create trigger venues_validate_update_against_instruments
  before update of asset_classes on public.venues
  for each row execute function public.validate_venue_update_against_instruments();

-- ---------------------------------------------------------------------------
-- Seed data: the initial crypto research universe (§6/§13). research_enabled
-- = true for every listed pair so it can be studied; paper_enabled = false
-- for ALL of them, including BTC/ETH, because PAPER authorization for those
-- two continues to come exclusively from the frozen V1 path, not this table.
--
-- IMPORTANT: whether SOL/USDT, XRP/USDT and BNB/USDT actually exist on
-- Bybit Spot, with what metadata, has NOT been runtime-provider-verified
-- from this development sandbox - outbound requests to api.bybit.com are
-- geo-blocked here (the same CloudFront restriction lib/bybit/client.ts
-- already documents for production's Vercel region). The owner separately
-- confirmed via a manual web check that Bybit's official Spot directory
-- currently lists all five of BTC/ETH/SOL/XRP/BNB against USDT - that is
-- real MANUAL VENUE EVIDENCE, but it is not this platform's own RUNTIME
-- PROVIDER VERIFICATION (no listing `status`, no turnover, no structured,
-- replayable result) - see docs/BUILD_STATE.md. `metadata.verifiedOnVenue`
-- stays false for the three candidates below on that basis; re-run
-- lib/domain/discovery/bybit-instrument-discovery.ts's
-- discoverBybitSpotInstruments() against the deployed environment before
-- flipping it.
--
-- Checkpoint 2 review §3: NO price_increment/size_increment/min_size are
-- seeded for ANY instrument here, including BTC/ETH - those are live,
-- provider-owned exchange rules with one authoritative source
-- (`instrument_metadata`, refreshed by lib/risk/position-sizing.ts's
-- callers every scan), not something to duplicate as a guessed constant in
-- canonical identity. They are left NULL and populated only by a real
-- provider call, if ever needed here at all.
-- ---------------------------------------------------------------------------
insert into public.instruments
  (canonical_id, asset_class, venue_id, venue_symbol, base_asset, quote_asset, settlement_asset,
   allows_long, allows_short, trading_calendar, metadata)
values
  ('CRYPTO:BYBIT:BTC/USDT', 'CRYPTO_SPOT', 'BYBIT', 'BTCUSDT', 'BTC', 'USDT', 'USDT',
   true, false, 'CRYPTO_24_7', '{"productionPair": true}'::jsonb),
  ('CRYPTO:BYBIT:ETH/USDT', 'CRYPTO_SPOT', 'BYBIT', 'ETHUSDT', 'ETH', 'USDT', 'USDT',
   true, false, 'CRYPTO_24_7', '{"productionPair": true}'::jsonb),
  ('CRYPTO:BYBIT:SOL/USDT', 'CRYPTO_SPOT', 'BYBIT', 'SOLUSDT', 'SOL', 'USDT', 'USDT',
   true, false, 'CRYPTO_24_7', '{"researchCandidate": true, "verifiedOnVenue": false}'::jsonb),
  ('CRYPTO:BYBIT:XRP/USDT', 'CRYPTO_SPOT', 'BYBIT', 'XRPUSDT', 'XRP', 'USDT', 'USDT',
   true, false, 'CRYPTO_24_7', '{"researchCandidate": true, "verifiedOnVenue": false}'::jsonb),
  ('CRYPTO:BYBIT:BNB/USDT', 'CRYPTO_SPOT', 'BYBIT', 'BNBUSDT', 'BNB', 'USDT', 'USDT',
   true, false, 'CRYPTO_24_7', '{"researchCandidate": true, "verifiedOnVenue": false}'::jsonb)
on conflict (canonical_id) do nothing;

insert into public.universes (key, name, purpose, asset_class, venue_id, enabled, notes)
values (
  'crypto-core',
  'Crypto Core (fixed present-day research universe)',
  'HISTORICAL',
  'CRYPTO_SPOT',
  'BYBIT',
  true,
  'Fixed present-day research universe; results may contain survivorship bias (§10/§15 - not a point-in-time reconstruction of historical top-N liquidity).'
)
on conflict (key) do nothing;

insert into public.universe_members (universe_id, instrument_id, research_enabled, shadow_enabled, paper_enabled)
select u.id, i.id, true, false, false
from public.universes u
join public.instruments i on i.canonical_id in (
  'CRYPTO:BYBIT:BTC/USDT', 'CRYPTO:BYBIT:ETH/USDT',
  'CRYPTO:BYBIT:SOL/USDT', 'CRYPTO:BYBIT:XRP/USDT', 'CRYPTO:BYBIT:BNB/USDT'
)
where u.key = 'crypto-core'
on conflict (universe_id, instrument_id) do nothing;

-- Every newly-registered instrument starts UNKNOWN, not ELIGIBLE, with
-- checked_at left NULL (not populated) - no runtime provider
-- discovery/history/turnover check has been run against the live venue
-- from this sandbox (see note above). A manual web confirmation of venue
-- listing is not a substitute for this and does not populate checked_at.
insert into public.instrument_research_eligibility (instrument_id, status, reasons, metrics)
select i.id, 'UNKNOWN', array['NOT_YET_CHECKED_AGAINST_LIVE_VENUE'], '{}'::jsonb
from public.instruments i
where i.canonical_id in (
  'CRYPTO:BYBIT:BTC/USDT', 'CRYPTO:BYBIT:ETH/USDT',
  'CRYPTO:BYBIT:SOL/USDT', 'CRYPTO:BYBIT:XRP/USDT', 'CRYPTO:BYBIT:BNB/USDT'
)
on conflict (instrument_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS (§17): read-only for any authenticated user (owner or guest, matching
-- the existing "authenticated_read" pattern - see
-- supabase/migrations/00000000000003_rls.sql); mutation restricted to the
-- 'owner' JWT role (matching supabase/migrations/20260913111342_owner_guest_access.sql).
-- The scanner role gets NO grants here: this checkpoint's tables are not
-- read or written by any job yet, so there is nothing for it to need.
-- ---------------------------------------------------------------------------
alter table public.venues enable row level security;
alter table public.instruments enable row level security;
alter table public.universes enable row level security;
alter table public.universe_members enable row level security;
alter table public.instrument_research_eligibility enable row level security;

drop policy if exists "authenticated_read" on public.venues;
create policy "authenticated_read" on public.venues for select to authenticated using (true);
drop policy if exists "authenticated_read" on public.instruments;
create policy "authenticated_read" on public.instruments for select to authenticated using (true);
drop policy if exists "authenticated_read" on public.universes;
create policy "authenticated_read" on public.universes for select to authenticated using (true);
drop policy if exists "authenticated_read" on public.universe_members;
create policy "authenticated_read" on public.universe_members for select to authenticated using (true);
drop policy if exists "authenticated_read" on public.instrument_research_eligibility;
create policy "authenticated_read" on public.instrument_research_eligibility for select to authenticated using (true);

drop policy if exists "owner_manage_instruments" on public.instruments;
create policy "owner_manage_instruments" on public.instruments for all to authenticated
  using (((select auth.jwt())->'app_metadata'->>'role') = 'owner')
  with check (((select auth.jwt())->'app_metadata'->>'role') = 'owner');

drop policy if exists "owner_manage_universes" on public.universes;
create policy "owner_manage_universes" on public.universes for all to authenticated
  using (((select auth.jwt())->'app_metadata'->>'role') = 'owner')
  with check (((select auth.jwt())->'app_metadata'->>'role') = 'owner');

drop policy if exists "owner_manage_universe_members" on public.universe_members;
create policy "owner_manage_universe_members" on public.universe_members for all to authenticated
  using (((select auth.jwt())->'app_metadata'->>'role') = 'owner')
  with check (((select auth.jwt())->'app_metadata'->>'role') = 'owner');

-- instrument_research_eligibility: READ-ONLY for every client role, owner
-- included (final pre-apply guardrail patch §3). There is deliberately NO
-- owner-mutation policy here, unlike instruments/universes/universe_members
-- above. An eligibility verdict must come from an actual runtime provider
-- check (lib/domain/discovery/bybit-instrument-discovery.ts), never from a
-- person clicking a toggle in a UI - so the client-facing API surface (the
-- publishable key, subject to RLS) has no path to write this table at all.
-- A future discovery job writes it using the service-role key, which
-- bypasses RLS by design (same pattern as the scanner writing
-- `instrument_metadata` today) - that is a deliberate server-side
-- capability, not a gap in this policy set.
drop policy if exists "owner_manage_eligibility" on public.instrument_research_eligibility;

-- venues has no owner-mutation policy: it is expected to change rarely (a
-- new venue being connected is itself a significant, deliberate act) and is
-- not exposed in any UI this checkpoint adds. Add one when that changes.
