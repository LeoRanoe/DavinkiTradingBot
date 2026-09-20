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

## JeanFX Gold — source-fidelity pass (this run)

Authoritative source: `JeanFX_Final_Complete` (21pp). Full rule-by-rule trace
in `docs/strategies/jeanfx-source-fidelity-matrix.md`.

- [x] Replaced the EMA50/EMA200 HTF bias with the source's liquidity-draw
  rule. No EMA is consulted for JeanFX bias anywhere; a regression test
  asserts it.
- [x] Made configuration-dependent timeframes drive the actual fetch
  (`resolveRequiredTimeframes`). Selecting the M30 profile previously
  received H1 candles while appearing to work.
- [x] Unified the liquidity map over all three source-named kinds. Session
  highs/lows were previously targets only, so JeanFX could not sweep the
  liquidity the source says London goes after.
- [x] Target is the NEXT liquidity pool; 1:3 is a quality gate on it, not a
  search criterion. The previous scan-forward manufactured the required R:R.
- [x] Risk bounded to the source's 0.5-1% server-side (was up to 5%), and an
  invalid configuration now fails closed instead of falling back to defaults.
- [x] Max 3 trades/session actually enforced, from durable trade records,
  London and New York counted separately, overlap-safe, DST-safe.
- [x] Removed the LONG-first array-order bias; contradictory opposing setups
  are rejected rather than resolved arbitrarily.
- [x] Gold made primary: XAU/USD profiles (Active M30 / Selective H1), METAL
  asset class, LONDON_AND_NEW_YORK session default.
- [x] partialExitPlan implemented as a labelled versioned SOURCE AMBIGUITY
  (50% @ +1.5R then break-even) instead of `null`.
- [x] Built the market-data provider abstraction, canonical instrument model
  (`METAL:TWELVEDATA:XAU/USD`), Twelve Data XAU/USD adapter, Gold sizing and
  bid/ask PAPER execution with spread, slippage and commission.
- [x] 638 -> 690 tests. LIVE remains disabled at all three layers.

### Blocked pending an external credential

- [ ] Historical validation (12-24mo walk-forward), Gold PAPER activation,
  and the dedicated JeanFX PAPER session. All require **`TWELVE_DATA_API_KEY`**
  in Vercel; it is not set. No substitute feed is used and no result is
  estimated. JeanFX therefore remains **RESEARCH_ONLY / SHADOW** — no
  historical edge has been demonstrated either way.

### Not started (deferred by agreement)

- [ ] `/trading` control centre and the frontend operating surface
  (strategy/config/assignment management, scanner controls, funnel,
  positions, performance, risk, audit log, health).
- [ ] Generic `app/api/jobs/scan-strategies` route, M5 idempotency keys,
  position management loop, JeanFX PAPER attribution tables.
- [ ] V1 AUTO-PAPER stand-down (V1 still opens new AUTO PAPER trades).
