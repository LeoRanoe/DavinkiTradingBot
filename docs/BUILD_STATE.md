# Build state

Last updated: 2026-09-13

## Current target

- Milestone 5.5 visual analytics is complete on the integration branch.
  It is read-only UI work; deployment and promotion remain Milestone 6 work.

- Milestone 5 command-center UI is complete on
  `claude/davinki-milestone-4-integrated`; application deployment and
  promotion remain Milestone 6 work.

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

## Task A — Milestone 4 (Controlled learning + strategy research) — COMPLETE

- Integrates outcome capture into the current Milestone 2 atomic settlement path: actual P/L/equity settle first, then MFE/MAE and a factual review are persisted.
- Counterfactual research is explicitly hypothetical and separate from portfolio truth. It may evaluate owner-rejected and risk-blocked candidates but never weakens deterministic risk.
- Adds evidence guards, aggregate analytics, chronological development/validation/holdout primitives, walk-forward support, immutable experiment primitives, and a bounded research-only Bybit backfill.
- Uses the current Qwen client, credential resolver, structured output, graceful degradation and AI usage accounting for optional post-trade interpretation.
- Migration `00000000000007_learning_layer.sql` is additive, has been applied
  to the connected Supabase project after the full application gate, and its
  schema, RLS policies, constraints, scanner insert policy and no-LIVE
  restrictions were verified. No application deployment was performed.

## Remaining hardening

- Replace or remove the stale Vercel `SUPABASE_SECRET_KEY`. Owner Vault saves, dashboard PAPER writes, guest management, and scans no longer depend on it; the remaining dependency is Telegram callback execution and the manual Cron fallback. Milestone 2 narrowed that path to a small set of specific operations and made a missing/rotated key surface as a clear "server configuration error" acknowledgement with nothing executed, instead of a 500 that Telegram would retry indefinitely. Replacing the key with a narrowly-scoped capability (an inbound webhook has no user session to carry RLS) is still open.
- Send a fresh Telegram test message and verify the webhook callback end to end. This could NOT be done from the development session: the bot token lives only in Vercel environment variables (there is no `telegram` row in `integration_credentials`), and the Milestone 2 code is not deployed yet. The Telegram formatting, callback parsing and authorization logic are unit-tested (13 tests), but a real button press remains unverified.
- Exercise one naturally occurring production paper candidate through entry and exit; the deterministic path is currently test-verified only.
- Supabase leaked-password protection is still disabled at the project level.

## Task A — Milestone 6 (Automatic PAPER research window) — COMPLETE

- Separates STRATEGY VALIDATION STATUS from TEMPORARY PAPER RESEARCH
  ELIGIBILITY. `strategy_versions.status` answers "has this strategy earned a
  promotion?"; a research window answers "is the owner collecting evidence
  right now?". A window never promotes a strategy, and DRAFT becomes
  non-executable again the moment the window ends.
- `lib/research/window.ts` never trusts a stored ACTIVE status past `ends_at`:
  expiry is a function of real time, so a missed or delayed scan cannot keep
  automatic execution alive past day 14. A 30-day ceiling is enforced both in
  TypeScript and by a database CHECK constraint.
- AUTO reuses the existing execution engine rather than adding a second one.
  Every source passes through the same atomic claim, fresh ticker, fresh ATR,
  entry range, expiry, risk sizing, exchange metadata, available balance,
  daily limits, loss lock, open-position limit, min-order risk conflict and
  duplicate protection.
- Migration `20260914090000_paper_research_window.sql` is additive and has
  been applied to the connected Supabase project. Two constraints are WIDENED,
  never narrowed: `decision_source` gains AUTO, and the scanner gains INSERT
  on `trades` restricted to `trading_mode = 'PAPER'`. That second change was
  required: only the owner principal could previously insert a trade, so AUTO
  would have failed at its final step. Every LIVE prohibition is untouched.
- Gate: 334 tests, typecheck clean, production build clean, lint unchanged at
  the same 2 pre-existing warnings.

### Milestone 6 production activation (2026-09-14)

Activated only after production was confirmed to be running the new code:
the scheduled scan at 00:35:52 UTC returned SUCCEEDED carrying
`executionPolicy` / `researchWindowActive` in `job_runs.metadata`, fields
that exist only in this build, and `/api/settings/research` answered 401
(route matched) rather than 404 on the canonical production URL.

Activated state:
- `trading_mode = PAPER`, `execution_policy = AUTO`
- research session `82058733-e894-41ab-9f3c-249b8cad62fb`,
  2026-09-14T00:36:46Z -> 2026-09-28T00:36:46Z (exactly 14 days)
- starting PAPER equity $20.00 (seeded: there were zero PAPER trades and
  zero PAPER snapshots, so no history was rewritten), target $50.00
  informational only
- Strategy V1 status: DRAFT, unchanged and not promoted
- `live_trading_enabled = false`; all three LIVE layers re-verified as
  refusing (settings flag, trading_mode, trades CHECK)

Two crons only: `davinki_scan_5m` (*/5) and `davinki_news_15m`
(2,17,32,47 - offset so news never contends with a scan). News ingestion was
verified working before scheduling: 4/4 providers OK, 100 items fetched,
1 event stored, 1 AI analysis, 0 failures.

Known transient: between 00:10 and 00:30 UTC the Supabase Edge runtime could
not reach the project's own REST/Auth endpoints (504s), so several scans did
not run. This predates the deployment and cleared on its own; scans resumed
SUCCEEDED from 00:35.

## Multi-market architecture — Checkpoint 1 only (2026-09-14)

