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
create or replace function public.venue_asset_classes_are_valid(classes text[])
returns boolean language sql immutable as $$
  select classes <@ array['CRYPTO_SPOT', 'FOREX']::text[] and array_length(classes, 1) > 0;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_asset_classes_valid') then
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

  price_increment numeric not null,
  size_increment numeric not null,
  min_size numeric not null default 0,
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
  if not exists (select 1 from pg_constraint where conname = 'instruments_asset_class_valid') then
    alter table public.instruments add constraint instruments_asset_class_valid
      check (asset_class in ('CRYPTO_SPOT', 'FOREX'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instruments_calendar_valid') then
    alter table public.instruments add constraint instruments_calendar_valid
      check (trading_calendar in ('CRYPTO_24_7', 'FX_24_5'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- universes / universe_members: research universe + PER-MEMBER permission
-- (§4/§5). `purpose` on universes is an ORGANIZATIONAL LABEL ONLY, never an
-- authorization - see lib/domain/universe.ts for why booleans on the
-- membership row are the safer model. There is no liveEnabled column
-- anywhere below; LIVE authorization cannot be expressed by this schema.
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
  if not exists (select 1 from pg_constraint where conname = 'universes_purpose_valid') then
    alter table public.universes add constraint universes_purpose_valid
      check (purpose in ('PRODUCTION', 'PAPER', 'SHADOW', 'HISTORICAL'));
  end if;
end $$;

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
  paper_enabled boolean not null default false,

  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (universe_id, instrument_id)
);
create index if not exists universe_members_universe_idx on public.universe_members (universe_id);
create index if not exists universe_members_instrument_idx on public.universe_members (instrument_id);

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
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eligibility_status_valid') then
    alter table public.instrument_research_eligibility add constraint eligibility_status_valid
      check (status in ('UNKNOWN', 'ELIGIBLE', 'INELIGIBLE'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed data: the initial crypto research universe (§6/§13). research_enabled
-- = true for every listed pair so it can be studied; paper_enabled = false
-- for ALL of them, including BTC/ETH, because PAPER authorization for those
-- two continues to come exclusively from the frozen V1 path, not this table.
--
-- IMPORTANT: whether SOL/USDT, XRP/USDT and BNB/USDT actually exist on
-- Bybit Spot, with what metadata, has NOT been verified from this
-- development sandbox - outbound requests to api.bybit.com are geo-blocked
-- here (the same CloudFront restriction lib/bybit/client.ts already
-- documents for production's Vercel region). The venue_symbol/base/quote
-- values below are seeded from the CLAUDE.md-provided candidate list, not
-- from a verified live discovery response. Re-run
-- lib/domain/discovery/bybit-instrument-discovery.ts's
-- discoverBybitSpotInstruments() against the deployed environment BEFORE
-- treating any of the three new pairs as confirmed - and populate
-- instrument_research_eligibility from real discovery + candle-history
-- results before relying on this seed for anything beyond "the schema can
-- hold it". price_increment/size_increment placeholder values below are
-- schema-completeness placeholders, not exchange rules - never used for
-- sizing (only lib/risk/position-sizing.ts's live instrument_metadata is).
-- ---------------------------------------------------------------------------
insert into public.instruments
  (canonical_id, asset_class, venue_id, venue_symbol, base_asset, quote_asset, settlement_asset,
   price_increment, size_increment, min_size, allows_long, allows_short, trading_calendar, metadata)
values
  ('CRYPTO:BYBIT:BTC/USDT', 'CRYPTO_SPOT', 'BYBIT', 'BTCUSDT', 'BTC', 'USDT', 'USDT',
   0.01, 0.000001, 0, true, false, 'CRYPTO_24_7', '{"productionPair": true}'::jsonb),
  ('CRYPTO:BYBIT:ETH/USDT', 'CRYPTO_SPOT', 'BYBIT', 'ETHUSDT', 'ETH', 'USDT', 'USDT',
   0.01, 0.0001, 0, true, false, 'CRYPTO_24_7', '{"productionPair": true}'::jsonb),
  ('CRYPTO:BYBIT:SOL/USDT', 'CRYPTO_SPOT', 'BYBIT', 'SOLUSDT', 'SOL', 'USDT', 'USDT',
   0.01, 0.001, 0, true, false, 'CRYPTO_24_7', '{"researchCandidate": true, "verifiedOnVenue": false}'::jsonb),
  ('CRYPTO:BYBIT:XRP/USDT', 'CRYPTO_SPOT', 'BYBIT', 'XRPUSDT', 'XRP', 'USDT', 'USDT',
   0.0001, 1, 0, true, false, 'CRYPTO_24_7', '{"researchCandidate": true, "verifiedOnVenue": false}'::jsonb),
  ('CRYPTO:BYBIT:BNB/USDT', 'CRYPTO_SPOT', 'BYBIT', 'BNBUSDT', 'BNB', 'USDT', 'USDT',
   0.01, 0.001, 0, true, false, 'CRYPTO_24_7', '{"researchCandidate": true, "verifiedOnVenue": false}'::jsonb)
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

-- Every newly-registered instrument starts UNKNOWN, not ELIGIBLE - no real
-- discovery/history/turnover check has been run against the live venue from
-- this sandbox (see note above).
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

drop policy if exists "owner_manage_eligibility" on public.instrument_research_eligibility;
create policy "owner_manage_eligibility" on public.instrument_research_eligibility for all to authenticated
  using (((select auth.jwt())->'app_metadata'->>'role') = 'owner')
  with check (((select auth.jwt())->'app_metadata'->>'role') = 'owner');

-- venues has no owner-mutation policy: it is expected to change rarely (a
-- new venue being connected is itself a significant, deliberate act) and is
-- not exposed in any UI this checkpoint adds. Add one when that changes.
