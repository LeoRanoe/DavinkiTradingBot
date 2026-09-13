# Orchestration State (Task A)

This file is the handoff memory for future Claude sessions working through
the Task A milestones on top of the Codex-repaired foundation. Update it
after every milestone.

## CURRENT_MILESTONE
Milestone 1 — Owner risk + complete trade candidate. **Deterministic core
complete and tested.** Persistence/scan-job/UI wiring intentionally deferred
to the start of Milestone 2 (see REMAINING_TASK_A_WORK).

## LAST_COMPLETED_MILESTONE
None before this session. Milestone 1's deterministic library layer is
implemented and tested in this session (see below); it is not yet marked
`MILESTONE_1_COMPLETE = true` because the acceptance criterion is satisfied
at the `lib/` level only — it has not yet been exercised end-to-end through
the scan job, DB persistence, or UI.

## CURRENT_BRANCH
`claude/davinki-milestone-1-ekbi1k` (tracks `dev`/`staging`/`main`, which
were all at the same commit at session start).

## LAST_GOOD_COMMIT
See `git log` on this branch — the commit immediately following this
session's work, message prefixed `feat(risk):`.

## VERIFIED_BASELINE
Before any changes: clean install, 0 vulnerabilities; typecheck clean; lint
clean (2 pre-existing non-blocking warnings, unchanged); 52/52 tests
passing; production build passing. Accepted as-is per Task A instructions —
no re-audit performed.

After this session's changes: typecheck clean; lint unchanged (same 2
warnings); **84/84 tests passing** (52 pre-existing + 32 new); production
build passing.

## WHAT WAS BUILT THIS SESSION

All additive, fully backward compatible with every existing caller
(`lib/trading/execute.ts`, `lib/backtest/engine.ts`) - no existing test was
modified, no existing function signature was removed.

- `lib/risk/types.ts` - added `RiskMode`, `CostModel`, extended
  `RiskLimits` (optional `riskMode`, `fixedRiskAmount`, `minCandidateScore`,
  `minRiskReward`), extended `AccountState` (optional `availableBalance`),
  extended `PositionSizing` (risk budget, entry/exit fees, slippage cost,
  `estimatedActualRisk`/`modeledMaxLoss`, `estimatedTargetProfit`), and new
  typed `RejectionReason`s: `MIN_RISK_REWARD_NOT_MET`, `STALE_MARKET_DATA`,
  `CANDIDATE_EXPIRED`, `ENTRY_OUTSIDE_ALLOWED_RANGE`,
  `EXCESSIVE_VOLATILITY`, `DUPLICATE_CANDIDATE`.
- `lib/risk/position-sizing.ts` - new `computePositionSizeFromBudget`
  (the shared core: risk-budget-based sizing, capped to available balance
  so spot notional can never exceed usable capital, fee/slippage modeling).
  Legacy `computePositionSize(pct)` now delegates to it, byte-for-byte
  compatible with the mandatory spec #42 test. New `resolveRiskBudget`
  translates `RiskLimits` (either risk mode) into a dollar budget.
- `lib/risk/engine.ts` - `evaluateTradeRisk` now routes through
  `resolveRiskBudget` + `computePositionSizeFromBudget`, accepts an optional
  `costModel`, and enforces `minRiskReward` post-sizing. Behavior for
  existing callers (who never set `riskMode`/`costModel`) is unchanged.
- `lib/risk/entry-protection.ts` (new) - allowed entry zone, candidate
  expiry, and staleness/no-chasing checks.
- `lib/risk/volatility.ts` (new) - deterministic ATR-based volatility gate,
  independent of the strategy score's own volatility component.
- `lib/risk/duplicate-candidate.ts` (new) - the same dedup key the
  `signals` table already enforces at the DB level
  (`strategy_version_id:symbol:timeframe:candle_time`), for in-process
  duplicate rejection.
