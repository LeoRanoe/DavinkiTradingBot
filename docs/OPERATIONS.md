# Operations

## Research jobs

Run historical candle acquisition as a bounded, explicit research backfill using `lib/learning/bybit-backfill.ts`; save the returned cursor in `research_backfill_jobs` before another batch. It is deliberately separate from `/api/jobs/scan`, does not reset candle data, and must not modify scan state.

Counterfactual settlement consumes only queued hypothetical rows and historical closed candles. Its failure is recorded as research failure and does not affect actual trades or portfolio equity.

## Deployment

Apply migration `00000000000007_learning_layer.sql` before deploying the Milestone 4 application code. The local test/build gate validates application code; production migration application remains an operator/deployment action.
