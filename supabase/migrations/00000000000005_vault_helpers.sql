-- Supabase Vault helper RPCs for dashboard-managed integration credentials.
-- vault.decrypted_secrets / vault.create_secret / vault.update_secret are not
-- directly callable by the service role by default; these SECURITY DEFINER
-- wrappers expose exactly the two operations the app needs, restricted to
-- the service_role (server-only, via createAdminClient()). Never granted to
-- anon/authenticated - dashboard-managed secrets must never be readable via
-- PostgREST from the browser.

create function app_vault_get_secret(secret_name text)
returns text
language sql
security definer
set search_path = vault, pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

revoke execute on function app_vault_get_secret(text) from public, anon, authenticated;
grant execute on function app_vault_get_secret(text) to service_role;

create function app_vault_set_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
set search_path = vault, pg_temp
as $$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.secrets where name = secret_name;
  if existing_id is not null then
    perform vault.update_secret(existing_id, secret_value);
  else
    perform vault.create_secret(secret_value, secret_name);
  end if;
end;
$$;

revoke execute on function app_vault_set_secret(text, text) from public, anon, authenticated;
grant execute on function app_vault_set_secret(text, text) to service_role;
