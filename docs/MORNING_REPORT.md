# Morning Report — Autonomous Build Session (extended)

Two work sessions are covered here: the initial build (Phases 1–16) and an
extended overnight session that fixed real bugs found while wiring up your
live credentials, deployed to Vercel, and hardened the app to need as
little privileged configuration as possible. Everything below is current
as of the last commit on `claude/keen-darwin-bmjeav`.

## TL;DR — what to do this morning
1. Open **https://davinki-trading-bot.vercel.app/signup**, create your
   owner account (you'll need to click a confirmation link Supabase emails
   you — check spam if it doesn't arrive in a minute or two).
2. In **Vercel → davinki-trading-bot → Settings → Environment Variables**,
   add the variables listed in the table below, then **trigger a redeploy**
   (adding `NEXT_PUBLIC_*` vars requires a rebuild to take effect in the
   browser — a plain env-var save alone won't do it).
3. Once `SUPABASE_SECRET_KEY` is set, the cron scanner and Settings page
   become fully functional. Set up Supabase Cron (step-by-step below) to
   call it automatically.
4. Watch the **System** page after the first scan run — see "Critical
   finding" below about a Bybit geo-block risk that needs one-time
   verification.

## Environment variables to set on Vercel

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xvklitfcesprzbnfslks.supabase.co` | Public, safe to set anywhere |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_AeiV7QmmHeuaHzp5sKmCtA_GryzQtjW` | Public, safe to set anywhere |
| `SUPABASE_SECRET_KEY` | *(from Supabase Dashboard → Project Settings → API → service_role key)* | **The only credential I genuinely could not retrieve myself** — connected tooling deliberately can't read privileged keys |
| `QWEN_API_KEY` | *(the value you gave via the Claude Code cloud environment)* | Verified live and working this session |
| `QWEN_BASE_URL` | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | Your custom gateway, not standard DashScope |
| `QWEN_MODEL` | `qwen3.8-flash` | Cheapest working model on your gateway (found via its `/models` endpoint) |
| `TELEGRAM_BOT_TOKEN` | *(the value you gave)* | Verified live — a real message was sent to your chat |
| `TELEGRAM_OWNER_USER_ID` | *(the value you gave)* | |
| `TELEGRAM_CHAT_ID` | *(the value you gave)* | |
| `CRON_SECRET` | *(generated this session — see chat, not printed here since this repo is public)* | Protects `/api/jobs/scan` from unauthenticated calls |
| `TELEGRAM_WEBHOOK_SECRET` | *(generated this session — see chat, not printed here since this repo is public)* | Protects the Telegram webhook from spoofed requests |
| `BYBIT_DEMO_API_KEY` / `BYBIT_DEMO_API_SECRET` | *(leave unset)* | Not implemented yet — app works fine without them |

None of these values are committed to git. This repository is **public**,
so the two secrets I generated (`CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`)
are given to you in chat only, never written into a file that gets pushed.

## Deployment
- **Live**: https://davinki-trading-bot.vercel.app (also
  `davinki-trading-bot-leonardo-ranoesendjojos-projects.vercel.app`)
- Vercel project `davinki-trading-bot` is linked to
  `LeoRanoe/DavinkiTradingBot` and auto-deploys every push to
  `claude/keen-darwin-bmjeav` (its production branch).
- I verified `/login` and `/signup` both render correctly (HTTP 200) on
  the live URL right now, even with zero env vars set — they're static
  pages. Actually submitting the forms will fail until the two
  `NEXT_PUBLIC_*` vars are set **and a rebuild happens**, per the note
  above.
- Every dashboard page beyond login/signup needs those two public vars at
  minimum; anything that writes data (cron scan, credential settings)
  needs `SUPABASE_SECRET_KEY` too.

## Critical finding: Bybit geo-blocks some regions — verify after first scan
While testing, every request to `api.bybit.com` **and** its `bytick.com`
mirror from this sandbox returned:
```
HTTP 403 — "The Amazon CloudFront distribution is configured to block access from your country"
```
This is a country-level block Bybit applies at the CDN layer, and it's
very likely this sandbox's egress IP is in the same blocked set as
Vercel's default function region (`iad1`, US East) — Bybit is well known
to not serve US traffic for regulatory reasons. If unaddressed, this would
have silently broken the entire market scanner in production.

**What I did about it:**
- Added `vercel.json` pinning the whole project (and `/api/jobs/scan`
  specifically) to the **Singapore region (`sin1`)**, which Bybit
  generally serves. Confirmed via the Vercel API that the deployment
  actually picked up `"regions": ["sin1"]`.
- Improved the Bybit client's error handling so a 403 now surfaces the
  exact CloudFront message and a remediation hint directly in
  `job_runs.error_summary` (visible on the System page), instead of a
  generic "HTTP error 403" that would look like an auth bug.

**What I could NOT do:** actually verify this fix works, because I'm
blocked by the same restriction and there are no valid Vercel credentials
yet to trigger a real scan from Singapore. **Please check the System page
after the first cron run** (or trigger `/api/jobs/scan` manually with
`CRON_SECRET` once it's set). If `job_runs` still shows a 403, go to
**Vercel → Project Settings → Functions → Function Region** and change it
explicitly to Singapore, Tokyo, or Frankfurt.

## Bugs found and fixed this session (all verified, all still 49/49 tests passing)
1. **Blank env vars crashed validation.** `QWEN_BASE_URL=` (empty, the
   normal state for an unconfigured optional integration) was rejected by
   Zod's `.url()` instead of being treated as absent — could crash env
   parsing entirely. Fixed with a preprocessing step.
2. **Telegram/Qwen env fallback was wrongly coupled to Supabase.** Both
   integrations' "use the environment variable" fallback path went through
   the same `getEnv()` that requires Supabase to be configured — so
   Telegram genuinely could not work at all until `SUPABASE_SECRET_KEY`
   existed, even though Telegram has nothing to do with Supabase. Split
   into a Supabase-independent `getOptionalEnv()`.
3. **Every authenticated page needed the privileged secret key for reads
   that RLS already allows.** The app shell read `system_settings` and
   `job_runs` via the admin client instead of the ordinary signed-in-user
   client, meaning the *entire dashboard* would 500 until
   `SUPABASE_SECRET_KEY` was set — even though those tables have
   `authenticated_read` policies. Fixed; verified locally that with the
   secret key unset, the dashboard correctly redirects unauthenticated
   users to `/login` (not a crash), and the one genuinely privileged route
   fails with a clear, specific error instead of a generic 500.
4. **No way to create the first user account.** Zero rows existed in
   `auth.users` and there was only a sign-in page, no sign-up page. Added
   `/signup` (linked from `/login`). Since this is meant to be a
   single-user app, **please disable "Allow new users to sign up" in
   Supabase → Authentication → Providers → Email once you've created your
   account.**
5. **No way to ever leave OBSERVE mode.** There was no UI control to
   switch `trading_mode` at all — the platform would have been
   permanently stuck recording signals and never paper trading, regardless
   of how everything else was configured. Added a Trading Mode switcher on
   the Settings page (OBSERVE/PAPER/DEMO only — LIVE is not a constructible
   value in that form, on top of the existing DB and risk-engine
   safeguards).
6. **One remaining lint error**, in the shadcn-generated `use-mobile` hook
   (`setState` called synchronously inside an effect). Fixed by lazily
   initializing state instead. Codebase now lints with zero errors.

## Verified live this session
- **Telegram**: `sendTelegramMessage()` — a real message was delivered to
  your chat using your bot token.
- **Qwen**: your API key is valid; it just needed your actual gateway
  (`token-plan.ap-southeast-1.maas.aliyuncs.com`) instead of the default
  DashScope endpoint I'd assumed. I queried that gateway's `/models`
  endpoint to find real available models (`qwen3.7-max`, `qwen3.8-flash`,
  `deepseek-v4-pro`, etc. — no embedding models are offered, see Knowledge
  Base below) and ran a full `explainSignal()` call end-to-end: correct
  math, properly tagged FACT/INTERPRETATION/EDUCATIONAL_NOTE/RISK notes,
  no fabricated numbers.
- **Vercel deployment**: live, auto-deploying, region-pinned as described
  above.
- **Local runtime behavior** without `SUPABASE_SECRET_KEY`: unauthenticated
  routes redirect cleanly, the admin-only route fails with a precise error
  — confirmed by actually starting the production build and curling it.

## Trading Mode
Default: **OBSERVE**. **LIVE is disabled at three independent layers**
(DB CHECK constraints on `system_settings`/`trades`/`orders`, the risk
engine's unconditional refusal, and now the UI form that cannot even
construct the value) — unchanged and re-verified this session.

## Supabase
- Project `davinki-trading-bot` (`xvklitfcesprzbnfslks`), free tier, 6
  migrations applied (added a Vault helper migration and an audit-log
  insert policy this session).
- RLS: security advisor reports **zero findings** after every migration
  this session, including the new audit_events insert policy.
- Zero user accounts exist yet — see step 1 above.

## Market Scanner
Code is complete and unit-tested (idempotent persistence, closed-candle
gating, position monitoring), but **has never actually run against real
Bybit data** — blocked by the geo-restriction described above from this
sandbox, and not yet triggerable on Vercel without `CRON_SECRET` set.
I could not run a real historical backtest for the same reason (every
attempt to fetch Bybit history 403'd). This is the most important thing
left to verify once you're through the checklist above.

## Strategy
Strategy V1 (`v1`, `DRAFT`) is seeded in the database. See
`docs/STRATEGY_V1.md` for its full, honestly-caveated rules.

## Backtesting
Engine is built and unit-tested (6 tests: no-look-ahead, conservative
same-candle resolution, fee/slippage impact, minimum-order-conflict
skip). **No real backtest has been run** — same Bybit access blocker.
Once the scanner is confirmed reachable from Singapore, running one against
real history is the natural next step.

## Risk Engine
Untouched and still 17/17 passing, including the mandatory spec scenario
($10 equity, 1% risk, 3% stop → `MIN_ORDER_RISK_CONFLICT`, never inflated).

## Qwen / Telegram / Paper Trading / Demo
See "Verified live" above for Qwen/Telegram. Paper trading code is
complete and unit-tested but has never executed against a real signal
(none have been generated yet — no scan has run). Demo remains an
interface-only stub, as before — no demo credentials supplied.

## Tests
**49/49 passing**, 4 suites. `typecheck`, `lint` (zero errors, two
harmless informational warnings), and `build` all clean.

## UI
All 11 pages plus login/signup live and confirmed rendering on the
production URL. Full responsive/dark-light visual QA with screenshots
still not done — recommend a pass once you're logged in and can see real
data.

## Known Problems (in priority order)
1. `SUPABASE_SECRET_KEY` still needs to be set by you — nothing else
   works until then.
2. Bybit geo-block mitigation (Singapore region) is unverified — check the
   System page after your first scan.
3. No real backtest or real signal has ever been generated — both are
   blocked on #2.
4. Qwen gateway has no embedding models (checked several likely names,
   all 404) — the knowledge-base semantic search feature can't be built
   against this provider as-is. Structured/relational memory (trades,
   signals, performance) is fully independent of this and works fine.
5. Supabase's default email-confirmation requirement means your signup
   needs a confirmation click — check spam if it's not in your inbox.

## Recommended Next Step
Do the 4-step checklist at the top. After that, the single most valuable
thing to check is whether `job_runs` on the System page shows a healthy
scan (not a Bybit 403) — that tells us in one glance whether the region
fix actually worked, which I could not verify myself tonight.
