# BUILD_STATE

Last updated: 2026-09-13 (autonomous build session 1)

## Environment
- Repo: `LeoRanoe/DavinkiTradingBot`, branch `claude/keen-darwin-bmjeav`.
- Supabase project: `davinki-trading-bot` (`xvklitfcesprzbnfslks`), region us-east-1,
  free tier ($0/mo, confirmed with user's org before creation).
- Vercel team available: `leonardo-ranoesendjojos-projects` (not yet deployed to).
- Extensions enabled: uuid-ossp, pgcrypto, vector, supabase_vault, pg_cron, pg_net.

## Completed
- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind 4 + shadcn/ui
  (Base UI primitives, ~40 components installed) + lucide-react + Recharts +
  TanStack Table + lightweight-charts + Zod + React Hook Form.
- Vitest configured (`npm test`), 43 tests passing across 3 suites.
- Full schema applied via 4 migrations in `supabase/migrations/`: core tables
  (profiles, system_settings, strategy_versions/parameters, instrument_metadata,
  candles, signals/signal_components, trades/orders/order_events/trade_events,
  portfolio_snapshots, daily_performance, weekly_reports, backtests/backtest_trades,
  knowledge_documents/knowledge_chunks (pgvector, hnsw index), trade_reviews,
  lessons, job_runs, audit_events, integration_credentials).
- RLS enabled on every table; authenticated-only read policies, no anon access.
  `get_advisors` security scan is clean (0 findings) after locking down the
  `handle_new_user` SECURITY DEFINER function.
- TypeScript types generated to `lib/supabase/database.types.ts`.
- `lib/config/env.ts`: tiered env validation (core throws, optional degrades).
- `lib/bybit/`: public V5 client (candles/instruments/ticker), Zod-validated,
  fails closed on malformed data, 10s timeout, 429 handling.
- `lib/indicators/`: EMA, RSI (Wilder), ATR (Wilder), volume average/relative
  volume, fractal swing high/low detection. 16 tests.
- `lib/strategy/v1/`: versioned config, 1H regime gate (EMA50>EMA200 & close>EMA50),
  15M setup score (trend/pullback/momentum/volume/riskReward/volatility = 100),
  classification thresholds (IGNORE<60, LOG<70, WATCH<80, CANDIDATE>=80),
  closed-candle-invariant signal orchestrator. 10 tests.
- `lib/risk/`: position sizing (risk_budget/stop_distance_pct, floor-to-qty-step,
  never inflates/shrinks to hit minimums), account limits (1 open position,
  2 trades/UTC day, loss lock after 2 losses/day), single risk engine entrypoint
  that blocks LIVE unconditionally. 17 tests INCLUDING the mandatory spec #42
  min-order-risk-conflict scenario (equity=$10, risk=1%, stop=3% -> $3.33 vs $5
  min -> MIN_ORDER_RISK_CONFLICT, not inflated to $5).

## Known blockers (env var names only, never values)
- `SUPABASE_SECRET_KEY` - connected Supabase tooling cannot retrieve privileged
  keys. Must be copied by the project owner from Supabase Dashboard -> Project
  Settings -> API, into Vercel env vars and local `.env.local`.
- `QWEN_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_USER_ID`,
  `TELEGRAM_CHAT_ID`, `BYBIT_DEMO_API_KEY`, `BYBIT_DEMO_API_SECRET` - not
  supplied in this environment. App must boot and paper-trade fine without them.
- `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` - not yet generated; will generate
  securely and set as Vercel env vars once deployment starts.

## Next up (see TASKS.md)
Backtester -> seed Strategy V1 row -> dashboard shell -> cron scanner -> paper
trading -> knowledge base -> Qwen -> Telegram -> deploy.
