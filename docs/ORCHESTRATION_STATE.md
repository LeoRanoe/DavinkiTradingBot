# Orchestration State (Task A)

This file is the handoff memory for future Claude sessions working through
the Task A milestones on top of the Codex-repaired foundation. Update it
after every milestone.

## MILESTONE_1_COMPLETE = true
## MILESTONE_2_COMPLETE = true
## AUTOMATED_TRADING_CORE_READY = true

Owner risk configuration, the complete trade-candidate pipeline, Telegram
approval, PAPER execution and automatic position management are implemented,
integrated into the real scanner code path, persisted and verified. The bot
is operational in PAPER + APPROVAL_REQUIRED, subject to the one owner
decision recorded under "Caveat A" (Strategy v1 is still DRAFT by design).

## CURRENT_MILESTONE
None in progress. Milestone 3 (News + Qwen) is next and has NOT been started.

## LAST_COMPLETED_MILESTONE
Milestone 2 — Telegram approval + PAPER position lifecycle.

## CURRENT_BRANCH
`claude/davinki-milestone-1-ekbi1k`

## LAST_GOOD_COMMIT
The commit on this branch prefixed `feat(milestone-2):`. Milestone 1 is
carried by the preceding `feat(risk):` and `feat(milestone-1):` commits.

## VERIFIED_BASELINE (after Milestone 2)

- Local: typecheck clean, lint clean (the same 2 pre-existing non-blocking
  warnings), **185/185 tests passing**, production build passing.
- Live Supabase (`xvklitfcesprzbnfslks`): both Milestone 2 migrations
  applied and verified. Database guarantees exercised directly against the
  real schema inside a rolled-back transaction:
  atomic claim admits exactly one caller (`first=1, second=0`), the expiry
  sweep works, a duplicate position per candidate is refused by the unique
  index, a LIVE trade insert is refused, and the full
  PENDING -> OPENING -> APPROVED lifecycle works with the new enum values.
- RLS re-verified earlier this milestone chain: guest settings UPDATE = 0
  rows, owner = 1 row; LIVE refused three ways.
- Deployed production: the scheduled scan ran SUCCEEDED at 19:45 UTC
  **after** both Milestone 2 migrations, 2 symbols processed, no errors, with
  NOOP still observed on ticks with no new closed candle - the additive
  migrations did not break the running (pre-change) deployment or the Cron
  path.

## WHAT WAS BUILT (Milestone 2 — Telegram approval + PAPER positions)

### Schema (additive only)

`20260913200000_milestone2_approval_and_positions.sql` (+ a separate
enum-value migration, since new enum values must commit before use):

- `signal_approval_status` gained `OPENING` (the atomic claim state) and
  `ERROR`.
- `signals` gained `owner_decision`, `decision_at`, `decision_source`,
  `approval_delay_ms`, `processed_at` (+ CHECK constraints).
- `trades` gained `exit_reason`, `entry_fee`, `exit_fee`, `risk_budget`,
  `modeled_max_loss`, `equity_after`.
- **`trades_one_per_signal`**: a partial unique index on
  `trades (signal_id)` - the database guarantee that one candidate can
  produce at most one position.
- `scanner_update_signals` RLS policy so the scheduled job can sweep expired
  candidates. No existing policy was modified or widened.

### Approval flow (`lib/trading/approval.ts`)

Built against ports (`ApprovalStore`, `MarketDataPort`) so every branch is
deterministically testable; the Supabase adapters are
`approval-store.ts` / `position-store.ts`.

- APPROVE = atomic claim, then FULL revalidation against a fresh ticker and
  fresh candles (volatility is recomputed from current ATR, so it can
  genuinely "become excessive"), current settings, current account, current
  exchange rules - then execution. The stored trade plan is never
  recomputed, so the bot cannot chase.
- REJECT = atomic PENDING -> REJECTED with `owner_decision='REJECTED'`;
  candidate data is retained for Milestone 4 counterfactuals.
- Every state transition is a single-statement compare-and-set. No
  read-then-write anywhere in the flow.

### Position management (`lib/trading/position-manager.ts`)

- Runs in PHASE 1 of the scan job, on the job's cadence, NOT gated on a new
  closed strategy candle.
- Atomic OPEN -> CLOSED; the equity snapshot is written only by the caller
  that won the transition, so settlement cannot double-count.
- `settlement.ts` holds the cost math: slippage lives in the fill prices
  only (never subtracted twice), fees are charged once per leg, and realized
  R uses the modeled max loss so a clean stop-out reads about -1.0R after
  costs.
- Refuses to settle on stale candles rather than inventing a fill.

### Telegram

Actionable recommendation with real persisted values and APPROVE / REJECT /
VIEW buttons; News is omitted rather than faked. Callbacks are authenticated
four ways (secret header, owner user id, owner chat id, strict `action:uuid`
payload) and the handler returns 200 even on internal error so Telegram
cannot retry-loop. Position-opened and position-closed messages are factual,
with no gambling language.

