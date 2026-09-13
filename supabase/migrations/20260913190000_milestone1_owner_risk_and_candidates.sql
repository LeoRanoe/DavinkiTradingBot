-- Task A / Milestone 1: owner-configurable risk settings and complete
-- trade-candidate snapshot persistence.
--
-- ADDITIVE ONLY. No existing column, value, constraint, policy, or grant is
-- dropped or relaxed anywhere in this migration. Existing columns already
-- cover several Milestone 1 settings and are deliberately REUSED rather than
-- duplicated:
--   max_risk_per_trade_pct    -> percentage risk (PERCENT_OF_EQUITY mode)
--   max_open_positions        -> max concurrent open positions
--   max_new_trades_per_day    -> max trades per UTC day
--   max_losing_trades_per_day -> the daily-loss lock
--   signal_expiry_minutes     -> approval window for an already-sent candidate
-- Only genuinely new settings are added below.

-- ---------------------------------------------------------------------------
-- system_settings: new owner-configurable risk configuration.
-- ---------------------------------------------------------------------------
alter table public.system_settings
  add column if not exists risk_mode text not null default 'PERCENT_OF_EQUITY',
  add column if not exists fixed_risk_amount numeric(12, 4) not null default 1,
  add column if not exists min_candidate_score integer not null default 80,
  add column if not exists min_risk_reward numeric(6, 2) not null default 1.5,
  add column if not exists max_entry_drift_pct numeric(8, 6) not null default 0.002,
  add column if not exists candidate_expiry_minutes integer not null default 10,
  add column if not exists max_market_data_age_seconds integer not null default 120,
  add column if not exists max_atr_pct numeric(8, 6) not null default 0.05,
  add column if not exists fee_bps numeric(8, 2) not null default 10,
  add column if not exists slippage_bps numeric(8, 2) not null default 5,
  add column if not exists execution_policy text not null default 'APPROVAL_REQUIRED';

