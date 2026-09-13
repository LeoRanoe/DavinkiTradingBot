-- The oldest existing account is the private application owner. All accounts
-- created later by the owner-managed access screen are explicit guests.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"owner"}'::jsonb
where id = (select id from auth.users order by created_at asc limit 1)
  and coalesce(raw_app_meta_data->>'role', '') = '';

-- Guests may inspect the dashboard, but only the owner may mutate trading
-- state, approve signals, or view integration credential metadata.
drop policy if exists "authenticated_update_settings" on public.system_settings;
create policy "owner_update_settings" on public.system_settings
  for update to authenticated
  using ((select auth.jwt())->'app_metadata'->>'role' = 'owner')
  with check (
    (select auth.jwt())->'app_metadata'->>'role' = 'owner'
    and live_trading_enabled = false
  );

drop policy if exists "authenticated_update_lessons" on public.lessons;
create policy "owner_update_lessons" on public.lessons
  for update to authenticated
  using ((select auth.jwt())->'app_metadata'->>'role' = 'owner')
  with check ((select auth.jwt())->'app_metadata'->>'role' = 'owner');

drop policy if exists "authenticated_approve_signal" on public.signals;
create policy "owner_approve_signal" on public.signals
  for update to authenticated
  using ((select auth.jwt())->'app_metadata'->>'role' = 'owner')
  with check ((select auth.jwt())->'app_metadata'->>'role' = 'owner');

drop policy if exists "authenticated_insert" on public.audit_events;
create policy "owner_insert_audit" on public.audit_events
  for insert to authenticated
  with check ((select auth.jwt())->'app_metadata'->>'role' = 'owner');

drop policy if exists "authenticated_read" on public.integration_credentials;
create policy "owner_read_integrations" on public.integration_credentials
  for select to authenticated
  using ((select auth.jwt())->'app_metadata'->>'role' = 'owner');

-- Optimize the existing profile policies while touching authorization.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
