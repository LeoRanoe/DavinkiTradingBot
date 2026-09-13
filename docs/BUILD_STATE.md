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

## Task A — Milestone 2 (Telegram approval + PAPER positions) — COMPLETE

- The bot is operational in PAPER + APPROVAL_REQUIRED: a risk-approved
  candidate reaches Telegram with APPROVE/REJECT/VIEW, approval re-runs the
  complete deterministic pipeline against fresh market data, a single PAPER
  position opens, the scheduled job manages it to stop or target, and the
  result (P/L, realized R, fees, slippage, new equity) is persisted and
  reported.
- Idempotency is guaranteed by the database, not by application logic: an
  atomic PENDING -> OPENING claim, a partial unique index on
  `trades (signal_id)`, and an atomic OPEN -> CLOSED settlement. Verified
  directly against the live schema in a rolled-back transaction (claim
  admits 1 of 2 callers; duplicate position refused; LIVE insert refused).
- Position management runs on the job's own cadence and is deliberately not
  gated on a new closed strategy candle.
- 185/185 tests passing (111 before this milestone + 74 new, including the
  end-to-end proof); typecheck, lint and production build clean.
- The deployed (pre-change) production scan still ran SUCCEEDED after both
  additive migrations, with NOOP behavior intact.
- Strategy `v1` remains `DRAFT` by design, so production candidates still
  resolve to a typed `STRATEGY_NOT_APPROVED`. See
  `docs/STRATEGY_V1_PAPER_READINESS.md`.
- Not yet deployed: the Milestone 1 and 2 application code is on the feature
  branch only.

## Task A — Milestone 3 (News Intelligence + Qwen context) — COMPLETE

- A separate News Intelligence module ingests public publisher RSS/Atom
  feeds (SEC, Federal Reserve, CoinDesk, Cointelegraph), normalizes and
  deduplicates them, classifies asset relevance / category / base news risk
  deterministically, and only then spends an AI call - on a relevant,
  materially-capable event, once per event, with a per-run cap. A routine
  ingestion run makes zero AI calls.
- News is CONTEXT, never an engine. `lib/news/isolation.test.ts` asserts
  structurally that the risk, strategy, backtest and indicator layers - and
  the candidate builder that decides eligibility - never import the news or
  Qwen modules, and a separate test proves a candidate is financially
  identical under LOW, HIGH or UNKNOWN news risk.
- Every Qwen failure mode degrades cleanly (non-JSON, schema violation,
  401, 429, timeout, missing credential): the deterministic classification
  stands alone and the trading pipeline is untouched.
- AI usage is accounted in requests and tokens, with no invented dollar cost.
- The candidate carries an IMMUTABLE news snapshot, so an old trade always
  shows what was known then.
- 254/254 tests passing (185 + 69 new); typecheck, lint and production build
  clean.
- Verified live: the migration is applied, RLS is correct on all four new
  tables (scanner writes, guest reads but cannot write), the `event_hash`
  unique constraint enforces deduplication at the database level, invalid
  risk values and oversized excerpts are refused, and Supabase security
  advisors report no new findings.
- NOT verified from the development session: a live news-feed fetch and a
  real Qwen request. The sandbox blocks all outbound network access (even
  `api.bybit.com`), so both are covered by realistic fixtures and mocked
  HTTP instead, and become verifiable on deployment.
- The news cron is deliberately NOT scheduled yet - the Edge function is
  written and ready, but scheduling it against the current production build
  would log a failed job every 15 minutes. See `docs/OPERATIONS.md`.

## Remaining hardening

- Replace or remove the stale Vercel `SUPABASE_SECRET_KEY`. Owner Vault saves, dashboard PAPER writes, guest management, and scans no longer depend on it; the remaining dependency is Telegram callback execution and the manual Cron fallback. Milestone 2 narrowed that path to a small set of specific operations and made a missing/rotated key surface as a clear "server configuration error" acknowledgement with nothing executed, instead of a 500 that Telegram would retry indefinitely. Replacing the key with a narrowly-scoped capability (an inbound webhook has no user session to carry RLS) is still open.
- Send a fresh Telegram test message and verify the webhook callback end to end. This could NOT be done from the development session: the bot token lives only in Vercel environment variables (there is no `telegram` row in `integration_credentials`), and the Milestone 2 code is not deployed yet. The Telegram formatting, callback parsing and authorization logic are unit-tested (13 tests), but a real button press remains unverified.
- Exercise one naturally occurring production paper candidate through entry and exit; the deterministic path is currently test-verified only.
- Supabase leaked-password protection is still disabled at the project level.
