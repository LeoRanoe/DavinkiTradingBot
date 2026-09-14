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
