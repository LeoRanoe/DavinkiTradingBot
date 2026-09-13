# Architecture

## Layers
1. **Market data** (`lib/bybit/`) - Bybit V5 public REST, Zod-validated, no credentials.
2. **Indicators** (`lib/indicators/`) - pure functions over OHLCV arrays.
3. **Strategy** (`lib/strategy/v1/`) - deterministic regime gate + setup score
   + closed-candle-gated signal evaluation. Versioned, immutable parameters.
4. **Risk** (`lib/risk/`) - the only path to a sized, eligible trade. Never
   receives AI output as an input.
5. **Trading** (`lib/trading/`) - paper portfolio simulation now; Bybit Demo
   client behind the same interface later (Phase 15).
6. **Backtest** (`lib/backtest/`) - replays strategy+risk logic candle-by-candle
   with no look-ahead, fees, and slippage.
7. **Persistence** (`lib/supabase/`) - typed clients; `server.ts` (RLS-respecting,
   per-user) for reads, `createAdminClient()` (service role) for privileged
   server-side writes (cron, webhooks).
8. **AI coach** (`lib/qwen/`) - explanations/lessons/reviews only, structured
   output validated by Zod, degrades to "unavailable" without crashing anything.
9. **News intelligence** (`lib/news/`) - provider-agnostic ingestion
   (`NewsProvider` -> normalize -> deduplicate -> deterministic classify ->
   optional AI analysis -> stored event -> candidate context). Strictly
   one-directional: news reads nothing from trading, and trading reads
   nothing from news except a display-only snapshot. `lib/ai/usage.ts`
   accounts for every AI request in tokens.
10. **Notifications** (`lib/telegram/`) - webhook + outbound messages; approvals
   re-run the full risk engine, they are never execution authority by themselves.
11. **UI** (`app/`, `components/`) - Next.js App Router, Server Components by
    default, shadcn/ui + TanStack Table + Recharts + lightweight-charts.

## Data flow (scan cycle)
Supabase Cron -> authenticated Edge proxy -> short-lived scanner JWT ->
`POST /api/jobs/scan` -> for each symbol: fetch 1H+15M candles ->
`evaluateSignal()` -> if CANDIDATE, persist `signals` row
(idempotent on strategy_version_id+symbol+timeframe+candle_time) -> optionally
call Qwen for an explanation -> optionally notify Telegram -> job_runs row
records outcome either way (including NOOP when no new closed candle).

## News data flow (separate job, slower cadence)
Supabase Cron -> `davinki-news-proxy` Edge function -> scanner JWT ->
`POST /api/jobs/news` -> per provider (isolated): fetch RSS/Atom ->
normalize -> deduplicate against recent events -> deterministic
classification (assets, category, base risk) -> AI analysis ONLY for
relevant, materially-capable events -> `news_events`. The scan job later
attaches a read-only snapshot of the most relevant recent events to a
candidate, and that snapshot is immutable thereafter.

## Trading mode state machine
OBSERVE -> PAPER -> DEMO -> (LIVE, permanently unreachable in this build).
Enforced at three independent layers: DB CHECK constraints, the risk engine,
and UI mode badges. See docs/SECURITY.md.
