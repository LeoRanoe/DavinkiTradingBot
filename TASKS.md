# Tasks

- [x] Establish `dev` from the historical Claude implementation.
- [x] Run clean install, lint, typecheck, tests, and production build baseline.
- [x] Remove public signup and convert the existing account to explicit owner access.
- [x] Add owner-managed read-only guest credentials with create/reset/delete controls.
- [x] Enforce owner-only mutations in API routes and Supabase RLS.
- [x] Fix closed-candle selection and durable scanner no-op behavior.
- [x] Remove hardcoded Bybit minimum order fallback and verify current V5 spot responses.
- [x] Verify LIVE remains blocked and the mandatory minimum-order risk conflict test passes.
- [x] Deploy the repaired release and complete owner/guest browser verification.
- [x] Verify the deployed scanner/Edge path, idempotency, and Qwen configuration.
- [x] Promote the verified repair to `staging` and `main` while preserving the Claude branch.
- [x] Remove the stale Supabase admin-key dependency from owner Vault saves and dashboard PAPER writes.
- [ ] Replace/remove the stale Vercel admin key and retest Telegram callback execution plus the manual Cron fallback.
- [ ] Send a fresh Telegram test message and observe a complete production paper trade when a real candidate occurs.

## Task A — Milestone 1: Owner risk + complete trade candidate

- [x] Owner-configurable risk modes: `PERCENT_OF_EQUITY` and `FIXED_AMOUNT` (`lib/risk/position-sizing.ts` `resolveRiskBudget`).
- [x] Position sizing capped to available capital - spot notional never exceeds usable balance, capping only ever reduces risk, never inflates it (`computePositionSizeFromBudget`).
- [x] Fees + slippage modeled into `modeledMaxLoss`/`estimatedTargetProfit`, never materially understating realistic loss.
- [x] Mandatory `MIN_ORDER_RISK_CONFLICT` invariant restated and passing through the full candidate pipeline, not just the primitive.
- [x] Complete `TradeCandidate` object (`lib/candidates/types.ts`) with every field the spec lists: position, risk, lifecycle, indicator snapshot, news placeholders.
- [x] Entry protection: allowed entry zone, candidate expiry, stale-market-data rejection, no chasing (`lib/risk/entry-protection.ts`).
- [x] Deterministic volatility protection independent of Qwen (`lib/risk/volatility.ts`).
- [x] Duplicate candidate prevention, keyed identically to the existing `signals` unique constraint (`lib/risk/duplicate-candidate.ts`).
- [x] `buildTradeCandidate()` pure pipeline: score -> R/R -> duplicate -> entry protection -> volatility -> risk engine -> complete candidate or typed rejection (`lib/candidates/build-candidate.ts`).
- [x] 32 new deterministic tests covering the full Milestone 1 checklist; 84/84 passing; typecheck/lint/build all green.
- [x] Additive Supabase migration for owner risk settings and the candidate snapshot; applied to the live project, repo migrations reconciled with the deployed ledger, types regenerated.
- [x] Persist the candidate onto `signals` (new columns) and wire `buildTradeCandidate()` into `app/api/jobs/scan/route.ts` behind a fresh Bybit reference price.
- [x] Owner-facing risk settings UI + owner-only API with server-side validation mirroring the DB CHECK constraints, plus CONSERVATIVE/BALANCED/GROWTH_EXPERIMENT presets.
- [x] 27 integration tests proving settings → strategy → fresh price → candidate → persisted row, including every typed rejection. 111/111 tests passing.
- [x] Verified live: guest cannot mutate risk settings, owner can, LIVE refused three ways, deployed Cron scan still SUCCEEDED after the migration.
- [x] `MILESTONE_1_COMPLETE = true`.

Open decision for the owner (not a defect): Strategy `v1` is still `DRAFT`,
so production candidates currently resolve to a typed `STRATEGY_NOT_APPROVED`
rejection. Approving v1 for PAPER should follow backtest validation — it was
deliberately not flipped to make candidates flow.

## Task A — Milestone 2: Telegram approval + PAPER position lifecycle