### UI

`/signals/[id]` - the VIEW target: setup, trade plan, risk breakdown,
indicators and the resulting position. Authentication required.

### Tests (+74 this milestone)

`settlement.test.ts` (10), `approval.test.ts` (32), `position-manager.test.ts`
(15), `telegram.test.ts` (13), and `milestone2-e2e.test.ts` (4) — the last
being the primary proof: fixture -> real Strategy V1 -> real risk engine ->
persisted PENDING -> simulated Telegram APPROVE -> full revalidation ->
exactly one PAPER position -> market movement -> automatic close -> P/L,
realized R, equity updated once -> notification payload.

## Milestone 2 completion evidence

All 20 acceptance criteria are met; the notable ones:

| Criterion | Status |
|---|---|
| 6. Approval performs full deterministic revalidation | 16 revalidation branches asserted, each rejecting instead of executing |
| 7. Moved/expired/invalid candidate does not execute | Entry-range, stale-data, expiry, volatility, limits all covered |
| 8. At most one PAPER position per candidate | Atomic claim + unique index, both verified live and in tests |
| 10. Management works across requests | E2E test settles via a brand-new store object, state read from storage only |
| 13-16. Fees/slippage, P/L, R, equity | `settlement.test.ts` asserts no double-counting; equity moves once, by exactly the net P/L |
| 18. Duplicate callbacks/scans cannot duplicate state | Double-tap, concurrent race, 3x retry, repeated scan all asserted |
| 19. LIVE remains impossible | Five layers; live insert refused in the database |

## WHAT WAS BUILT EARLIER (Milestone 1 integration)

### Schema (additive only — nothing dropped, relaxed, or overwritten)

`supabase/migrations/20260913190000_milestone1_owner_risk_and_candidates.sql`,
applied to the live project and verified.

- `system_settings` gained: `risk_mode`, `fixed_risk_amount`,
  `min_candidate_score`, `min_risk_reward`, `max_entry_drift_pct`,
  `candidate_expiry_minutes`, `max_market_data_age_seconds`, `max_atr_pct`,
  `fee_bps`, `slippage_bps`, `execution_policy` (default
  `APPROVAL_REQUIRED`). Existing columns were REUSED, not duplicated:
  `max_risk_per_trade_pct` (percent risk), `max_open_positions`,
  `max_new_trades_per_day`, `max_losing_trades_per_day` (the daily-loss
  lock), `signal_expiry_minutes`.
- 18 CHECK constraints now enforce every bound server-side, including two
  new LIVE layers: `trading_mode <> 'LIVE'` and "AUTO execution policy only
  with PAPER/DEMO".
- `signals` gained the candidate snapshot: `trading_mode`,
  `reference_price`, `reference_price_at`, `planned_entry`,
  `minimum_allowed_entry`, `maximum_allowed_entry`, `stop_pct`,
  `volatility_state`, `rejection_reason`, `rejection_detail`,
  `risk_snapshot` (jsonb), `indicator_snapshot` (jsonb), plus a
  `signals_live_forbidden` constraint and an approval-status index.
- `lib/supabase/database.types.ts` regenerated to match the live schema.
- Five migrations that existed in the deployed ledger but had no repo file
  were backfilled, so every deployed migration now has a repository file.

### Scanner integration

`app/api/jobs/scan/route.ts` now runs, for a CANDIDATE classification only:
owner settings -> account state -> live exchange metadata -> **fresh Bybit
ticker** -> `buildCandidateForScan()` -> one `signals` insert carrying
either the complete candidate or the typed rejection.

- A CANDIDATE score is explicitly treated as a strategy opinion, not a
  financial decision; the deterministic layer has final authority.
- The candidate is priced off a fresh ticker (with Bybit's own server
  timestamp, newly surfaced as `Ticker.serverTimeMs`), never off the closed
  signal candle.
- Exchange rules come from the live Bybit fetch, falling back to the stored
  row; if neither is available the scan **fails closed** with
  `INVALID_EXCHANGE_METADATA` rather than guessing a minimum.
- Closed-candle invariant, the candles-table watermark, and the
  `(strategy_version_id, symbol, timeframe, candle_time)` unique constraint
  are untouched — one dedup mechanism, not two.
- Telegram now announces only candidates the risk layer actually approved,
  with the real modeled max loss instead of the previous hardcoded `0`. The
  interactive APPROVE/REJECT flow remains Milestone 2 work.
- No Qwen call, no position opened, no approval message — all Milestone 2+.

### Settings surface

- `lib/settings/risk-settings.ts` — typed `OwnerRiskSettings`, DB-row
  parsing with numeric coercion, mappers into `RiskLimits`/`CostModel`/
  `EntryProtectionConfig`/`VolatilityConfig`, a Zod schema whose bounds
  mirror the DB CHECK constraints exactly, and the three presets.