A much larger multi-market/multi-strategy platform was requested (generic
instrument model, forex readiness, five new strategy families, a research
engine with holdout/walk-forward/cost-stress and multiple-testing
correction, shadow forward research, a universe service with DB tables and
owner-facing UI, portfolio-level risk, correlation analytics). That is
several weeks of work. This checkpoint delivers only its first, explicitly
requested step ("do not deploy all at once blindly... Checkpoint 1: generic
domain + V1 parity") and changes nothing else.

**What actually shipped, all under `lib/domain/` (net-new, additive-only):**
- Venue/asset-class-independent domain types: `Instrument`, `AssetClass`,
  `VenueId`, `InstrumentId`, `CanonicalTimeframe`, `MarketDataProvider`,
  `ExecutionProvider`.
- `BybitMarketDataProvider`: a thin adapter wrapping the existing
  `lib/bybit/client.ts` verbatim (not rewritten). Supports only 1H/15M
  today — it refuses (throws) any other canonical timeframe rather than
  silently mis-mapping it, since the underlying client only exposes those
  two.
- A static crypto instrument registry naming the frozen production pair
  (BTC/USDT, ETH/USDT) plus SOL/USDT, XRP/USDT, BNB/USDT as
  domain-model-only research candidates (`paperEnabled: false` in
  metadata — nothing reads that flag yet; it documents intent for the
  future universe service).
- A long-only policy function that refuses SHORT platform-wide even for an
  instrument whose own convention permits it.
- A pure, order-independent `selectOpportunities` — the future portfolio
  selector described in CLAUDE.md §30 — unused by production.
- A no-network `FakeForexMarketDataProvider` (EUR/USD, USD/JPY fixtures)
  and a `forexRiskCompliantLots` sizing function that is NOT the crypto
  qty×price formula, proving (with tests) that the domain model can
  represent forex pip/lot sizing, weekend market closure, and a
  bid/ask spread, without any real broker connection.
- Parity tests proving: (a) the adapter calls the underlying Bybit client
  with identical arguments and passes every candle/ticker field through
  unchanged; (b) Strategy V1's `evaluateSignal` gives byte-identical output
  whether it's fed candles directly or via the adapter's shape; (c)
  evaluating BTC-then-ETH vs ETH-then-BTC gives each symbol an identical
  result (CLAUDE.md §28/§29 regression coverage).
- 461/461 tests passing (14 net-new), `npm run typecheck`, `npm run lint`
  (2 pre-existing unrelated warnings, no new ones), and `npm run build` all
  clean.

**Explicitly NOT touched by this checkpoint** (still exactly as before):
Strategy V1's parameters/thresholds/production universe
(`lib/strategy/v1/config.ts`), `app/api/jobs/scan/route.ts`, `lib/trading/*`,
`lib/risk/*`, the active 14-day research window, current PAPER positions,
AUTO policy, and every LIVE-disabled layer. No new instrument or strategy
can open a PAPER position — none of this checkpoint's new code is imported
by any route or job.

**Audit finding on CLAUDE.md §28/29 (ETH concentration / first-symbol-wins):**
`app/api/jobs/scan/route.ts` iterates `STRATEGY_V1_PARAMS.symbols` (`["BTCUSDT",
"ETHUSDT"]`) in a single sequential `for` loop, fetching candles and
evaluating `evaluateSignal` independently per symbol with no shared mutable
state between iterations — so (a) is a real regression risk for the
`maxOpenPositions = 1` limit specifically: if BTC's evaluation in one scan
opens/claims the one available position before ETH is evaluated in the same
loop, ETH can never candidate in that cycle purely because of array order.
This is the exact bug CLAUDE.md §29 asks to document rather than fix during
the active experiment — it has NOT been changed. `lib/domain/opportunity.ts`
`selectOpportunities` is the future fix (evaluate everything first, then
select), but it is not wired into the scanner. Whether ETH's apparent
concentration in current production data is (A) more valid V1 setups or (B)
this ordering effect has not been separated out — that requires a
signals-history query against the live database, which is future analysis
work, not something this checkpoint's code changes can determine.

**Not done yet** (genuinely outstanding against the full request — no DB
migration, no UI, and none of these exist yet):
- Universe service + `instruments`/`venues`/`universes`/`universe_members`
  DB tables, RLS, and the Settings → Markets research/paper toggle UI.
- Strategy families v2-trb, v3-ma, v4-tsmom, v5-bbmr, v6-xmom, and the
  `/strategies` evidence-by-instrument UI.
- The full research engine: pre-registered trials, development/validation/
  holdout/walk-forward splits, cost-stress (1.5x/2x), Deflated Sharpe /
  multiple-testing accounting, trial-count reporting.
- Shadow forward research and its result recording.
- Portfolio-level risk (`maxTotalOpenRisk`, correlation, asset-class
  exposure) and correlation analytics.
- A real forex market-data/execution adapter (OANDA/IBKR) — only a fake,
  no-network fixture exists, deliberately, per CLAUDE.md §40/§41.
- Live-instrument eligibility verification (listing date, liquidity,
  turnover, spread) for SOL/XRP/BNB — the registry only proves the domain
  model can name them; nothing has checked them against the venue yet.

## Multi-market architecture — Checkpoint 2 (2026-09-14)

**THE MIGRATION BELOW HAS NOT BEEN APPLIED TO THE LIVE SUPABASE PROJECT.**
Per instruction, this checkpoint stops at proposing the schema for owner
review. Nothing in this section mutated production data, deployed an Edge
Function, or changed live RLS.

### 1-4. Proposed DB tables, columns, RLS

File: `supabase/migrations/20260914130000_multi_market_universe.sql`
(additive only; full rationale and inline comments in the file itself).

- **`venues`** (`id text pk`, `name`, `asset_classes text[]`, `notes`,
  `created_at`) — seeded with one row, `BYBIT`. A CHECK function restricts
  `asset_classes` to `{CRYPTO_SPOT, FOREX}`.
- **`instruments`** (`id uuid pk`, `canonical_id text unique`, `asset_class`,
  `venue_id → venues`, `venue_symbol`, `base_asset`, `quote_asset`,
  `settlement_asset`, `price_increment`, `size_increment`, `min_size`,
  `min_notional` (nullable), `max_size` (nullable), `contract_multiplier`
  (nullable), `pip_size` (nullable), `lot_size` (nullable), `allows_long`,
  `allows_short`, `trading_calendar`, `is_active`, `metadata jsonb`,
  `created_at`, `updated_at`; unique on `(venue_id, venue_symbol)`). CHECKs
  restrict `asset_class` and `trading_calendar` to known values.
- **`universes`** (`id uuid pk`, `key text unique`, `name`, `purpose`,
  `asset_class`, `venue_id`, `enabled`, `notes`, timestamps). `purpose` is
  an **organizational label only** (`PRODUCTION`/`PAPER`/`SHADOW`/
  `HISTORICAL`) — it authorizes nothing; see §4/§5 rationale below.
- **`universe_members`** (`id uuid pk`, `universe_id → universes`,
  `instrument_id → instruments`, `research_enabled`, `shadow_enabled`,
  `paper_enabled`, `added_at`, `updated_at`; unique on
  `(universe_id, instrument_id)`). **No `live_enabled` column exists
  anywhere in this schema** — LIVE has no authorization surface here at
  all, by omission rather than a flag someone could flip.
- **`instrument_research_eligibility`** (`instrument_id uuid pk →
  instruments`, `status` CHECKed to `UNKNOWN`/`ELIGIBLE`/`INELIGIBLE`,
  `reasons text[]`, `metrics jsonb`, `checked_at`, timestamps) — latest
  snapshot per instrument, matching `lib/domain/eligibility.ts`.

**Why new tables rather than reusing `instrument_metadata`/`strategy_versions`/
`backtests`/`paper_research_sessions`:** `instrument_metadata` is a
Bybit-symbol-keyed cache of live exchange rules refreshed every scan — it
has no venue-independent identity, long/short policy, or calendar, and
conflating "current exchange tick/qty rules" with "canonical instrument
identity" would mix two different lifecycles. `strategy_versions`/
`signals`/`trades` describe strategy execution, not which markets exist.
`backtests`/`paper_research_sessions` describe a study over a range or a
live authorization window for one strategy version, not universe
membership. Full rationale is in the migration file's header comment.

**RLS:** every new table has `authenticated_read` (select, any signed-in
user — matching the existing pattern for reference/market data). Mutation
on `instruments`/`universes`/`universe_members`/
`instrument_research_eligibility` is restricted to the `owner` JWT role
(`app_metadata->>'role' = 'owner'`, matching the existing owner/guest
pattern). `venues` has no mutation policy yet — deliberately: adding a real
venue is a significant, deliberate act with no UI in this checkpoint, so
there's nothing routine to authorize. The scanner service role gets no
grants on any of these five tables — nothing reads or writes them from a
job yet.

**Validated locally** (never against the live project): the DDL and seed
statements were applied to a throwaway local PostgreSQL 16 database
(pgcrypto in place of Supabase's `gen_random_uuid()`/`auth` extensions,
which don't exist outside a real Supabase project). Confirmed: every
statement applies without error; re-running the same DDL+seed block is a
no-op (`CREATE TABLE ... IF NOT EXISTS`, every `INSERT` is `ON CONFLICT ...
DO NOTHING`); the `asset_class`/`purpose` CHECK constraints reject invalid
values. The RLS/policy block (which needs `auth.jwt()` and the
`authenticated` role that only exist inside a real Supabase project) was
reviewed against the already-deployed pattern in
`supabase/migrations/20260913111342_owner_guest_access.sql` rather than
executed locally.

### 5. Migration file path

`supabase/migrations/20260914130000_multi_market_universe.sql` — **proposed,
not applied.**

### 6-7. Initial crypto instruments found on Bybit / historical coverage

**Not verified from this sandbox.** Outbound requests to `api.bybit.com`
are geo-blocked here — the identical CloudFront restriction
`lib/bybit/client.ts` already documents and works around only via
production's Vercel function region:

```
$ curl https://api.bybit.com/v5/market/instruments-info?category=spot&symbol=SOLUSDT
{"error":"The Amazon CloudFront distribution is configured to block access from your country"}
```

So: BTC/USDT and ETH/USDT are known-good (they are the live, currently
trading V1 production pair). SOL/USDT, XRP/USDT, and BNB/USDT are seeded
into the migration from the CLAUDE.md-provided candidate list only, each
marked `metadata.verifiedOnVenue: false` and with an
`instrument_research_eligibility` row of `status = 'UNKNOWN'`, reason
`NOT_YET_CHECKED_AGAINST_LIVE_VENUE` — not claimed as confirmed. Historical
candle-coverage per instrument is equally unchecked for the same reason.
`lib/domain/discovery/bybit-instrument-discovery.ts`'s
`discoverBybitSpotInstruments()` / `checkBybitResearchEligibility()` are
the capability to run this for real from the deployed environment (same
"not verified from the development session" situation already true of
Milestone 3's live news-feed/Qwen calls, per `TASKS.md`).

**MANUAL VENUE EVIDENCE vs. RUNTIME PROVIDER VERIFICATION — these are kept
strictly distinct and this checkpoint does not blur them.** The owner
independently checked Bybit's official Spot directory on the web and
confirmed BTC/USDT, ETH/USDT, SOL/USDT, XRP/USDT, and BNB/USDT are
currently listed there. That is real, useful evidence — but it is a manual,
point-in-time, human web lookup, not this platform's own runtime provider
call, and it carries none of `discoverBybitSpotInstruments()`'s structured
output (listing `status` string, leveraged-token/stablecoin heuristic
flags, live turnover for the eligibility check). Per instruction,
`metadata.verifiedOnVenue` for SOL/XRP/BNB in the migration's seed data
**stays `false`**, and `instrument_research_eligibility.status` for all
three **stays `UNKNOWN`** — neither flips to `true`/`ELIGIBLE` on the
strength of a manual check. Only `BybitMarketDataProvider` /
`checkBybitResearchEligibility()` actually calling the venue from the
deployed environment may set `verifiedOnVenue: true` or move a status out
of `UNKNOWN`. This distinction is deliberate: a manual web lookup can't be
replayed, audited, or re-run on a schedule, and conflating it with a
provider-verified result would let a stale or mistaken manual check quietly
stand in for a real, repeatable one.

### 8. Research eligibility status/reasons

All five seeded instruments: `UNKNOWN`, reason `NOT_YET_CHECKED_AGAINST_LIVE_VENUE`
— by design, since no live discovery ran. `lib/domain/eligibility.ts`
classifies UNKNOWN whenever a required metric (listing status, history
coverage, a defensible turnover threshold, or turnover itself) is missing,
and only ever returns INELIGIBLE for an explicit, named reason (leveraged
token, stablecoin-vs-stablecoin, not actively trading, insufficient
history, insufficient turnover) — never a fabricated ELIGIBLE.

### 9. Repository/domain changes

- `lib/domain/eligibility.ts`, `lib/domain/discovery/bybit-instrument-discovery.ts`,
  `lib/domain/universe.ts` (`UniverseRepository`, `InMemoryUniverseRepository`),
  `lib/domain/repository/supabase-universe-repository.ts`
  (`SupabaseUniverseRepository` — untyped against the generated `Database`
  type on purpose, since the new tables aren't in it yet; switch to
  `SupabaseClient<Database>` once the migration is applied and types are
  regenerated).
- Additive-only changes to `lib/bybit/client.ts` (`listSpotInstruments()`,
  `getListingStatus()`) and `lib/bybit/types.ts` (`Ticker.turnover24h`).
  `getInstrumentMetadata`/`getCandles`/`getTicker`'s existing return values
  are unchanged in every previously-existing field.
- `SupabaseUniverseRepository.listUniverseMembers` issues exactly one
  query with an embedded join regardless of member count (asserted by a
  call-count test) — no N+1 as the universe grows.

### 10. UI changes

**None.** Per instruction ("if adding this UI materially expands the
checkpoint, implement the backend and domain model first... do not
sacrifice architecture quality to finish a settings page"): the schema
doesn't exist live yet, so a Settings → Markets page would either be inert
or would have to fake data. Backend/domain is done; the UI is a clean,
small follow-up once the migration is reviewed and applied.

### 11-13. Tests / typecheck / lint

- 500/500 tests passing (461 → 500; 39 net-new): eligibility classifier,
  discovery heuristics + venue-neutral mapping, in-memory and Supabase
  repository behavior (research/paper isolation, batch loading, no-N+1),
  fake-forex-fixture universe compatibility with zero schema change,
  migration static-safety checks, and a Strategy V1 config regression
  guard.
- `npm run typecheck`: clean.
- `npm run lint`: clean — same 2 pre-existing warnings as Checkpoint 1, no
  new ones.
- `npm run build`: clean.

### 14. Confirmation: V1 production code unchanged

Nothing in `lib/strategy/v1/`, `app/api/jobs/scan/route.ts`,
`lib/trading/`, or `lib/risk/` was touched. `STRATEGY_V1_PARAMS.symbols`
is asserted unchanged (`["BTCUSDT", "ETHUSDT"]`) by
`lib/domain/__tests__/v1-production-unchanged.test.ts`. The only edits to
previously-existing files are the two additive changes to
`lib/bybit/client.ts`/`types.ts` above, neither of which alters an
existing field or function signature that V1 depends on (verified by the
full existing test suite staying green, including the Checkpoint 1
parity tests).

### 15. Confirmation: current 14-day experiment unchanged

Not referenced by anything in this checkpoint. No table, column, or code
path added here reads or writes `paper_research_sessions`,
`system_settings`, or any `signals`/`trades` row.

### 16. Confirmation: SOL/XRP/BNB cannot PAPER trade

Structurally, not just by convention: the migration's seed INSERT sets
`paper_enabled = false` for every one of the five seeded instruments,
including BTC/ETH (whose actual PAPER trading continues to come solely
from the frozen V1 path, not this table). No code anywhere reads
`universe_members.paper_enabled` for authorization yet — no strategy v2+
exists to read it. A static test
(`lib/domain/__tests__/migration-safety.test.ts`) asserts the migration
file contains no statement setting `paper_enabled = true`.

### 17. Confirmation: LIVE remains disabled

Unchanged and re-verified: `system_settings.live_trading_enabled`'s CHECK,
the `trades`/`orders` CHECK constraints forbidding `trading_mode = 'LIVE'`,
and `lib/risk/engine.ts`'s unconditional refusal are all untouched by this
checkpoint. The new schema goes further by omission: it has no
`live_enabled` column at all on any table, so there is nothing for a
future bug to accidentally read as an authorization. Asserted by a static
test that the migration declares no such column.

### Outstanding for Checkpoint 3+

Strategy families (v2-trb etc.), the research engine (holdout/
walk-forward/cost-stress/multiple-testing), shadow forward, portfolio
risk/correlation, real forex connectivity, and the Settings → Markets UI
are all still not implemented — unchanged from Checkpoint 1's list, since
this checkpoint's scope was explicitly the universe/schema layer only.

## Checkpoint 2 — pre-migration review fixes (2026-09-14, not yet applied)

Reviewed commit `12ac0f43a24251602d543f9a70e83dc0db5baef9`. Ten correctness
issues were raised before any live migration; all fixed in this follow-up
commit. Nothing here has been applied to Supabase — the migration is still
schema-proposal-only. Full itemized list in `TASKS.md`; the load-bearing
points:

- **`checked_at` no longer defaults to `now()`.** It is nullable with no
  default; the UNKNOWN seed rows leave it NULL. A `now()` default would
  have stamped false evidence of a recent verification on a row nobody
  actually checked. `lib/domain/universe.ts`'s `InMemoryUniverseRepository`
  gained a `setEligibility(..., checkedAt)` method so tests can prove the
  null → populated transition happens only on an explicit call, never
  implicitly.
- **Research selection and eligibility are now two different questions.**
  `getResearchUniverse()` still means "the owner selected this" (UNKNOWN
  instruments can still be shown in UI/config). A new
  `getEligibleResearchUniverse()` is fail-closed: it requires the universe
  enabled, the member research-selected, the instrument active, AND
  `status = 'ELIGIBLE'` — all four, via one shared pure function
  (`selectEligibleResearchInstruments`) so the two repository
  implementations can't drift apart on the rule. No future strategy can
  mistake "owner picked this for research" for "this actually passed
  eligibility".
- **No more fabricated exchange rules, for ANY instrument, including
  BTC/ETH.** `Instrument.priceIncrement/sizeIncrement/minSize` are now
  optional and are never populated by `lib/domain/instruments/crypto.ts`.
  The DB columns are nullable with no default; the seed INSERT no longer
  names them. `lib/domain/exchange-rules.ts` is the fail-closed guard any
  future generic execution code must call instead of defaulting a missing
  rule to 0/1 — Strategy V1's own execution path is untouched and never
  reads `Instrument` at all.
- **`UniverseDefinition` keeps `assetClass`/`venueId`** instead of reading
  them off the row and discarding them; `universes.asset_class` now has the
  CHECK constraint `instruments.asset_class` always had.
- **Fixed a real bug in the empty-array CHECK**: `array_length(arr, 1) > 0`
  returns NULL for `{}` (not 0), and a NULL CHECK result is treated as
  PASSING by Postgres — so `venues.asset_classes = '{}'` was silently
  admitted. Switched to `cardinality(classes) > 0`, and confirmed against a
  local scratch database that the old expression let an empty array
  through while the new one correctly rejects it.
- **Constraint-existence guards are now scoped to their own table**
  (`conrelid = 'public.<table>'::regclass`), not `conname` alone, which is
  not schema-unique.
- **`VenueId` is now an open string type**, not a closed union — adding a
  real future venue no longer means widening a type baked into core
  domain code. `KNOWN_VENUE_IDS` keeps typo-safe constants for the venues
  already in use.
- **`PLATFORM_LONG_ONLY_POLICY`** replaces `CRYPTO_SPOT_LONG_ONLY_POLICY`
  (the old name was wrong on the FOREX fixtures, which are not crypto
  spot). `Instrument.isActive` was added (mirrors `instruments.is_active`)
  — needed for the new fail-closed filter.
- **Two comments were overclaiming and are now stated precisely.** LIVE:
  there is no `live_enabled` column ANYWHERE in this schema — a stronger
  statement than "a column exists and is CHECKed false", since there's no
  column to check at all. PAPER: `paper_enabled` has NO permanent CHECK
  forcing it false (a legitimate future owner-approved promotion must be
  able to set it true) — its actual current safety is four independent,
  changeable layers (false seed/default, owner-only RLS mutation, no
  execution consumer yet, and an expected future explicit approval step),
  not one absolute guarantee the way LIVE has.
- **MANUAL VENUE EVIDENCE vs RUNTIME PROVIDER VERIFICATION**, made explicit
  in the migration's seed comment: the owner's manual web confirmation that
  BTC/ETH/SOL/XRP/BNB are listed on Bybit's Spot directory does not flip
  `metadata.verifiedOnVenue` or move any instrument's eligibility status
  out of `UNKNOWN`. Only a real `discoverBybitSpotInstruments()` /
  `checkBybitResearchEligibility()` run from the deployed environment may
  do that.

**Validation:** re-ran the migration's DDL/seed statements against a fresh
scratch local PostgreSQL 16 database (same method as the original
Checkpoint 2 validation) — applies cleanly, idempotent on re-run, nullable
columns are actually NULL (not a fabricated 0), `checked_at` is actually
NULL, the fixed `cardinality()` check now correctly rejects an empty
`asset_classes` array (confirmed the old `array_length()` version would
have accepted it), and the new `universes_asset_class_valid` CHECK rejects
a bogus value. Dropped the scratch database afterward.

**Tests:** 533/533 passing (33 net-new over the 500 from the prior
checkpoint commit): checked_at null/populated semantics, the fail-closed
eligible-universe filter (UNKNOWN/INELIGIBLE/ELIGIBLE × research-selected ×
instrument-active × universe-enabled, in both the in-memory and Supabase
repositories), no-fabricated-exchange-rules assertions plus the
fail-closed guard's own tests, `UniverseDefinition.assetClass/venueId`
mapping, an extensible-`VenueId` proof, the renamed long-only reason, and
static migration-safety checks for every item above. `npm run typecheck` /
`npm run lint` (2 pre-existing warnings, unchanged) / `npm run build` all
clean.

**Confirmed unchanged:** Strategy V1 (`lib/strategy/v1/`,
`app/api/jobs/scan/route.ts`, `lib/trading/`, `lib/risk/`) — not touched by
any edit in this patch. The active 14-day PAPER research session, its AUTO
execution policy, and current PAPER equity are not referenced by anything
changed here. `system_settings.live_trading_enabled`'s CHECK, the
`trades`/`orders` LIVE CHECKs, and `lib/risk/engine.ts`'s unconditional LIVE
refusal are all untouched — and the new schema still has no `live_enabled`
column anywhere. SOL/XRP/BNB remain `paper_enabled = false` in every seed
row; the migration itself is still NOT applied to the live Supabase
project — no `mcp__Supabase__*` tool call, and no production database
mutation, was made while producing this patch.

## Checkpoint 2 — final pre-apply guardrail patch (2026-09-14, not yet applied)

Requested after review of commit `3dd6b9791a148ec0fee08a84108b3d53c747670a`.
Eight items, all schema-proposal/domain-code only — nothing applied to
Supabase.

1. **ELIGIBLE requires `eligibilityCheckedAt != null`.**
   `selectEligibleResearchInstruments` (`lib/domain/universe.ts`) now
   excludes an ELIGIBLE member whose `eligibilityCheckedAt` is still null.
   The DB CHECK below should make that combination impossible to write in
   the first place, but the domain filter doesn't trust that and checks
   again — a row that somehow got there anyway (a bug, a manual fix) is
   still refused, not assumed valid because the status string looks right.
2. **DB CHECK `eligibility_checked_at_required_when_eligible`**:
   `status <> 'ELIGIBLE' or checked_at is not null`. Verified against a
   scratch database: `UPDATE ... SET status='ELIGIBLE'` (leaving
   `checked_at` null) is rejected; the same UPDATE with
   `checked_at = now()` succeeds.
3. **`instrument_research_eligibility` is now read-only for every client
   role, including owner.** The `owner_manage_eligibility` policy is gone
   — there is no RLS-governed path for anyone using the publishable key to
   write this table at all. A real eligibility verdict can only come from
   a server-side job using the service-role key (bypasses RLS by design,
   same pattern the scanner already uses for `instrument_metadata`), i.e.
   an actual runtime provider check, never a person toggling something in
   a UI.
4. **`universe_members` gained a cross-table compatibility trigger**
   (`validate_universe_member_compatibility`, `BEFORE INSERT OR UPDATE`):
   rejects a member whose instrument's `asset_class` doesn't match the
   universe's `asset_class`, or — when the universe pins a specific
   `venue_id` — whose instrument is on a different venue. A plain `CHECK`
   can't reference another table, so this had to be a trigger. Verified: a
   CRYPTO_SPOT instrument added to a FOREX-classed universe is rejected
   with a clear error naming both asset classes.
5. **`instruments` gained a venue/asset-class compatibility trigger**
   (`validate_instrument_venue_asset_class`, `BEFORE INSERT OR UPDATE`):
   rejects an instrument whose `asset_class` isn't one of its venue's
   declared `asset_classes`. Verified: inserting a FOREX instrument
   pointed at the BYBIT venue (`asset_classes = {CRYPTO_SPOT}`) is
   rejected.
6. **`paperEnabled` removed from `UniverseRepository.setMemberFlags`'s
   type entirely**, in both `InMemoryUniverseRepository` and
   `SupabaseUniverseRepository` — not just left unused, the TypeScript
   signature no longer accepts it (`Partial<Pick<UniverseMember,
   "researchEnabled" | "shadowEnabled">>`). PAPER promotion needs its own
   dedicated, more heavily guarded call path once one is designed — it
   must not ride through the same generic call as a research/shadow
   toggle. No such dedicated path exists in this checkpoint; nothing can
   set `paper_enabled` true through the domain layer at all right now.
7. **`lib/domain/exchange-rules.ts` validates finite, valid, positive
   values**, not just presence. `checkExchangeRulesAvailable` now rejects
   NaN, Infinity, zero, or negative `priceIncrement`/`sizeIncrement`
   (which must be positive), and negative `minSize` (which may legitimately
   be zero) — returning a typed `problems: string[]` naming exactly what's
   wrong instead of the old boolean-only `missing` list.
8. **`updated_at` is now enforced by the database, not application
   discipline.** A shared `public.set_updated_at()` trigger function is
   attached (`BEFORE UPDATE`) to `instruments`, `universes`,
   `universe_members`, and `instrument_research_eligibility`. Verified:
   updating an unrelated column on an `instruments` row bumps
   `updated_at` automatically, with `created_at` unchanged.

**Validation:** re-ran the full DDL/seed against a fresh scratch local
PostgreSQL 16 database (same method as both prior checkpoints) — applies
cleanly, idempotent on re-run (confirmed a second full apply produces only
`INSERT 0`/"already exists, skipping" output, no errors), and every new
trigger/constraint was exercised directly: the `updated_at` trigger bumps
the timestamp on UPDATE; an incompatible instrument/venue pairing is
rejected with the expected error; an incompatible universe-member pairing
is rejected with the expected error; `UPDATE ... SET status='ELIGIBLE'`
without `checked_at` is rejected, and the same UPDATE with `checked_at =
now()` succeeds. Dropped the scratch database afterward — no
`mcp__Supabase__*` tool call, no production database mutation.

**Tests:** 550/550 passing (17 net-new over the 533 from the prior
commit): the domain-level and DB-level ELIGIBLE+checked_at rule (both must
hold independently), the two new compatibility triggers (static assertions
plus live rejection/acceptance verified manually above), the
finite/positive exchange-rule validation (NaN/Infinity/zero/negative cases
individually), a compile-time proof that `setMemberFlags`'s flags type has
no `paperEnabled` key, and static migration-safety checks for every item
above. `npm run typecheck` / `npm run lint` (2 pre-existing warnings,
unchanged) / `npm run build` all clean.

**Confirmed unchanged:** Strategy V1, the scanner, the risk engine, the
active 14-day PAPER research session and its AUTO policy, current PAPER
equity, and every LIVE-disabled layer — none referenced by any edit in
this patch. The migration remains NOT applied to the live Supabase
project; main was not touched; nothing was deployed; Strategy V2 was not
started.

## Checkpoint 2 — cross-table invariant completion (2026-09-15, not yet applied)

Requested after review of commit `de798cbba7fc0772bc709e3fbfba5d2b7a71c984`.
The prior guardrails (`validate_instrument_venue_asset_class`,
`validate_universe_member_compatibility`) only fire on the row actually
being written, so they stop a new mismatched instrument or membership from
being *created* — but they never fire when a PARENT row is edited after
compatible children already exist: `UPDATE universes SET asset_class =
'FOREX'` on a universe with existing CRYPTO_SPOT members touches no
`universe_members` row at all, so its trigger stays silent while the
pairing becomes nonsensical. Same class of gap existed for an instrument's
`asset_class`/`venue_id` changing after it already has memberships, and for
a venue's `asset_classes` shrinking after instruments already reference it.

**Three new triggers**, added in a dedicated "Cross-table update
validation" section of the migration (after all four tables and their
existing triggers, before the seed data):

- `universes_validate_update_against_members` — `BEFORE UPDATE OF
  asset_class, venue_id ON universes`. Counts existing `universe_members`
  (joined to `instruments`) that would become incompatible with the new
  values; raises and refuses the UPDATE if that count is > 0. A no-op
  UPDATE (values unchanged, or an unrelated column like `name`) is a fast
  pass-through.
- `instruments_validate_update_against_memberships` — `BEFORE UPDATE OF
  asset_class, venue_id ON instruments`. Same shape, the other direction:
  counts `universe_members` (joined to `universes`) referencing this
  instrument that would become incompatible. Kept separate from the
  existing `validate_instrument_venue_asset_class` trigger (which only
  re-checks the instrument against its own venue's `asset_classes`, not
  against any membership) rather than merging the two, so each function
  stays a single, auditable responsibility.
- `venues_validate_update_against_instruments` — `BEFORE UPDATE OF
  asset_classes ON venues`. Counts instruments on that venue whose
  `asset_class` would no longer be in the new `asset_classes` array;
  refuses the UPDATE. Never deactivates or reassigns the instrument itself
  — the venue's own definition just can't shrink out from under it.

All three follow the same "no silent cascade/remapping" rule the request
specified: each is a pure validation gate that either lets the UPDATE
through unchanged or raises an exception. None of them writes to any other
table.

**Domain defense in depth**: `selectEligibleResearchInstruments`
(`lib/domain/universe.ts`) now also requires
`member.instrument.assetClass === universe.assetClass` and
(`universe.venueId === null OR member.instrument.venue ===
universe.venueId`), on top of the existing research-selected / active /
ELIGIBLE / checked-at-populated checks. This holds independent of whatever
the database does or doesn't enforce — an in-memory fixture with
deliberately malformed data, or a future bug in one of the three triggers
above, still can't put a mismatched instrument in front of a research
trial.

**Validation** — re-ran the full DDL/seed against a fresh scratch local
PostgreSQL 16 database and exercised every one of the eleven required
scenarios directly (not just asserted in prose):

| # | Scenario | Result |
|---|---|---|
| 1 | Valid membership insert | accepted |
| 2 | Member insert, wrong asset class | rejected (existing trigger) |
| 3 | Member insert, wrong venue | rejected (existing trigger) |
| 4 | `UPDATE universes SET asset_class` that would orphan members | rejected |
| 5 | `UPDATE universes SET venue_id` that would orphan members | rejected |
| 6 | `UPDATE universes SET name` (unrelated) | accepted |
| 7 | `UPDATE instruments SET asset_class` that would break memberships | rejected |
| 8 | `UPDATE instruments SET venue_id` that would break memberships | rejected |
| 9 | `UPDATE instruments SET metadata` (unrelated) | accepted |
| 10 | `UPDATE venues SET asset_classes` shrinking, stranding an instrument | rejected |
| 11 | `UPDATE venues SET asset_classes` widening | accepted |

Also re-ran the complete DDL a second time end-to-end to confirm the whole
migration, including the three new triggers, is still idempotent (every
statement either `CREATE ... IF NOT EXISTS`/`DROP TRIGGER IF EXISTS` or an
`INSERT ... ON CONFLICT DO NOTHING`, all producing `INSERT 0` on the
re-run). Dropped the scratch database afterward — no `mcp__Supabase__*`
tool call, no production database mutation.

**Tests:** 557/557 passing (7 net-new over the 550 from the prior commit):
three domain-level tests for the new asset-class/venue defense-in-depth
checks (mismatch excluded, venue mismatch excluded, null `venueId` allows
any venue), and static migration-safety assertions confirming each new
trigger exists, is scoped to the right columns/table, and only ever
raises or passes through (never writes to another table). `npm run
typecheck` / `npm run lint` (2 pre-existing warnings, unchanged) / `npm
run build` all clean.

**Confirmed unchanged:** Strategy V1, the scanner, the risk engine, the
active 14-day PAPER research session and its AUTO policy, current PAPER
equity, and every LIVE-disabled layer. The migration remains NOT applied
to the live Supabase project; `main` was not touched; nothing was
deployed; Strategy V2 was not started.

## Checkpoint 2 — migration APPLIED to live Supabase (2026-09-15)

Approved commit `03e008fcfb9be4f1e31807dc3ae4559660c81af9`. Applied
`supabase/migrations/20260914130000_multi_market_universe.sql` to the
`davinki-trading-bot` project (`xvklitfcesprzbnfslks`) via
`mcp__Supabase__apply_migration`. This is the first Checkpoint-2 action
that actually touched the live database.

**Pre-apply guards, verified live before touching anything:**
- Working branch `claude/practical-davinci-6sejvp`, `HEAD =
  03e008fcfb9be4f1e31807dc3ae4559660c81af9` — matched exactly.
- `system_settings`: `trading_mode = PAPER`, `live_trading_enabled = false`.
- `strategy_versions.v1.status = DRAFT` (unchanged since Milestone 6).
- `paper_research_sessions` (research session `82058733-...`): `status =
  ACTIVE`, `started_at`/`ends_at`/`planned_days` unchanged from the
  original 14-day window.
- `instrument_metadata` had exactly 2 rows (BTC/ETH) — no prior
  contamination.
- None of `venues`/`instruments`/`universes`/`universe_members`/
  `instrument_research_eligibility` existed yet; the migration was not in
  `list_migrations`.

**Applied successfully.** `mcp__Supabase__apply_migration` returned
`{"success":true}`.

**Tables created and verified via `list_tables`:** `venues` (1 row),
`instruments` (5 rows), `universes` (1 row), `universe_members` (5 rows),
`instrument_research_eligibility` (5 rows) — all with `rls_enabled: true`.

**Seed state verified with direct queries, matching the migration exactly:**
- Venue: `BYBIT`, `asset_classes = ["CRYPTO_SPOT"]`.
- Universe: `crypto-core`, `purpose = HISTORICAL`, `asset_class =
  CRYPTO_SPOT`, `venue_id = BYBIT`, `enabled = true`.
- All five instruments (BTC/ETH/SOL/XRP/BNB against USDT) present as
  `universe_members` of `crypto-core` with `research_enabled = true`,
  `shadow_enabled = false`, `paper_enabled = false` — no exceptions.
- All five `instrument_research_eligibility` rows: `status = UNKNOWN`,
  `checked_at = NULL` — nothing was manually marked ELIGIBLE or given a
  fabricated timestamp.

**Safety constraints and all five cross-table triggers verified live**,
each inside a `BEGIN ... ROLLBACK` (or left to auto-rollback on the
expected error) so no test data or state change persisted:

| Check | Result |
|---|---|
| `UPDATE ... SET status='ELIGIBLE'` with `checked_at` still NULL | **rejected** (`eligibility_checked_at_required_when_eligible`) |
| Same UPDATE with `checked_at = now()` | **accepted**, then rolled back |
| Insert a CRYPTO_SPOT instrument as a member of a FOREX-classed test universe | **rejected** (`validate_universe_member_compatibility`) |
| Insert an instrument on a different venue as a member of a BYBIT-pinned test universe | **rejected** (`validate_universe_member_compatibility`) |
| `UPDATE universes SET asset_class='FOREX'` on `crypto-core` (5 existing members) | **rejected** (`validate_universe_update_against_members`) |
| `UPDATE instruments SET asset_class='FOREX'` on BTC/USDT (1 existing membership) | **rejected** (`validate_instrument_update_against_memberships`) |
| `UPDATE venues SET asset_classes=['FOREX']` on BYBIT (5 existing instruments) | **rejected** (`validate_venue_update_against_instruments`) |

After all of the above, a final count query confirmed exactly the
original 1/5/1/5/5 rows across the five tables, `paper_enabled = true`
count `0`, and every eligibility row still `UNKNOWN`/`NULL` — none of the
verification queries left any residue.

**RLS verified directly against `pg_policies`:**
- `authenticated_read` (SELECT, role `authenticated`) exists on all five
  tables — no `anon` policy anywhere on any of them.
- `owner_manage_instruments`, `owner_manage_universes`,
  `owner_manage_universe_members` each exist as a single `ALL`-command
  policy scoped to the `authenticated` role, gated inside by the
  `app_metadata->>'role' = 'owner'` check (same pattern as every other
  owner-only table in this project).
- `instrument_research_eligibility` has **only** the read policy — no
  `ALL`/`INSERT`/`UPDATE` policy exists for it at all, confirmed by the
  query returning exactly one row for that table.

**PAPER safety verified:** `select count(*) from universe_members where
paper_enabled = true` → `0`.

**Security advisor findings** (`mcp__Supabase__get_advisors`, type
`security`) after the apply:
- **New** (from this migration): all 7 functions it created
  (`set_updated_at`, `venue_asset_classes_are_valid`,
  `validate_instrument_venue_asset_class`,
  `validate_universe_member_compatibility`,
  `validate_universe_update_against_members`,
  `validate_instrument_update_against_memberships`,
  `validate_venue_update_against_instruments`) have a mutable
  `search_path` (`function_search_path_mutable`, WARN). Not fixed in this
  checkpoint — it's outside the exact scope authorized ("apply exactly
  `20260914130000_multi_market_universe.sql`... do not apply unrelated
  pending migrations") — flagged as a small, additive follow-up
  (`ALTER FUNCTION public.<name> SET search_path = ''` on each) for a
  dedicated migration.
- **Pre-existing, unrelated**: `authenticated_security_definer_function_executable`
  on the `owner_*` RPCs (guest management, integration config — all
  predate Checkpoint 2), and `auth_leaked_password_protection`. Neither
  was introduced by this migration.

**Types regenerated and repository re-typed:** `lib/supabase/database.types.ts`
regenerated from the live schema via `mcp__Supabase__generate_typescript_types`
(now includes `venues`/`instruments`/`universes`/`universe_members`/
`instrument_research_eligibility`, confirmed `instrument_research_eligibility.checked_at:
string | null` came through correctly). `SupabaseUniverseRepository`
switched from an untyped `SupabaseClient` to `SupabaseClient<Database>`,
using `Database["public"]["Tables"][...]["Row"/"Update"]` types instead of
hand-written row shapes — no behavioral change, confirmed by the full test
suite staying green with zero test-assertion edits needed beyond the
client-type cast in the test file itself.

**Final checks:** 557/557 tests passing (no count change — this was a
typing-only change), `npm run typecheck` / `npm run lint` (2 pre-existing
warnings, unchanged) / `npm run build` all clean.

**Confirmed after the apply, queried directly:** `trading_mode = PAPER`,
`live_trading_enabled = false`, `strategy_versions.v1.status = DRAFT`,
research session `82058733-...` still `status = ACTIVE` with its original
window, `paper_enabled = true` count still `0`. Nothing in
`lib/strategy/v1/`, `app/api/jobs/scan/route.ts`, `lib/risk/`, or
`lib/trading/` was touched. No runtime eligibility check was performed or
faked — all five instruments remain `UNKNOWN`/`checked_at NULL`. Strategy
V2 was not started. `main` was not touched; nothing was deployed.

## Checkpoint 2.1 — function search_path hardening, applied live (2026-09-15)

Pure security-hardening follow-up to Checkpoint 2's already-applied
migration, at commit `267d1936346d3ef1f52e6b8e3983487f3164d617`. Scope:
clear the Supabase Security Advisor's `function_search_path_mutable`
(WARN) finding on the seven functions Checkpoint 2 introduced. Nothing
else.

**New migration**: `supabase/migrations/20260915110000_harden_multi_market_function_search_paths.sql`.
`20260914130000_multi_market_universe.sql` was not edited.

**Body review before hardening** (required, since an empty `search_path`
breaks any unqualified table reference): re-read all seven function
bodies in the applied Checkpoint 2 migration. Every table reference in
every one of them was already written `public.venues` /
`public.instruments` / `public.universes` / `public.universe_members` —
never a bare name. The only unqualified identifiers used anywhere are
`now()`, `cardinality()`, `count()`, and the `= any(array)` construct, all
`pg_catalog` built-ins that Postgres always searches first regardless of
`search_path`. None of the seven reference an `extensions`-schema object
(`gen_random_uuid()` only appears in table column `DEFAULT`s, not inside
any of these function bodies). Conclusion: `SET search_path = ''` is safe
for all seven with zero body changes — confirmed by the local scratch-DB
regression run below before touching production.

**Approach**: `ALTER FUNCTION public.<name>(<exact signature>) SET
search_path = '';` for each — configuration-only, no `CREATE OR REPLACE`,
idempotent. None of the seven were ever `SECURITY DEFINER` and none
becomes one; each stays `SECURITY INVOKER`.

**Local validation** (scratch PostgreSQL 16, before any live change):
applied the full Checkpoint 2 base DDL, then this hardening migration —
both applied cleanly; `pg_proc.proconfig` for all seven showed
`{"search_path=\"\""}`; re-ran the migration a second time (idempotent,
all `ALTER FUNCTION`, no error); ran all ten regression scenarios from §8
— every one behaved identically to the pre-hardening state. Dropped the
scratch database afterward.

**Live apply**: `mcp__Supabase__apply_migration` → `{"success":true}`.

**Live `pg_proc` verification** (all seven, via a single query joining
`pg_proc`/`pg_namespace`):

| Function | `security_definer` | `proconfig` |
|---|---|---|
| `set_updated_at` | false | `{"search_path=\"\""}` |
| `venue_asset_classes_are_valid` | false | `{"search_path=\"\""}` |
| `validate_instrument_venue_asset_class` | false | `{"search_path=\"\""}` |
| `validate_universe_member_compatibility` | false | `{"search_path=\"\""}` |
| `validate_universe_update_against_members` | false | `{"search_path=\"\""}` |
| `validate_instrument_update_against_memberships` | false | `{"search_path=\"\""}` |
| `validate_venue_update_against_instruments` | false | `{"search_path=\"\""}` |

None has `proconfig IS NULL` for `search_path` any longer; all remain
`SECURITY INVOKER`.

**Security Advisor, before → after** (both calls to
`mcp__Supabase__get_advisors`, type `security`):
- **Before**: 8 findings total — 7× `function_search_path_mutable` (one
  per Checkpoint 2 function) + `authenticated_security_definer_function_executable`
  (6 pre-existing `owner_*` RPCs) + `auth_leaked_password_protection`.
- **After**: 2 findings — the same `authenticated_security_definer_function_executable`
  and `auth_leaked_password_protection`, unchanged. **All 7
  `function_search_path_mutable` findings are gone.**
- The two remaining findings predate this migration and Checkpoint 2
  entirely (the `owner_*` guest/integration-config RPCs, and Supabase
  Auth's leaked-password-protection toggle) — explicitly out of scope for
  this task and not touched.

**Regression, live, all rollback-only (10/10, §8):**

| # | Check | Result |
|---|---|---|
| 1 | `updated_at` trigger still bumps on UPDATE | pass |
| 2 | Valid universe membership insert succeeds | pass |
| 3 | Instrument/universe asset-class mismatch on membership insert rejected | pass |
| 4 | Wrong-venue membership insert rejected | pass |
| 5 | Venue/instrument asset-class mismatch on instrument insert rejected | pass |
| 6 | Parent universe `asset_class` UPDATE that breaks members rejected | pass |
| 7 | Parent instrument `asset_class` UPDATE that breaks memberships rejected | pass |
| 8 | Venue `asset_classes` shrink that strands an instrument rejected | pass |
| 9 | ELIGIBLE + `checked_at` NULL still rejected | pass |
| 10 | ELIGIBLE + `checked_at` populated still accepted (then rolled back) | pass |

A final row-count query after all of the above confirmed exactly the
original 1/5/1/5/5 rows, `paper_enabled=true` count still `0`, and every
eligibility row still `UNKNOWN`/`NULL` — no test left any residue.

**Tests**: 562/562 passing (5 net-new — static checks on the new
migration file: exact-signature `ALTER FUNCTION` coverage for all seven,
no `CREATE FUNCTION`/table/policy/trigger statement anywhere in it, and a
check that every referenced table in the seven original function bodies
is `public.`-qualified). `npm run typecheck` / `npm run lint` (2
pre-existing warnings, unchanged) / `npm run build` all clean.

**Production safety, re-confirmed live after the apply:**
`strategy_versions.v1.status = DRAFT`; `system_settings.trading_mode =
PAPER`; `system_settings.live_trading_enabled = false`; research session
`82058733-...` still `status = ACTIVE` with its original window;
`count(universe_members where paper_enabled = true) = 0`; all five
research instruments still `status = UNKNOWN`, `checked_at = NULL`. No
runtime venue eligibility check was run. `lib/strategy/v1/`,
`app/api/jobs/scan/route.ts`, `lib/risk/`, `lib/trading/` untouched.
Strategy V2 not started; `main` not touched; nothing deployed.

## Checkpoint 3A — V2 Trading Range Breakout + generic research engine (2026-09-15)

Pure code, no DB migration, no live database write. First strategy-research
checkpoint: builds and tests the generic research machinery and V2 TRB.
Does not promote V2, does not PAPER/shadow it, does not deploy a new
scanner, does not touch the active V1 experiment.

**1. Files added/changed:**
- New namespace: `lib/research-engine/` — `strategy.ts`, `engine.ts`,
  `metrics.ts`, `cost-model.ts`, `position-sizing.ts`, `split.ts`,
  `trial.ts`, `benchmark.ts`, `candle-integrity.ts`,
  `historical-loader.ts`, `eligible-universe-gate.ts`,
  `strategies/trb.ts`, plus 11 test files under `__tests__/`.
- Additive-only edits: `lib/bybit/types.ts` (4H interval/ms maps),
  `lib/bybit/client.ts` (`getCandles`'s timeframe param widened to
  include `"4H"`, interval-ms lookup generalized from a ternary to a map —
  identical values for 1H/15M), `lib/domain/adapters/bybit-market-data-provider.ts`
  (4H added to the supported-timeframe map).
- One regression fix required by the 4H addition:
  `lib/domain/__tests__/bybit-adapter-parity.test.ts`'s
  "rejects an unsupported timeframe" test used `"4H"` as its example —
  updated to `"1D"` (still genuinely unsupported) since 4H is now real.
- Nothing under `lib/strategy/v1/`, `app/api/jobs/scan/route.ts`,
  `lib/risk/`, `lib/trading/`, `lib/backtest/` was touched — confirmed via
  `git status` filtered to those paths (zero matches).

**2. StrategyDefinition/API shape** (`lib/research-engine/strategy.ts`):
`StrategyDefinition<TParams>` = `{ id, name, status: "DRAFT"|"RESEARCH_ONLY",
supportedAssetClasses, parameterSets, evaluateEntry(closedCandles, params),
evaluateExit(closedCandles, params) }`. `evaluateEntry`/`evaluateExit`
receive `closedCandles: readonly CanonicalCandle[]` whose **last element is
always the bar currently being evaluated** — this is structural, not a
convention: the engine only ever calls with `fullHistory.slice(0, t+1)`,
so a strategy cannot read a future bar even by an indexing mistake.
`evaluateEntry` returns `{kind:"OPPORTUNITY", opportunity: Opportunity}`
(reusing the existing `lib/domain/opportunity.ts` model) or
`{kind:"NO_OPPORTUNITY", reason}`. `evaluateExit` returns
`{kind:"EXIT", reason}` or `{kind:"HOLD"}`. Strategies never do IO.

**3. Exact V2 semantics** (`lib/research-engine/strategies/trb.ts`):
Long-only, closed-candles-only. Entry on closed bar t: `close[t] >
highest(high[t-N..t-1])` (N = entryLookback) — the channel strictly
excludes bar t, verified by an adversarial off-by-one test (a current-bar
high of 999 must not suppress a real breakout of the correct window).
Execution: next bar's open (engine, not the strategy). Exit: while in
position, on closed bar x, `close[x] < lowest(low[x-M..x-1])` (M =
exitLookback) — same exclusion rule, same adversarial test. No fixed
profit target — verified by a test where an enormous favorable close
(100,000 vs. a ~100 channel) produces `HOLD`, not an exit.
`initialStop` = lowest low of the prior M closed bars, informational for
sizing only — the strategy's only real exit is the dynamic channel.
`initialStop < entryPrice` is enforced by the ENGINE at actual fill time
(not by the strategy at signal time, since the real fill price isn't
known until the next bar opens) — a gap-down fill that violates it is
skipped with reason `STOP_NOT_BELOW_ENTRY`, never forced. No score:
`Opportunity.strength` is left `undefined`; `features` records only
`entryLookback`/`exitLookback`/`timeframe`/`breakoutChannelHigh`/`signalClose`.

**4. Exact six preregistered configs:** `TRB-1H-20-10`, `TRB-1H-50-20`,
`TRB-1H-100-50`, `TRB-4H-20-10`, `TRB-4H-50-20`, `TRB-4H-100-50` — three
channel pairs (20/10, 50/20, 100/50) × two timeframes (1H, 4H). Asserted
by test to be exactly six, with exactly these ids and exactly these two
fields (`entryLookback`, `exitLookback`) per config — no ATR, no extra
lookback, no seventh config.

**5. 4H implementation:** `BYBIT_INTERVAL["4H"] = "240"` (Bybit kline
interval, minutes), `BYBIT_INTERVAL_MS["4H"] = 14_400_000`.
`getCandles()`'s timeframe param widened from `"1H"|"15M"` to
`"1H"|"15M"|"4H"`; the interval-ms computation switched from `timeframe
=== "1H" ? 3_600_000 : 900_000` to a `BYBIT_INTERVAL_MS[timeframe]`
lookup — same two values for the same two inputs, confirmed by a
regression test. `BybitMarketDataProvider`'s `SUPPORTED` map gained
`"4H": "4H"`. All changes additive; V1 never calls `getCandles` with
anything but `"1H"`/`"15M"`.

**6. Historical pagination behavior**
(`lib/research-engine/historical-loader.ts`): paginates backward from
`endMs` using the provider's `endMs` cursor, one page (`pageSize`,
default 1000) at a time; merges into oldest-first output; deduplicates by
`openTime`; a duplicate `openTime` whose OHLCV disagrees across pages is a
**hard error** (`ConflictingDuplicateCandleError`), never silently
resolved by picking one; filters to closed candles only and to `openTime
<= endMs` (no future candles); stops when the provider legitimately runs
dry (`truncated: false` — a true boundary), when the requested `startMs`
is covered, or when `maxPages` is hit (`truncated: true`, explicit, never
a silent gap); records `earliestAvailableMs`/`latestAvailableMs` from
what was actually obtained, not what was requested; detects gaps by
comparing consecutive `openTime` deltas against the timeframe's expected
bucket length. Sits above `MarketDataProvider` — never touches
`lib/bybit/client.ts` directly and is never called from the scanner.

**7. Data-integrity checks** (`lib/research-engine/candle-integrity.ts`):
strictly-increasing `openTime`, no duplicates, finite OHLCV,
`high >= max(open, close)`, `low <= min(open, close)`, `high >= low`,
`volume >= 0` and finite, unclosed-candle flagging. Pure reporting — never
mutates or manufactures a candle. `runResearchBacktest` throws if the
input fails this check, so no trial can silently run on bad data.

**8. Generic backtest semantics** (`lib/research-engine/engine.ts`): does
NOT import `lib/strategy/v1/signal.ts` (grep-verifiable). Chronological
single pass; one open position per call (one trial = one instrument × one
parameter set × one candle range); signal known at close of bar t → fill
at bar (t+1)'s open, for both entry and exit; if there's no next bar, the
engine never fakes a fill — a pending entry signal with no next bar
produces a skip, an open position with no next bar to exit on ends as
`OPEN_AT_END` (`exitPrice`/`exitTime`/`pnl`/`rMultiple` all `null`).
Determinism proven by an instrumented strategy wrapper that records the
largest candle-array length it was ever given and confirms it never
exceeds `candles.length - 1` (i.e., never one bar beyond the last), plus
an identical-input/identical-output test and an input-array-immutability
test.

**9. Normalized risk convention** (`lib/research-engine/position-sizing.ts`):
`initialEquity` (e.g. 10,000, unitless/normalized) + `riskPct` of CURRENT
equity per trade (compounds, same convention as
`lib/risk/position-sizing.ts`'s `PERCENT_OF_EQUITY` mode). `riskBudget =
equity * riskPct`; `stopDistancePct = (entry - stop) / entry`; `qty =
(riskBudget / stopDistancePct) / entry`. No leverage, no averaging down,
no martingale. Rejects (`STOP_NOT_BELOW_ENTRY`) rather than forcing a fit
when the actual fill makes stop ≥ entry. Explicitly documented as NOT
representing what the live $20 PAPER account could execute or expected
dollar profit from it — R-multiples are the comparable unit, not the
normalized quantity.

**10. Cost-model representation** (`lib/research-engine/cost-model.ts`):
`entryFeeBps`/`exitFeeBps`/`entrySlippageBps`/`exitSlippageBps`, each with
exactly one documented meaning, applied exactly once at exactly one fill.
Entry slippage always moves the price up (against a long buyer); exit
slippage always moves it down (against a long seller); each fee is
computed on its own side's post-slippage notional. No value here is
asserted to be "the correct Bybit cost" — real scenarios are Checkpoint
3B's job to lock in before any comparison.

**11. Split implementation** (`lib/research-engine/split.ts`): index-based
60/20/20 by candle count (`Math.floor`), chronological, contiguous
(`development.endIndex === validation.startIndex`, etc.), no
randomization anywhere. `registerResearchTrial` records the actual
candle-timestamp boundaries for each split from this, and a SHA-256
config fingerprint (`node:crypto`, stable under object-key reordering)
over strategy/parameter-set/instrument/timeframe/date-ranges/cost model —
changes if any of them does. **No DB migration** — pure in-memory value
object per §27; persistence deferred, to be proposed separately if
Checkpoint 3B needs it.

**12. Benchmark implementation** (`lib/research-engine/benchmark.ts`): buy
at the first candle's open, hold to the last candle's close;
`totalReturn` and `maxDrawdownPct` on the close series. Explicitly typed
with no `rMultiple`/`riskBudget` field — it is a market reference, not a
risk-sized strategy result; actual comparison is Checkpoint 3B's job.

**13. Tests:** 97 net-new (664 total, up from 567): 19 for TRB (exact
preregistered matrix, entry/exit channel exclusion incl. two adversarial
off-by-one cases, unclosed-candle handling, insufficient-history handling
for both the entry and the risk-reference window, `initialStop`
correctness, no-score assertion, no-fixed-target assertion), 17 for the
engine (determinism, no-mutation, an instrumented no-lookahead proof,
next-bar fill semantics for both entry and exit, no-fill-when-no-next-bar,
`OPEN_AT_END`, single-open-position, win/loss R correctness, cost
application, invalid-stop rejection, the integrity gate), plus dedicated
suites for candle integrity (11), cost model (6), position sizing (5),
split (6), benchmark (4), metrics (8), trial registry (8), the historical
loader (10, including conflicting-duplicate rejection and the
truncated-vs-legitimately-exhausted distinction), the eligibility gate (3,
including a static source-text check that `getResearchUniverse()` is
never called as a bypass), and a 4H parity/regression suite (5).

**14-16. typecheck / lint / build:** all clean. `npm run typecheck`: 0
errors. `npm run lint`: the same 2 pre-existing warnings as every prior
checkpoint, 0 new. `npm run build`: succeeds, same route manifest as
before.

**17. Confirmation V1 untouched:** `git status` filtered to
`lib/strategy/v1/`, `app/api/jobs/scan/route.ts`, `lib/trading/`,
`lib/risk/` returns zero matches. `lib/backtest/engine.ts` (V1's
backtester) was not edited and was not turned into the generic engine —
`lib/research-engine/engine.ts` is a wholly separate file.

**18. Confirmation active PAPER AUTO experiment untouched:** confirmed
live (read-only query): research session `82058733-...` still `status =
ACTIVE`, `system_settings.trading_mode = PAPER`,
`strategy_versions.v1.status = DRAFT` — unchanged. This checkpoint made
zero Supabase write calls.

**19. Confirmation `paper_enabled = true` count remains 0:** confirmed
live: `0`. Nothing in this checkpoint reads or writes
`universe_members.paper_enabled`.

**20. Confirmation LIVE remains disabled:** confirmed live:
`live_trading_enabled = false`. No `live_enabled` column exists anywhere
in the schema (unchanged from Checkpoint 2/2.1); this checkpoint added no
schema at all.

**21. Exact blockers before Checkpoint 3B real historical trials:**
1. **All five research instruments are still eligibility `UNKNOWN`.** No
   runtime `discoverBybitSpotInstruments()` /
   `checkBybitResearchEligibility()` call has ever been made from a
   deployed environment (this development sandbox is geo-blocked from
   `api.bybit.com`, same restriction documented since Checkpoint 1/2).
   `getApprovedResearchInstruments()` will correctly return zero
   instruments and a blocker report until that runs and produces real
   `ELIGIBLE` rows with a populated `checked_at` — nothing in this
   checkpoint works around that, per §20-§22.
2. **No cost-model scenario is locked in.** `CostModel` is implemented and
   tested with arbitrary example values; Checkpoint 3B must decide and
   document the actual bps assumptions (base / 1.5× / 2× per the
   project's own stress-testing convention) before any result is treated
   as comparable.
3. **No real Bybit historical data has been loaded yet.** Every test in
   this checkpoint uses synthetic or mocked candles; `loadHistoricalCandles`
   has never been run against the live venue. Multi-year 1H/4H history for
   BTC/ETH/SOL/XRP/BNB still needs to be fetched, integrity-validated, and
   gap-checked before a single real trial runs.
4. **No `ResearchTrial` has been registered against real data or persisted
   anywhere** — the registry is pure in-memory code; if Checkpoint 3B
   wants durable trial history, that's a new migration proposal requiring
   review, not something this checkpoint pre-decided.
