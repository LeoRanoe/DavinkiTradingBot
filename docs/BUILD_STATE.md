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
- Supabase Cron uses an authenticated Edge proxy and dedicated scanner identity. It persisted current BTCUSDT/ETHUSDT data, produced an idempotent `NOOP`, and recovered from one missed tick with a successful 16:30 UTC run.
- Qwen and Telegram configuration resolve from server-only environment fallbacks; Qwen's connection test completed.
- Owner-scoped integration configuration and PAPER write policies are live; a production Qwen configuration save succeeded without the stale admin key.

## Task A — Milestone 1 (owner risk + complete trade candidate) — COMPLETE

- Deterministic library layer: `lib/risk/` has owner-configurable risk modes
  (percent-of-equity / fixed-amount), available-capital capping,
  fee/slippage-aware modeled loss, entry protection (allowed entry zone,
  expiry, staleness), and deterministic volatility protection.
  `lib/candidates/` assembles the complete candidate object, or a precise
  typed rejection.
- Integrated: an additive migration added owner risk settings to
  `system_settings` and the candidate snapshot to `signals`; the scanner
  (`app/api/jobs/scan/route.ts`) now loads owner settings, current account
  state, live exchange metadata and a **fresh Bybit ticker**, runs the
  candidate pipeline, and persists either the complete candidate or the
  typed rejection on one `signals` row. An owner-only risk settings page
  and API (server-validated, RLS-enforced) drive it.
- 111/111 tests passing (52 original + 32 library + 27 integration);
  typecheck, lint, and production build all clean.
- Verified against live infrastructure: migration applied and existing
  values preserved; guest UPDATE on settings blocked (0 rows) while owner
  UPDATE succeeds; `trading_mode='LIVE'`, `live_trading_enabled=true`, and
  AUTO-without-PAPER/DEMO all refused by the database; the deployed
  scheduled scan ran SUCCEEDED after the migration with both symbols
  processed; NOOP behavior intact; instrument metadata refreshing live from
  Bybit with per-symbol tick/step values.
- Two honest caveats, detailed in `docs/ORCHESTRATION_STATE.md`: Strategy v1
  is still `DRAFT` (so production candidates currently resolve to a typed
  `STRATEGY_NOT_APPROVED` rejection until the owner approves it for PAPER),
  and this session's application code is on the feature branch, not yet
  deployed.

## Remaining hardening

- Replace or remove the stale Vercel `SUPABASE_SECRET_KEY`. Owner Vault saves, dashboard PAPER writes, guest management, and scans no longer depend on it; the remaining dependency is Telegram callback execution and the manual Cron fallback.
- Send a fresh Telegram test message and verify the webhook callback after that key is repaired.
- Exercise one naturally occurring production paper candidate through entry and exit; the deterministic path is currently test-verified only.
- Supabase leaked-password protection is still disabled at the project level.
