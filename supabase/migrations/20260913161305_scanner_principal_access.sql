-- Backfilled from the deployed migration ledger (version 20260913161305).
-- Dedicated scanner principal: the Cron path signs in as a scanner-role
-- Supabase user and gets exactly the table grants the scan job needs -
-- no service-role key in the serverless runtime.

create or replace function public.get_davinki_scanner_credentials()
returns jsonb language sql security definer set search_path=''
as $$ select jsonb_build_object('email','scanner@davinki.internal','password',decrypted_secret) from vault.decrypted_secrets where name='davinki_scanner_password' limit 1; $$;
revoke all on function public.get_davinki_scanner_credentials() from public,anon,authenticated;
grant execute on function public.get_davinki_scanner_credentials() to service_role;

drop policy if exists scanner_insert_job_runs on public.job_runs;
create policy scanner_insert_job_runs on public.job_runs for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_update_job_runs on public.job_runs;
create policy scanner_update_job_runs on public.job_runs for update to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='scanner') with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_insert_candles on public.candles;
create policy scanner_insert_candles on public.candles for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_update_candles on public.candles;
create policy scanner_update_candles on public.candles for update to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='scanner') with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_insert_instrument_metadata on public.instrument_metadata;
create policy scanner_insert_instrument_metadata on public.instrument_metadata for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_update_instrument_metadata on public.instrument_metadata;
create policy scanner_update_instrument_metadata on public.instrument_metadata for update to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='scanner') with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_insert_signals on public.signals;
create policy scanner_insert_signals on public.signals for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_insert_signal_components on public.signal_components;
create policy scanner_insert_signal_components on public.signal_components for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_update_trades on public.trades;
create policy scanner_update_trades on public.trades for update to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='scanner') with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_insert_trade_events on public.trade_events;
create policy scanner_insert_trade_events on public.trade_events for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
drop policy if exists scanner_insert_portfolio_snapshots on public.portfolio_snapshots;
create policy scanner_insert_portfolio_snapshots on public.portfolio_snapshots for insert to authenticated with check (((select auth.jwt())->'app_metadata'->>'role')='scanner');
