-- Milestone 4: research and learning are additive and never become account truth.
alter table signals add column if not exists decision_snapshot jsonb;
alter table trades add column if not exists gross_pnl numeric;
alter table trades add column if not exists equity_before numeric;
alter table trades add column if not exists mfe_price numeric;
alter table trades add column if not exists mae_price numeric;
alter table trades add column if not exists mfe_r numeric;
alter table trades add column if not exists mae_r numeric;
alter table trade_reviews add column if not exists factual_review jsonb;
alter table trade_reviews add column if not exists ai_interpretation jsonb;

create table if not exists counterfactual_outcomes (
  id uuid primary key default gen_random_uuid(), signal_id uuid not null unique references signals(id) on delete cascade,
  is_hypothetical boolean not null default true check (is_hypothetical), source text not null check (source in ('OWNER_REJECTED','RISK_BLOCKED')),
  rejection_reason text, plan_snapshot jsonb not null, outcome text not null default 'UNRESOLVED' check (outcome in ('UNRESOLVED','NO_ENTRY','STOP','TARGET','EXPIRED')),
  entry_time timestamptz, exit_time timestamptz, entry_price numeric, exit_price numeric, r_multiple numeric,
  mfe_price numeric, mae_price numeric, mfe_r numeric, mae_r numeric, conservative_ambiguous_candle boolean not null default false,
  evaluated_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists counterfactual_outcomes_source_idx on counterfactual_outcomes(source, outcome);

create table if not exists research_hypotheses (
  id uuid primary key default gen_random_uuid(), source text not null check (source in ('DETERMINISTIC_ANALYTICS','QWEN','OWNER')),
  description text not null, supporting_metrics jsonb not null default '{}'::jsonb, sample_count integer not null default 0,
  evidence_level text not null check (evidence_level in ('NO_DATA','EXTREMELY_LOW_EVIDENCE','LOW_EVIDENCE','INITIAL_EVIDENCE')),
  proposed_strategy_change jsonb, status text not null default 'PROPOSED' check (status in ('PROPOSED','TESTING','REJECTED','VALIDATED','OWNER_APPROVED','ARCHIVED')),
  created_at timestamptz not null default now()
);
create table if not exists strategy_experiments (
  id uuid primary key default gen_random_uuid(), base_strategy_version_id uuid not null references strategy_versions(id), experimental_strategy_version_id uuid references strategy_versions(id),
  hypothesis_id uuid references research_hypotheses(id), changed_parameters jsonb not null, dataset_snapshot jsonb not null,
  development_range tstzrange not null, validation_range tstzrange not null, holdout_range tstzrange not null,
  results jsonb, status text not null default 'DRAFT' check (status in ('DRAFT','RUNNING','COMPLETE','REJECTED','OWNER_APPROVED','ARCHIVED')),
  holdout_consumed_at timestamptz, created_at timestamptz not null default now(),
  check (upper(development_range) <= lower(validation_range) and upper(validation_range) <= lower(holdout_range))
);
create table if not exists research_backfill_jobs (
  id uuid primary key default gen_random_uuid(), symbol text not null, timeframe text not null, resume_end timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','PAUSED','COMPLETE','FAILED')),
  records_written integer not null default 0, error_summary text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(symbol, timeframe)
);

-- Rejections are automatically queued, not executed. A later research job may
-- settle these rows with historical candles; no trigger ever touches trades,
-- portfolio snapshots, or daily performance.
create or replace function public.queue_rejected_counterfactual() returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.approval_status = 'REJECTED' and new.rejection_reason is not null)
     or (tg_op = 'UPDATE' and old.approval_status = 'PENDING' and new.approval_status = 'REJECTED') then
    insert into counterfactual_outcomes(signal_id, source, rejection_reason, plan_snapshot)
    values (new.id, case when new.owner_decision = 'REJECTED' then 'OWNER_REJECTED' else 'RISK_BLOCKED' end, new.rejection_reason,
      coalesce(new.decision_snapshot, jsonb_build_object('entryPrice',new.entry_price,'stopPrice',new.stop_price,'targetPrice',new.target_price,'expiresAt',new.expires_at)))
    on conflict (signal_id) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists signals_queue_rejected_counterfactual on signals;
create trigger signals_queue_rejected_counterfactual after insert or update of approval_status on signals for each row execute function public.queue_rejected_counterfactual();

alter table counterfactual_outcomes enable row level security;
alter table research_hypotheses enable row level security;
alter table strategy_experiments enable row level security;
alter table research_backfill_jobs enable row level security;
create policy "authenticated_read" on counterfactual_outcomes for select to authenticated using (true);
create policy "authenticated_read" on research_hypotheses for select to authenticated using (true);
create policy "authenticated_read" on strategy_experiments for select to authenticated using (true);
create policy "authenticated_read" on research_backfill_jobs for select to authenticated using (true);

-- The existing scanner principal can queue research rows through the trigger;
-- it receives no broader trading privilege. Owner-authenticated writes are
-- limited to research hypotheses/experiments, never active execution state.
create policy "scanner_insert_counterfactual_outcomes" on counterfactual_outcomes for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy "owner_write_research_hypotheses" on research_hypotheses for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');
create policy "owner_write_strategy_experiments" on strategy_experiments for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');
create policy "owner_write_research_backfill_jobs" on research_backfill_jobs for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');
