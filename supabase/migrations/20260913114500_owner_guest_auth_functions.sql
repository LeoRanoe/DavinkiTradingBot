-- Owner-only guest account management without exposing a service-role key.
-- These SECURITY DEFINER functions are deliberately narrow and verify the
-- caller's server-managed app_metadata role before touching auth tables.

create or replace function public.owner_list_auth_users()
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'owner' then
    raise insufficient_privilege using message = 'Owner access required';
  end if;

  return query
  select
    u.id,
    coalesce(u.email, '')::text,
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    case when u.raw_app_meta_data ->> 'role' = 'owner' then 'owner' else 'guest' end,
    u.created_at,
    u.last_sign_in_at
  from auth.users u
  where u.deleted_at is null
    and coalesce(u.raw_app_meta_data ->> 'role', 'guest') in ('owner', 'guest')
  order by u.created_at;
end;
$$;

create or replace function public.owner_create_guest(
  p_email text,
  p_password text,
  p_display_name text default null
)
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := extensions.gen_random_uuid();
  normalized_email text := lower(trim(p_email));
  now_at timestamptz := now();
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'owner' then
    raise insufficient_privilege using message = 'Owner access required';
  end if;
  if length(normalized_email) > 320 or position('@' in normalized_email) < 2 then
    raise invalid_parameter_value using message = 'Invalid email address';
  end if;
  if length(p_password) < 12 or length(p_password) > 128 then
    raise invalid_parameter_value using message = 'Password must be 12 to 128 characters';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated',
    'authenticated', normalized_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now_at, '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'guest'),
    jsonb_build_object(
      'sub', new_id::text, 'email', normalized_email,
      'display_name', nullif(trim(p_display_name), ''),
      'email_verified', true, 'phone_verified', false
    ),
    now_at, now_at
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    new_id::text, new_id,
    jsonb_build_object('sub', new_id::text, 'email', normalized_email, 'email_verified', true, 'phone_verified', false),
    'email', now_at, now_at, now_at
  );

  insert into public.audit_events (actor, action, metadata)
  values (
    coalesce(auth.jwt() ->> 'email', auth.uid()::text),
    'guest_created',
    jsonb_build_object('guest_user_id', new_id, 'guest_email', normalized_email)
  );

  return query select new_id, normalized_email, nullif(trim(p_display_name), ''), 'guest'::text, now_at, null::timestamptz;
end;
$$;

create or replace function public.owner_reset_guest_password(p_user_id uuid, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  guest_email text;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'owner' then
    raise insufficient_privilege using message = 'Owner access required';
  end if;
  if length(p_password) < 12 or length(p_password) > 128 then
    raise invalid_parameter_value using message = 'Password must be 12 to 128 characters';
  end if;

  select u.email into guest_email
  from auth.users u
  where u.id = p_user_id and u.raw_app_meta_data ->> 'role' = 'guest';
  if guest_email is null then
    raise no_data_found using message = 'Guest not found';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  insert into public.audit_events (actor, action, metadata)
  values (
    coalesce(auth.jwt() ->> 'email', auth.uid()::text),
    'guest_password_reset',
    jsonb_build_object('guest_user_id', p_user_id, 'guest_email', guest_email)
  );
  return guest_email;
end;
$$;

create or replace function public.owner_delete_guest(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  guest_email text;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'owner' then
    raise insufficient_privilege using message = 'Owner access required';
  end if;
  if p_user_id = auth.uid() then
    raise invalid_parameter_value using message = 'The owner account cannot be deleted';
  end if;

  select u.email into guest_email
  from auth.users u
  where u.id = p_user_id and u.raw_app_meta_data ->> 'role' = 'guest';
  if guest_email is null then
    raise no_data_found using message = 'Guest not found';
  end if;

  insert into public.audit_events (actor, action, metadata)
  values (
    coalesce(auth.jwt() ->> 'email', auth.uid()::text),
    'guest_deleted',
    jsonb_build_object('guest_user_id', p_user_id, 'guest_email', guest_email)
  );
  delete from auth.users where id = p_user_id;
  return guest_email;
end;
$$;

revoke all on function public.owner_list_auth_users() from public, anon;
revoke all on function public.owner_create_guest(text, text, text) from public, anon;
revoke all on function public.owner_reset_guest_password(uuid, text) from public, anon;
revoke all on function public.owner_delete_guest(uuid) from public, anon;

grant execute on function public.owner_list_auth_users() to authenticated;
grant execute on function public.owner_create_guest(text, text, text) to authenticated;
grant execute on function public.owner_reset_guest_password(uuid, text) to authenticated;
grant execute on function public.owner_delete_guest(uuid) to authenticated;
