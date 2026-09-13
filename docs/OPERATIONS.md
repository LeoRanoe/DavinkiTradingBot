# Operations

How the running system behaves: what executes on a schedule, how a candidate
moves through its lifecycle, and what happens when something fails.

## Scheduled job (`POST /api/jobs/scan`)

Supabase Cron -> authenticated Edge proxy -> short-lived scanner JWT ->
the scan route, roughly every 5 minutes. The job has two phases, in order:

**Phase 1 - manage what is already open.** Runs on every invocation,
deliberately NOT gated on a new closed 15m candle. It loads open PAPER
positions, fetches current candles per symbol, settles any that hit their
stop or target, updates equity, and notifies Telegram. It then sweeps
candidates that lapsed and reconciles any claim that died mid-flight.

**Phase 2 - evaluate new closed strategy candles.** Unchanged from
Milestone 1: the candles table is the durable watermark, so a run with no
new closed candle does no strategy work and reports `NOOP`.

An open position is therefore monitored on the job's cadence even during a
long stretch with no new setup, and a `NOOP` still means "no new strategy
work", not "nothing happened".

## News ingestion job (`POST /api/jobs/news`)

Deliberately SEPARATE from the market scanner. The strategy path never waits
on a news fetch, news runs on its own slower cadence, and a total news
outage leaves trading completely unaffected.

Flow: fetch each provider (isolated) -> normalize -> deduplicate ->
deterministic classify -> AI analysis only where it earns its cost ->
persist. Repeated runs are idempotent: deduplication collapses anything
already stored, so re-running costs nothing and creates nothing.

Auth mirrors the scan job exactly: the Vault-held scanner credential
exchanged for a short-lived JWT by an Edge proxy, with `CRON_SECRET` as a
manual fallback.

### Activating the schedule (not yet done)

`supabase/functions/davinki-news-proxy/index.ts` is ready but is NOT
deployed or scheduled. Activating it before the application code that serves
`/api/jobs/news` is deployed would simply log a failed job every 15 minutes.
After this branch is deployed:

1. Deploy the Edge function `davinki-news-proxy`.
2. Add the cron entry (15 minutes is ample - news does not arrive on a
   candle boundary):

```sql
select cron.schedule('davinki_news_15m', '*/15 * * * *', $$
 select net.http_post(
  url:='https://<project>.supabase.co/functions/v1/davinki-news-proxy',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'apikey',(select decrypted_secret from vault.decrypted_secrets where name='davinki_cron_invoker_jwt' limit 1),
   'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='davinki_cron_invoker_jwt' limit 1)
  ),
  body:='{}'::jsonb,
  timeout_milliseconds:=60000
 );
$$);
```

3. Confirm on `/system` that "News ingestion" reports a real run.

## News is context, never an engine

The one invariant that matters here: **no file under `lib/risk/`,
`lib/strategy/` or the sizing path imports anything under `lib/news/`.**
News cannot create a trade, change position size, move a stop or target,
bypass a risk rejection, or authorise execution. A candidate is financially
identical whether news risk is LOW, HIGH, or UNKNOWN - there is a test
asserting exactly that.

Three distinct news states, which must not be conflated:

| State | Meaning |
|---|---|
| `LOW` + NO_RELEVANT_EVENTS | We looked and found nothing material |
| `LOW`/`MEDIUM`/`HIGH` + OK | We looked and found something |
| `UNKNOWN` + UNAVAILABLE | We could not look at all |

AI failure of any kind (missing credential, auth, rate limit, timeout,
malformed output) degrades to UNKNOWN or leaves the deterministic
classification standing alone. It never blocks a candidate.

## Candidate lifecycle

One state machine, on `signals.approval_status`. `rejection_reason` and
`owner_decision` qualify it rather than duplicating it.

