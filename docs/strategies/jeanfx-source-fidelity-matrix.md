# JeanFX v1 — Source-Fidelity Matrix

Authoritative source: **JeanFX_Final_Complete** ("JeanFX Complete Trading
System" + "JEANFX: MASTERING GOLD — MASTER EDITION"), 21 pages.

Every row traces a JeanFX rule to the code that implements it. `ORIGIN`
records whether the rule's *numbers* come from the document (SOURCE), were
chosen by us because the document gives none (IMPLEMENTATION ASSUMPTION), or
name a gap the document leaves open (SOURCE AMBIGUITY).

Nothing tagged IMPLEMENTATION ASSUMPTION or SOURCE AMBIGUITY may be presented
to an operator as "a JeanFX rule". The machine-readable copy of this
distinction lives in `JEANFX_IMPLEMENTATION_ASSUMPTIONS`
(`lib/strategy/jeanfx-v1/config.ts`) and is rendered verbatim in the UI.

## Core execution rules

| # | Rule | Source text | Implementation | Status | Origin | Tests |
|---|------|-------------|----------------|--------|--------|-------|
| 1 | Sequence, not separate ideas | "The JeanFX model is a sequence, not separate ideas: 1. liquidity 2. BOS 3. FVG 4. retrace 5. candlestick confirms" | `state-machine.ts` walks strictly `WAITING_FOR_LIQUIDITY_SWEEP → WAITING_FOR_STRUCTURE_CONFIRMATION → WAITING_FOR_FVG → WAITING_FOR_RETRACE → WAITING_FOR_CONFIRMATION → READY`; no stage can be entered out of order | MATCH | SOURCE | `state-machine.test.ts` |
| 2 | HTF bias from liquidity | "Determine bias by observing where liquidity sits relative to price. If liquidity sits above price, market may seek it first." | `primitives/bias.ts` — nearest unswept pool still in front of price is the draw; true direction is away from it | **FIXED** (was EMA50/EMA200) | SOURCE | `source-fidelity.test.ts`, `state-machine.test.ts` |
| 3 | Multi-timeframe model | "H1 or M30 identifies market bias. M15 confirms structure shifts. M5 provides precise entries with tight risk." | Profiles `JEANFX_GOLD_ACTIVE` (M30) / `JEANFX_GOLD_SELECTIVE` (H1); structure M15, entry M5 | MATCH | SOURCE | `source-fidelity.test.ts` |
| 3a | Selected timeframe is the one fetched | — | `StrategyContract.resolveRequiredTimeframes()`, honoured by `evaluation-plan.ts` and `orchestrator.ts` | **FIXED** (M30 silently received H1) | SOURCE | `source-fidelity.test.ts` |
| 4 | Liquidity mapping | "Map equal highs, equal lows, session highs and previous highs/lows." / "above highs, below lows, equal highs/lows, and obvious support/resistance" | `buildLiquidityMap()` → `EQUAL_HIGH_LOW`, `PRIOR_SWING`, `SESSION_HIGH_LOW` | **FIXED** (session pools were targets only, never sweepable) | SOURCE | `liquidity.test.ts` |
| 4a | "Obvious support/resistance" | listed as liquidity, never defined numerically | Not a distinct pool kind; such levels surface as equal highs/lows or prior swings | AMBIGUOUS | SOURCE AMBIGUITY | — |
| 5 | Liquidity taken first | "Price moves into liquidity (stop hunt)" — step 1 of 5 | Sweep must be detected before `requiredSwing` is captured; structure is only hunted after `sweepIndex` | MATCH | SOURCE | `sweep.test.ts`, `state-machine.test.ts` |
| 6 | Sweep definition | "price trades beyond liquidity level and closes back through/inside it" | `isSweepCandle()` | MATCH | SOURCE | `sweep.test.ts` |
| 7 | Sweep side per direction | "If price sweeps below lows (taking sell-side liquidity) and then breaks above a previous high, this signals a shift from bearish to bullish" | LONG requires a SELL_SIDE sweep, SHORT a BUY_SIDE sweep | MATCH | SOURCE | `state-machine.test.ts` |
| 8 | MSS/BOS after the sweep | "After liquidity is taken, the next step is confirmation... Without BOS, there is no confirmation. Entering before BOS is guessing." | `detectStructureEvent()` only reachable from `WAITING_FOR_STRUCTURE_CONFIRMATION` | MATCH | SOURCE | `structure.test.ts` |
| 9 | FVG = 3-candle imbalance | "Candle 1 → Candle 2 (strong impulse) → Candle 3. If there is a gap between Candle 1 and Candle 3, that is your FVG." | `detectFvgAt()` — bullish `low[c3] > high[c1]`, bearish `high[c3] < low[c1]` | MATCH | SOURCE | `fvg.test.ts` |
| 10 | FVG forms after structure | step 3 of 5, after BOS | FVG search starts at `mssIndex` | MATCH | SOURCE | `state-machine.test.ts` |
| 11 | Retrace into the FVG | "Price retraces into FVG" — step 4 | `touchesFvg()` gates `WAITING_FOR_CONFIRMATION`; an FVG alone never entries | MATCH | SOURCE | `fvg.test.ts` |
| 12 | Candle confirms, never leads | "Use as confirmation AFTER BOS, not before." | Confirmation only evaluated once `touched === true` in `walkEntry()` | MATCH | SOURCE | `candles.test.ts` |
| 13 | Confirmation patterns | bullish/bearish engulfing, hammer, shooting star | `isBullishEngulfing`, `isBearishEngulfing`, `isHammer`, `isShootingStar` | MATCH | SOURCE | `candles.test.ts` |
| 14 | Target = next liquidity pool | "Targets are placed at the next liquidity pool." | Nearest unswept opposing pool; **no scan-forward** for a further pool | **FIXED** (previously searched past the next pool for one clearing 3R) | SOURCE | `state-machine.test.ts` |
| 15 | Minimum 1:3 | "Risk Reward — Minimum 1:3" | Quality gate on the chosen target; `RR_BELOW_MINIMUM` rejects below 3R | MATCH | SOURCE | `state-machine.test.ts`, `source-fidelity.test.ts` |
| 16 | Risk 0.5–1% | "Risk per trade — 0.5–1%" | `JEANFX_RISK_PCT_MIN/MAX`, enforced server-side in `validateJeanfxUserConfig()` | **FIXED** (permitted up to 5%) | SOURCE | `source-fidelity.test.ts` |
| 17 | Max 3 trades/session | "Max trades per session — 3" | `session-limits.ts`, derived from durable trade records, London/NY counted separately | **FIXED** (configured but enforced nowhere) | SOURCE | `source-fidelity.test.ts` |
| 18 | Break-even after partial | "Break-even — After partial profit" | 50% at +1.5R, then stop to break-even | **IMPLEMENTED AS ASSUMPTION** (was `partialExitPlan: null`) | SOURCE AMBIGUITY — the document gives neither fraction nor trigger | `source-fidelity.test.ts` |
| 19 | Sessions | "Asian builds range, London sweeps liquidity, New York expands." | Gold defaults to `LONDON_AND_NEW_YORK`; Asian range supplies liquidity context only | **FIXED** (defaulted to ALL) | SOURCE | `source-fidelity.test.ts`, `sessions.test.ts` |
| 20 | Both directions | Engulfing/hammer chapters cover both sides | Both LONG and SHORT fully evaluated; contradictory pairs rejected | **FIXED** (LONG-first array order) | SOURCE | `jeanfx-v1.test.ts` |

## Supporting market context (NOT mandatory entry rules)

The document also teaches support/resistance (ch. 4) and continuation
patterns (ch. 5). These are classified as SUPPORTING MARKET CONTEXT, not core
execution rules: the document never states that a continuation pattern is
required for entry, and inventing a filter because a chapter exists would add
an unsourced gate. They remain available as context, not as entry conditions.

## Implementation assumptions (our numbers, not JeanFX's)

| Parameter | Value | Why it is ours |
|---|---|---|
| `swing.leftBars/rightBars` | 2 / 2 | Source names swing highs/lows, gives no fractal lookback |
| `equalHighLowAtrMultiple` | 0.10 × ATR14 | Source says "equal highs/lows", gives no tolerance for "equal" |
| `displacementAtrMultiple` | 1.50 × ATR14 | Source says "strong impulse" / "moves aggressively", no threshold |
| `stopBufferAtrMultiple` | 0.10 × ATR14 | Source does not specify stop distance beyond the sweep extreme |
| `confirmation.minWickBodyRatio` | 2.0 | Source: "long lower wick, small body at top" — qualitative only |
| `confirmation.maxOppositeWickRatio` | 0.5 | Source gives no opposite-wick bound |
| `biasAmbiguityAtrMultiple` | 0.25 × ATR14 | Tie-break guard so an equidistant draw resolves to NONE, never a coin flip |
| `mssTimeoutBars` / `fvgTimeoutBars` | 20 / 20 M15 bars | Source gives no staleness bound for a pending setup |
| `partialExit` | 50% @ +1.5R | Source states the behaviour, not the numbers |
| session clock windows | London 08–17 Europe/London; New York 08–17 America/New_York; Asia 00–09 Asia/Tokyo | Source names the sessions, gives no killzone hours. DST-aware via IANA zones |
| `atrPeriod` | 14 | Conventional; source names no indicator period |

A change to any of these ships a **new `strategy_versions` row**, never a
mutation of an existing one.

## Unresolved source ambiguities

1. **Partial-profit fraction and trigger** — "Break-even after partial profit"
   with no numbers. Implemented as a labelled versioned assumption.
2. **"Obvious support/resistance"** — named as liquidity, never defined.
   Deliberately not implemented as its own pool kind.
3. **MSS vs BOS distinction** — the document uses both terms
   ("MSS signals momentum change and BOS confirms trend") without a numeric
   split. JeanFX's own sequence only needs the post-sweep reversal case.
4. **Killzone hours** — sessions named, clock windows not given.

## Explicitly removed

**EMA50 / EMA200 are no longer used for JeanFX bias anywhere.** The previous
`determineHtfBias()` required `EMA50 > EMA200 && close > EMA50` for a bullish
bias. No EMA appears anywhere in the JeanFX document; that rule turned JeanFX
into generic trend-following wearing a JeanFX label. A regression test asserts
`state-machine.ts` contains no EMA reference.
