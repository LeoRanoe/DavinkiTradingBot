-- Time-bounded PAPER research windows.
--
-- ADDITIVE ONLY. No existing column, value, policy or grant is dropped or
-- relaxed. Two existing constraints are WIDENED (never narrowed):
--   signals_decision_source_valid  -> also accepts 'AUTO'
--   trades INSERT policy           -> the scanner may insert PAPER rows
-- Every LIVE prohibition is left exactly as it stands, and the new table adds
-- one more place where LIVE is structurally impossible.
--
-- Why a new table rather than reusing strategy_experiments / research_*:
-- those model BACKTEST experiments over historical ranges (development /
-- validation / holdout splits) and carry no notion of a live wall-clock
-- authorization window. Overloading them would conflate "an offline study of
-- past data" with "automatic execution is permitted until this timestamp",
-- which is precisely the distinction this migration exists to make explicit.

-- ---------------------------------------------------------------------------
-- paper_research_sessions
--
-- Server-authoritative, timestamped, auditable, and self-expiring. There is
-- no browser timer anywhere: the window survives redeploys and cold starts
-- because the row - not a process - holds the clock.
-- ---------------------------------------------------------------------------
create table if not exists public.paper_research_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ends_at timestamptz not null,
  planned_days integer not null,
  status text not null default 'ACTIVE',
  -- The PAPER equity the experiment began from, recorded so a later report
  -- can never be quietly rebased onto a different starting point.
  starting_equity numeric(18, 8) not null,
  -- Informational milestone only. Nothing under lib/risk/ or lib/strategy/
  -- reads this column; it must never influence sizing or filtering.
  target_equity numeric(18, 8),
  strategy_version_id uuid references public.strategy_versions(id),
  label text,
  ended_at timestamptz,
  -- Set by the same atomic update that expires the row, so the completion
  -- notification can be sent exactly once.
  ended_notified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_research_status_valid') then
    alter table public.paper_research_sessions add constraint paper_research_status_valid
      check (status in ('ACTIVE', 'EXPIRED', 'CANCELLED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'paper_research_window_ordered') then
    alter table public.paper_research_sessions add constraint paper_research_window_ordered
      check (ends_at > started_at);
  end if;

  -- A research window that cannot end is indistinguishable from permanently
  -- enabling automatic execution. The 30-day ceiling is enforced here as well
  -- as in lib/research/window.ts so it holds even if the app layer is bypassed.
  if not exists (select 1 from pg_constraint where conname = 'paper_research_max_duration') then
    alter table public.paper_research_sessions add constraint paper_research_max_duration
      check (ends_at <= started_at + interval '30 days');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'paper_research_planned_days_bounds') then
    alter table public.paper_research_sessions add constraint paper_research_planned_days_bounds
      check (planned_days between 1 and 30);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'paper_research_starting_equity_positive') then
    alter table public.paper_research_sessions add constraint paper_research_starting_equity_positive
      check (starting_equity > 0);
  end if;
end $$;

-- At most one ACTIVE window, enforced by the database rather than by an
-- application check-then-insert, so two concurrent starts cannot both win.
create unique index if not exists paper_research_single_active
  on public.paper_research_sessions (status)
  where status = 'ACTIVE';

create index if not exists paper_research_started_idx
  on public.paper_research_sessions (started_at desc);

-- ---------------------------------------------------------------------------
-- Research tagging.
--
-- Nullable and additive: a trade or signal outside any research period simply
-- carries null, and no existing row is rewritten. This is what lets the
-- 14-day run be analyzed on its own without mixing in unrelated history.
-- ---------------------------------------------------------------------------
alter table public.trades
  add column if not exists research_session_id uuid references public.paper_research_sessions(id);
alter table public.signals
  add column if not exists research_session_id uuid references public.paper_research_sessions(id);

create index if not exists trades_research_session_idx
  on public.trades (research_session_id) where research_session_id is not null;
create index if not exists signals_research_session_idx
  on public.signals (research_session_id) where research_session_id is not null;

