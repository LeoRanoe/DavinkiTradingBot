# Strategy V1 - PAPER Readiness Report

Prepared at the end of Task A / Milestone 2, for the owner to decide whether
`strategy_versions.v1` should move from `DRAFT` to `PAPER_APPROVED`.

**Recommendation: NOT YET. The evidence required to make this decision
responsibly does not exist in the repository or the database today.**

This is a statement about missing evidence, not a claim that the strategy is
bad. Nothing here was fabricated or estimated.

## Why this gate matters

While `v1` is `DRAFT`, the approval path rejects every candidate with a typed
`STRATEGY_NOT_APPROVED` and no position can open in production. That is the
gate working: an unvalidated strategy must not trade, not even with paper
money that feeds the learning layer later.

## Evidence actually available today

| Evidence | Status |
|---|---|
| Backtest runs stored (`backtests`) | **0** |
| Backtest trades stored (`backtest_trades`) | **0** |
| Daily performance rows (`daily_performance`) | **0** |
| Closed PAPER trades (`trades`) | **0** |
| Candle history in the database | ~11 days (2026-09-02 to 2026-09-13), 1,070 rows across both symbols and both timeframes |
| Development / validation / holdout split | Never run |
| Walk-forward analysis | Never run |

Consequently there is **no** measured sample size, win rate, expectancy,
average R, profit factor, max drawdown, losing streak, MFE/MAE, or
after-cost result for Strategy V1. Any number offered for those today would
be invented.

## What HAS been verified

These are engineering guarantees, not evidence of profitability:

- The backtester refuses look-ahead: entry is never earlier than the candle
  after the signal (`lib/backtest/backtest.test.ts`).
- Ambiguous candles that touch both stop and target resolve as a STOP, never
  a TARGET - the pessimistic assumption.
- Fees and slippage measurably reduce realized P/L rather than being
  cosmetic.
- Below-minimum trades are skipped, never forced to the exchange minimum.
- `computeMetrics` refuses to over-interpret small samples: it sets
  `insufficientSample` below 20 closed trades.
- The strategy's own documentation (`docs/STRATEGY_V1.md`) already states
  that its component weights are "reasonable-but-arbitrary starting points,
  not fitted to data".

## Why the current data cannot settle the question

Even a perfect backtest over the stored history would not be decisive:

- ~11 days of 15m candles is roughly 1,050 bars per symbol, and Strategy V1
  needs ~210 bars of indicator warm-up before it can score anything.
- A CANDIDATE requires a score of 80+, which is deliberately rare. Over that
  window the expected number of qualifying setups is in the single digits -
  below the 20-trade threshold the codebase itself treats as the minimum for
  believable statistics.
- A single 11-day window is one market regime. It cannot distinguish a
  strategy with an edge from one that happened to suit two weeks of price
  action.

## What would make this decision answerable

In the order the spec's controlled-improvement pipeline lays out:

1. Ingest a materially longer BTCUSDT/ETHUSDT 15m + 1H history (a year or
   more, covering at least one clear uptrend, downtrend and range).
2. Run the existing backtester over a **development** split and record the
   run in `backtests` / `backtest_trades`.
3. Require at least 20 closed trades before reading any statistic, and
   report expectancy, profit factor, max drawdown and losing streak **after
   fees and slippage** - net result, not win rate, is the target.
4. Re-run on an untouched **validation** split, then once on a **holdout**
   split that has never informed a parameter.
5. Walk-forward the result to check it is not a single-window artifact.
6. Only then decide `PAPER_APPROVED`, and record the reasoning in
   `docs/DECISIONS.md`.

If step 3 or 4 shows negative expectancy after costs, the correct outcome is
a new strategy version - never loosening the thresholds on this one.

## How to approve, when the evidence supports it

Strategy versions are immutable, so approval is a status change on the
existing row, not a parameter edit:

```sql
update strategy_versions set status = 'PAPER_APPROVED', activated_at = now()
where version_label = 'v1';
```

The moment that lands, the Milestone 2 pipeline is live end to end: the
scanner will produce candidates, Telegram will offer them, and an approved
candidate will open a managed PAPER position. Nothing else needs changing -
which is precisely why the decision should be made on evidence rather than
convenience.
