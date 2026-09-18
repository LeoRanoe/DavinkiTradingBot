# JeanFX v1 — Formal Specification

**Status: RESEARCH_ONLY. Not PAPER_APPROVED. Not LIVE_APPROVED.**

**Implementation status (Prompt 2): the state machine, all primitives, and
the DSL wiring described below are now implemented** -
`lib/strategy/jeanfx-v1/` (primitives + `state-machine.ts`), wired into the
generic contract at `lib/strategy-platform/built-in/jeanfx-v1.ts`. This
document was written as a spec-first checkpoint (Prompt 1) before any of
that code existed; it is now kept as the living source of truth for every
SOURCE RULE / IMPLEMENTATION ASSUMPTION distinction the code implements -
every assumption listed below is locked exactly as written, none were
silently changed during implementation. See
`docs/architecture/strategy-platform.md` for how this fits the wider
multi-strategy platform. It still does not ship a profitability claim or
change V1's promotion status. See `TASKS.md` / `docs/BUILD_STATE.md` for
where this sits in the overall build.

## 0. Source-of-truth caveat (read this first)

No JeanFX PDF/document file was attached to this session — only a written
task brief describing the strategy's sequence, concepts, and rough
parameters (liquidity sweep → MSS/BOS → FVG → retracement → confirmation →
entry → target next liquidity; 0.5–1% risk; minimum 1:3 R:R; break-even
after partial; Asian/London/NY sessions). Every rule below is derived
either directly from that brief (quoted/paraphrased) or is a deterministic
interpretation I am proposing to fill a gap the brief leaves open.

Anything not pinned to an exact number or exact formula in the brief is
marked **[IMPLEMENTATION ASSUMPTION]**. None of these numbers should be
treated as "from JeanFX" — they are conservative starting points I am
proposing for review, per instruction not to silently finalize thresholds.
If an actual JeanFX source document exists, it should be supplied and this
spec re-checked against it before any of these assumptions are locked.

## 1. Scope

- Prompt 1: formal, deterministic specification + pure domain types only.
- Prompt 2: full implementation (primitives, state machine, generic
  contract wiring, DSL primitive sharing) - see the "Files" section below.
  `runGenericBacktest()` (`lib/strategy-platform/backtest.ts`) CAN run
  JeanFX now, through the same engine as any other strategy - but no
  profitability claim is made anywhere in this document or the code; that
  is a promotion-review question (§16), not a backtest-day one.
- No PAPER/LIVE change, in either prompt.
- V1 (`lib/strategy/v1/`) is untouched.
- V2/TRB: not present in this repository as a distinct code path (no
  `lib/strategy/v2` or TRB module was found) - registered as an honest
  placeholder in the built-in registry
  (`lib/strategy-platform/built-in/trb.ts`), nothing more.

## 2. Strategy identity

| Field | Value |
|---|---|
| `strategyId` | `jeanfx-v1` |
| `name` | `JeanFX Liquidity System` |
| `status` | `RESEARCH_ONLY` |
| `promotionEligible` | `false` |

`RESEARCH_ONLY` is a new status value, distinct from V1's existing
`DRAFT` → `PAPER_APPROVED` → `LIVE_APPROVED` progression, so that JeanFX
cannot accidentally inherit a promotion path meant for a different
strategy. Promoting `jeanfx-v1` out of `RESEARCH_ONLY` requires the same
evidence bar as any strategy (see §16) plus an explicit owner decision —
this checkpoint does not request or perform that promotion.

## 3. Multi-timeframe structure

Three explicit timeframes, not collapsed into one:

- **Bias timeframe — H1 or M30**: determines HTF directional bias
  (bullish / bearish / none). Configurable per instrument; default
  **[IMPLEMENTATION ASSUMPTION] H1**, because the brief lists "H1 or M30"
  without picking one, and H1 is the coarser/more conservative of the two.
- **Structure timeframe — M15**: where MSS/BOS is confirmed against
  identified liquidity.
- **Entry timeframe — M5**: where the FVG, retracement, and candle
  confirmation are evaluated for precise entry.

Each timeframe has a single responsibility; the state machine (§8) does
not let a lower timeframe substitute for a higher one's job.

## 4. Directional domain model

