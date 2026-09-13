# Tasks

- [x] Establish `dev` from the historical Claude implementation.
- [x] Run clean install, lint, typecheck, tests, and production build baseline.
- [x] Remove public signup and convert the existing account to explicit owner access.
- [x] Add owner-managed read-only guest credentials with create/reset/delete controls.
- [x] Enforce owner-only mutations in API routes and Supabase RLS.
- [x] Fix closed-candle selection and durable scanner no-op behavior.
- [x] Remove hardcoded Bybit minimum order fallback and verify current V5 spot responses.
- [x] Verify LIVE remains blocked and the mandatory minimum-order risk conflict test passes.
- [x] Deploy the repaired release and complete owner/guest browser verification.
- [x] Verify the deployed scanner/Edge path, idempotency, and Qwen configuration.
- [x] Promote the verified repair to `staging` and `main` while preserving the Claude branch.
- [ ] Replace the stale Vercel Supabase admin key, then retest Vault saves, Telegram callbacks, and privileged paper writes.
- [ ] Restore the five-minute Supabase Cron schedule; production stopped recording runs after 16:20 UTC.
- [ ] Send a fresh Telegram test message and observe a complete production paper trade when a real candidate occurs.
