# Production audit

Last updated: 2026-09-13

| Subsystem | Status | Evidence |
| --- | --- | --- |
| Git workflow | VERIFIED | Historical Claude branch preserved; `dev`, `staging`, and `main` contain the repaired release. GitHub/Vercel production use `main`. |
| Next.js | VERIFIED | Next.js 16.3.5 installed docs followed; `proxy.ts` convention; typecheck/build pass. |
| Authentication | VERIFIED | Owner login works in production; `/signup` is absent; a database trigger also rejects public Auth signups. |
| Guest access | VERIFIED | Production owner UI creates, resets, lists, and deletes guests; guest login is read-only and settings routes are blocked. |
| Supabase schema/RLS | VERIFIED | Live migrations applied; every public table has RLS; owner/guest/scanner roles were exercised against production. |
| Supabase advisors | PARTIAL | No table/RLS security errors; leaked-password protection warning remains. |
| Bybit public data | VERIFIED | Current BTCUSDT spot kline, ticker, and instrument rules returned successfully. |
| Closed candles | FIXED | Strategy discards open candles and scores the latest closed 15m candle. |
| Scanner idempotency | FIXED | Persisted candle watermark yields `NOOP` until a new closed 15m candle exists. |
| Strategy V1 | VERIFIED | Configuration and 1H/15m behavior covered by passing tests. |
| Indicators | VERIFIED | EMA, RSI, ATR, volume, and swings covered by passing numerical tests. |
| Risk engine | VERIFIED | LIVE blocked; $10 minimum-order conflict test passes without risk inflation. |
| Backtester | VERIFIED | Next-candle fill and conservative ambiguous-candle outcome covered by tests. |
| Paper trading | PARTIAL | Deterministic entry/exit, fees, slippage, risk, and persistence paths pass tests; no live qualifying candidate existed for a production round trip. |
| Qwen | VERIFIED | Production resolves the server-only Vercel fallback and the connection test completes without affecting scanner execution. |
| Telegram | PARTIAL | Production configuration resolves and owner restriction is implemented; no new outbound test message was sent during this audit. |
| Dashboard-managed secrets | PARTIAL | Vault-first architecture is present, but the deployed `SUPABASE_SECRET_KEY` is stale, so saving a new connection or privileged webhook/paper writes still needs key repair. |
| Supabase Cron | PARTIAL | Authenticated Edge path recorded `SUCCEEDED` then `NOOP`, but the production schedule stopped advancing after 16:20 UTC and needs scheduler access restored. |
| Vercel | VERIFIED | Production responds at the canonical URL, deploys `main`, and authenticated/unauthenticated route behavior was checked in-browser. |
| Staging readiness | VERIFIED | The same repaired commit is present on `dev`, `staging`, and `main`; local release gate passes. |
