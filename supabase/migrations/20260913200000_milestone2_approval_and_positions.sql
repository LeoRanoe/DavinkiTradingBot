-- Task A / Milestone 2: Telegram approval + PAPER position lifecycle.
--
-- ADDITIVE ONLY. Nothing existing is dropped, relaxed, or overwritten.
--
-- State model (deliberately ONE machine, not two):
--   signals.approval_status  PENDING -> OPENING -> APPROVED | REJECTED | ERROR
--                            plus EXPIRED and NOT_APPLICABLE
--   trades.status            OPEN -> CLOSED | CANCELLED | REJECTED
--   trades.exit_reason       STOP | TARGET | MANUAL
-- `signals.rejection_reason` (Milestone 1) still says WHAT rejected a
-- candidate; `signals.owner_decision` (added here) says the owner did.
-- REJECTED_BY_OWNER is therefore approval_status='REJECTED' AND
-- owner_decision='REJECTED', with no second status column.

-- OPENING is the atomic claim state: exactly one caller can move a candidate
-- PENDING -> OPENING, which is what makes double-taps, webhook retries and
-- concurrent function invocations safe. ERROR records an execution that
-- could not be completed safely.
alter type signal_approval_status add value if not exists 'OPENING';
alter type signal_approval_status add value if not exists 'ERROR';

-- ---------------------------------------------------------------------------
-- signals: owner decision audit trail.
-- ---------------------------------------------------------------------------
alter table public.signals
  add column if not exists owner_decision text,
  add column if not exists decision_at timestamptz,
  add column if not exists decision_source text,
  add column if not exists approval_delay_ms bigint,
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signals_owner_decision_valid') then
    alter table public.signals add constraint signals_owner_decision_valid
      check (owner_decision is null or owner_decision in ('APPROVED', 'REJECTED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'signals_decision_source_valid') then
    alter table public.signals add constraint signals_decision_source_valid
      check (decision_source is null or decision_source in ('TELEGRAM', 'DASHBOARD'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'signals_approval_delay_non_negative') then
    alter table public.signals add constraint signals_approval_delay_non_negative
      check (approval_delay_ms is null or approval_delay_ms >= 0);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- trades: the executed position and its settlement.
-- `fees` (existing) stays the round-trip total; the split below exists so a
-- settlement can be audited without double-counting either leg. Realized
-- slippage is embedded in the fill prices and recorded in `slippage` for
-- reporting only - it is never deducted from `pnl` a second time.
-- ---------------------------------------------------------------------------
alter table public.trades
  add column if not exists exit_reason text,
  add column if not exists entry_fee numeric,
  add column if not exists exit_fee numeric,
  add column if not exists risk_budget numeric,
  add column if not exists modeled_max_loss numeric,
  add column if not exists equity_after numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trades_exit_reason_valid') then
    alter table public.trades add constraint trades_exit_reason_valid
      check (exit_reason is null or exit_reason in ('STOP', 'TARGET', 'MANUAL'));
  end if;
end;
$$;

-- EXACTLY ONE position per candidate, guaranteed by the database rather than
-- by application logic. A duplicate Telegram callback, a Vercel retry, or two
-- concurrent serverless invocations can at most produce one trade row; the
-- loser gets a unique-violation and reports ALREADY_PROCESSED.
create unique index if not exists trades_one_per_signal
  on public.trades (signal_id)
  where signal_id is not null;

create index if not exists trades_open_by_mode_idx
  on public.trades (trading_mode, status)
  where status = 'OPEN';

-- ---------------------------------------------------------------------------
-- RLS: the scanner must be able to settle positions and sweep expired
-- candidates. This GRANTS a narrow new capability to the scanner principal
-- only - no existing policy is modified or widened.
-- ---------------------------------------------------------------------------
drop policy if exists scanner_update_signals on public.signals;
create policy scanner_update_signals on public.signals
  for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

comment on column public.signals.owner_decision is
  'The owner''s explicit decision on this candidate. REJECTED here (with approval_status REJECTED) is the REJECTED_BY_OWNER lifecycle state; an engine rejection leaves this null and sets rejection_reason instead.';
comment on column public.signals.approval_delay_ms is
  'Milliseconds between the candidate being offered and the owner deciding. Kept for Milestone 4 counterfactual analysis.';
comment on column public.trades.modeled_max_loss is
  'The modeled worst case at open (price risk + fees + slippage). Used as the denominator for realized R so a clean stop-out is about -1.0R after costs.';
