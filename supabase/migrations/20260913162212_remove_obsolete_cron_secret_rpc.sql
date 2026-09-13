-- Backfilled from the deployed migration ledger (version 20260913162212).
-- The Cron path now authenticates with a short-lived scanner JWT, so the
-- cron-secret RPC is obsolete and is removed rather than left reachable.
drop function if exists public.get_davinki_cron_secret();
