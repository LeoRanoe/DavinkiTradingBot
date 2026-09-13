-- Core schema for the Autonomous AI Trading Coach.
-- Single-user private application. RLS restricts all data-API access to
-- authenticated users; privileged writes happen through server-side code
-- using the secret key, which bypasses RLS by design (service role).

create type trading_mode as enum ('OBSERVE', 'PAPER', 'DEMO', 'LIVE');
create type strategy_status as enum ('DRAFT', 'BACKTESTING', 'PAPER_APPROVED', 'DEMO_APPROVED', 'RETIRED');
create type signal_classification as enum ('IGNORE', 'LOG', 'WATCH', 'CANDIDATE');
create type signal_approval_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'NOT_APPLICABLE');
create type trade_status as enum ('OPEN', 'CLOSED', 'CANCELLED', 'REJECTED');
create type trade_side as enum ('LONG');
create type order_status as enum ('PENDING', 'SUBMITTED', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'UNKNOWN');
create type lesson_status as enum ('UNREAD', 'READ', 'COMPLETED');
create type job_status as enum ('RUNNING', 'SUCCEEDED', 'FAILED', 'NOOP');
create type backtest_split as enum ('DEVELOPMENT', 'VALIDATION', 'HOLDOUT');

-- ---------------------------------------------------------------------------
-- profiles: mirrors auth.users for the (single) app owner.
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- system_settings: singleton row holding the live trading mode.
-- ---------------------------------------------------------------------------
create table system_settings (
  id boolean primary key default true constraint single_row check (id = true),
  trading_mode trading_mode not null default 'OBSERVE',
  live_trading_enabled boolean not null default false constraint live_never_enabled check (live_trading_enabled = false),
  max_risk_per_trade_pct numeric(6, 4) not null default 0.01,
  max_open_positions integer not null default 1,
  max_new_trades_per_day integer not null default 2,
  max_losing_trades_per_day integer not null default 2,
  signal_expiry_minutes integer not null default 30,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
insert into system_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- strategy_versions: immutable strategy definitions.
-- ---------------------------------------------------------------------------
create table strategy_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null unique,
  name text not null,
  description text,
  status strategy_status not null default 'DRAFT',
  parameters jsonb not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);

create table strategy_parameters (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id) on delete cascade,
  key text not null,
  value jsonb not null,
  unique (strategy_version_id, key)
);

-- ---------------------------------------------------------------------------
-- Market data
-- ---------------------------------------------------------------------------
create table instrument_metadata (
  symbol text primary key,
  base_coin text not null,
  quote_coin text not null,
  tick_size numeric not null,
  qty_step numeric not null,
  min_order_qty numeric not null,
  min_order_amt numeric not null,
  max_order_qty numeric,
  price_scale integer not null default 2,
  raw jsonb not null,
  updated_at timestamptz not null default now()
);

create table candles (
  id bigint generated always as identity primary key,
  symbol text not null,
  timeframe text not null,
  open_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  is_closed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (symbol, timeframe, open_time)
);
create index candles_symbol_timeframe_time_idx on candles (symbol, timeframe, open_time desc);

-- ---------------------------------------------------------------------------
-- Signals
-- ---------------------------------------------------------------------------
create table signals (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id),
  symbol text not null,
  timeframe text not null,
  candle_time timestamptz not null,
  regime text not null,
  score integer not null check (score between 0 and 100),
  classification signal_classification not null,
  entry_price numeric,
  stop_price numeric,
  target_price numeric,
  risk_reward numeric,
  reason text,
  approval_status signal_approval_status not null default 'NOT_APPLICABLE',
  expires_at timestamptz,
  approved_at timestamptz,
  ai_explanation jsonb,
  created_at timestamptz not null default now(),
  unique (strategy_version_id, symbol, timeframe, candle_time)
);
create index signals_symbol_time_idx on signals (symbol, candle_time desc);
create index signals_classification_idx on signals (classification);

create table signal_components (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references signals(id) on delete cascade,
  component_name text not null,
  points_earned numeric not null,
  points_possible numeric not null,
  detail jsonb,
  unique (signal_id, component_name)
);

