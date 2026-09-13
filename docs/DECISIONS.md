# DECISIONS

- **Base UI over Radix for shadcn primitives.** Used the current shadcn CLI
  default (`base-nova` preset) rather than pinning to the older Radix-based
  registry, since the spec asks for "the current recommended/default
  primitive system."
- **Single-user RLS model.** Rather than building multi-tenant row ownership,
  every table's read policy is `to authenticated using (true)` because this
  is explicitly a single-user private app with no public sign-up flow.
  Privileged writes go through the service-role admin client server-side.
  Revisit if multi-user support is ever requested.
- **strategy_parameters as a normalized side table AND parameters as jsonb on
  strategy_versions.** The spec lists both `strategy_versions` and
  `strategy_parameters`. We keep the full immutable snapshot as `parameters
  jsonb` on the version row (what the app actually reads at runtime) and also
  populate `strategy_parameters` as queryable key/value rows for
  cross-version parameter comparison in the UI later.
- **LIVE enforced at three independent layers**, not one: DB CHECK
  constraints (`trades`/`orders`/`system_settings`), the risk engine
  (`evaluateTradeRisk` refuses `LIVE` unconditionally before any other
  check), and (once built) a UI badge. Defense in depth for the one rule that
  must never fail.
- **Bybit Demo and real trading share no code path with LIVE.** `TradingMode`
  is a 4-value union including LIVE only so it can be referenced/reasoned
  about; `EXECUTABLE_MODES` explicitly excludes it and every execution
  function is expected to check membership before acting.
- **Position sizing rounds DOWN to the exchange qty step, never up.**
  Rounding up would silently exceed the intended risk budget; rounding down
  and rejecting below-minimum trades (rather than bumping to the minimum) is
  the spec's explicit requirement (#42).
- **Free-tier Supabase project.** Confirmed $0/month cost before creation
  (`get_cost` returned 0 for this org), so no user billing confirmation dialog
  was needed beyond the standard cost-confirmation call.
- **Milestone 1 shipped as a pure `lib/` layer, no schema/scan-job/UI wiring
  yet.** `resolveRiskBudget`/`computePositionSizeFromBudget` and
  `buildTradeCandidate()` are fully deterministic and unit-tested against
  fixtures, which is what the milestone's acceptance criterion actually
  requires. Touching the production Supabase schema and the live scan job
  is deferred to Milestone 2's opening work, so a real schema change lands
  deliberately, in the same pass as the code that actually needs it, rather
  than speculatively alongside brand-new risk math.
- **One risk-sizing primitive, not two.** `computePositionSizeFromBudget`
  is the only place spot position sizing happens; legacy
  `computePositionSize(pct)` (used by the backtester and paper execution)
  is now a thin wrapper that computes `riskBudget = equity * pct` and
  delegates. `FIXED_AMOUNT` risk mode reuses the exact same function with a
  different budget - no parallel sizing logic.
- **`RiskLimits`/`AccountState`/`PositionSizing` extended with optional
  fields, not replaced.** `riskMode`, `fixedRiskAmount`, `minCandidateScore`,
  `minRiskReward`, `availableBalance`, and the new fee/slippage/modeled-loss
  fields are additive; every existing caller (`lib/trading/execute.ts`,
  `lib/backtest/engine.ts`) and the mandatory spec #42 test are unchanged
  and still pass.
- **Candidate lifecycle reuses existing state, no second state machine.**
  `lib/candidates/types.ts` documents `CandidateState` as the full spec
  union, but explicitly says the DB-level truth stays `signal_approval_status`
  + `trade_status` (already in the schema) - Milestone 2's wiring should
  derive/extend those, never add a parallel table of trade states.
