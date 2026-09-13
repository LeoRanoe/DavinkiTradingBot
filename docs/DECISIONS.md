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
- **Milestone 1 landed in two passes: the deterministic `lib/` layer first,
  then schema/scanner/UI integration.** The library pass shipped
  `resolveRiskBudget`/`computePositionSizeFromBudget` and
  `buildTradeCandidate()` against fixtures; the integration pass added the
  additive migration, the scanner wiring, and the owner settings surface.
  Splitting it kept a production schema change out of the same pass as
  brand-new risk math.
- **The `signals` row IS the candidate.** No separate candidates table, no
  second state machine: `approval_status` stays the single lifecycle column
  and `rejection_reason` qualifies it — set means the deterministic risk
  layer rejected it (typed reason), null on a REJECTED row means the owner
  did. The existing unique constraint on
  `(strategy_version_id, symbol, timeframe, candle_time)` remains the only
  deduplication mechanism; `candidateKey()` mirrors that exact tuple so the
  in-process check can never disagree with the database.
- **Candidate expiry takes the stricter of two owner settings.**
  `candidate_expiry_minutes` (entry protection) and `signal_expiry_minutes`
  (the approval window) both apply, and `expires_at` is the minimum of the
  two, so enabling one can never silently extend the other.
- **The scanner fails closed without live exchange rules.** If neither the
  live Bybit instrument fetch nor the stored row is available, the
  candidate is rejected with `INVALID_EXCHANGE_METADATA`. There is no
  hardcoded minimum order, quantity step, tick size, or maximum quantity
  anywhere in the sizing path.
- **A CANDIDATE score is a strategy opinion, not an eligibility decision.**
  The scanner re-derives the trade from a fresh ticker (not the closed
  signal candle) and gives the deterministic risk/candidate layer final
  authority. Telegram now announces only candidates that survived it.
- **Strategy v1 was left `DRAFT`.** It makes every production candidate a
  typed `STRATEGY_NOT_APPROVED` rejection today. Flipping it to
  PAPER_APPROVED would have made candidates flow, but approving an
  unvalidated strategy to make a demo work is exactly the kind of threshold
  manipulation the spec forbids; it stays an owner decision that should
  follow backtest validation.
- **Validation is duplicated on purpose.** Every owner risk bound exists as
  a Zod rule in `lib/settings/risk-settings.ts` AND as a database CHECK
  constraint, and the settings API uses the RLS-respecting client so the
  database refuses a guest write independently of the route's own
  `isOwner` check. Presets are validated by that same schema — they
  populate fields, they never bypass a bound.
- **Two more LIVE layers were added, none removed.** `system_settings` now
  has `trading_mode <> 'LIVE'` and "AUTO execution policy only with
  PAPER/DEMO" CHECK constraints, and `riskSettingsFromRow` coerces an
  unexpected LIVE mode back to OBSERVE rather than trusting the row.
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
- **Idempotency is a database guarantee, never application logic.** Every
  Milestone 2 state transition is a single-statement compare-and-set with
  the expected current state in the WHERE clause (`PENDING -> OPENING`,
  `OPEN -> CLOSED`), plus a partial unique index on `trades (signal_id)`.
  Nothing in the approval or settlement path is implemented as
  read-then-write, because a read-then-write cannot survive two concurrent
  serverless invocations. The in-memory test doubles model the same
  synchronous compare-and-set, so the concurrency tests are meaningful
  rather than decorative.
- **`OPENING` and `ERROR` extend the existing candidate state machine
  rather than adding a second one.** `OPENING` is the atomic claim state -
  it is what makes a double-tap, a webhook retry and a cron overlap safe.
  A claim that dies mid-flight is reconciled against the authoritative
  execution state (trade exists -> APPROVED, no trade -> ERROR) and is
  NEVER returned to PENDING, which could otherwise open a second position.
- **Slippage lives in the fill prices only; fees are charged once per leg.**
  `computeSettlement` documents this as a hard rule and a test asserts the
  double-counted alternative is different, so a future change that also
  subtracts slippage from P/L fails loudly.
- **Realized R uses the modeled max loss recorded at open**, not the raw
  price risk, so a clean stop-out reads about -1.0R *after* costs instead
  of flattering the result.
- **Approval revalidates against fresh data but never recomputes the trade
  plan.** The stored planned entry, stop and target are fixed; entry drift
  is measured against the plan the owner was actually shown. Volatility, by
  contrast, IS recomputed from current ATR - otherwise the "volatility
  became excessive" gate could never fire. A genuinely new setup must
  become a new candidate; the bot does not chase.
- **Position management is driven by the job's cadence, not by the strategy
  candle watermark.** Phase 1 of the scan job manages open positions on
  every run; phase 2 evaluates new closed candles. A `NOOP` still means "no
  new strategy work", never "nothing was monitored".
- **The Telegram webhook returns 200 even on internal failure.** A non-2xx
  makes Telegram retry the same callback indefinitely. The handler answers
  the callback with a safe message, logs without leaking the error, and
  relies on the atomic claim so that nothing was executed.
- **Telegram messages are sent as plain text.** Values like
  `EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50` contain underscores that
  Telegram's Markdown parser would mangle or reject, so formatting is
  opt-in rather than the default.
- **News is omitted from the Telegram message, not stubbed.** The field
  exists structurally on `TradeCandidate`; showing a placeholder analysis
  would be indistinguishable from a real one to the owner making a
  financial decision.
- **`lib/trading/monitor.ts` was deleted rather than left in place.** It
  never deducted the entry fee from P/L, hardcoded fee/slippage instead of
  reading owner settings, and closed positions with a non-atomic
  read-then-write. `position-manager.ts` supersedes it completely; leaving
  buggy dead code invites its reuse.
