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
