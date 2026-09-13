-- Defense in depth for the private owner/guest application. GoTrue public
-- sign-up cannot set app_metadata, while owner-created guests and the internal
-- scanner are inserted with an explicit server-controlled role.
create or replace function public.enforce_private_auth_user_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'role', '') not in ('owner', 'guest', 'scanner') then
    raise insufficient_privilege using message = 'Public signup is disabled';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_private_auth_user_creation on auth.users;
create trigger enforce_private_auth_user_creation
before insert on auth.users
for each row execute function public.enforce_private_auth_user_creation();

revoke all on function public.enforce_private_auth_user_creation() from public, anon, authenticated;
