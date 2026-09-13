# TASKS

Phase order and status. See `docs/BUILD_STATE.md` for narrative detail.

- [x] Phase 1: Repo foundation (Next.js 16 + TS, Tailwind 4, shadcn/ui, Vitest, docs)
- [x] Phase 2: Supabase schema, RLS, auth trigger, generated types (project `xvklitfcesprzbnfslks`)
- [x] Phase 3: Bybit V5 public market client (candles, instruments, ticker) - Zod validated
- [x] Phase 4: Indicators (EMA/RSI/ATR/volume/swings) - 16 tests passing
- [x] Phase 5: Strategy V1 (regime gate, setup score, signal evaluation) - 10 tests passing
- [x] Phase 6: Risk engine (position sizing, account limits, mandatory min-order test) - 17 tests passing
- [ ] Phase 7-8: Backtester (no-look-ahead, fees/slippage) + validation/holdout + UI
- [ ] Phase 9: Core dashboard UI (shell, markets, signals, candlestick chart, tables)
- [ ] Phase 10: Supabase Cron scanner (`/api/jobs/scan`) + job_runs tracking
- [ ] Phase 11: Knowledge base (pgvector ingestion + retrieval)
- [ ] Phase 12: Qwen integration (explanations, lessons, trade review) behind an interface
- [ ] Phase 13: Telegram integration (webhook, notifications, approve/reject)
- [ ] Phase 14: Paper trading engine ($10 simulated portfolio)
- [ ] Phase 15: Bybit Demo abstraction (mocked - no demo credentials supplied)
- [ ] Phase 16: Monitoring/audit log/order reconciliation
- [ ] Phase 17: Responsive/dark-light UI polish
- [ ] Phase 18: Vercel deployment + end-to-end verification

## Next immediate steps
1. Backtester core (`lib/backtest/`) sharing strategy + risk logic.
2. Seed a Strategy V1 `strategy_versions` row (status DRAFT) so signals/backtests
   have a valid foreign key.
3. App shell + dashboard page skeleton wired to Supabase.
