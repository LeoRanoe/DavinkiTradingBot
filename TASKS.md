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
- [ ] Persist the candidate onto `signals` (new columns) and wire `buildTradeCandidate()` into `app/api/jobs/scan/route.ts`.
- [ ] Owner-facing risk settings UI (risk mode, pct/fixed amount, limits, min score, min R/R, execution policy).
- [ ] Mark `MILESTONE_1_COMPLETE = true` once the above is exercised end-to-end through a real scan cycle.

See `docs/ORCHESTRATION_STATE.md` for full detail and the exact next action.