`Direction = "LONG" | "SHORT"`. The research engine models both. Per
instruction, **SHORT is not wired to Bybit spot execution** — Bybit spot
cannot go short at all, so this is also a structural fact, not just a
policy choice. The domain types below carry direction as data; nothing
downstream assumes LONG-only the way V1 does.

Execution authorization is a separate layer (existing risk engine /
`system_settings`), untouched by this checkpoint. `jeanfx-v1` proposes no
change to LIVE gating, which remains hard-disabled by the three existing
layers per CLAUDE.md §1.

## 5. Deterministic definitions

All definitions below operate on **closed candles only**, mirroring V1's
closed-candle invariant (CLAUDE.md §3). No definition here ever reads an
unclosed/forming candle.

### 5.1 Swing high / swing low
**[IMPLEMENTATION ASSUMPTION — fractal, fixed lookback]**
A candle at index `i` is a **swing high** if its high is strictly greater
than the high of the `leftBars` candles before it and the `rightBars`
candles after it. Swing low is the mirror on lows.

Proposed: `leftBars = 2`, `rightBars = 2` (5-candle fractal). This matches
common ICT/SMC fractal practice and is intentionally conservative (fewer,
more significant swings than a 1-bar fractal). A swing is only confirmed
once its `rightBars` have closed — it cannot be known in real time until
then, and no logic may treat an unconfirmed swing as valid.

### 5.2 Equal highs / equal lows (liquidity pools)
**[IMPLEMENTATION ASSUMPTION — ATR-relative tolerance]**
Two or more swing highs are **equal highs** if each pair's price
difference is `<= equalTolerance`, where
`equalTolerance = equalHighLowAtrMultiple * ATR(atrPeriod)` computed on
the structure timeframe (M15) at the time of the most recent of the
compared swings.

Proposed: `equalHighLowAtrMultiple = 0.10` (10% of ATR14). ATR-relative
rather than a fixed percentage so the tolerance scales with instrument
volatility (needed for §17's forex/gold generality — 10 pips means
something different on EURUSD than on XAUUSD). Equal lows are the mirror.

### 5.3 Liquidity pool
A **liquidity pool** is one of:
- an equal-highs/equal-lows cluster (§5.2),
- the most recent unswept prior swing high/low on the bias or structure
  timeframe ("previous highs/lows"),
- the high/low of a completed session (§9) ("session highs/lows").

Each pool has a `side` (`BUY_SIDE` above price / `SELL_SIDE` below price),
a `level` (price), and a `swept: boolean` flag.

"Obvious support/resistance" from the brief is **not** implemented as a
separate category — it is treated as redundant with prior-swing and
session liquidity above; a free-floating "obvious S/R" concept has no
deterministic definition in the brief and I am not inventing a subjective
one. This is logged as an unresolved simplification, not silently dropped
(§ Unresolved ambiguities).

### 5.4 Sweep
A **sweep** of a liquidity pool occurs on a closed candle that:
1. trades beyond the pool's `level` (high > level for sell-side, low <
   level for buy-side), **and**
2. closes back through/inside the level (close < level for a sell-side
   sweep, close > level for a buy-side sweep).

This is the brief's own definition ("price trades beyond liquidity level
and closes back through/inside it"), used verbatim — not an assumption.
Once swept, the pool's `swept` flag is set `true` and it is no longer a
valid target (§12) or a re-usable sweep trigger.

### 5.5 MSS / BOS
Both are: **a closed candle's close breaks (trades through and closes
beyond) the price of a required prior confirmed swing structure point.**
This is the brief's own definition, used verbatim.

Distinction drawn (**[IMPLEMENTATION ASSUMPTION]**, since the brief does
not separate them numerically):
- **BOS (Break of Structure)**: a close beyond a swing point *in the
  direction of the current HTF bias* — continuation.
- **MSS (Market Structure Shift)**: a close beyond a swing point *against*
  the most recent confirmed structure direction — the first signal of a
  potential reversal, and the one JeanFX's bullish/bearish sequence (§8)
  actually requires immediately after a sweep.

### 5.6 Fair Value Gap (FVG)
Classic 3-candle imbalance, exactly as stated in the brief:
- **Bullish FVG**: `low[candle3] > high[candle1]`. The gap is
  `[high[candle1], low[candle3]]`.
- **Bearish FVG**: `high[candle3] < low[candle1]`. The gap is
  `[high[candle3], low[candle1]]`.

