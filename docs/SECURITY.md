# Security

## LIVE trading — three independent layers
1. DB: `system_settings.live_trading_enabled` has `CHECK (live_trading_enabled = false)`;
   `trades`/`orders` have `CHECK (trading_mode <> 'LIVE')`.
2. App: `evaluateTradeRisk()` refuses `tradingMode === "LIVE"` before any
   other check, unconditionally.
3. UI (Phase 9+): a persistent mode badge and a hard-disabled LIVE option in
   any mode selector.

## RLS
Every table in `public` has RLS enabled. No anonymous policies exist anywhere
— default-deny covers the `anon` role automatically. Authenticated (the
single owner account) can read all trading/analytics data; only
`system_settings`, `lessons`, and `signals` (approve/reject) have
authenticated UPDATE policies, and the settings policy's `WITH CHECK` still
enforces `live_trading_enabled = false`. Verified via `get_advisors(type:
security)` — 0 findings after locking down the `handle_new_user` trigger
function's PostgREST RPC exposure.

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

## Webhooks / cron (Phase 10, 13)
- `/api/jobs/scan` will require `CRON_SECRET` in an Authorization header,
  constant-time compared.
- Telegram webhook will validate `X-Telegram-Bot-Api-Secret-Token` against
  `TELEGRAM_WEBHOOK_SECRET`, and only accept commands from
  `TELEGRAM_OWNER_USER_ID`/`TELEGRAM_CHAT_ID`.

## Idempotency as a security property
Duplicate cron invocations, duplicate Telegram callbacks, and retried
external order submissions must never create duplicate signals/trades. See
`signals` unique constraint on `(strategy_version_id, symbol, timeframe,
candle_time)` and `orders.client_order_id` unique constraint.
