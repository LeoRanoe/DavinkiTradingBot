# Learning System

## Truth boundaries

**ACTUAL** means an owner-approved PAPER or DEMO trade that executed. Only its settlement may affect `trades`, portfolio snapshots, daily performance, or actual performance analytics.

**COUNTERFACTUAL** means an owner-rejected or deterministic-risk-blocked candidate followed for research. Every row in `counterfactual_outcomes` has `is_hypothetical = true`; it never changes account equity or realized P/L. A hypothetical winner never proves that a minimum-order/risk rejection was wrong.

## Outcome convention

For a long trade, MFE is the greatest closed-candle high minus the actual filled entry; MAE is the actual filled entry minus the lowest closed-candle low. Both are stored as absolute price and R-normalized values, where one R is actual filled entry minus stop. Only closed bars whose interval begins after the fill are included. Excursions are persisted while the trade is open, so bounded market-data fetches cannot discard earlier movement.

Counterfactual entry requires a touch of the explicitly allowed entry range. No touch is `NO_ENTRY`, not a win/loss. If stop and target are both touched in a single unresolved candle, the outcome is conservatively `STOP`, matching the backtester.

## Evidence controls

| Closed outcomes | Evidence label |
| --- | --- |
| 0 | `NO_DATA` |
| 1-4 | `EXTREMELY_LOW_EVIDENCE` |
| 5-19 | `LOW_EVIDENCE` |
| 20+ | `INITIAL_EVIDENCE` |

The UI and deterministic observation generator do not make profitability claims below initial evidence. Twenty trades is a minimum review gate, not proof of an edge.

## Experiments and governance

V1 is immutable and remains `DRAFT`. A hypothesis can propose a new immutable version, never change V1. Research is chronological: development, validation, then untouched holdout. Holdout use is recorded. Walk-forward windows are available for longer histories. Do not optimize for a target balance, win rate, or one historical peak; compare robust out-of-sample performance after fees, slippage, risk sizing, rounding, and exchange constraints.

Qwen receives deterministic post-trade facts only after settlement. Its output is stored as **AI INTERPRETATION/HYPOTHESIS**, validated with Zod, cached per trade, and has no authority to alter risk, strategy parameters, activation, or execution. A failed review is ignored safely.

## Research backfill

`lib/learning/bybit-backfill.ts` pages public Bybit candles in bounded batches, deduplicates by open time, retains closed candles only, and returns a resume cursor. It has no access to the production scanner watermark. Backfill jobs are explicitly research-only; they are not a permanent serverless process.