```
                     (score < CANDIDATE)
   evaluated ────────────────────────────► NOT_APPLICABLE

   evaluated ──► risk engine ──► rejected ─► REJECTED  (rejection_reason set)
                      │
                      └────────► valid ───► PENDING
                                              │
             owner REJECT (atomic) ───────────┼──► REJECTED  (owner_decision = REJECTED,
                                              │               rejection_reason null)
             expiry sweep / approval ─────────┼──► EXPIRED
                                              │
             owner APPROVE (atomic CAS) ──────┴──► OPENING
                                                     │
                    revalidation failed ─────────────┼──► REJECTED / EXPIRED
                    trade recorded ──────────────────┼──► APPROVED
                    claim died mid-flight ───────────┴──► ERROR (no trade) or APPROVED (trade exists)
```

`REJECTED_BY_OWNER` is `approval_status = REJECTED` **and**
`owner_decision = REJECTED`. An engine rejection leaves `owner_decision`
null and sets a typed `rejection_reason`. There is no second status column.

## Position lifecycle

On `trades.status`: `OPEN -> CLOSED` (with `exit_reason` of `STOP`,
`TARGET` or `MANUAL`), plus `CANCELLED` / `REJECTED` for trades that never
ran. Settlement writes P/L, realized R, the fee split, realized slippage,
`equity_after`, and one `portfolio_snapshots` row.

## Idempotency - what actually guarantees it

Application logic is never the guarantee. Three database facts are:

1. **The atomic claim.** `UPDATE signals SET approval_status='OPENING'
   WHERE id = ? AND approval_status = 'PENDING'` — a single statement, so
   Postgres row locking admits exactly one caller. Verified live: first
   update affects 1 row, the concurrent second affects 0.
2. **One position per candidate.** A partial unique index on
   `trades (signal_id)`. A duplicate insert raises `23505` and the caller
   reports `ALREADY_PROCESSED` rather than unwinding a real position.
3. **One settlement per position.** `UPDATE trades SET status='CLOSED'
   WHERE id = ? AND status = 'OPEN'`. The equity snapshot is written only
   by the caller that won that transition, so fees and P/L cannot be
   counted twice.

Together these cover a Telegram double-tap, a duplicate webhook delivery, a
Telegram or Vercel retry, overlapping cron runs, two concurrent serverless
invocations, and a dashboard click racing a Telegram tap.

## Approval is revalidation, not execution

Pressing APPROVE asks the engine to re-evaluate; it never opens the stored
proposal. After the atomic claim, the flow re-checks expiry, trading mode,
strategy approval, exchange metadata, a **fresh ticker and fresh candles**,
market-data freshness, the allowed entry zone, volatility recomputed from
current ATR, stop/target validity, minimum R/R, current equity and available
balance, current risk settings, quantity/tick rounding, minimum-order
conflict, modeled fees and slippage, the open-position limit, the daily
trade limit and the daily loss lock.

The stored trade plan (planned entry, stop, target) is **not** recomputed. A
genuinely new setup must become a new candidate; the bot does not chase.

## Failure behavior - fail closed

No position opens when anything is uncertain: market data unavailable or
stale, exchange metadata missing, account state unreadable, risk calculation
failing, or the atomic transition lost. Each case persists a typed reason
and tells the owner concisely.

Notifications are strictly secondary. Execution state is authoritative: a
Telegram failure after a position has been opened never re-opens or unwinds
it. The webhook answers Telegram with 200 even on an internal error,
because a non-2xx makes Telegram retry the same callback.

Position management refuses to settle on stale candles rather than inventing
a fill; the position stays open and the run reports the reason.

## LIVE

Refused at five independent layers: the `system_settings` CHECK constraints
(`trading_mode <> 'LIVE'`, and AUTO only with PAPER/DEMO), the
`trades`/`orders`/`signals` CHECK constraints, the risk engine's
unconditional refusal, the approval flow's mode check, and the UI, which
cannot represent it. `riskSettingsFromRow` additionally coerces an
unexpected LIVE value back to OBSERVE rather than trusting the row.

## Known operational dependency

The Telegram callback path still uses the Supabase service-role key
(`createAdminClient`), because an inbound webhook has no user session to
carry RLS. Its DB surface is now a small set of specific operations, and a
missing or rotated key surfaces as a clear "server configuration error"
acknowledgement with nothing executed, rather than a 500 that Telegram would
retry. Replacing that key with a narrowly-scoped capability remains open -
see `docs/BUILD_STATE.md`.