- [x] Additive migration: `OPENING`/`ERROR` candidate states, owner-decision audit columns, trade settlement columns, and a partial unique index guaranteeing one position per candidate. Applied and verified live.
- [x] Approval flow built on ports: atomic PENDING -> OPENING claim, then full revalidation against a fresh ticker and fresh candles before anything opens.
- [x] REJECT records `REJECTED_BY_OWNER` atomically and keeps the candidate for later counterfactual analysis.
- [x] Telegram: actionable recommendation with real values and APPROVE/REJECT/VIEW, four-way callback authentication, no retry loop on internal error, News omitted rather than faked.
- [x] `/signals/[id]` candidate detail as the VIEW target (authenticated).
- [x] Automatic PAPER position management on the job's own cadence, not gated on a new strategy candle; atomic settlement, fees/slippage without double-counting, realized P/L and R, equity updated exactly once.
- [x] 74 new tests including the end-to-end proof; 185/185 passing, typecheck/lint/build clean.
- [x] Database guarantees verified directly against the live schema (atomic claim 1/0, duplicate position refused, LIVE refused, expiry sweep).
- [x] `MILESTONE_2_COMPLETE = true`, `AUTOMATED_TRADING_CORE_READY = true`.

Open for the owner: Strategy `v1` remains `DRAFT` on purpose. See
`docs/STRATEGY_V1_PAPER_READINESS.md` — the honest recommendation is NOT YET,
because zero backtests have ever been run.

## Task A — Milestone 3: News Intelligence + Qwen context

- [x] Additive migration: `news_events`, `news_event_sources`, `candidate_news_links`, `ai_usage_events`, plus `signals.news_risk` / `signals.news_snapshot`. Applied and verified live, with RLS on all four tables and no new security-advisor findings.
- [x] Provider abstraction (`NewsProvider`) with a dependency-free RSS/Atom parser and four public publisher feeds (SEC + Federal Reserve as OFFICIAL, CoinDesk + Cointelegraph as media). No scraping, no paid credential, polite identifying User-Agent.
- [x] Deterministic normalization, deduplication (canonical URL → normalized headline → token similarity, with the match reason persisted), asset relevance, category and BASE news risk — all before any AI is consulted.
- [x] Structured Qwen analysis validated by Zod; every failure mode (non-JSON, schema violation, 401, 429, timeout, missing credential) degrades cleanly and never blocks trading.
- [x] AI called only for relevant, materially-capable events, once per event, with a per-run cap. A routine ingestion run makes zero calls.
- [x] AI usage accounting in requests and tokens — deliberately no invented dollar cost.
- [x] Immutable news snapshot on the candidate; `/news` page, `/system` diagnostics and candidate detail all surface it read-only.
- [x] Structural guarantee that news never reaches sizing, stops, targets or eligibility (`lib/news/isolation.test.ts`), plus a test asserting a candidate is identical under LOW/HIGH/UNKNOWN news risk.
- [x] 69 new tests including the end-to-end proof; 254/254 passing, typecheck/lint/build clean.
- [x] `MILESTONE_3_COMPLETE = true`, `INTELLIGENCE_LAYER_READY = true`.

Not verified from the development session (sandbox blocks all outbound
network access): a live news-feed fetch and a real Qwen request. Both are
covered by tests against realistic fixtures and mocked HTTP, and both become
verifiable once the branch is deployed.

Next: Milestone 4 (Controlled learning). See `docs/ORCHESTRATION_STATE.md`
for the exact next action.

## Task A — Milestone 4: Controlled learning + strategy research

- [x] Actual settlement now captures MFE/MAE, factual reviews, and optional Qwen interpretation after equity is authoritative.
- [x] Rejected/risk-blocked candidates queue only explicit counterfactual research; account equity and actual P/L are isolated.
- [x] Deterministic analytics, evidence thresholds, chronological experiments, walk-forward primitives, and research-only Bybit backfill are available.
- [x] Strategy V1 remains `DRAFT`; LIVE remains disabled.
- [x] Applied and verified `00000000000007_learning_layer.sql` after the full
  integration gate; no application deployment was performed.

## Task A - Milestone 5: Trading Command Center UI

- [x] Reworked the authenticated shell as **Davinki Trading** with compact,
  responsive terminal navigation, semantic status language, and corrected
  Geist font tokens.
- [x] Rebuilt /dashboard around persisted operating state, risk, current
  action, market/news context, activity, learning evidence, and the DRAFT
  strategy gate.
- [x] Added first-class /candidates and /positions surfaces, including
  responsive candidate filters/cards, owner-only existing decision actions,
  PAPER position state, pending approvals, and closed outcomes.
- [x] Refined /signals and /trades for dense desktop use and mobile
  readability. No fake trading, health, performance, or research data added.
- [x] Strategy V1 remains DRAFT; LIVE remains disabled; no deployment work
  was performed.

## Task A - Milestone 5.5: Visual analytics

- [x] Added reusable closed-candle, drawdown, and actual-only cumulative-R
  chart transforms with focused tests.
- [x] Added persisted-candle BTCUSDT and ETHUSDT market charts with volume.
- [x] Added actual-only equity, drawdown, cumulative-R, and per-trade-R
  performance charts. No mock chart fallback is used.

