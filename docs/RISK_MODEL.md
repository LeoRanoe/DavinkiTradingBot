# Risk Model

## Risk is not position size
Risk is the approximate amount the owner intends to lose if the stop is hit.
Position size is *derived* from that risk budget and the stop distance — a
$0.20 risk budget with a 4% stop is roughly a $5 position, not a $0.20 one.

## Account
Initial PAPER equity: $10 (`INITIAL_PAPER_EQUITY`). All risk configuration
is owner-editable under Settings → Risk settings and stored on
`system_settings`; `lib/settings/risk-settings.ts` is the single place it is
read and mapped into the risk engine's inputs.

## Risk modes
- `PERCENT_OF_EQUITY` (default): `risk_budget = equity * max_risk_per_trade_pct`
- `FIXED_AMOUNT`: `risk_budget = min(fixed_risk_amount, equity)`

Risk never escalates on its own. Progress toward a goal (the owner's ~$20 →
$50 experiment) changes nothing about sizing, and no preset is ever selected
automatically.

## Position sizing
```
risk_budget        = (per the risk mode above)
stop_distance_pct  = (entry - stop) / entry
position_notional  = min(risk_budget / stop_distance_pct, available_balance)
qty                = floor(position_notional / entry, exchange_qty_step)
```
Spot has no margin, so notional is capped at usable capital. Capping only
ever *reduces* exposure (and therefore risk) — size is never raised to reach
the intended risk budget.

## Costs
`fee_bps` (charged on both entry and exit) and `slippage_bps` (round trip)
are modeled into `modeled_max_loss` and `estimated_target_profit`, so the
loss figure the owner approves is not optimistic.

## Entry and volatility protection
Every candidate carries `planned_entry`, `minimum_allowed_entry`,
`maximum_allowed_entry`, `created_at`, and `expires_at`. A candidate is
rejected — never adjusted — when the fresh reference price falls outside the
allowed entry zone (`ENTRY_OUTSIDE_ALLOWED_RANGE`, i.e. no chasing), when
market data is older than `max_market_data_age_seconds`
(`STALE_MARKET_DATA`), when it has expired (`CANDIDATE_EXPIRED`), or when
ATR/price exceeds `max_atr_pct` (`EXCESSIVE_VOLATILITY`). A candidate is
always priced from a fresh ticker, never from the closed signal candle.
Qwen has no say in any of this.

## Minimum-order conflict (the invariant that must never break)
If the resulting `qty` is below `minOrderQty` or the resulting notional is
below `minOrderAmt`, the trade is **rejected** with `MIN_ORDER_RISK_CONFLICT`.
The size is never inflated to the minimum and the stop is never shrunk to
make the minimum fit — see `lib/risk/position-sizing.ts` and the mandatory
test in `lib/risk/risk.test.ts` reproducing the spec #42 example exactly
(equity=$10, risk=1%→$0.10 budget, 3% stop→$3.33 compliant size, $5 exchange
minimum → rejected, not bumped to $5).

## Account limits (owner-configurable, spec #43 defaults)
- Max open positions: default 1 (`max_open_positions`).
- Max new trades per UTC day: default 2 (`max_new_trades_per_day`).
- Daily-loss lock: after 2 losing trades in a UTC day, no new trades until
  the next UTC day (`max_losing_trades_per_day`).
- Candidate quality gates: `min_candidate_score` (default 80) and
  `min_risk_reward` (default 1.5). No valid setup means no trade — these are
  never relaxed automatically.
- No leverage, margin, futures, shorts, martingale, averaging down, or
  revenge sizing anywhere in the codebase.

Every bound is enforced twice: as a Zod rule server-side and as a database
CHECK constraint, so a value out of range cannot be persisted even if the
application layer is bypassed.

## Rejection reasons
See `lib/risk/types.ts` `RejectionReason` for the full typed list (spec #44).
Every rejection surfaced to the user carries one of these reasons plus a
human-readable detail string — never a bare "trade failed."

## AI has zero authority here
`RiskEngineInput` (the only input type `evaluateTradeRisk()` accepts) has no
field for an AI confidence score, explanation, or override. Qwen output is
never read by any file under `lib/risk/`.

## Signal expiry
A candidate's `expires_at` is the **stricter** of two owner settings: its own
entry-protection expiry (`candidate_expiry_minutes`, default 10) and the
approval window (`signal_expiry_minutes`, default 30). Raising one can never
silently extend the other. An expired approval reruns the full risk engine
and is rejected with `STALE_SIGNAL` regardless of what the original signal
said — an old candidate price is never executable later.

## Execution policy
`execution_policy` defaults to `APPROVAL_REQUIRED`: a candidate is only ever
a recommendation until the owner approves it, and approval re-runs every
check against fresh market data. `AUTO` is a PAPER/DEMO-only future
capability; a database CHECK constraint makes AUTO impossible in any other
mode, and LIVE remains unreachable at every layer.

## Execution and settlement (Milestone 2)

Approval never executes a stored proposal. After an atomic claim, the full
deterministic pipeline re-runs against a fresh ticker, freshly recomputed
ATR, current settings, current equity and available balance, and current
exchange rules. Any failure rejects with a typed reason and opens nothing.

Cost accounting, stated once so it is never double-counted:

```
entryFill = reference * (1 + slippageBps/10000)   # worse for a long
exitFill  = stopOrTarget * (1 - slippageBps/10000)
grossPnl  = (exitFill - entryFill) * qty          # slippage already inside
netPnl    = grossPnl - entryFee - exitFee         # each fee once
realizedR = netPnl / modeled_max_loss             # costs included
```

Because realized R is measured against the modeled worst case recorded at
open, a clean stop-out reads about -1.0R after costs rather than a
flatteringly smaller number.

Settlement is idempotent: the OPEN -> CLOSED transition is an atomic
compare-and-set and the equity snapshot is written only by the caller that
won it, so a repeated or overlapping scan cannot re-charge fees or
double-count P/L.
