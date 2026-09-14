-- Daily research snapshots for the 14-day window.
--
-- ADDITIVE ONLY. New table; nothing existing is altered.
--
-- One row per research session per UTC day. The unique constraint is what
-- makes the daily job idempotent and the daily Telegram summary exactly-once:
-- a second run on the same day cannot insert a duplicate, so it cannot send a
-- second message either.
create table if not exists public.research_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid not null references public.paper_research_sessions(id) on delete cascade,
  utc_date date not null,
  day_number integer not null,
  total_days integer not null,

  -- Actual PAPER activity for the day. These are the only figures that
  -- describe real results.
  candidates integer not null default 0,
  trades_opened integer not null default 0,
  trades_closed integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  realized_pnl numeric(18, 8) not null default 0,
  realized_r numeric(12, 4),
  cumulative_r numeric(12, 4),
  equity numeric(18, 8),
  max_drawdown numeric(18, 8),
  average_mfe_r numeric(12, 4),
  average_mae_r numeric(12, 4),

  -- Counterfactual counts, kept in their own columns so they can never be
  -- mistaken for actual results.
  counterfactual_total integer not null default 0,
  counterfactual_settled integer not null default 0,

  -- Operational health, recorded honestly rather than assumed.
  scanner_health text,
  news_health text,
  qwen_health text,
  evidence_level text,

  detail jsonb,
  notified_at timestamptz,
  created_at timestamptz not null default now(),

  unique (research_session_id, utc_date)
);

create index if not exists research_daily_snapshots_session_idx
  on public.research_daily_snapshots (research_session_id, utc_date desc);

alter table public.research_daily_snapshots enable row level security;

drop policy if exists authenticated_read on public.research_daily_snapshots;
create policy authenticated_read on public.research_daily_snapshots
  for select to authenticated using (true);

drop policy if exists scanner_write_research_daily_snapshots on public.research_daily_snapshots;
create policy scanner_write_research_daily_snapshots on public.research_daily_snapshots
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

drop policy if exists owner_write_research_daily_snapshots on public.research_daily_snapshots;
create policy owner_write_research_daily_snapshots on public.research_daily_snapshots
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');

comment on table public.research_daily_snapshots is
  'One row per research session per UTC day, for longitudinal analysis. The unique (session, date) constraint makes the daily job idempotent and the daily notification exactly-once. Actual and counterfactual counts are kept in separate columns so they can never be conflated.';
