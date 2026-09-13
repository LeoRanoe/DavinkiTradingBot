-- Remove the dashboard's dependency on a long-lived service-role key for the
-- two owner operations that already have an authenticated Supabase session:
-- secure integration settings and PAPER trade execution.

create or replace function public.owner_set_integration_configuration(
  p_integration text,
  p_secret text default null,
  p_config jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_name text;
  existing_id uuid;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'owner' then
    raise insufficient_privilege using message = 'Owner access required';
  end if;
  if p_integration not in ('qwen', 'telegram') then
    raise invalid_parameter_value using message = 'Unsupported integration';
  end if;
  if jsonb_typeof(coalesce(p_config, '{}'::jsonb)) <> 'object' then
    raise invalid_parameter_value using message = 'Configuration must be an object';
  end if;

  select ic.vault_secret_name into secret_name
  from public.integration_credentials ic
  where ic.integration = p_integration;

  if nullif(p_secret, '') is not null then
    secret_name := 'davinki_' || p_integration || '_credential';
    select s.id into existing_id from vault.secrets s where s.name = secret_name;
    if existing_id is null then
      perform vault.create_secret(p_secret, secret_name);
    else
      perform vault.update_secret(existing_id, p_secret);
    end if;
  end if;

  insert into public.integration_credentials (
    integration, vault_secret_name, config, status, updated_by, updated_at
  ) values (
    p_integration,
    secret_name,
    coalesce(p_config, '{}'::jsonb),
    case when secret_name is null then 'NOT_CONFIGURED' else 'CONFIGURED' end,
    auth.uid(),
    now()
  )
  on conflict (integration) do update set
    vault_secret_name = coalesce(excluded.vault_secret_name, integration_credentials.vault_secret_name),
    config = coalesce(integration_credentials.config, '{}'::jsonb) || excluded.config,
    status = case
      when coalesce(excluded.vault_secret_name, integration_credentials.vault_secret_name) is null
        then integration_credentials.status
      else 'CONFIGURED'
    end,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_events (actor, action, metadata)
  values (
    coalesce(auth.jwt() ->> 'email', auth.uid()::text),
    'integration_credentials_updated',
    jsonb_build_object('integration', p_integration, 'credential_source', 'vault')
  );
end;
$$;

create or replace function public.owner_get_integration_configuration(p_integration text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'owner' then
    raise insufficient_privilege using message = 'Owner access required';
  end if;
  if p_integration not in ('qwen', 'telegram', 'bybit_demo') then
    raise invalid_parameter_value using message = 'Unsupported integration';
  end if;

  select jsonb_build_object(
    'config', coalesce(ic.config, '{}'::jsonb),
    'secret', ds.decrypted_secret
  ) into result
  from public.integration_credentials ic
  left join vault.decrypted_secrets ds on ds.name = ic.vault_secret_name
  where ic.integration = p_integration;
  return result;
end;
$$;

revoke all on function public.owner_set_integration_configuration(text, text, jsonb) from public, anon;
revoke all on function public.owner_get_integration_configuration(text) from public, anon;
grant execute on function public.owner_set_integration_configuration(text, text, jsonb) to authenticated;
grant execute on function public.owner_get_integration_configuration(text) to authenticated;

create policy owner_insert_paper_trades on public.trades for insert to authenticated
with check (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner'
  and trading_mode = 'PAPER'
);

create policy owner_insert_trade_events on public.trade_events for insert to authenticated
with check (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner'
  and exists (
    select 1 from public.trades t
    where t.id = trade_events.trade_id and t.trading_mode = 'PAPER'
  )
);
