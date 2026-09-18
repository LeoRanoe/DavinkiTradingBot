-- JeanFX Gold (XAU/USD) PAPER attribution + frequency diagnostics.
--
-- ADDITIVE ONLY. Nothing existing is altered, renamed, or dropped - the
-- legacy `trades`/`signals` tables (V1's PAPER pipeline) and the strategy
-- platform's own `strategy_*` tables (20260917000000_strategy_platform.sql)
-- are untouched.
--
-- LIVE is structurally unreachable from this table: unlike
-- `strategy_assignments` (which needed a CHECK constraint to forbid a
-- `mode` column value of 'LIVE'), `jeanfx_gold_paper_trades` simply has NO
-- mode/trading_mode column at all. There is no value any client could ever
-- write here that would mean "this was a real order" - this is a stronger
-- structural guarantee than a CHECK constraint, mirroring CLAUDE.md #1's
-- "LIVE is permanently disabled" invariant one layer further for this new,
-- PAPER-only surface.

create table jeanfx_gold_paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),

  -- Full platform attribution (brief S11) - every row traces back to
  -- exactly which definition/version/configuration/assignment produced it.
  strategy_definition_id uuid not null references strategy_definitions(id),
  strategy_version_id uuid not null references strategy_platform_versions(id),
  strategy_configuration_id uuid not null references strategy_configurations(id),
  strategy_assignment_id uuid not null references strategy_assignments(id),

  instrument_id text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),

  entry_price numeric not null check (entry_price > 0),
  stop_price numeric not null check (stop_price > 0),
  target_price numeric not null check (target_price > 0),
  spread numeric not null default 0 check (spread >= 0),
  slippage_bps numeric not null default 0 check (slippage_bps >= 0),
  fees numeric not null default 0 check (fees >= 0),
  qty numeric not null check (qty > 0),

  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  exit_price numeric check (exit_price > 0),
  exit_reason text check (exit_reason in ('STOP', 'TARGET', 'MANUAL')),
  pnl numeric,
  r_multiple numeric,

  reason_codes text[] not null default '{}',
  feature_snapshot jsonb,

  -- The trading session (LONDON or NEW_YORK - brief S3) that produced this
  -- setup; drives the frequency-diagnostics rollup below and the
  -- maxTradesPerSession=3 cap (enforced in application code,
  -- lib/strategy-platform/gold/scan.ts - this column is the audit trail
  -- for that cap, not a second enforcement point).
  session text not null check (session in ('LONDON', 'NEW_YORK')),

  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint jeanfx_gold_paper_trades_closed_fields check (
    (status = 'OPEN' and exit_price is null and exit_reason is null and pnl is null and r_multiple is null and closed_at is null)
    or
    (status = 'CLOSED' and exit_price is not null and exit_reason is not null and pnl is not null and r_multiple is not null and closed_at is not null)
  )
);
create index jeanfx_gold_paper_trades_user_idx on jeanfx_gold_paper_trades (user_id);
create index jeanfx_gold_paper_trades_assignment_idx on jeanfx_gold_paper_trades (strategy_assignment_id);
create index jeanfx_gold_paper_trades_status_idx on jeanfx_gold_paper_trades (status);

alter table jeanfx_gold_paper_trades enable row level security;

create policy "jeanfx_gold_paper_trades_select" on jeanfx_gold_paper_trades
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "jeanfx_gold_paper_trades_insert" on jeanfx_gold_paper_trades
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
    and strategy_assignment_id in (select id from strategy_assignments where user_id = (select auth.uid()))
  );

create policy "jeanfx_gold_paper_trades_update" on jeanfx_gold_paper_trades
  for update to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest')
  with check (user_id = (select auth.uid()));

-- No delete policy: a PAPER trade record is evidence, not scratch state -
-- closing a trade is an UPDATE (status -> CLOSED), never a DELETE.

-- ---------------------------------------------------------------------------
-- jeanfx_gold_session_diagnostics: frequency diagnostics (brief S13), one
-- row per (assignment, session date, session-name), incremented as each
-- scan runs - never recomputed by replaying trades, since a rejected setup
-- (RR too low, risk cap, no signal at all) never produces a trade row to
-- replay from.
-- ---------------------------------------------------------------------------
create table jeanfx_gold_session_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  strategy_assignment_id uuid not null references strategy_assignments(id),
  session_date date not null,
  session text not null check (session in ('LONDON', 'NEW_YORK')),

  liquidity_sweeps integer not null default 0,
  mss_bos integer not null default 0,
  fvgs integer not null default 0,
  retraces integer not null default 0,
  confirmations integer not null default 0,
  ready_setups integer not null default 0,
  rr_rejected integer not null default 0,
  risk_rejected integer not null default 0,
  executed integer not null default 0,

  updated_at timestamptz not null default now(),
  unique (strategy_assignment_id, session_date, session)
);
create index jeanfx_gold_session_diagnostics_user_idx on jeanfx_gold_session_diagnostics (user_id);

alter table jeanfx_gold_session_diagnostics enable row level security;

create policy "jeanfx_gold_session_diagnostics_select" on jeanfx_gold_session_diagnostics
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "jeanfx_gold_session_diagnostics_insert" on jeanfx_gold_session_diagnostics
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
    and strategy_assignment_id in (select id from strategy_assignments where user_id = (select auth.uid()))
  );

create policy "jeanfx_gold_session_diagnostics_update" on jeanfx_gold_session_diagnostics
  for update to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest')
  with check (user_id = (select auth.uid()));

-- No anonymous policies on either table above: default-deny covers anon/public.
