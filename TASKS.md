# Tasks

- [x] Establish `dev` from the historical Claude implementation.
- [x] Run clean install, lint, typecheck, tests, and production build baseline.
- [x] Remove public signup and convert the existing account to explicit owner access.
- [x] Add owner-managed read-only guest credentials with create/reset/delete controls.
- [x] Enforce owner-only mutations in API routes and Supabase RLS.
- [x] Fix closed-candle selection and durable scanner no-op behavior.
- [x] Remove hardcoded Bybit minimum order fallback and verify current V5 spot responses.
- [x] Verify LIVE remains blocked and the mandatory minimum-order risk conflict test passes.
- [ ] Deploy `dev` preview and complete authenticated browser verification.
- [ ] Verify deployed scanner, Cron, Qwen, and Telegram connectivity.
- [ ] Promote to `staging` only after the preview quality gate passes.