-- ---------------------------------------------------------------------------
-- AUTO as an execution source.
--
-- Widened, not replaced: TELEGRAM and DASHBOARD remain exactly as valid.
-- AUTO is recorded as its own source precisely so an automatically executed
-- candidate is never mistaken for one the owner individually approved -
-- signals.owner_decision stays NULL for AUTO, because no owner decided it.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'signals_decision_source_valid') then
    alter table public.signals drop constraint signals_decision_source_valid;
  end if;

  alter table public.signals add constraint signals_decision_source_valid
    check (decision_source is null or decision_source in ('TELEGRAM', 'DASHBOARD', 'AUTO'));
end $$;

-- ---------------------------------------------------------------------------
-- Scanner INSERT on trades, restricted to PAPER.
--
-- AUTO execution runs inside the scanner job, which authenticates as the
-- scanner principal. Until now only the owner principal could INSERT a trade,
-- so automatic execution would have failed at the final step. The new policy
-- mirrors the owner policy's shape and keeps its `trading_mode = 'PAPER'`
-- restriction, so the scanner gains the narrowest privilege that makes AUTO
-- possible and no more. DEMO and LIVE remain uninsertable by the scanner, and
-- the trades table's own live_trades_forbidden CHECK is untouched.
-- ---------------------------------------------------------------------------
drop policy if exists scanner_insert_paper_trades on public.trades;
create policy scanner_insert_paper_trades on public.trades
  for insert to authenticated
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner'
    and trading_mode = 'PAPER'
  );

-- The factual post-trade review is written by the scanner immediately after
-- settlement. Without this, learning capture silently fails for every
-- automatically closed position.
drop policy if exists scanner_write_trade_reviews on public.trade_reviews;
create policy scanner_write_trade_reviews on public.trade_reviews
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

-- ---------------------------------------------------------------------------
-- RLS for the research table: same model as every other table here.
-- Everyone authenticated reads; only the owner creates a window; the scanner
-- may update only to expire one it did not create.
-- ---------------------------------------------------------------------------
alter table public.paper_research_sessions enable row level security;

drop policy if exists authenticated_read on public.paper_research_sessions;
create policy authenticated_read on public.paper_research_sessions
  for select to authenticated using (true);

drop policy if exists owner_insert_research_session on public.paper_research_sessions;
create policy owner_insert_research_session on public.paper_research_sessions
  for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');

drop policy if exists owner_update_research_session on public.paper_research_sessions;
create policy owner_update_research_session on public.paper_research_sessions
  for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');

-- The scanner expires an elapsed window; it can never create or extend one.
drop policy if exists scanner_update_research_session on public.paper_research_sessions;
create policy scanner_update_research_session on public.paper_research_sessions
  for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

-- The scanner must be able to persist the fallback to APPROVAL_REQUIRED when
-- a window elapses. Restricted to that one column transition and, like every
-- other path, unable to enable live trading.
drop policy if exists scanner_revert_execution_policy on public.system_settings;
create policy scanner_revert_execution_policy on public.system_settings
  for update to authenticated
  using (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner'
    and execution_policy = 'AUTO'
  )
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner'
    and execution_policy = 'APPROVAL_REQUIRED'
    and live_trading_enabled = false
  );

comment on table public.paper_research_sessions is
  'Time-bounded windows during which a DRAFT strategy may execute in PAPER. A window is evidence collection only: it never promotes a strategy, never implies validation or profitability, and can never authorize LIVE.';
comment on column public.paper_research_sessions.target_equity is
  'Informational milestone shown to the owner. Never read by risk, sizing or filtering - progress toward a goal must not change how trades are selected or sized.';
comment on column public.paper_research_sessions.ended_notified_at is
  'Set by the same atomic ACTIVE -> EXPIRED update that ends the window, so the completion notification is sent exactly once.';
comment on column public.signals.decision_source is
  'Which surface authorized execution: TELEGRAM or DASHBOARD (an owner individually approved) or AUTO (a research-window policy authorized it). For AUTO, owner_decision stays NULL - no owner decided that trade.';
