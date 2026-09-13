# Strategy V1 — Research Baseline

**This is a research starting point, not a claim of profitability.** It exists
so the platform can generate real signals, paper trade them, and measure
expectancy after realistic costs. Parameters live in
`lib/strategy/v1/config.ts` and are versioned — any change ships as a new
`strategy_versions` row.

## Universe
BTCUSDT, ETHUSDT. Spot. Long only.

## 1H regime gate
Bullish when `EMA50 > EMA200 AND close > EMA50`. Otherwise: no candidate,
full stop (`NO_BULLISH_REGIME`).

## 15M setup score (100 pts, see `lib/strategy/v1/score.ts`)
| Component | Points | Rule |
|---|---|---|
| Trend | 25 | Full 15M EMA stack (20>50>200) = full credit; 20>200 only = half. |
| Pullback | 20 | Full credit within 0.25×ATR of EMA20, linearly decaying to 0 by 1.5×ATR. |
| Momentum | 15 | Full credit when RSI14 is in [40, 65] (a "reset," not overbought/oversold); decays outside. |
| Volume | 15 | Linear from 0 at relative-volume 0.5x to full credit at 1.2x. |
| Risk/Reward | 15 | Stop = latest confirmed swing low (or 1.5×ATR fallback); target = stop-distance × 2R. Full credit at R/R ≥ 2. |
| Volatility | 10 | Full credit when ATR/price is within [0.3%, 3%]; decays outside. |

## Classification
`<60` IGNORE · `60–69` LOG · `70–79` WATCH · `80–100` CANDIDATE.

## Known limitations (documented honestly, not hidden)
- Component weightings are reasonable-but-arbitrary starting points, not
  fitted to data. The backtester (Phase 7) is what determines whether this
  configuration has positive expectancy — this document does not claim it does.
- The pullback/momentum/volatility scoring functions are simple linear ramps
  for interpretability, not the result of optimization.
- Swing detection uses a fixed 3-bar fractal lookback; it can miss larger
  structural swings on choppy data.

## Closed-candle invariant
`evaluateSignal()` refuses to score anything unless the most recent 15M
candle has `isClosed = true`. See `lib/strategy/v1/signal.ts`.
