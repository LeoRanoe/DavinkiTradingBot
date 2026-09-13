# CLAUDE.md — Engineering Rules for This Project

This is the Autonomous AI Trading Coach: a deterministic crypto trading
research/paper-trading platform with an AI (Qwen) coaching layer. Read
`docs/BUILD_STATE.md` and `TASKS.md` before continuing work in a new session.

## Non-negotiable invariants

1. **LIVE trading is permanently disabled in this build.** `trading_mode` enum includes
   LIVE architecturally, but `system_settings.live_trading_enabled` has a DB
   CHECK constraint forcing it to `false`, and `trades`/`orders` have CHECK
   constraints forbidding `trading_mode = 'LIVE'`. The risk engine
   (`lib/risk/engine.ts`) also refuses LIVE unconditionally as defense in
   depth. Never remove any of these three layers.
2. **Qwen/AI never decides trades.** All market data, indicators, scoring,
   risk, and order eligibility are deterministic TypeScript in `lib/`. Qwen
   only explains, reviews, and teaches (see `lib/qwen/`). `RiskEngineInput`
   has no field an AI output could plug into.
3. **Closed-candle invariant.** A signal is only ever evaluated off a fully
   closed 15-minute candle. See `lib/strategy/v1/signal.ts`.
4. **Never inflate a trade to meet exchange minimums, never shrink a stop to
   fit.** Below-minimum risk-compliant sizes are rejected
   (`MIN_ORDER_RISK_CONFLICT`), not adjusted. See `lib/risk/position-sizing.ts`
   and the mandatory test in `lib/risk/risk.test.ts`.
5. **Strategy versions are immutable.** A parameter change ships as a new
   `strategy_versions` row, never an update to an existing one.
6. **Never commit secrets.** `.env.local` is gitignored. Supabase Vault holds
   dashboard-managed integration credentials; env vars are the fallback.
   Read `lib/config/` for the credential-resolution order.

## Architecture map

- `lib/bybit/` — public Bybit V5 market data client (Zod-validated, fails closed).
- `lib/indicators/` — pure EMA/RSI/ATR/volume/swing functions + tests.
- `lib/strategy/v1/` — Strategy V1: regime gate, setup score, signal evaluation.
- `lib/risk/` — position sizing, account limits, the single risk engine entrypoint.
- `lib/backtest/` — no-look-ahead backtester sharing strategy/risk logic.
- `lib/trading/` — paper/demo execution, portfolio simulation.
- `lib/qwen/`, `lib/telegram/` — optional integrations behind interfaces; app
  must boot and trade (paper/demo) fine with either absent.
- `lib/supabase/` — typed clients (`server.ts` respects RLS, `createAdminClient`
  bypasses it — server-only, never import from client components).
- `app/` — Next.js App Router; `app/api/jobs/scan` is the cron entrypoint.

## Working conventions

- Run `npm run typecheck && npm run lint && npm test` before considering any
  phase done. `npm run build` before deploying.
- Keep core financial logic framework-independent (pure functions in `lib/`)
  so it can be unit tested directly - see `lib/risk/risk.test.ts`.
- Update `docs/BUILD_STATE.md` and `TASKS.md` after each meaningful phase,
  not after every file.
