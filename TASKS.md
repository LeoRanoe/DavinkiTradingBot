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
- [ ] Phase 18: Vercel deployment - **blocked on GitHub login connection** (see BUILD_STATE.md)

## Immediate next steps (in order)
1. Owner: connect GitHub to Vercel account (one-time), then re-run project
   creation/deploy.
2. Owner: set `SUPABASE_SECRET_KEY` in Vercel env vars (copy from Supabase
   dashboard).
3. Configure Supabase Cron (`pg_cron` + `pg_net`) to POST `/api/jobs/scan`
   every 5 minutes with `CRON_SECRET`.
4. Register Telegram webhook once a stable URL + bot token exist.
5. Build the knowledge ingestion pipeline once `QWEN_API_KEY` is available
   (pick an embedding model, populate `knowledge_chunks.embedding`).
6. Run a real historical backtest (fetch real Bybit history) and persist a
   `backtests` row so the Backtests page shows real numbers instead of an
   empty state.