-- ---------------------------------------------------------------------------
-- Trading: trades, orders, events
-- ---------------------------------------------------------------------------
create table trades (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references signals(id),
  strategy_version_id uuid not null references strategy_versions(id),
  trading_mode trading_mode not null,
  symbol text not null,
  side trade_side not null default 'LONG',
  status trade_status not null default 'OPEN',
  rejection_reason text,
  entry_price numeric,
  stop_price numeric,
  target_price numeric,
  qty numeric,
  notional numeric,
  risk_amount numeric,
  risk_reward numeric,
  exit_price numeric,
  fees numeric not null default 0,
  slippage numeric not null default 0,
  pnl numeric,
  r_multiple numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint live_trades_forbidden check (trading_mode <> 'LIVE')
);
create index trades_mode_status_idx on trades (trading_mode, status);
create index trades_symbol_idx on trades (symbol);

create table orders (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  trading_mode trading_mode not null,
  client_order_id text not null unique,
  exchange_order_id text,
  side trade_side not null default 'LONG',
  order_type text not null,
  qty numeric not null,
  price numeric,
  status order_status not null default 'PENDING',
  submitted_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint live_orders_forbidden check (trading_mode <> 'LIVE')
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table trade_events (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------
create table portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  trading_mode trading_mode not null,
  equity numeric not null,
  balance numeric not null,
  open_risk numeric not null default 0,
  taken_at timestamptz not null default now()
);
create index portfolio_snapshots_mode_time_idx on portfolio_snapshots (trading_mode, taken_at desc);

create table daily_performance (
  id uuid primary key default gen_random_uuid(),
  trading_mode trading_mode not null,
  perf_date date not null,
  trades_count integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  net_pnl numeric not null default 0,
  gross_pnl numeric not null default 0,
  fees numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (trading_mode, perf_date)
);

create table weekly_reports (
  id uuid primary key default gen_random_uuid(),
  trading_mode trading_mode not null,
  week_start date not null,
  week_end date not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  unique (trading_mode, week_start)
);

-- ---------------------------------------------------------------------------
-- Backtests
-- ---------------------------------------------------------------------------
create table backtests (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id),
  symbol text not null,
  split backtest_split not null,
  date_from timestamptz not null,
  date_to timestamptz not null,
  fee_bps numeric not null,
  slippage_bps numeric not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

create table backtest_trades (
  id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references backtests(id) on delete cascade,
  symbol text not null,
  entry_time timestamptz not null,
  exit_time timestamptz,
  entry_price numeric not null,
  exit_price numeric,
  stop_price numeric not null,
  target_price numeric not null,
  qty numeric not null,
  fees numeric not null default 0,
  pnl numeric,
  r_multiple numeric,
  score integer,
  regime text,
  outcome text
);
create index backtest_trades_backtest_idx on backtest_trades (backtest_id);

-- ---------------------------------------------------------------------------
-- Knowledge base (structured + semantic memory)
-- ---------------------------------------------------------------------------
create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null,
  content text not null,
  strategy_version_id uuid references strategy_versions(id),
  created_at timestamptz not null default now()
);

create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(1024),
  embedding_model text,
  embedding_version text,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index knowledge_chunks_embedding_idx on knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table trade_reviews (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null unique references trades(id) on delete cascade,
  ai_summary jsonb,
  created_at timestamptz not null default now()
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null,
  related_signal_id uuid references signals(id),
  related_trade_id uuid references trades(id),
  status lesson_status not null default 'UNREAD',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status job_status not null default 'RUNNING',
  records_processed integer not null default 0,
  error_summary text,
  metadata jsonb
);
create index job_runs_name_started_idx on job_runs (job_name, started_at desc);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on audit_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Integration credentials (Supabase Vault-backed, non-secret metadata only).
-- The actual secret lives in vault.secrets; this table stores a pointer plus
-- non-secret config (base_url, model, chat id, etc).
-- ---------------------------------------------------------------------------
create table integration_credentials (
  id uuid primary key default gen_random_uuid(),
  integration text not null unique, -- 'qwen' | 'telegram' | 'bybit_demo'
  vault_secret_name text, -- name used in vault.create_secret
  config jsonb not null default '{}'::jsonb,
  status text not null default 'NOT_CONFIGURED',
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
