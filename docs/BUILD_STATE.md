# Build state

Last updated: 2026-09-13

## Current target

- Active repair branch: `dev`, created from historical source `claude/keen-darwin-bmjeav` at `69000da`.
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

## Remaining deployment checks

- Push `dev` and verify the Vercel preview end-to-end.
- Verify scanner execution from the deployed Singapore function region.
- Confirm live Qwen and Telegram environment fallbacks on the new preview.
- Configure/verify Supabase Cron and the Telegram webhook only after a stable deployment URL is confirmed.
- Supabase leaked-password protection is still disabled at the project level.