-- Server-side validation that no client can bypass. Bounds are deliberately
-- permissive enough never to block a legitimate owner configuration, while
-- making an absurd or accidental value impossible to persist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'system_settings_risk_mode_valid') then
    alter table public.system_settings add constraint system_settings_risk_mode_valid
      check (risk_mode in ('PERCENT_OF_EQUITY', 'FIXED_AMOUNT'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_execution_policy_valid') then
    alter table public.system_settings add constraint system_settings_execution_policy_valid
      check (execution_policy in ('APPROVAL_REQUIRED', 'AUTO'));
  end if;

  -- LIVE remains impossible: a fourth independent layer alongside
  -- live_trading_enabled, the trades/orders CHECK constraints, and the risk
  -- engine. The selected trading mode itself can never be LIVE, and an
  -- automatic execution policy is only ever reachable for PAPER/DEMO.
  if not exists (select 1 from pg_constraint where conname = 'system_settings_mode_never_live') then
    alter table public.system_settings add constraint system_settings_mode_never_live
      check (trading_mode <> 'LIVE');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_auto_never_live') then
    alter table public.system_settings add constraint system_settings_auto_never_live
      check (execution_policy <> 'AUTO' or trading_mode in ('PAPER', 'DEMO'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_risk_pct_bounds') then
    alter table public.system_settings add constraint system_settings_risk_pct_bounds
      check (max_risk_per_trade_pct > 0 and max_risk_per_trade_pct <= 0.10);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_fixed_risk_bounds') then
    alter table public.system_settings add constraint system_settings_fixed_risk_bounds
      check (fixed_risk_amount > 0 and fixed_risk_amount <= 100000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_min_score_bounds') then
    alter table public.system_settings add constraint system_settings_min_score_bounds
      check (min_candidate_score between 0 and 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_min_rr_bounds') then
    alter table public.system_settings add constraint system_settings_min_rr_bounds
      check (min_risk_reward >= 0 and min_risk_reward <= 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_entry_drift_bounds') then
    alter table public.system_settings add constraint system_settings_entry_drift_bounds
      check (max_entry_drift_pct > 0 and max_entry_drift_pct <= 0.5);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_candidate_expiry_bounds') then
    alter table public.system_settings add constraint system_settings_candidate_expiry_bounds
      check (candidate_expiry_minutes between 1 and 240);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_market_data_age_bounds') then
    alter table public.system_settings add constraint system_settings_market_data_age_bounds
      check (max_market_data_age_seconds between 10 and 3600);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_max_atr_bounds') then
    alter table public.system_settings add constraint system_settings_max_atr_bounds
      check (max_atr_pct > 0 and max_atr_pct <= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_fee_bps_bounds') then
    alter table public.system_settings add constraint system_settings_fee_bps_bounds
      check (fee_bps >= 0 and fee_bps <= 1000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_slippage_bps_bounds') then
    alter table public.system_settings add constraint system_settings_slippage_bps_bounds
      check (slippage_bps >= 0 and slippage_bps <= 1000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_open_positions_bounds') then
    alter table public.system_settings add constraint system_settings_open_positions_bounds
      check (max_open_positions between 1 and 10);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_trades_per_day_bounds') then
    alter table public.system_settings add constraint system_settings_trades_per_day_bounds
      check (max_new_trades_per_day between 1 and 50);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_losing_trades_bounds') then
    alter table public.system_settings add constraint system_settings_losing_trades_bounds
      check (max_losing_trades_per_day between 1 and 50);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'system_settings_signal_expiry_bounds') then
    alter table public.system_settings add constraint system_settings_signal_expiry_bounds
      check (signal_expiry_minutes between 1 and 1440);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- signals: the complete trade-candidate snapshot.
--
-- The signals row IS the candidate - there is no separate candidates table
-- and no second state machine. `approval_status` stays the single lifecycle
-- column; `rejection_reason` qualifies WHO/WHAT rejected it:
--   approval_status = 'PENDING'  -> passed deterministic risk, awaiting owner
--   approval_status = 'REJECTED' + rejection_reason not null
--                                -> the deterministic risk/candidate layer
--                                   rejected it (typed reason)
--   approval_status = 'REJECTED' + rejection_reason null
--                                -> the owner rejected it (Milestone 2)
-- Candidate uniqueness continues to rely on the existing unique constraint
-- on (strategy_version_id, symbol, timeframe, candle_time).
-- ---------------------------------------------------------------------------
alter table public.signals
  add column if not exists trading_mode trading_mode,
  add column if not exists reference_price numeric,
  add column if not exists reference_price_at timestamptz,
  add column if not exists planned_entry numeric,
  add column if not exists minimum_allowed_entry numeric,
  add column if not exists maximum_allowed_entry numeric,
  add column if not exists stop_pct numeric,
  add column if not exists volatility_state text,
  add column if not exists rejection_reason text,
  add column if not exists rejection_detail text,
  add column if not exists risk_snapshot jsonb,
  add column if not exists indicator_snapshot jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signals_live_forbidden') then
    alter table public.signals add constraint signals_live_forbidden
      check (trading_mode is null or trading_mode <> 'LIVE');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'signals_volatility_state_valid') then
    alter table public.signals add constraint signals_volatility_state_valid
      check (volatility_state is null or volatility_state in ('NORMAL', 'EXCESSIVE'));
  end if;
end;
$$;

create index if not exists signals_approval_status_idx
  on public.signals (approval_status, created_at desc);

comment on column public.signals.risk_snapshot is
  'Deterministic risk breakdown at candidate build time (equity, risk mode, budget, sizing, fees, slippage, modeled max loss). Milestone 2 reads this instead of recomputing a historical decision.';
comment on column public.signals.indicator_snapshot is
  'Indicator values (EMA/RSI/ATR/relative volume) at the closed candle that produced this candidate.';
comment on column public.signals.rejection_reason is
  'Typed RejectionReason from the deterministic risk/candidate layer. Null when the owner rejected the candidate rather than the engine.';
