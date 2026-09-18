# JeanFX Gold (XAU/USD) PAPER Activation

Status: **PAPER research only. LIVE is disabled and structurally unreachable.**
JeanFX is a gold-first strategy; this activation does **not** make JeanFX the
primary crypto strategy, and does not touch the V1 crypto PAPER pipeline.

## What changed

Nothing in `lib/strategy/jeanfx-v1/` (the immutable, versioned strategy core)
was modified. JeanFX Gold is entirely new, additive wiring around the
existing generic architecture:

- `lib/strategy-platform/gold/instrument.ts` — canonical `Instrument` for
  XAU/USD (`METAL:TWELVEDATA:XAU/USD`).
- `lib/strategy-platform/gold/market-data-provider.ts` — a `MarketDataProvider`
  (Twelve Data REST API) supplying M5/M15/M30/H1 closed candles + a bid/ask
  quote. No TradingView scraping.
- `lib/strategy-platform/gold/config.ts` — two `JeanfxUserConfig` profiles
  (ACTIVE: M30 bias; SELECTIVE: H1 bias), both using the strategy's existing
  `LONDON_AND_NEW_YORK` session filter — no new session logic was written;
  `lib/strategy/jeanfx-v1/primitives/sessions.ts`'s existing
  `Intl.DateTimeFormat`-based, IANA-timezone DST handling is reused as-is.
- `lib/strategy-platform/gold/sizing.ts` — a direction-aware (LONG **and**
  SHORT) position-sizing model, separate from `lib/risk/position-sizing.ts`
  (which is long-only by design, backing the real Bybit Spot pipeline and
  is never modified here).
- `lib/strategy-platform/gold/paper-executor.ts` — direction-aware PAPER
  fill/exit simulation with spread, slippage, and fee costs.
- `lib/strategy-platform/gold/scan.ts` — the Gold-specific policy wrapper:
  session gate, `maxTradesPerSession` cap, calls `runJeanfxDirection`
  (unmodified) for both directions, sizes any `READY` setup, and reports
  frequency-diagnostics counts either way.
- `lib/strategy-platform/gold/diagnostics.ts` — funnel-count aggregation
  from the state machine's own transition reason codes.
- `lib/strategy-platform/gold/performance.ts` — reuses
  `lib/backtest/metrics.ts`'s `computeMetrics` unchanged.
- `supabase/migrations/20260920000000_jeanfx_gold_paper.sql` — two new,
  additive tables: `jeanfx_gold_paper_trades` (full attribution: definition
  → version → configuration → assignment) and
  `jeanfx_gold_session_diagnostics` (frequency diagnostics).
- `app/(app)/strategies/jeanfx-gold/page.tsx` — a dedicated performance +
  diagnostics view, isolated from V1/TRB/custom strategies.

## Sizing model assumptions (IMPLEMENTATION ASSUMPTION — no real broker

contract metadata was available at implementation time)

- **Unit**: 1 unit of `qty` = 1 troy ounce. `contractUnitValue = 1` means a
  $1.00 move in XAU/USD is worth $1.00 × qty — no lot (e.g. 100oz/lot) or
  leverage multiplier is assumed. This is explicit and swappable the moment
  real broker contract metadata exists (`GOLD_CONTRACT_SPEC` in `sizing.ts`).
- **Price precision**: 2 decimal places (`0.01`), matching typical spot gold
  quoting.
- **Spread**: a documented default of `$0.30` (`GOLD_DEFAULT_SPREAD_MODEL`)
  is used when a live quote's bid/ask isn't available; a real quote's
  bid/ask always overrides it when the caller supplies one.
- **Account currency**: USD only.
- **No leverage assumptions are hidden inside sizing** — `riskAmount /
  stopDistance` is the entire sizing formula; nothing scales it beyond that.

## Risk discipline (sourced directly from the activation brief, not assumed)

- `riskPct` = 1% maximum per trade.
- Minimum R:R = 3.0 (also already enforced one layer up, inside
  `runJeanfxDirection`'s own target selection — `sizing.ts`'s check is
  defense in depth, matching this repo's existing "two independent layers"
  pattern).
- Max 3 new trades per session (LONDON or NEW_YORK), enforced in
  `scan.ts` before the state machine is even evaluated.

## Instrument identity

The canonical id `METAL:TWELVEDATA:XAU/USD` encodes which market-data feed's
candle/session semantics apply — it is not a broker order-routing symbol,
and no broker-specific symbol appears anywhere inside
`lib/strategy/jeanfx-v1/`.

## LIVE is structurally unreachable here

`jeanfx_gold_paper_trades` has no `mode`/`trading_mode` column at all — there
is no value any client could ever write that would mean "this was a real
order". `GoldScanResult`/`GoldPaperTradeIntent` (in `scan.ts`) carry no mode
field either. This is in addition to, not a replacement for, the three
existing LIVE-disable layers documented in `CLAUDE.md`.

## Not yet done (explicitly out of scope for this pass)

- No `GOLD_DATA_API_KEY` is configured in any environment — the market-data
  provider is fully implemented and unit-tested against a mocked HTTP
  client, but has not made a live network call.
- No `strategy_configurations`/`strategy_assignments` rows for JeanFX Gold
  exist in production yet — creating them is a separate, explicit step once
  a data feed is actually configured (an assignment with no working feed
  would just sit idle).
- No scheduled job (cron route) invokes `runGoldScan` against live data yet.
- The new migration has **not** been applied to production in this pass.
