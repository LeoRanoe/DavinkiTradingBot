# Security

## LIVE trading — three independent layers
1. DB: `system_settings.live_trading_enabled` has `CHECK (live_trading_enabled = false)`;
   `trades`/`orders` have `CHECK (trading_mode <> 'LIVE')`.
2. App: `evaluateTradeRisk()` refuses `tradingMode === "LIVE"` before any
   other check, unconditionally.
3. UI (Phase 9+): a persistent mode badge and a hard-disabled LIVE option in
   any mode selector.

## RLS
Every table in `public` has RLS enabled and no anonymous table policy exists.
Authenticated owners may mutate the supported dashboard state; guests are
read-only. The internal scanner JWT has only the insert/update policies needed
for scan persistence. Public Auth user creation is rejected by a database
trigger unless a server-controlled owner, guest, or scanner role is present.
The security advisor warns that six authenticated owner-management RPCs are
`SECURITY DEFINER`; this is intentional, and each function independently
rejects callers whose signed `app_metadata.role` is not `owner`.

## Secrets
- Never logged, never committed (`.env*` gitignored), never returned to the
  browser.
- Integration credentials (Qwen, Telegram, future Bybit Demo) resolve
  Vault-first then env-fallback via `lib/config/*Configuration()` helpers
  (Phase 12/13) — see spec section 90. The `integration_credentials` table
  only ever stores a `vault_secret_name` pointer plus non-secret config
  (base URL, model, chat id), never the secret value itself.
- `SUPABASE_SECRET_KEY` (service role) is used only in
  `lib/supabase/server.ts` `createAdminClient()`, imported exclusively from
  server-only files (cron/webhook route handlers). Never imported from
  anything under `components/` or any `"use client"` file.
- Production's current value is stale. Owner Vault saves and dashboard PAPER
  writes use role-checked database operations; scheduled scans exchange a
  Vault-held scanner credential for a short-lived scoped JWT. Only Telegram
  callback execution and the manual Cron fallback still use the admin client.

## News intelligence and AI (Milestone 3)
- News tables (`news_events`, `news_event_sources`, `candidate_news_links`,
  `ai_usage_events`) all have RLS enabled: authenticated users read, only the
  scanner principal writes. Verified live; Supabase security advisors report
  no new findings from them.
- The news module is structurally isolated from the trading engine - a test
  fails the build if `lib/risk/`, `lib/strategy/`, `lib/backtest/`,
  `lib/indicators/` or the candidate builder ever imports it. AI output can
  therefore never reach sizing, stops, targets, eligibility or execution.
- Model output is NEVER executed or evaluated. It is parsed as JSON inside a
  try/catch and then validated by a Zod schema; anything that fails either
  step is discarded and recorded as a failure.
- External content (headlines, excerpts) is stored as compact text and only
  ever rendered as text - a database CHECK constraint caps excerpt length so
  full articles cannot be stored, and outbound links carry
  `rel="noopener noreferrer nofollow"`.
- AI error messages are mapped to coarse classes (AUTH, RATE_LIMIT, TIMEOUT,
  MALFORMED_OUTPUT, UNAVAILABLE) before being stored, so a provider message
  cannot echo input or credentials into the database.
- Outbound feed requests send a polite, identifiable User-Agent with a
  contact URL, as publishers such as the SEC ask automated clients to do.

## Webhooks / cron (Phase 10, 13)
- `/api/jobs/scan` accepts the dedicated scanner JWT. `CRON_SECRET` is retained
  only as a manual fallback.
- Telegram webhook will validate `X-Telegram-Bot-Api-Secret-Token` against
  `TELEGRAM_WEBHOOK_SECRET`, and only accept commands from
  `TELEGRAM_OWNER_USER_ID`/`TELEGRAM_CHAT_ID`.

## Idempotency as a security property
Duplicate cron invocations, duplicate Telegram callbacks, and retried
external order submissions must never create duplicate signals/trades. See
`signals` unique constraint on `(strategy_version_id, symbol, timeframe,
candle_time)` and `orders.client_order_id` unique constraint.
