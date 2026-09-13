# Risk Model

## Account
Initial PAPER equity: $10. Max risk per trade: 1% (`system_settings.max_risk_per_trade_pct`).

## Position sizing
```
risk_budget = equity * max_risk_per_trade_pct
stop_distance_pct = (entry - stop) / entry
position_notional = risk_budget / stop_distance_pct
qty = floor(position_notional / entry, exchange_qty_step)
```
If the resulting `qty` is below `minOrderQty` or the resulting notional is
below `minOrderAmt`, the trade is **rejected** with `MIN_ORDER_RISK_CONFLICT`.
The size is never inflated to the minimum and the stop is never shrunk to
make the minimum fit — see `lib/risk/position-sizing.ts` and the mandatory
test in `lib/risk/risk.test.ts` reproducing the spec #42 example exactly
(equity=$10, risk=1%→$0.10 budget, 3% stop→$3.33 compliant size, $5 exchange
minimum → rejected, not bumped to $5).

## Static limits (spec #43)
- Max 1 open position at a time.
- Max 2 new trades per UTC day.
- After 2 losing trades in a UTC day, no new trades until the next UTC day.
- No leverage, margin, futures, shorts, martingale, averaging down, or
  revenge sizing anywhere in the codebase.

## Rejection reasons
See `lib/risk/types.ts` `RejectionReason` for the full typed list (spec #44).
Every rejection surfaced to the user carries one of these reasons plus a
human-readable detail string — never a bare "trade failed."

## AI has zero authority here
`RiskEngineInput` (the only input type `evaluateTradeRisk()` accepts) has no
field for an AI confidence score, explanation, or override. Qwen output is
never read by any file under `lib/risk/`.

## Research does not relax risk
Risk-blocked candidates may be observed counterfactually as explicitly hypothetical research. A hypothetical winner never authorizes increasing size, changing a stop, or violating `MIN_ORDER_RISK_CONFLICT`.

## Signal expiry
Telegram/dashboard approvals expire after `system_settings.signal_expiry_minutes`
(default 30). An expired approval reruns the full risk engine and is rejected
with `STALE_SIGNAL` regardless of what the original signal said.
