-- Backfilled from the deployed migration ledger (version 20260913004913).
-- The auth trigger function must not be callable by application roles.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