## Task A - Milestone 6: Automatic PAPER research window

- [x] Added a persisted, server-authoritative research window
  (`paper_research_sessions`) that lets a DRAFT strategy execute in PAPER for
  a bounded period without implying it is validated or profitable.
- [x] Centralized strategy eligibility in `isStrategyEligibleForPaper()`,
  used by BOTH the scanner and the executor so they cannot disagree. LIVE is
  refused first and unconditionally.
- [x] Made AUTO operational through the EXISTING execution engine.
  `executeCandidate()` routes TELEGRAM, DASHBOARD and AUTO into the same
  `approveCandidate()`; AUTO changes who may authorize execution, never what
  is checked.
- [x] AUTO stops by itself: `effectiveExecutionPolicy()` refuses AUTO once
  the window elapses, on time alone, independently of any write having
  happened. The scanner additionally reconciles the stored state and sends
  exactly one completion notification.
- [x] Automatic trades record `decision_source = AUTO` with `owner_decision`
  left null, and are tagged to the research session so the period can be
  analyzed on its own without mixing in other history.
- [x] Added the research evidence report. It can only ever recommend KEEP
  DRAFT or OWNER REVIEW FOR PAPER APPROVAL, and gates that on sample size
  rather than on how good the numbers look.
- [x] Updated settings, dashboard and system diagnostics to show the
  EFFECTIVE execution policy and the research day, and never to display a
  DRAFT strategy as PAPER_APPROVED.
- [x] 270 -> 334 tests. Strategy V1 remains DRAFT; LIVE remains disabled.

## Multi-market architecture — Checkpoint 1 (generic domain + V1 parity)

Scope of this checkpoint only: introduce the venue/asset-class-independent
domain abstractions (`lib/domain/`) requested for the multi-market/multi-
strategy platform, and prove they don't change Strategy V1's behavior. This
checkpoint does **not** touch any production code path, any database
schema, or any UI. See `docs/BUILD_STATE.md` for detail and for the honest
list of everything the full spec still asks for that is NOT done yet.

- [x] Generic domain types: `AssetClass`, `VenueId`, `InstrumentId`,
  `Instrument` (`lib/domain/instrument.ts`), `CanonicalTimeframe`
  (`lib/domain/timeframe.ts`), `MarketDataProvider` /
  `ExecutionProvider` interfaces.
- [x] `BybitMarketDataProvider` (`lib/domain/adapters/bybit-market-data-provider.ts`)
  — a thin wrapper over the EXISTING, unmodified `lib/bybit/client.ts`. It
  only supports 1H/15M today because that's all the underlying client
  exposes; it throws rather than mis-mapping any other canonical timeframe.
- [x] Canonical crypto instrument registry (`lib/domain/instruments/crypto.ts`)
  naming BTC/USDT, ETH/USDT (the frozen production pair) plus SOL, XRP, BNB
  as domain-model-only research candidates, each explicitly flagged
  `paperEnabled: false`. Nothing in the codebase reads these new candidate
  ids yet — no scanner, no execution path, no universe table.