- `app/api/settings/risk/route.ts` — owner-only, server-validated, and
  deliberately uses the RLS-respecting client so the database independently
  refuses a guest write.
- `app/(app)/settings/risk/page.tsx` + `components/settings/risk-settings-form.tsx`
  — owner-only UI covering every setting, with explicit "risk is not
  position size" copy, and a sidebar entry.
- Presets (CONSERVATIVE / BALANCED / GROWTH_EXPERIMENT) only populate
  owner-editable fields and pass the identical validation. Nothing selects
  one automatically; a small account never escalates its own risk.

### Tests

`lib/candidates/scan-integration.test.ts` — 27 integration tests driving the
REAL strategy/indicator/risk code over a deterministic candle fixture that
genuinely scores 99/CANDIDATE under production thresholds (thresholds were
never lowered to manufacture one). Total suite: **111 tests**.

## Milestone 1 completion evidence

| Criterion | Status |
|---|---|
| 1. Owner-configurable risk persists | DB columns + API + UI; owner write verified against live RLS |
| 2. Scanner consumes those settings | `riskSettingsFromRow` -> `buildCandidateForScan` in the scan route |
| 3. Complete candidates from the real scanner code path | Yes, via the composed production functions (see caveat A) |
| 4. Candidate snapshots persist correctly | Row shape asserted end-to-end in integration tests |
| 5. Deterministic rejections persist correctly | 10 typed rejection reasons asserted on the persisted row |
| 6. Duplicate scans remain idempotent | Existing watermark + unique constraint untouched; dedup key asserted to match the constraint tuple |
| 7. UI settings owner-only | Page redirect + API `isOwner` + RLS (guest UPDATE = 0 rows, verified live) |
| 8. Exchange metadata dynamic | Live Bybit values confirmed (BTC tick 0.1/step 0.000001; ETH 0.01/0.00001); fails closed without them |
| 9. LIVE remains disabled | Verified live: `trading_mode='LIVE'`, `live_trading_enabled=true`, and `AUTO`+non-PAPER/DEMO all refused |
| 10. All quality checks pass | 111/111 tests, typecheck, lint, production build |

### Caveat A — Strategy V1 is still DRAFT

`strategy_versions.status` for `v1` is `DRAFT`, so in production every
CANDIDATE currently resolves to a typed `STRATEGY_NOT_APPROVED` rejection.
That is the gate working as designed (an unvalidated strategy must not
trade), not a defect — but it means **no actionable candidate will appear in
production until the owner approves v1 for PAPER**, which should follow
backtest validation, not convenience. This was deliberately NOT flipped:
doing so to make candidates flow would be manipulating a production
threshold.

### Caveat B — Not yet deployed

The schema changes are live (shared project), but the Milestone 1 and 2
application code is on the feature branch only. Promotion to `dev`/`staging`/`main` is
Milestone 6 work or an explicit owner decision. The running deployment was
verified to still work against the migrated schema.

## BLOCKERS
None. Pre-existing hardening items from the Codex handoff remain open (see
`docs/BUILD_STATE.md` "Remaining hardening") and do not block Milestone 2.

## NEXT_ACTION

Two things are open, in this order of importance:

1. **Owner decision (not a coding task): Strategy v1 DRAFT -> PAPER_APPROVED.**
   Read `docs/STRATEGY_V1_PAPER_READINESS.md`. The recommendation is NOT YET:
   zero backtests have ever been run, so there is no sample size, expectancy,
   profit factor or drawdown to judge. The report lists exactly what would
   make the decision answerable. Do NOT flip this status to make the pipeline
   visibly work.
2. **Milestone 3 (News + Qwen).** A separate News Intelligence module:
   `NewsProvider -> normalize -> deduplicate -> event clustering -> asset
   relevance -> Qwen structured analysis -> candidate context`. News informs
   a trade; it never creates one. Most 5-minute scans must make zero Qwen
   calls, and Qwen failure must not stop the scanner, strategy, risk,
   Telegram or PAPER management. The `news` field already exists structurally
   on `TradeCandidate` and is deliberately omitted from Telegram until real
   data backs it.

Conventions to preserve in Milestone 3+:
- `signals.rejection_reason` set = engine rejection; null with
  `owner_decision='REJECTED'` = owner rejection. One state machine.
- Never add a second dedup mechanism; the signals unique constraint and
  `trades_one_per_signal` are authoritative.
- Deployment of this branch has not happened yet (see Caveat B).

## REMAINING_TASK_A_WORK
Milestone 3 (News + Qwen) -> Milestone 4 (Controlled learning) ->
Milestone 5 (Trading Command Center UI) -> Milestone 6 (staging ->
production promotion with full manual verification).