Evaluated on the entry timeframe (M5), using three consecutive closed
candles, and required to form as part of the displacement leg immediately
following the MSS/BOS (§5.7), not anywhere in history.

### 5.7 Displacement
**[IMPLEMENTATION ASSUMPTION]** The impulsive move that produces the
MSS/BOS and the FVG. Defined as: the candle (or contiguous run of
same-direction candles) whose range is `>= displacementAtrMultiple *
ATR(atrPeriod)` on the entry timeframe, and which contains the FVG-forming
3-candle sequence. Proposed `displacementAtrMultiple = 1.5`. This exists
so a FVG formed by ordinary chop isn't mistaken for a genuine displacement
leg; the brief names displacement but gives no threshold.

### 5.8 Retracement
Price on the entry timeframe (M5) trades back into the FVG range (§5.6)
after displacement, without the FVG having been fully invalidated (see
§10 for exactly how much of the FVG must be reachable before invalidation
voids the setup).

### 5.9 Confirmation candle
See §7 for the four deterministic patterns. A confirmation candle is any
closed M5 candle, occurring after retracement into the FVG, that matches
one of the defined bullish (for LONG) or bearish (for SHORT) patterns.

### 5.10 Target liquidity
The nearest **unswept** liquidity pool (§5.3) on the opposite side of
price from the entry, in the trade's direction — see §12.

## 6. Bullish state machine

**As implemented** (`lib/strategy/jeanfx-v1/state-machine.ts`, states named
per `JeanfxStateName` in `types.ts` — renamed from this document's
original `S0_IDLE..S9_NO_TRADE` placeholders to the more descriptive names
below during implementation; the sequence and every gating rule are
unchanged):

```
WAITING_FOR_BIAS
  -> WAITING_FOR_LIQUIDITY_SWEEP        [H1/M30: bias == BULLISH]
  -> WAITING_FOR_STRUCTURE_CONFIRMATION [closed candle sweeps a sell-side
                                          pool, §5.4]
  -> WAITING_FOR_FVG                    [closed M15 candle breaks the swing
                                          high nearest the sweep - MSS, §5.5]
  -> WAITING_FOR_RETRACE                [3-candle bullish FVG, §5.6, inside
                                          the displacement leg that produced
                                          the MSS]
  -> WAITING_FOR_CONFIRMATION           [M5 close trades back into the FVG
                                          range]
  -> READY                              [valid bullish confirmation pattern,
                                          §8, AND target liquidity exists
                                          with R:R >= 3, §12]
  -> INVALIDATED                        [terminal for this attempt; any
                                          missing precondition lands here,
                                          never a partial entry - see §15]
```

Enforcement rule (brief, verbatim intent): **no state may be entered out
of order.** A FVG seen with no prior sweep+MSS is not a valid setup: **no
sweep-only entry, no FVG-only entry, no confirmation-before-BOS.** Every
transition is logged with a reason code, timestamp, and price level
(`JeanfxStateTransition`) - never a bare state change. On timeout or
invalidation the walk resets to `WAITING_FOR_LIQUIDITY_SWEEP` and keeps
hunting within the same evaluation, rather than permanently giving up -
see "New implementation-only assumptions" below for the timeout bounds.

**Implementation design note (not a source rule):** rather than persisting
engine state between calls, `runJeanfxDirection()` DERIVES the state by
walking the full closed-candle history once per evaluation. Given the same
candle history this always reproduces the same trajectory - exactly as
deterministic as literal persisted state, without needing engine-state
storage. See `docs/architecture/strategy-platform.md`.

## 7. Bearish state machine (mirror)

Same states and same function (`runJeanfxDirection(..., "SHORT", ...)`),
mirrored: `WAITING_FOR_LIQUIDITY_SWEEP` hunts a **buy-side** sweep,
`WAITING_FOR_FVG` requires the swing **low** nearest the sweep to break
(MSS), and the FVG/confirmation/target are bearish. Same ordering
enforcement as §6. `READY` on a SHORT walk is a research-only output — see
§4: it is never forwarded to Bybit spot execution.

## 8. Candle confirmation patterns (entry timeframe, closed candles only)

