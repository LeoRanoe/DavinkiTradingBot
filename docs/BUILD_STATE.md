# BUILD_STATE

Last updated: 2026-09-13 (autonomous build session 1, end of session)

## Environment
- Repo: `LeoRanoe/DavinkiTradingBot`, branch `claude/keen-darwin-bmjeav` (pushed).
- Supabase project: `davinki-trading-bot` (`xvklitfcesprzbnfslks`), region us-east-1,
  free tier ($0/mo).
- Vercel team available: `leonardo-ranoesendjojos-projects`. **No project created yet -
  see Blockers.**

## Completed (all phases through 14; 15-16 partially; 17-18 partial)
- **Phase 1** Next.js 16 (App Router, Turbopack) + TS + Tailwind 4 + shadcn/ui
  (Base UI primitives) + Vitest + Zod + React Hook Form + Recharts +
  TanStack Table v8 + lightweight-charts + lucide-react.
- **Phase 2** Full schema (21 tables, 10 enums) via 5 migrations, RLS on
  every table (authenticated-read-all, no anon access anywhere), Supabase
  Vault helper RPCs (service-role only), auth trigger, TS types generated.
  Security advisors: 0 findings.
- **Phase 3** Bybit V5 public client (candles/instruments/tickers), Zod
  validated, fails closed, 10s timeout, 429 handling.
- **Phase 4** Indicators: EMA, RSI (Wilder), ATR (Wilder), volume avg/
  relative volume, fractal swings. 16 tests.
- **Phase 5** Strategy V1: 1H regime gate, 15M setup score (6 weighted
  components = 100 pts), classification thresholds, closed-candle-gated
  signal evaluation. 10 tests.
- **Phase 6** Risk engine: position sizing (floor-to-qty-step, never
  inflates/shrinks), account limits (1 open position, 2 trades/day, loss
  lock), single entrypoint blocking LIVE unconditionally. 17 tests
  including the mandatory spec #42 min-order-conflict scenario.
- **Phase 7-8** No-look-ahead backtester sharing strategy+risk logic exactly,
  conservative same-candle stop/target resolution, fee/slippage modeling,
  dev/validation/holdout split support, metrics with insufficient-sample
  flag. 6 tests. Backtest results UI page (empty state - no runs persisted
  yet, engine itself is fully tested).
- **Phase 9** Full dashboard UI: app shell (sidebar, header with mode/
  scanner-health badges, theme toggle), 11 pages (Dashboard, Markets,
  Signals, Trades, Performance, Backtests, Strategies, Knowledge, Learn,
  System, Settings > Connections), login page, dark/light token system
  with semantic positive/negative/warning/info colors.
- **Phase 10** `/api/jobs/scan` Supabase Cron entrypoint: fetches candles,
  refreshes instrument metadata, persists candles/signals/signal_components
  idempotently (DB unique constraints prevent duplicates), closes due paper
  trades, notifies Telegram on CANDIDATE, records job_runs. CRON_SECRET
  generated and stored locally (not yet in Vercel - no project exists yet).
- **Phase 11-12** Qwen client behind an interface, structured/Zod-validated
  output (FACT/INTERPRETATION/EDUCATIONAL_NOTE/RISK tags), degrades to
  NOT_CONFIGURED without throwing. **Verified live** against the user's
  provider (a custom OpenAI-compatible gateway at
  `token-plan.ap-southeast-1.maas.aliyuncs.com`, model `qwen3.8-flash` -
  discovered via that gateway's `/models` endpoint; the default
  `qwen-turbo`/DashScope combination does not exist there) -
  `explainSignal()` produced correct, well-tagged, non-fabricated output.
  `QWEN_BASE_URL`/`QWEN_MODEL` must be set to these values for this
  provider. Knowledge base schema exists (knowledge_documents/
  knowledge_chunks with pgvector+hnsw); ingestion pipeline not yet built.
- **Phase 13** Telegram client (send message, webhook secret verification,
  owner-user authorization), webhook route, candidate message formatting.
  **Verified live** - a real message was sent to the owner's chat using
  the supplied bot token.
- **Phase 14** Paper trading: fill simulation matching the backtester's fee/
  slippage model, `approveAndExecuteSignal()` as the single execution path
  (used by both dashboard buttons and the Telegram webhook), open-position
  monitor that closes trades on stop/target touch.
- **Phase 15** Bybit Demo: interface + types defined, `submitDemoOrder()`
  returns UNAVAILABLE (no credentials to develop/test against). Never
  fabricates a fill.
- **Phase 16** job_runs + audit_events tables populated by the scan job and
  execute path; System page surfaces integration health.

## Known blockers (env var names / account actions only, never secret values)
- **Vercel deployment**: RESOLVED - GitHub is now connected, project
  `davinki-trading-bot` created and linked to `LeoRanoe/DavinkiTradingBot`
  (auto-deploys on push). Currently returns HTTP 500 on every route because
  no environment variables are set on Vercel yet - the MCP tooling
  available in this session has no env-var-management capability, so this
  must be done by the project owner in the Vercel dashboard (Project ->
  Settings -> Environment Variables). See TASKS.md for the exact list.
- `SUPABASE_SECRET_KEY` - connected Supabase tooling cannot retrieve
  privileged keys. Copy from Supabase Dashboard -> Project Settings -> API
  -> service_role/secret key, into Vercel env vars, and into local
  `.env.local` for local dev. **This is the only remaining credential
  blocker** - Qwen, Telegram, and the two generated secrets are resolved
  (see below).
- `QWEN_API_KEY` - supplied via the Claude Code Cloud environment and
  **verified live**: works against `QWEN_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
  with `QWEN_MODEL=qwen3.8-flash` (discovered via that gateway's `/models`
  endpoint - the code's default DashScope base URL/model do not apply to
  this provider). These three values must be set on Vercel together.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_USER_ID`, `TELEGRAM_CHAT_ID` -
  supplied via the Claude Code Cloud environment and **verified live** (a
  real message was sent to the owner's chat).
- `BYBIT_DEMO_API_KEY`, `BYBIT_DEMO_API_SECRET` - not supplied. App boots
  and paper-trades fine without them.
- `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` - generated securely, stored only
  in local `.env.local` (gitignored, never committed, never printed to
  chat). Must be copied into Vercel env vars, and Supabase Cron must be
  configured to call `/api/jobs/scan` with the same `CRON_SECRET`.

## Not yet done
- Supabase Cron job itself (the `pg_cron`/`pg_net` schedule calling
  `/api/jobs/scan`) - needs a stable deployment URL first.
- Telegram webhook registration (`setWebhook`) - needs a stable deployment
  URL and a real bot token.
- Knowledge base ingestion/embedding pipeline (needs QWEN_API_KEY to pick
  and test an embedding model).
- Order reconciliation for Bybit Demo (needs demo credentials).
- Full responsive/dark-light manual QA pass with screenshots (build is
  responsive by construction - shadcn primitives + Tailwind - but not
  visually verified in a browser this session).

## Next up
1. Owner sets all env vars in Vercel (Project -> Settings -> Environment
   Variables) - see TASKS.md for the exact list - and triggers a redeploy.
2. Once the site loads, configure Supabase Cron to call `/api/jobs/scan`
   every 5 minutes with `CRON_SECRET`.
3. Register the Telegram webhook against the live URL with
   `TELEGRAM_WEBHOOK_SECRET`.

<!-- redeploy trigger: env vars added on Vercel 2026-09-13T10:22:22Z -->
<!-- redeploy: core Supabase env vars confirmed in Vercel 2026-09-13T10:34:31Z -->
