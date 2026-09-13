-- The authenticated Edge proxy obtains only the internal scanner principal's
-- credentials. Browser, anon, and ordinary authenticated users cannot call it.
create or replace function public.get_davinki_scanner_credentials()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('email', 'scanner@davinki.internal', 'password', decrypted_secret)
  from vault.decrypted_secrets
  where name = 'davinki_scanner_password'
  limit 1;
$$;

revoke all on function public.get_davinki_scanner_credentials() from public, anon, authenticated;
grant execute on function public.get_davinki_scanner_credentials() to service_role;

create policy scanner_insert_job_runs on public.job_runs for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_update_job_runs on public.job_runs for update to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_insert_candles on public.candles for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_update_candles on public.candles for update to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_insert_instrument_metadata on public.instrument_metadata for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_update_instrument_metadata on public.instrument_metadata for update to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_insert_signals on public.signals for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_insert_signal_components on public.signal_components for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_update_trades on public.trades for update to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_insert_trade_events on public.trade_events for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
create policy scanner_insert_portfolio_snapshots on public.portfolio_snapshots for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');