- [x] Long-only policy enforcement as a domain function
  (`assertLongOnlyPolicy`) that refuses SHORT even for an instrument whose
  convention allows it (proves "supporting a domain enum is not permission
  to short", CLAUDE.md §17).
- [x] `OpportunitySelector` (`lib/domain/opportunity.ts`) — deterministic,
  array-order-independent selection, for FUTURE multi-instrument research
  only. NOT wired into `app/api/jobs/scan/route.ts`.
- [x] Forex readiness proof only (CLAUDE.md §40/§41): fake, no-network
  `FakeForexMarketDataProvider` + EUR/USD and USD/JPY fixtures showing pip
  size, lot sizing (`forexRiskCompliantLots`, NOT the crypto qty×price
  formula), a bid/ask spread, and a weekend-closed trading calendar. No real
  broker is connected; no forex trading exists.
- [x] Parity + regression tests (`lib/domain/__tests__/`): the adapter calls
  the same underlying client function with the same arguments and changes
  no field; Strategy V1's `evaluateSignal` produces identical output
  whether fed directly or through the adapter's candle shape; BTC-then-ETH
  vs ETH-then-BTC evaluation is proven order-independent (CLAUDE.md
  §28/§29).
- [x] 461/461 tests passing (was 254 in Milestone 3, then grew through
  later milestones to 447 before this checkpoint's 14 new tests), typecheck
  clean, lint unchanged (2 pre-existing warnings), production build clean.
- [ ] Everything else in the full spec (universe service + DB tables,
  Settings → Markets / Strategies / Markets UI, strategy families v2-v6,
  research engine, holdout/walk-forward/cost-stress, shadow forward,
  correlation analytics, multiple-testing accounting, real forex adapter)
  is genuinely NOT implemented. See "Not done yet" in `docs/BUILD_STATE.md`.

## Multi-market architecture — Checkpoint 2 (configurable crypto research universe)

Scope: a proposed, additive DB schema for a configurable crypto research
universe, a Bybit instrument-discovery capability, a pure eligibility
classifier, and a repository layer over both an in-memory fixture and the
proposed schema. **The migration has NOT been applied to the live Supabase
project** — it is included for owner review only, per instruction. See
`docs/BUILD_STATE.md` "Checkpoint 2" for the full report (proposed tables,
RLS, live-verification status, and everything still outstanding).

- [x] Proposed migration `supabase/migrations/20260914130000_multi_market_universe.sql`:
  `venues`, `instruments`, `universes`, `universe_members`,
  `instrument_research_eligibility`. Additive-only; validated locally
  against a scratch PostgreSQL 16 database (DDL applies, is idempotent on
  re-run, CHECK constraints reject bad `asset_class`/`purpose` values) —
  never applied to the live project.
- [x] `lib/domain/eligibility.ts` — pure UNKNOWN/ELIGIBLE/INELIGIBLE
  classifier; never fabricates a verdict when a required metric is missing.
- [x] `lib/domain/discovery/bybit-instrument-discovery.ts` — venue-neutral
  discovery over `lib/bybit/client.ts`'s new `listSpotInstruments()` /
  `getListingStatus()` (additive exports; existing `getInstrumentMetadata`/
  `getCandles`/`getTicker` untouched). Raw Bybit shapes never cross the
  adapter boundary.
- [x] `lib/domain/universe.ts` (`UniverseRepository`, `InMemoryUniverseRepository`)
  and `lib/domain/repository/supabase-universe-repository.ts`
  (`SupabaseUniverseRepository`, untyped against the generated `Database`
  type until the migration is applied and types are regenerated). Batched:
  `listUniverseMembers` is one query with an embedded join, proven by a
  call-count assertion in tests.
- [x] `Ticker` gained an additive `turnover24h` field (from Bybit's existing
  `turnover24h` response field, already Zod-validated but previously
  unmapped) — read by the new eligibility check only.
- [x] 39 new tests (500 total, up from 461): eligibility classification,
  discovery heuristics (leveraged-token/stablecoin naming patterns,
  explicitly documented as heuristic not authoritative), repository
  research/paper isolation and batch-loading, forex-fixture compatibility
  with zero schema change, migration static-safety checks (no DROP, no
  `paper_enabled = true`, no `live_enabled` column, RLS present,
  idempotency), and a V1-production-unchanged regression guard.
- [x] typecheck/lint/build clean.
- [ ] Live Bybit discovery for SOL/XRP/BNB could NOT be run from this
  sandbox (outbound requests to `api.bybit.com` are geo-blocked here, same
  restriction already documented in `lib/bybit/client.ts` for production's
  Vercel region). The migration seeds them with
  `metadata.verifiedOnVenue: false` and `instrument_research_eligibility.status
  = 'UNKNOWN'` rather than claiming a verified result. Must be re-run from
  the deployed environment before treating them as confirmed.
- [ ] Settings → Markets UI deferred: per instruction, backend/domain first,
  UI as a small follow-up rather than sacrificing schema quality to ship a
  page against tables that don't exist yet.

## Checkpoint 2 — pre-migration review fixes (not yet applied)

A small correctness patch requested on review of commit
`12ac0f43a24251602d543f9a70e83dc0db5baef9`, before any live migration. Full
detail in `docs/BUILD_STATE.md`. All still schema-proposal-only; nothing
applied to Supabase.

- [x] `instrument_research_eligibility.checked_at`: nullable, no default
  (was `not null default now()`, which stamped a fake "verified just now"
  time on rows nobody had checked). Seed rows now leave it NULL.
- [x] Separated research SELECTION from eligibility: added
  `getEligibleResearchUniverse()` (fail-closed: universe enabled AND
  member research-selected AND instrument active AND eligibility status
  `ELIGIBLE`), backed by a shared pure helper
  (`selectEligibleResearchInstruments`) so both `InMemoryUniverseRepository`
  and `SupabaseUniverseRepository` apply the identical rule.
  `getResearchUniverse()` keeps its original meaning ("owner-selected",
  regardless of eligibility) so UI/config can still show an UNKNOWN
  instrument.
- [x] Removed fabricated exchange rules from canonical identity:
  `Instrument.priceIncrement/sizeIncrement/minSize` are now optional and
  ARE NOT populated by the crypto registry for any instrument, including
  BTC/ETH. The DB columns are nullable with no default; the seed INSERT no
  longer names them. Added `lib/domain/exchange-rules.ts` — a fail-closed
  guard any future generic execution code must call instead of defaulting
  a missing rule to 0/1.
- [x] `UniverseDefinition` now carries `assetClass`/`venueId` (previously
  read from the DB row and discarded); added a matching
  `universes_asset_class_valid` CHECK (the column existed with no CHECK).
- [x] Fixed `venues.asset_classes`' empty-array bug: `array_length(arr,1) >
  0` returns NULL (not 0) for `{}`, and a NULL CHECK result is treated as
  passing — so an empty array was silently admitted. Switched to
  `cardinality(classes) > 0`.
- [x] Every constraint-existence guard (`pg_constraint` lookup before
  `ALTER TABLE ... ADD CONSTRAINT`) is now scoped with `conrelid =
  'public.<table>'::regclass`, not `conname` alone.
- [x] `VenueId` is now an open string type (`KNOWN_VENUE_IDS` provides
  typo-safe constants for BYBIT/OANDA_FAKE/IBKR_FAKE) instead of a closed
  union — adding a real venue no longer requires widening a core type.
- [x] Renamed `CRYPTO_SPOT_LONG_ONLY_POLICY` → `PLATFORM_LONG_ONLY_POLICY`
  (it could fire on a non-crypto, e.g. FOREX, instrument).
  `Instrument.isActive` added (mirrors `instruments.is_active`), used by
  the new fail-closed filter.
- [x] Corrected two overclaiming comments: LIVE has no `live_enabled`
  column anywhere in this schema (stronger than "a column exists and is
  CHECKed false" — there's no column to check); `paper_enabled` has no
  permanent CHECK forcing it false (a real future PAPER promotion must be
  able to set it true) — its actual current safety is seed/default false +
  owner-only RLS mutation + no execution consumer yet + a future explicit
  approval step, stated as four independent, changeable layers rather than
  one absolute guarantee.
- [x] Added MANUAL VENUE EVIDENCE vs RUNTIME PROVIDER VERIFICATION language
  to the migration's seed comment: the owner's manual web confirmation that
  Bybit's Spot directory lists BTC/ETH/SOL/XRP/BNB does not flip
  `metadata.verifiedOnVenue` or move eligibility out of `UNKNOWN` — only an
  actual `discoverBybitSpotInstruments()` run from the deployed environment
  may do that.
- [x] 33 net-new tests (533 total, up from 500); typecheck/lint/build clean.

## Checkpoint 2 — final pre-apply guardrail patch (not yet applied)

Requested after review of commit `3dd6b9791a148ec0fee08a84108b3d53c747670a`.
Full detail in `docs/BUILD_STATE.md`. Still schema-proposal-only; nothing
applied to Supabase.

1. [x] `selectEligibleResearchInstruments` now also requires
   `eligibilityCheckedAt !== null` for ELIGIBLE — an ELIGIBLE row with no
   checked_at is treated as a data bug, not trusted.
2. [x] DB CHECK `eligibility_checked_at_required_when_eligible`:
   `status <> 'ELIGIBLE' or checked_at is not null` — the database-level
   twin of (1), holding even for a write that bypasses the app layer.
3. [x] Removed the owner-mutation RLS policy from
   `instrument_research_eligibility` entirely. It is now read-only for
   every client role, owner included — an eligibility verdict may only
   come from a server-side job using the service-role key (which bypasses
   RLS by design), never from a UI toggle.
4. [x] New trigger `validate_universe_member_compatibility` on
   `universe_members`: rejects a member whose instrument's `asset_class`
   doesn't match the universe's, or (when the universe pins a venue)
   whose instrument is on a different venue.
5. [x] New trigger `validate_instrument_venue_asset_class` on
   `instruments`: rejects an instrument whose `asset_class` isn't in its
   venue's `asset_classes`.
6. [x] `paperEnabled` removed from `UniverseRepository.setMemberFlags`'s
   type entirely (both implementations) — PAPER promotion needs its own
   dedicated, more heavily guarded path, not a flag alongside
   research/shadow selection. No such path exists yet.
7. [x] `lib/domain/exchange-rules.ts` now rejects a present-but-malformed
   value (NaN, Infinity, zero, or negative where positive is required),
   not just a missing one — `checkExchangeRulesAvailable` returns typed
   `problems` naming exactly what's wrong.
8. [x] Shared `set_updated_at()` trigger function attached to `instruments`,
   `universes`, `universe_members`, and `instrument_research_eligibility` —
   `updated_at` is now enforced by the database on every UPDATE, not left
   to application code to remember.
- [x] 17 net-new tests (550 total, up from 533); typecheck/lint/build
  clean. Re-validated the full DDL against a fresh scratch local
  PostgreSQL 16 database: every new trigger/constraint fires correctly
  (confirmed both the rejection and the accepting case for each), the
  `updated_at` trigger actually bumps the timestamp on UPDATE, and the
  full migration is still idempotent on re-run. Dropped afterward — no
  Supabase MCP call, no production mutation.

## Checkpoint 2 — cross-table invariant completion (not yet applied)

Requested after review of commit `de798cbba7fc0772bc709e3fbfba5d2b7a71c984`.
The prior compatibility triggers only fired on the child row
(`universe_members`) being written; they never stopped a PARENT
(`universes`/`instruments`/`venues`) from being edited out from under
already-compatible children. Full detail in `docs/BUILD_STATE.md`.

- [x] `universes_validate_update_against_members`: rejects a
  `UPDATE ... SET asset_class = ...` or `venue_id = ...` on a universe if
  any existing member would become incompatible.
- [x] `instruments_validate_update_against_memberships`: rejects the same
  UPDATE shape on an instrument if any existing `universe_members` row
  referencing it would become incompatible.
- [x] `venues_validate_update_against_instruments`: rejects shrinking
  `venues.asset_classes` if any existing instrument on that venue would
  lose its supported asset class. Never silently deactivates anything —
  the UPDATE is refused, full stop.
- [x] `selectEligibleResearchInstruments` now also requires
  `member.instrument.assetClass === universe.assetClass` and
  (`universe.venueId === null OR member.instrument.venue ===
  universe.venueId`) — defense in depth independent of whether the DB
  triggers exist, fired, or are backed by a real database at all.
- [x] 7 net-new tests (557 total, up from 550); typecheck/lint/build
  clean. Re-validated against a fresh scratch local PostgreSQL 16
  database: every one of the 11 requested scenarios exercised directly
  (valid membership; wrong-asset-class and wrong-venue member inserts
  rejected; universe asset_class/venue_id updates that would orphan
  members rejected, a no-op-relevant update accepted; instrument
  asset_class/venue_id updates that would break memberships rejected, an
  unrelated update accepted; venue asset_classes shrink that would strand
  an instrument rejected, a widen accepted) — plus a second full apply
  confirming the migration is still idempotent. Dropped the scratch
  database afterward — no Supabase MCP call, no production mutation.

## Checkpoint 2 — MIGRATION APPLIED to live Supabase (2026-09-15)

Approved commit `03e008fcfb9be4f1e31807dc3ae4559660c81af9` applied to
`davinki-trading-bot` (`xvklitfcesprzbnfslks`) via
`supabase/migrations/20260914130000_multi_market_universe.sql`. Full
verification detail in `docs/BUILD_STATE.md`.

- [x] Pre-apply: confirmed branch `claude/practical-davinci-6sejvp` at
  exactly `03e008f...`; confirmed live `trading_mode=PAPER`,
  `live_trading_enabled=false`, `strategy_versions.v1.status=DRAFT`,
  research session `82058733-...` still `ACTIVE`, `instrument_metadata`
  still only BTC/ETH — all as before.
- [x] Migration applied. Five tables created: `venues`, `instruments`,
  `universes`, `universe_members`, `instrument_research_eligibility`.
- [x] Seed state verified live: venue `BYBIT`; universe `crypto-core`;
  BTC/ETH/SOL/XRP/BNB all `research_enabled=true`,
  `shadow_enabled=false`, `paper_enabled=false`; eligibility all
  `status=UNKNOWN`, `checked_at=NULL` for all five.
- [x] Safety constraints and all five triggers verified live with
  rollback-only transactions (`eligibility_checked_at_required_when_eligible`;
  `validate_instrument_venue_asset_class`;
  `validate_universe_member_compatibility`;
  `validate_universe_update_against_members`;
  `validate_instrument_update_against_memberships`;
  `validate_venue_update_against_instruments`) — every rejection and
  acceptance case fired exactly as designed; confirmed zero residual rows
  from any test afterward.
- [x] RLS verified via `pg_policies`: all five tables readable by
  `authenticated`; `instruments`/`universes`/`universe_members` each have
  exactly one owner-scoped `ALL` policy; `instrument_research_eligibility`
  has no mutation policy at all; no `anon` policy anywhere.
- [x] `count(universe_members where paper_enabled=true) = 0`, confirmed
  live.
- [x] `lib/supabase/database.types.ts` regenerated from the live schema;
  `SupabaseUniverseRepository` switched from an untyped `SupabaseClient` to
  `SupabaseClient<Database>` (behavior unchanged, only compile-time column
  safety added).
- [x] 557/557 tests still passing after the type switch;
  typecheck/lint/build all clean.
- [ ] **Security advisor finding (new, from this migration):** all 7
  functions this migration created (`set_updated_at`,
  `venue_asset_classes_are_valid`, `validate_instrument_venue_asset_class`,
  `validate_universe_member_compatibility`,
  `validate_universe_update_against_members`,
  `validate_instrument_update_against_memberships`,
  `validate_venue_update_against_instruments`) have a mutable
  `search_path` (Supabase linter `function_search_path_mutable`, WARN).
  Not fixed in this checkpoint per its exact scope — flagged for a small,
  dedicated follow-up migration (`ALTER FUNCTION ... SET search_path = ''`
  on each, additive-only). The other two advisor findings
  (`authenticated_security_definer_function_executable` on the pre-existing
  `owner_*` RPCs, and `auth_leaked_password_protection`) predate this
  migration and are unrelated to it.
- [x] Confirmed unchanged after apply: `trading_mode=PAPER`,
  `live_trading_enabled=false`, `strategy_versions.v1.status=DRAFT`,
  research session still `ACTIVE`, `paper_enabled=true` count still 0.
- [x] Not started: runtime eligibility flips (all five stay UNKNOWN/NULL),
  Strategy V2 (TRB/MA/TSMOM/BBMR/shadow execution).

## Checkpoint 2.1 — security hardening: function search_path (applied live, 2026-09-15)

New migration `supabase/migrations/20260915110000_harden_multi_market_function_search_paths.sql`,
applied to `davinki-trading-bot`. Pins `search_path = ''` on all seven
Checkpoint 2 functions via `ALTER FUNCTION ... SET` (no body rewrites —
every table reference in all seven was already `public.`-qualified;
the only unqualified identifiers are `pg_catalog` built-ins, always
searched regardless of `search_path`). Full detail in `docs/BUILD_STATE.md`.

- [x] Did not edit `20260914130000_multi_market_universe.sql`.
- [x] All seven functions remain `SECURITY INVOKER` (`prosecdef = false`),
  confirmed live via `pg_proc`.
- [x] `pg_proc.proconfig` confirmed live for all seven:
  `{"search_path=\"\""}`.
- [x] Security Advisor: the 7 `function_search_path_mutable` findings are
  gone after apply (confirmed with a before/after `get_advisors` call).
  Two unrelated, pre-existing findings remain
  (`authenticated_security_definer_function_executable` on the `owner_*`
  RPCs, `auth_leaked_password_protection`) — not touched, per exact scope.
- [x] 10/10 regression checks re-verified live, all rollback-only, all
  behaving identically to before hardening: `updated_at` trigger still
  bumps; valid membership still succeeds; wrong asset-class and wrong-venue
  member inserts still rejected; instrument/venue asset-class mismatch
  still rejected on instrument insert; all three parent-mutation triggers
  (universe asset_class, instrument asset_class, venue asset_classes
  shrink) still rejected; ELIGIBLE+null `checked_at` still rejected,
  ELIGIBLE+populated `checked_at` still accepted. Zero residual test rows
  afterward — seed counts (1/5/1/5/5, 0 paper_enabled, 0 non-UNKNOWN
  eligibility) unchanged.
- [x] 562/562 tests passing (5 net-new — static checks on the new
  migration file); typecheck/lint/build clean.
- [x] Production safety re-confirmed live post-apply: V1 `DRAFT`,
  `trading_mode=PAPER`, `live_trading_enabled=false`, research session
  still `ACTIVE`, `paper_enabled=true` count still 0, all five instruments
  still `UNKNOWN`/`checked_at NULL`.

## Checkpoint 3A — V2 Trading Range Breakout + generic research engine (pure code, no DB, no live change)

New namespace `lib/research-engine/` — generic multi-strategy research
machinery, wholly separate from `lib/backtest/` (V1's frozen backtester,
untouched) and not imported by any production path. Full detail in
`docs/BUILD_STATE.md`.

- [x] Generic `StrategyDefinition`/`StrategyParameterSet`/entry-exit
  evaluation contract (`lib/research-engine/strategy.ts`) — strategies are
  pure, receive only `candles.slice(0, t+1)` (structural no-lookahead),
  never do IO, never authorize PAPER/LIVE.
- [x] V2 TRB (`lib/research-engine/strategies/trb.ts`): long-only,
  closed-candles-only, entry = close > prior-N-bar high channel, exit =
  close < prior-M-bar low channel (no fixed target), `initialStop` =
  prior-M-bar low (risk reference only, not a separate stop order). Status
  `RESEARCH_ONLY`. Exactly six preregistered configs (`TRB-1H-20-10`,
  `TRB-1H-50-20`, `TRB-1H-100-50`, `TRB-4H-20-10`, `TRB-4H-50-20`,
  `TRB-4H-100-50`) — no extra parameter set exists, enforced by test.
- [x] 4H added to the Bybit adapter (`lib/bybit/types.ts`,
  `lib/bybit/client.ts`, `lib/domain/adapters/bybit-market-data-provider.ts`)
  — additive; 1H/15M behavior byte-identical (regression-tested).
- [x] Historical pagination loader (`lib/research-engine/historical-loader.ts`):
  paginates backward via `endMs`, oldest-first output, dedupes by
  `openTime`, **rejects** a conflicting duplicate (same time, different
  OHLCV) rather than picking one, filters unclosed bars, detects gaps,
  explicit `truncated` flag (never silently incomplete), capped by
  `maxPages` (never infinite).
- [x] Candle integrity validation (`lib/research-engine/candle-integrity.ts`):
  strictly-increasing/no-duplicate openTime, finite OHLCV,
  `high>=max(open,close)`, `low<=min(open,close)`, `high>=low`,
  `volume>=0`, unclosed-candle detection. The engine refuses to run on
  unvalidated data (throws).
- [x] Generic backtest engine (`lib/research-engine/engine.ts`) — does NOT
  import `lib/strategy/v1/signal.ts`. Next-bar-open execution for both
  entry and exit, one open position per call, explicit `OPEN_AT_END`
  rather than any faked fill, deterministic (proven by an
  instrumented-strategy test that no call is ever given more than
  `candles.slice(0, t+1)`).
- [x] Configurable, unambiguous cost model (`lib/research-engine/cost-model.ts`)
  — `entryFeeBps`/`exitFeeBps`/`entrySlippageBps`/`exitSlippageBps`, each
  applied exactly once, at exactly one fill, with one documented meaning
  (fixes the old `lib/backtest/types.ts` "round-trip... applied each side"
  ambiguity — that file itself is untouched).
- [x] Normalized research-only risk sizing
  (`lib/research-engine/position-sizing.ts`) — `initialEquity`/`riskPct`
  convention, no leverage, rejects `stop >= entry` rather than forcing a
  fit. Explicitly documented as NOT representing the real $20 PAPER
  account.
- [x] Metrics (`lib/research-engine/metrics.ts`): tradeCount, win/loss,
  winRate, avgWin/LossR, expectancyR, medianR, profitFactor, gross/net
  return, maxDrawdownPct, maxDrawdownR, maxLosingStreak, finalEquity,
  average/medianHoldingBars, totalCosts — computed from CLOSED trades
  only; `openPositionsAtEnd` reported separately.
- [x] Deterministic chronological 60/20/20 split
  (`lib/research-engine/split.ts`) — index-based, contiguous, no
  randomness.
- [x] Immutable trial registry (`lib/research-engine/trial.ts`) — pure
  in-memory record + SHA-256 config fingerprint (stable under key
  reordering). **No DB migration** — persistence intentionally deferred
  per §27, to be proposed and reviewed separately if Checkpoint 3B needs
  it.
- [x] Buy-and-hold benchmark (`lib/research-engine/benchmark.ts`) — total
  return + max drawdown, explicitly not a risk-sized strategy result.
- [x] Eligibility gate (`lib/research-engine/eligible-universe-gate.ts`) —
  the one approved call site for a real historical run's instrument
  source: `getEligibleResearchUniverse()` only, never
  `getResearchUniverse()` as a bypass (asserted by a static source-text
  test). Did **not** touch `classifyResearchEligibility`'s
  `minTurnoverUsd24h === null → UNKNOWN` behavior.
- [x] 97 net-new tests (664 total, up from 567); typecheck/lint/build
  clean.
- [x] Confirmed live (read-only query, no write): V1 `status=DRAFT`,
  `trading_mode=PAPER`, `live_trading_enabled=false`, research session
  still `ACTIVE`, `paper_enabled=true` count still 0 — this checkpoint
  made zero Supabase writes.
- [ ] **Blockers before Checkpoint 3B real historical trials:** (1) all
  five research instruments are still eligibility `UNKNOWN` — no runtime
  `discoverBybitSpotInstruments()`/`checkBybitResearchEligibility()` call
  has ever been made from a deployed environment (this sandbox is
  geo-blocked); `getApprovedResearchInstruments()` will return zero
  instruments until that runs. (2) No real cost-model values are locked in
  yet — Checkpoint 3A only implements and tests the mechanism. (3) No
  actual Bybit historical candle data has been fetched/paginated for
  real instruments yet — only synthetic/mocked data was used for tests.
