-- Auto-create a profile row when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Security advisor: SECURITY DEFINER functions are exposed via PostgREST RPC
-- by default. This function must only run as the auth trigger, never as a
-- callable RPC for anon/authenticated roles.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
