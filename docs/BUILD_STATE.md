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
