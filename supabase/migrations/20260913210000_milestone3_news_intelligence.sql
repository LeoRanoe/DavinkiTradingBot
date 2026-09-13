-- Task A / Milestone 3: News Intelligence + AI usage accounting.
--
-- ADDITIVE ONLY. No existing table, column, constraint, policy or value is
-- dropped, relaxed or overwritten. Nothing here is readable by the risk
-- engine: news is context for the owner, never an input to sizing,
-- stops, targets, eligibility or execution.
--
-- Schema is deliberately minimal - four concerns, four tables:
--   news_events          the deduplicated real-world event + cached analysis
--   news_event_sources   which syndicated copies collapsed into it, and why
--   candidate_news_links which events a candidate actually used
--   ai_usage_events      what the AI layer cost, in requests and tokens

-- ---------------------------------------------------------------------------
-- news_events: one row per deduplicated real-world event.
-- The AI analysis is cached ON this row rather than in a separate table:
-- there is exactly one current analysis per event, and keeping it here is
-- what makes "never analyse the same event twice" a simple lookup.
-- ---------------------------------------------------------------------------
create table if not exists public.news_events (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  provider text not null,
  source text not null,
  source_quality text not null default 'UNKNOWN',
  headline text not null,
  canonical_url text not null,
  excerpt text,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  category text not null default 'OTHER',
  affected_assets text[] not null default '{}',
  relevance_score numeric(4, 3) not null default 0,
  news_risk text not null default 'UNKNOWN',
  analysis_status text not null default 'NOT_REQUIRED',
  analysis jsonb,
  analysis_model text,
  analyzed_at timestamptz,
  duplicate_count integer not null default 0,
  matched_terms text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint news_events_source_quality_valid
    check (source_quality in ('OFFICIAL', 'HIGH_QUALITY_MEDIA', 'SECONDARY', 'UNKNOWN')),
  constraint news_events_risk_valid
    check (news_risk in ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
  constraint news_events_analysis_status_valid
    check (analysis_status in ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED', 'UNAVAILABLE')),
  constraint news_events_relevance_bounds check (relevance_score >= 0 and relevance_score <= 1),
  -- Excerpts are context, not a copy of the article.
  constraint news_events_excerpt_compact check (excerpt is null or length(excerpt) <= 600)
);

create index if not exists news_events_published_idx on public.news_events (published_at desc);
create index if not exists news_events_assets_idx on public.news_events using gin (affected_assets);
create index if not exists news_events_risk_idx on public.news_events (news_risk, published_at desc);

-- ---------------------------------------------------------------------------
-- news_event_sources: the syndicated copies that collapsed into one event,
-- and the reason each was considered a duplicate. This exists so a
-- deduplication decision can always be explained after the fact.
-- ---------------------------------------------------------------------------
create table if not exists public.news_event_sources (
  id uuid primary key default gen_random_uuid(),
  news_event_id uuid not null references public.news_events(id) on delete cascade,
  provider text not null,
  source text not null,
  canonical_url text not null,
  headline text not null,
  match_reason text not null,
  similarity numeric(4, 3),
  seen_at timestamptz not null default now(),
  unique (news_event_id, canonical_url),
  constraint news_event_sources_reason_valid
    check (match_reason in ('ORIGINAL', 'SAME_CANONICAL_URL', 'SAME_NORMALIZED_HEADLINE', 'SIMILAR_HEADLINE'))
);

create index if not exists news_event_sources_event_idx on public.news_event_sources (news_event_id);

-- ---------------------------------------------------------------------------
-- candidate_news_links: which events a candidate actually used.
-- The authoritative record for DISPLAY is `signals.news_snapshot` (immutable,
-- written once at decision time). This table is the relational index that
-- answers "which candidates referenced this event", which Milestone 4 needs.
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_news_links (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  news_event_id uuid not null references public.news_events(id) on delete restrict,
  relevance_score numeric(4, 3) not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (signal_id, news_event_id)
);

create index if not exists candidate_news_links_signal_idx on public.candidate_news_links (signal_id);
create index if not exists candidate_news_links_event_idx on public.candidate_news_links (news_event_id);

-- ---------------------------------------------------------------------------
-- signals: the immutable news context as it stood at decision time.
-- Viewing an old candidate must show what was known THEN, never what is
-- known now - Milestone 4's counterfactual analysis depends on it.
-- ---------------------------------------------------------------------------
alter table public.signals
  add column if not exists news_risk text,
  add column if not exists news_snapshot jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signals_news_risk_valid') then
    alter table public.signals add constraint signals_news_risk_valid
      check (news_risk is null or news_risk in ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- ai_usage_events: requests and tokens. Deliberately NO dollar figure -
-- reliable per-token pricing for the configured model is not known to this
-- application, and an invented cost is worse than none.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'QWEN',
  model text,
  feature text not null,
  success boolean not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  latency_ms integer,
  error_kind text,
  created_at timestamptz not null default now(),
  constraint ai_usage_feature_valid
    check (feature in ('NEWS_ANALYSIS', 'CANDIDATE_CONTEXT', 'SIGNAL_EXPLANATION', 'TRADE_REVIEW', 'CONNECTION_TEST'))
);

create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_feature_idx on public.ai_usage_events (feature, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: same model as the existing tables. Everyone authenticated reads;
-- only the scanner/ingestion principal writes. No existing policy is touched
-- and no trading table's security changes.
-- ---------------------------------------------------------------------------
alter table public.news_events enable row level security;
alter table public.news_event_sources enable row level security;
alter table public.candidate_news_links enable row level security;
alter table public.ai_usage_events enable row level security;

drop policy if exists authenticated_read on public.news_events;
create policy authenticated_read on public.news_events for select to authenticated using (true);
drop policy if exists authenticated_read on public.news_event_sources;
create policy authenticated_read on public.news_event_sources for select to authenticated using (true);
drop policy if exists authenticated_read on public.candidate_news_links;
create policy authenticated_read on public.candidate_news_links for select to authenticated using (true);
drop policy if exists authenticated_read on public.ai_usage_events;
create policy authenticated_read on public.ai_usage_events for select to authenticated using (true);

drop policy if exists scanner_insert_news_events on public.news_events;
create policy scanner_insert_news_events on public.news_events for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
drop policy if exists scanner_update_news_events on public.news_events;
create policy scanner_update_news_events on public.news_events for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

drop policy if exists scanner_insert_news_event_sources on public.news_event_sources;
create policy scanner_insert_news_event_sources on public.news_event_sources for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

drop policy if exists scanner_insert_candidate_news_links on public.candidate_news_links;
create policy scanner_insert_candidate_news_links on public.candidate_news_links for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

drop policy if exists scanner_insert_ai_usage on public.ai_usage_events;
create policy scanner_insert_ai_usage on public.ai_usage_events for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
drop policy if exists owner_insert_ai_usage on public.ai_usage_events;
create policy owner_insert_ai_usage on public.ai_usage_events for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');

comment on table public.news_events is
  'Deduplicated news events. Context for the owner only - no file under lib/risk/ or lib/strategy/ reads this table.';
comment on column public.signals.news_snapshot is
  'Immutable news context as it stood when this candidate was created. Viewing an old candidate must show what was known then, not what is known now.';
comment on table public.ai_usage_events is
  'AI request/token accounting. No dollar cost is stored: reliable per-token pricing is not known to this application and an invented figure would be worse than none.';