All four require a deterministic body/wick test — no visual judgment.
Let `body = |close - open|`, `range = high - low`,
`upperWick = high - max(open, close)`, `lowerWick = min(open, close) - low`.

- **Bullish engulfing** — **[IMPLEMENTATION ASSUMPTION: body-to-body]**:
  current candle is bullish (`close > open`), prior candle is bearish
  (`close < open`), and current candle's body fully contains prior
  candle's body: `current.open <= prior.close AND current.close >=
  prior.open`. Body-to-body (not full-range) chosen because it's the more
  common, stricter ICT convention and avoids engulfing triggers on long
  wicks alone.
- **Bearish engulfing**: mirror of the above with bearish/bullish swapped.
- **Hammer** — **[IMPLEMENTATION ASSUMPTION: wick/body ratio]**: bullish
  or bearish body, `lowerWick >= 2 * body`, `upperWick <= 0.5 * body` (or
  `upperWick <= 0.1 * range` when `body` is ~0, to avoid divide-by-near-zero
  degenerate cases), occurring at/after retracement into a bullish FVG.
- **Shooting star**: mirror of hammer — `upperWick >= 2 * body`,
  `lowerWick <= 0.5 * body`, occurring at/after retracement into a
  bearish FVG.

`minWickBodyRatio = 2.0` and `maxOppositeWickRatio = 0.5` are proposed
defaults, not sourced from an exact JeanFX number.

## 9. Session model

`TradingSession = "ASIA" | "LONDON" | "NEW_YORK"`, timezone-aware (IANA
tz, not fixed UTC offsets, so DST shifts are handled automatically by the
runtime's tz database rather than hardcoded hour math).

**[IMPLEMENTATION ASSUMPTION — proposed local session windows, subject to
review]**:
- `ASIA`: 00:00–09:00 Asia/Tokyo
- `LONDON`: 08:00–17:00 Europe/London
- `NEW_YORK`: 08:00–17:00 America/New_York

A UTC instant is mapped to zero or more concurrent sessions by converting
to each session's local time and checking window membership — this
naturally absorbs DST because the conversion goes through the IANA tz
database, not a fixed UTC-offset table.

Session logic is an **optional** strategy-config component (`sessionFilter:
SessionConfig | null`). With `sessionFilter: null`, JeanFX evaluates
24/7 (needed for the crypto adaptation, §18). It stays optional/disabled
until tested, per instruction.

## 10. Entry model

**[IMPLEMENTATION ASSUMPTION]** Proposed single interpretation for review:
**FVG first touch.** Entry triggers at the first M5 close that trades
into the FVG range (any overlap), immediately followed by a valid
confirmation candle (§7/§5.9). This is chosen over 50%-midpoint or
full-fill because first-touch is the most conservative distance from the
displacement leg (largest room for the confirmation candle to still be
"backed" by the FVG) and requires no extra invented threshold. Midpoint
and full-fill are explicitly **not** implemented and must not be
introduced later as silent post-hoc optimization (instruction §10).

FVG invalidation: if price closes fully through the far edge of the FVG
without producing a valid confirmation candle, the setup reverts to
`INVALIDATED` — the FVG is not "reused" on a second touch. **As
implemented, the entry-timeframe scan for retracement+confirmation has no
bar-count timeout** (unlike the structure-timeframe MSS/FVG stages, §
below) - it keeps scanning every M5 candle supplied until invalidation or
READY. This is a noted limitation, not a silent design decision: an
unbounded wait could in principle let a very old, stale FVG still trigger;
adding a symmetric entry-timeframe timeout is flagged for future review
rather than guessed at here.

## 11. Stop loss model

**[IMPLEMENTATION ASSUMPTION]** Stop placed beyond the sweep extreme
(§5.4) that triggered `S3_SWEEP_CONFIRMED`:
- LONG: `stop = sweepCandle.low - buffer`
- SHORT: `stop = sweepCandle.high + buffer`

Buffer **[IMPLEMENTATION ASSUMPTION, explicit small buffer]**:
`buffer = bufferAtrMultiple * ATR(atrPeriod, entryTimeframe)` with
proposed `bufferAtrMultiple = 0.1`. ATR-based (not a fixed pip/point
value) for the same cross-instrument reason as §5.2. No ATR-multiple stop
is used as the *primary* stop mechanism (that would conflict with
instruction §11) — ATR only sizes the small buffer beyond a structural
level.

## 12. Profit target model

Deterministic next-liquidity selection, per instruction:
- LONG: nearest **unswept** buy-side liquidity pool (§5.3) with
  `level > entry`.
- SHORT: nearest unswept sell-side liquidity pool with `level < entry`.

Required initial R:R: `(target - entry) / (entry - stop) >= 3.0` for LONG,
mirrored for SHORT. `rrMinimum = 3.0` is sourced directly from the brief
("minimum 1:3"), not an assumption.

**If no unswept liquidity pool yields R:R >= 3.0, the setup resolves to
`NO_TRADE`.** No target substitution, no stop-shrinking, no size-inflation
to force the ratio — this mirrors CLAUDE.md §4's prohibition exactly, now
applied to JeanFX's own target logic.

## 13. Risk model

- `riskPct = 0.01` (1% of equity) for the primary research lock, per
  instruction. Sourced range from the brief is 0.5–1%; 1% is the
  specified normalized lock value, not my own choice.
- No leverage.
- Max 3 trades per session (§9's session concept; when `sessionFilter` is
  `null`, "session" degenerates to a rolling UTC calendar day —
  **[IMPLEMENTATION ASSUMPTION]**, since "per session" is undefined when
  sessions are disabled).
- Sizing reuses the existing deterministic risk engine
  (`lib/risk/position-sizing.ts`, `lib/risk/engine.ts`) rather than a new
  parallel implementation for the LONG side — JeanFX supplies
  `entry`/`stop`/`target`/`riskPct`, the existing engine still owns
  min-order-vs-stop conflict handling (`MIN_ORDER_RISK_CONFLICT`, CLAUDE.md
  §4) unchanged. For SHORT (research-only, never executable in this build),
  the generic backtest engine (`lib/strategy-platform/backtest.ts`) uses a
  separate, symmetric, clearly-labeled research-only mirror of the same
  formulas rather than modifying the production (intentionally long-only)
  risk engine - see that file's header comment.

### New implementation-only assumptions (added during Prompt 2, not in the original brief)

- `mssTimeoutBars = 20` and `fvgTimeoutBars = 20` (structure-timeframe, M15
  bars): how long a setup waits in `WAITING_FOR_STRUCTURE_CONFIRMATION` /
  `WAITING_FOR_FVG` before giving up on that attempt and resuming the hunt
  for a fresh sweep. The brief gives no bound; without one a stale sweep
  from days ago could still "count" indefinitely.
- HTF bias determination itself (`determineHtfBias()`,
  `state-machine.ts`): `EMA50 > EMA200 AND close > EMA50` (bullish; mirror
  for bearish). The brief never specifies how bias is computed at all -
  this reuses the same well-known trend test V1 uses conceptually, as an
  independent JeanFX-owned copy, not a shared function with V1.

### User-configurable parameters (Prompt 2 S6) vs version-locked assumptions

Per instruction, only a small surface is user-tunable
(`lib/strategy/jeanfx-v1/config.ts` `JeanfxUserConfig`,
`validateJeanfxUserConfig()`) — everything else above (swing bars, equal-
level tolerance, displacement multiple, stop buffer, confirmation wick
ratios, the two new timeouts) stays locked to the immutable `jeanfx-v1`
version, so a user can never quietly overfit JeanFX into a different
strategy while still calling it "JeanFX":

| Parameter | Choices | Default |
|---|---|---|
| `biasTimeframe` | `H1` \| `M30` | `H1` |
| `riskPct` | `(0, 0.05]` | `0.01` |
| `sessionFilter` | `LONDON` \| `NEW_YORK` \| `LONDON_AND_NEW_YORK` \| `ALL` | `ALL` (no session gating) |
| `confirmationPatterns` | `ENGULFING` \| `HAMMER_SHOOTING_STAR` \| `BOTH` | `BOTH` |

## 14. Partial profit + break-even — unresolved source ambiguity

The brief states break-even-after-partial-profit but defines neither
partial size nor the R-level trigger. Per instruction, **not** silently
invented. Decision for this checkpoint: **Option A — excluded from
`jeanfx-v1`.**

`jeanfx-v1` v1 manages a single full-size position from entry to stop or
full target (§12), with no partial exit and no stop movement to
break-even. This is a known limitation, not a claim that JeanFX has no
partial/BE concept — see §"Unresolved ambiguities" for the two concrete
options (A/B) available for future explicit review before any performance
testing.

## 15. No-trade conditions (exhaustive)

A setup resolves to `INVALIDATED` (or simply never leaves
`WAITING_FOR_*`) — never a degraded entry — whenever:
1. HTF bias is neutral/undetermined (§3) — stays at `WAITING_FOR_BIAS`.
2. No identifiable liquidity pool exists ahead of price in the bias
   direction — stays at `WAITING_FOR_LIQUIDITY_SWEEP`.
3. No sweep occurs (state never leaves `WAITING_FOR_LIQUIDITY_SWEEP`).
4. Sweep occurs but no MSS confirms afterward within `mssTimeoutBars`
   (§5.5) — sweep-only, rejected by design, resets to hunting.
5. MSS confirms but no FVG forms in the displacement leg within
   `fvgTimeoutBars` (§5.7) — confirmation-before-BOS / no-FVG, rejected by
   design, resets to hunting.
6. FVG forms but price never retraces into it, or invalidates it first
   (§10) — `INVALIDATED` with reason code `FVG_INVALIDATED`.
7. Retracement occurs but no valid confirmation candle (§8) forms — walk
   ends at `WAITING_FOR_CONFIRMATION`.
8. Confirmation candle forms but no unswept target liquidity yields
   R:R >= 3.0 (§12) — `INVALIDATED` with reason code `NO_VALID_TARGET_RR`.
9. Max trades for the session/day already reached (§13) — **not yet
   enforced anywhere in this checkpoint**, honestly flagged rather than
   claimed: `maxTradesPerSession` is defined in `JEANFX_V1_PARAMS` but no
   caller (the built-in wiring, the generic backtest engine) currently
   tracks trades-per-session for JeanFX specifically. This is a real gap,
   not a design choice - it needs to be wired into whichever caller
   ultimately runs JeanFX repeatedly over time (a scan job or backtest
   loop) before promotion review.
10. `sessionFilter` is enabled and the confirmation candle's instant is
    outside all configured sessions — `INVALIDATED` with reason code
    `OUTSIDE_SESSION` (checked once, at the moment of readiness, not
    throughout the whole walk).
11. Any input candle in the required window is not closed (closed-candle
    invariant, CLAUDE.md §3) — mirrors V1 exactly; enforced by the caller
    (`lib/strategy-platform/built-in/jeanfx-v1.ts`) filtering every
    timeframe to `isClosed` candles before the state machine ever sees them.

## 16. Promotion bar (restated, not new)

Being the primary research strategy does not imply PAPER or LIVE
eligibility, or a profitability claim (instruction §15/§16). Evaluation
criteria for later promotion review: OOS expectancyR, OOS profit factor,
cost robustness, drawdown, temporal stability, cross-instrument
consistency. Trade count is a sample-adequacy check only; win rate is
descriptive only. None of these have been measured — this checkpoint runs
no backtest.

## 17. Forex/gold readiness

The domain model (`Instrument`, `CanonicalCandle`, `TradingSession`, §19
skeleton types) has no Bybit-specific field. `jeanfx-v1`'s pure strategy
functions take `Instrument` + `CanonicalCandle[]` and never a Bybit
symbol string or Bybit client type. No forex broker is connected in this
checkpoint — `Instrument` for XAU/USD, EUR/USD, GBP/USD, USD/JPY can be
constructed today for research/backtesting once historical candle data is
sourced, but nothing here wires up a live forex feed.

## 18. Crypto adaptation labeling

Any run of `jeanfx-v1` against crypto instruments (BTCUSDT, ETHUSDT, i.e.
Bybit spot, 24/7 market with no session close) must be labeled
**"JeanFX Crypto Adaptation"**, not presented as equivalent to the
source's gold/forex, session-driven execution model. Concretely: with
`sessionFilter: null` (the crypto default, §9), the Asian/London/NY
liquidity-sweep narrative the brief describes for a session-gapping
market does not really apply — sweeps/MSS/FVG still compute
deterministically, but "session" framing is cosmetic for crypto until/
unless `sessionFilter` is explicitly enabled and tested for that market.

## Unresolved ambiguities (full list)

1. "Obvious support/resistance" (§5.3) — no deterministic definition
   attempted beyond prior-swing/session liquidity; not implemented as its
   own category.
2. Partial profit + break-even (§14) — excluded from v1 (Option A);
   Option B (propose one deterministic partial-size/R-trigger pair) is
   available for explicit review, not silently added.
3. H1 vs M30 bias timeframe (§3) — brief allows either; H1 defaulted,
   configurable.
4. "Per session" trade cap when sessions are disabled (§13) — degraded to
   rolling UTC day; not stated in the brief.
5. No actual JeanFX source document was available in this session (§0) —
   everything above should be re-checked against the real source once
   supplied.

## Proposed numeric thresholds (all pending review, none locked)

| Parameter | Proposed value | Basis |
|---|---|---|
| `swing.leftBars` / `rightBars` | 2 / 2 | assumption |
| `equalHighLowAtrMultiple` | 0.10 | assumption |
| `displacementAtrMultiple` | 1.5 | assumption |
| `bufferAtrMultiple` (stop) | 0.10 | assumption |
| `minWickBodyRatio` (hammer/star) | 2.0 | assumption |
| `maxOppositeWickRatio` | 0.5 | assumption |
| `rrMinimum` | 3.0 | sourced ("minimum 1:3") |
| `riskPct` | 0.01 | sourced (normalized lock value) |
| `maxTradesPerSession` | 3 | sourced (**not yet enforced** - see §15.9) |
| Session windows (§9) | see §9 | assumption |
| `mssTimeoutBars` | 20 | assumption (new, Prompt 2) |
| `fvgTimeoutBars` | 20 | assumption (new, Prompt 2) |

## Files (spec-checkpoint types, Prompt 1, and implementation, Prompt 2)

Prompt 1 (spec + types only):
- `docs/strategies/jeanfx-v1-spec.md` (this file).
- `lib/strategy/jeanfx-v1/types.ts` — pure domain types (`Direction`,
  `Instrument`, `CanonicalCandle`, `LiquidityPool`, `FairValueGap`,
  `StructureEvent`, `JeanfxStateName`, `JeanfxStateTransition`, etc.) - now
  also re-exports `Direction`/`CanonicalCandle`/etc. from
  `lib/strategy-platform/types.ts` rather than duplicating them, tidied up
  during Prompt 2 to avoid two competing definitions of the same shape.
- `lib/strategy/jeanfx-v1/config.ts` — `JEANFX_V1_PARAMS`, versioned like
  V1's `STRATEGY_V1_PARAMS`.

Prompt 2 (implementation):
- `lib/strategy/jeanfx-v1/primitives/` — `swings.ts`, `equal-levels.ts`,
  `sweep.ts`, `structure.ts` (BOS/MSS), `fvg.ts`, `candles.ts` (engulfing/
  hammer/shooting-star), `sessions.ts` (DST-aware), `liquidity.ts` (pool
  assembly) - each with its own test file. These are the SAME functions
  the DSL's structure primitives (`SWING_HIGH`/`BOS`/`LIQUIDITY_SWEEP`/
  `FVG`/`CANDLE_PATTERN`) delegate to (`lib/strategy-platform/dsl/
  evaluate.ts`) - see docs/architecture/strategy-platform.md "DSL
  primitive library expansion". Not reimplemented twice.
- `lib/strategy/jeanfx-v1/state-machine.ts` — `runJeanfxDirection()`, the
  two-phase (structure-timeframe walk, then entry-timeframe scan) walk
  described in §6/§7, plus `determineHtfBias()`.
- `lib/strategy/jeanfx-v1/state-machine.test.ts` — LONG/SHORT (mirrored),
  bias mismatch, flat-market no-signal, FVG invalidation, no-valid-target
  invalidation, and no-lookahead (an appended absurd future candle proven
  to have zero effect on an already-reached READY result).
- `lib/strategy-platform/built-in/jeanfx-v1.ts` — wires the state machine
  into the generic `StrategyContract`; the ONLY place JeanFX-specific code
  touches the platform layer. No JeanFX logic anywhere in
  `lib/strategy-platform/backtest.ts`, `lib/risk/`, or `lib/trading/`.
  `config.ts` also gained `JeanfxUserConfig`/`validateJeanfxUserConfig()`
  for the small user-tunable surface (§ above).
