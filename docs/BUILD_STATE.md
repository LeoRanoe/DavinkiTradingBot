# Build state

Last updated: 2026-09-13

## Current target

- Active repair branch: `dev`, created from historical source `claude/keen-darwin-bmjeav` at `69000da`; repaired history is also promoted to `staging` and `main`.
- Supabase: `davinki-trading-bot` (`xvklitfcesprzbnfslks`), healthy, Postgres 17.
- Production URL: `https://davinki-trading-bot.vercel.app`.
- LIVE trading remains hard-disabled in validation, the risk engine, and database constraints.

## Verified locally

- Clean install: 0 package vulnerabilities.
- Lint: passes with two non-blocking upstream/generated warnings.
- Typecheck: passes.
- Tests: 52 passing across indicators, strategy, risk, backtesting, and authorization.
- Production build: passes.
- Bybit V5 public spot endpoints: BTCUSDT kline, ticker, and instrument metadata return valid current data.
- Mandatory $10 / 1% risk / 3% stop / $5 minimum scenario rejects rather than inflating the order.

## Authentication

- Public `/signup` removed.
- Existing account is the owner; role is stored in server-managed Supabase `app_metadata`.
- Owner can create, reset, and delete read-only guest logins under Settings → Guest access.
- Guest mutation attempts are blocked in route handlers and by RLS.
- Owner login was verified against Supabase Auth after credential rotation.
- Public Auth signup was tested directly and rejected without creating a user.

## Verified in production

- Vercel production deploys from `main`; owner and guest sessions were exercised in-browser.
- Owner guest lifecycle: create, initial login, password reset, second login, and delete all succeeded.
- The authenticated Edge proxy uses a dedicated scanner identity; it persisted current BTCUSDT/ETHUSDT data and produced a successful scan followed by an idempotent `NOOP`.
- Qwen and Telegram configuration resolve from server-only environment fallbacks; Qwen's connection test completed.

## Remaining hardening

- Replace the stale Vercel `SUPABASE_SECRET_KEY` with a key belonging to `xvklitfcesprzbnfslks`; current connected Supabase management access cannot reveal/rotate that key. This affects dashboard Vault writes and service-role-only webhook/paper mutations, not login, guest management, reads, or scheduled scans.
- Restore Supabase management access and repair the Cron schedule: the verified run path stopped recording runs after 16:20 UTC.
- Send a fresh Telegram test message and verify the webhook callback after that key is repaired.
- Exercise one naturally occurring production paper candidate through entry and exit; the deterministic path is currently test-verified only.
- Supabase leaked-password protection is still disabled at the project level.
