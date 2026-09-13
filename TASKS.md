# TASKS

- [x] Phase 1: Repo foundation
- [x] Phase 2: Supabase schema + RLS + auth
- [x] Phase 3: Bybit public market client
- [x] Phase 4: Indicators (16 tests)
- [x] Phase 5: Strategy V1 (10 tests)
- [x] Phase 6: Risk engine (17 tests, incl. mandatory min-order test)
- [x] Phase 7-8: Backtester (6 tests) + backtests UI page
- [x] Phase 9: Core dashboard UI (all 11 pages + shell + login)
- [x] Phase 10: Supabase Cron scanner endpoint (`/api/jobs/scan`)
- [x] Phase 11-12: Knowledge base schema + Qwen client (ingestion pipeline pending)
- [x] Phase 13: Telegram client + webhook route (untested live - no bot token)
- [x] Phase 14: Paper trading engine
- [x] Phase 15: Bybit Demo interface (mocked, no credentials)
- [x] Phase 16: job_runs/audit_events + System status page
- [ ] Phase 17: Manual responsive/dark-light QA pass with screenshots
- [x] Phase 18: Vercel deployment - project created and deployed
      (`davinki-trading-bot`, linked to this repo). **Site 500s until env
      vars are set** - no MCP tool here can set them, so this is on the owner.

## Immediate next steps (in order)
1. **Owner: set these in Vercel -> davinki-trading-bot -> Settings ->
   Environment Variables**, then redeploy:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://xvklitfcesprzbnfslks.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_AeiV7QmmHeuaHzp5sKmCtA_GryzQtjW`
   - `SUPABASE_SECRET_KEY` = (from Supabase Dashboard -> Project Settings -> API -> service_role key)
   - `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL` = the values already verified working this session (ask Claude/check local `.env.local`)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_USER_ID`, `TELEGRAM_CHAT_ID` = the values already verified working this session
   - `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` = generated this session (see local `.env.local`, or ask Claude to regenerate)
2. Configure Supabase Cron (`pg_cron` + `pg_net`) to POST `/api/jobs/scan`
   every 5 minutes with `CRON_SECRET`, once the site is live.
3. Register the Telegram webhook (`setWebhook`) against the live URL with
   `TELEGRAM_WEBHOOK_SECRET`.
4. Build the knowledge ingestion pipeline (pick an embedding model on the
   now-working Qwen gateway, populate `knowledge_chunks.embedding`).
5. Run a real historical backtest (fetch real Bybit history) and persist a
   `backtests` row so the Backtests page shows real numbers instead of an
   empty state.
