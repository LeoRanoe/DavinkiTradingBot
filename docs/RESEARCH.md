# RESEARCH — Key Findings From Official Documentation

## Next.js / React
- Next.js 16 (installed 16.3.5) with App Router, Turbopack dev/build, React 19.
- Route param/layout prop types are now generated into `.next/types` and
  referenced globally (e.g. `LayoutProps<"/">`) - these types only resolve
  after a `next dev`/`next build` has run once; a clean `tsc --noEmit` before
  any build will show a false-positive `Cannot find name 'LayoutProps'`.

## shadcn/ui
- Current CLI (`shadcn@latest`) defaults to **Base UI** as the primitive
  library (preset `base-nova`), not Radix - `-b radix|aria|base` selects it.
  `npx shadcn init -d` uses the recommended default. We used the default (Base UI).
- Tailwind v4 is auto-detected; `components.json` written accordingly.

## Supabase
- `supabase_vault` extension (0.3.1) is available on this project for
  application-managed secret storage (Qwen/Telegram credentials replaceable
  from the dashboard without redeploying). `vault.create_secret` /
  `vault.update_secret` are the standard functions; secrets are only
  decryptable server-side via `vault.decrypted_secrets` view under RLS-safe
  SECURITY DEFINER access - never exposed to PostgREST directly.
- `pg_cron` + `pg_net` are available, enabling Supabase Cron to call our
  `/api/jobs/scan` endpoint on a schedule directly from Postgres via HTTP,
  without depending on Vercel Hobby's cron frequency limits.
- MCP tooling cannot retrieve the project's secret/service-role key (by
  design - it's a privileged credential). This must be copied manually from
  the Supabase dashboard by the project owner.
- `get_advisors` (security) flagged our `handle_new_user()` trigger function
  as callable via PostgREST RPC by anon/authenticated by default for any
  SECURITY DEFINER function in the `public` schema - fixed by `REVOKE EXECUTE`.

## Bybit V5
- Public market data (`/v5/market/kline`, `/v5/market/instruments-info`,
  `/v5/market/tickers`) require no API key. Response envelope is always
  `{ retCode, retMsg, result, time }`; `retCode !== 0` is an application-level
  error even on HTTP 200.
- Kline rows are `[start, open, high, low, close, volume, turnover]`, all
  strings, **newest first** - must reverse for indicator computation.
- Instrument metadata (`lotSizeFilter.minOrderQty`, `minOrderAmt`, `qtyStep`,
  `priceFilter.tickSize`) must be fetched per-symbol and never hard-coded, as
  required by spec #38.

## Qwen / Model Studio
- Not yet integrated (Phase 12) - `QWEN_API_KEY` not supplied in this
  environment. When implemented: use an OpenAI-compatible chat completions
  endpoint at Alibaba Cloud Model Studio's documented base URL
  (`QWEN_BASE_URL` will default to the DashScope-compatible endpoint), with a
  small/cheap model (e.g. a `qwen-turbo`-class model) for routine explanations.
  This must be re-verified against current docs at implementation time since
  QWEN_API_KEY is not present to test against right now.

## Telegram Bot API
- Not yet integrated (Phase 13) - no bot token supplied. Standard approach:
  `setWebhook` with a secret token header (`X-Telegram-Bot-Api-Secret-Token`)
  once a stable Vercel URL exists; verify the header on every inbound webhook
  request before processing callback queries.