- `lib/candidates/types.ts` (new) - the full `TradeCandidate` type (every
  field the spec's "complete candidate" section lists) and the
  `CandidateState` lifecycle union, deliberately reusing/extending existing
  concepts (`signal_approval_status` + `trade_status`) rather than building
  a second state machine.
- `lib/candidates/build-candidate.ts` (new) - `buildTradeCandidate()`, the
  pure orchestrator: score threshold -> R/R threshold -> duplicate check ->
  entry protection -> volatility protection -> `evaluateTradeRisk` (fresh
  reference price, not the stale signal-candle close) -> either a complete
  `TradeCandidate` or a typed `CandidateRejection`. This is what satisfies
  the Milestone 1 acceptance criterion.
- `lib/trading/account-state.ts` - now also returns `availableBalance`
  (currently `= equity`, documented as such - PAPER/DEMO have no separate
  custody balance yet).
- New tests: `lib/risk/position-sizing-modes.test.ts`,
  `lib/risk/entry-protection.test.ts`, `lib/risk/volatility.test.ts`,
  `lib/candidates/build-candidate.test.ts` (32 tests covering every item in
  the spec's Milestone 1 test checklist: both risk modes, available-capital
  capping, fees/slippage, the mandatory min-order-risk-conflict scenario
  restated through the full candidate pipeline, entry-range/staleness/
  expiry, volatility, duplicate prevention, tick-size and qty rounding,
  existing daily/open-position limits, and LIVE remaining unreachable).

## DELIBERATE SCOPE DECISION THIS SESSION

Milestone 1 was implemented entirely as a pure, deterministic, unit-tested
`lib/` layer with **no production Supabase schema change and no scan-job/
API/UI wiring**. Rationale:
- The spec's own acceptance criterion for Milestone 1 is phrased in terms
  of "given a deterministic market fixture, the system produces a complete
  candidate or a typed rejection" - which the new tests satisfy directly,
  without needing persistence.
- Wiring the candidate object into `signals` (new columns), the scan job,
  and Telegram formatting is naturally Milestone 2's opening work
  ("candidate -> Telegram -> APPROVE/REJECT/VIEW"), and doing it now would
  mean touching the production DB schema and the live scan job in the same
  session as introducing brand-new risk math - more surface than is safe to
  land and verify in one pass, and a real production schema change is an
  outward-facing, semi-irreversible action better made deliberately at the
  start of the milestone that actually needs it.
- Every new type/field was still named and shaped to match what Milestone 2
  will need to persist, so wiring it in should be additive, not a rewrite.

## BLOCKERS
None for continuing Milestone 1 wiring or starting Milestone 2. Pre-existing
hardening items from the Codex handoff remain open (see `docs/BUILD_STATE.md`
"Remaining hardening") - none block Task A work.

## NEXT_ACTION
1. Add an additive Supabase migration: new `system_settings` columns for
   `risk_mode`, `fixed_risk_amount`, `min_candidate_score`, `min_risk_reward`,
   `max_entry_drift_pct`, `candidate_expiry_minutes`, `max_atr_pct`,
   `fee_bps`, `slippage_bps`, `execution_policy`; and new nullable `signals`
   columns to persist the richer candidate snapshot (`planned_entry`,
   `min_allowed_entry`, `max_allowed_entry`, `risk_snapshot jsonb`,
   `indicator_snapshot jsonb`, `volatility_state`). Regenerate
   `lib/supabase/database.types.ts` after applying.
2. Wire `buildTradeCandidate()` into `app/api/jobs/scan/route.ts` right
   after `evaluateSignal()`/`scoreSetup()` produce a `CANDIDATE`
   classification, persisting the result onto the `signals` row.
3. Add an owner-facing risk settings form (risk mode, pct/fixed amount, max
   open positions, max trades/day, daily-loss lock, min score, min R/R,
   execution policy) - likely `Settings` page, reading/writing the new
   `system_settings` columns.
4. Once (1)-(3) land and are tested end-to-end with a real scan cycle, mark
   `MILESTONE_1_COMPLETE = true` here and in `TASKS.md`, then start
   Milestone 2 (Telegram approval + paper position, per the Task A spec).

## REMAINING_TASK_A_WORK
Milestone 1 wiring (above) -> Milestone 2 (Telegram approval + paper
position, idempotent APPROVE) -> Milestone 3 (News + Qwen) -> Milestone 4
(Controlled learning) -> Milestone 5 (Trading Command Center UI) ->
Milestone 6 (staging -> production promotion with full manual verification).
