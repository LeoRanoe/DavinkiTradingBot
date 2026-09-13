# Production audit

Last updated: 2026-09-13

| Subsystem | Status | Evidence |
| --- | --- | --- |
| Git workflow | FIXED | Historical Claude branch preserved; repair work moved to `dev`. |
| Next.js | VERIFIED | Next.js 16.3.5 installed docs followed; `proxy.ts` convention; typecheck/build pass. |
| Authentication | FIXED | Public signup removed; owner login verified; owner/guest roles enforced server-side. |
| Guest access | FIXED | Owner-only account create/reset/delete UI and API; passwords shown once. |
| Supabase schema/RLS | VERIFIED | Live migration applied; every public table has RLS; guest mutations denied. |
| Supabase advisors | PARTIAL | No table/RLS security errors; leaked-password protection warning remains. |
| Bybit public data | VERIFIED | Current BTCUSDT spot kline, ticker, and instrument rules returned successfully. |
| Closed candles | FIXED | Strategy discards open candles and scores the latest closed 15m candle. |
| Scanner idempotency | FIXED | Persisted candle watermark yields `NOOP` until a new closed 15m candle exists. |
| Strategy V1 | VERIFIED | Configuration and 1H/15m behavior covered by passing tests. |
| Indicators | VERIFIED | EMA, RSI, ATR, volume, and swings covered by passing numerical tests. |
| Risk engine | VERIFIED | LIVE blocked; $10 minimum-order conflict test passes without risk inflation. |
| Backtester | VERIFIED | Next-candle fill and conservative ambiguous-candle outcome covered by tests. |
| Paper trading | PARTIAL | Core entry/monitor/persistence code present; deployed end-to-end run pending. |
| Qwen | PARTIAL | Server-only fallback architecture present; current preview connectivity pending. |
| Telegram | PARTIAL | Owner-restricted webhook/client present; current preview connectivity pending. |
| Supabase Cron | NOT CONFIGURED | No active `cron.job` was observed in the live database. |
| Vercel | PARTIAL | Existing production responds; connector/CLI session cannot currently enumerate project settings. |
| Staging readiness | PARTIAL | Local quality gate passes; deployed preview verification remains. |
