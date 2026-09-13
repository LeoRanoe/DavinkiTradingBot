# Orchestration State (Task A)

This file is the handoff memory for future Claude sessions working through
the Task A milestones on top of the Codex-repaired foundation. Update it
after every milestone.

## MILESTONE_1_COMPLETE = true

Owner risk configuration and the complete trade-candidate pipeline are
implemented, integrated into the real scanner code path, persisted, and
verified. See "Milestone 1 completion evidence" below, including the two
honest caveats.

## CURRENT_MILESTONE
None in progress. Milestone 2 (Telegram approval + paper position) is the
next milestone and has NOT been started.

## LAST_COMPLETED_MILESTONE
Milestone 1 — Owner risk + complete trade candidate.

## CURRENT_BRANCH
`claude/davinki-milestone-1-ekbi1k`

## LAST_GOOD_COMMIT
The commit on this branch prefixed `feat(milestone-1):` — the Milestone 1
integration commit. The preceding `feat(risk):` commit carries the
deterministic library layer.

## VERIFIED_BASELINE

- Local: typecheck clean, lint clean (2 pre-existing non-blocking warnings,
  unchanged), **111/111 tests passing**, production build passing.
- Live Supabase (`xvklitfcesprzbnfslks`): migration applied and verified;
  existing settings values preserved; RLS re-verified (guest write blocked,
  owner write allowed); all three LIVE paths refused at the database level.
- Deployed production: a scheduled scan ran at 19:30 UTC **after** the
  migration and returned SUCCEEDED with 2 symbols processed and no errors,
  proving the additive migration did not break the running (pre-change)
  deployment or the Cron path. NOOP behavior still observed on ticks with
  no new closed candle.

## WHAT WAS BUILT THIS SESSION (Milestone 1 integration)

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

The schema change is live (shared project), but this session's application
code is on the feature branch only. Promotion to `dev`/`staging`/`main` is
Milestone 6 work or an explicit owner decision. The running deployment was
verified to still work against the migrated schema.

## BLOCKERS
None. Pre-existing hardening items from the Codex handoff remain open (see
`docs/BUILD_STATE.md` "Remaining hardening") and do not block Milestone 2.

## NEXT_ACTION
Start Milestone 2 (Telegram approval + paper position):
1. Telegram recommendation message rendering the persisted candidate
   snapshot (symbol, score, entry, allowed entry range, stop, target, R/R,
   equity, risk config, risk budget, estimated actual risk, position size,
   target profit, regime, volatility, expiry) with APPROVE / REJECT / VIEW
   buttons.
2. APPROVE = full fresh-market revalidation through the same
   `buildCandidateForScan` seam (identity, candidate state, expiry, current
   price, entry drift, freshness, strategy validity, stop/target, risk,
   equity, balance, exchange rules, daily limits, open-position limit,
   idempotency) — never blind execution of the stored proposal.
3. Exactly one position per candidate: protect against double click,
   webhook retry, cron overlap, dashboard + Telegram races, Vercel retry.
4. PAPER execution + persistent position + automatic stop/target management
   + portfolio update + Telegram result.
5. Mark `AUTOMATED_TRADING_CORE_READY = true`.

Note for Milestone 2: `signals.rejection_reason` distinguishes an engine
rejection (reason set) from an owner rejection (reason null) on the same
`approval_status = 'REJECTED'` row — keep that convention rather than adding
a second state column.

## REMAINING_TASK_A_WORK
Milestone 2 (Telegram approval + paper position) -> Milestone 3 (News +
Qwen) -> Milestone 4 (Controlled learning) -> Milestone 5 (Trading Command
Center UI) -> Milestone 6 (staging -> production promotion with full manual
verification).
