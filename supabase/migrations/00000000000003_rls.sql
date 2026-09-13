-- Row Level Security: this is a single-user private application.
-- Any authenticated user (the owner, who is the only person who can sign up
-- since there is no public sign-up flow exposed) may read all trading data.
-- Anonymous (unauthenticated) requests are denied everywhere.
-- All privileged writes (signal creation, order placement, settings changes)
-- happen through server-side code using the Supabase secret key, which uses
-- the postgres role and bypasses RLS - so write policies here mainly cover
-- authenticated dashboard actions (approve/reject signal, settings toggles).

alter table profiles enable row level security;
alter table system_settings enable row level security;
alter table strategy_versions enable row level security;
alter table strategy_parameters enable row level security;
alter table instrument_metadata enable row level security;
alter table candles enable row level security;
alter table signals enable row level security;
alter table signal_components enable row level security;
alter table trades enable row level security;
alter table orders enable row level security;
alter table order_events enable row level security;
alter table trade_events enable row level security;
alter table portfolio_snapshots enable row level security;
alter table daily_performance enable row level security;
alter table weekly_reports enable row level security;
alter table backtests enable row level security;
alter table backtest_trades enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;
alter table trade_reviews enable row level security;
alter table lessons enable row level security;
alter table job_runs enable row level security;
alter table audit_events enable row level security;
alter table integration_credentials enable row level security;

-- profiles: a user may only see/update their own profile row.
create policy "profiles_select_own" on profiles for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on profiles for update to authenticated using (id = auth.uid());

-- Read-only reference/market/analytics data: any authenticated user.
create policy "authenticated_read" on system_settings for select to authenticated using (true);
create policy "authenticated_read" on strategy_versions for select to authenticated using (true);
create policy "authenticated_read" on strategy_parameters for select to authenticated using (true);
create policy "authenticated_read" on instrument_metadata for select to authenticated using (true);
create policy "authenticated_read" on candles for select to authenticated using (true);
create policy "authenticated_read" on signals for select to authenticated using (true);
create policy "authenticated_read" on signal_components for select to authenticated using (true);
create policy "authenticated_read" on trades for select to authenticated using (true);
create policy "authenticated_read" on orders for select to authenticated using (true);
create policy "authenticated_read" on order_events for select to authenticated using (true);
create policy "authenticated_read" on trade_events for select to authenticated using (true);
create policy "authenticated_read" on portfolio_snapshots for select to authenticated using (true);
create policy "authenticated_read" on daily_performance for select to authenticated using (true);
create policy "authenticated_read" on weekly_reports for select to authenticated using (true);
create policy "authenticated_read" on backtests for select to authenticated using (true);
create policy "authenticated_read" on backtest_trades for select to authenticated using (true);
create policy "authenticated_read" on knowledge_documents for select to authenticated using (true);
create policy "authenticated_read" on knowledge_chunks for select to authenticated using (true);
create policy "authenticated_read" on trade_reviews for select to authenticated using (true);
create policy "authenticated_read" on lessons for select to authenticated using (true);
create policy "authenticated_read" on job_runs for select to authenticated using (true);
create policy "authenticated_read" on audit_events for select to authenticated using (true);

-- integration_credentials: never expose vault_secret_name contents beyond
-- pointer/status; still restrict to authenticated (owner) only, and the app
-- must never select vault.secrets directly from client-exposed queries.
create policy "authenticated_read" on integration_credentials for select to authenticated using (true);

-- Dashboard-driven mutations allowed for authenticated users (owner).
-- Financial-safety invariants (mode transitions, risk limits) are enforced
-- again in server-side application code regardless of what RLS allows.
create policy "authenticated_update_settings" on system_settings for update to authenticated using (true) with check (live_trading_enabled = false);
create policy "authenticated_update_lessons" on lessons for update to authenticated using (true);
create policy "authenticated_approve_signal" on signals for update to authenticated using (true);

-- No anonymous policies are created anywhere: the default-deny behavior of
-- RLS means anon/public roles have zero access to any table above.
