# Strategy catalog

This directory documents strategies, not the platform that runs them - for
the architecture (contract, DSL, orchestrator, security), see
`docs/architecture/strategy-platform.md`. For the end-to-end story of
creating and running your own strategy, see `docs/user-strategies.md`.

## Built-in strategies

| Slug | Name | Status | Concept | Markets | Timeframes |
|---|---|---|---|---|---|
| `jeanfx-v1` | JeanFX Liquidity System | `RESEARCH_ONLY` | Liquidity sweep → MSS/BOS → FVG → retracement → confirmation → entry, targeting the next liquidity pool (min 1:3 R:R). See `jeanfx-v1-spec.md`. | CRYPTO, FOREX, METAL (research) | H1/M30 bias, M15 structure, M5 entry |
| `v1` | Strategy V1 (Legacy Baseline) | `DRAFT` | 1H EMA-stack regime gate + 15M weighted setup score (trend/pullback/momentum/volume/R:R/volatility). Frozen/control - see `docs/STRATEGY_V1.md`. Still runs through its own dedicated pipeline (`lib/strategy/v1/`), not the generic platform. | CRYPTO (spot, long only) | H1 regime, M15 setup |
| `v2-trb` | TRB (Research Benchmark) | `DRAFT` | **No implementation exists.** Registered as an honest placeholder only - nothing was found in this repository to preserve, and nothing has been built for it. | - | - |

None of these are advertised with a win rate or "profitable" claim. See
"Research status" below for why, and `docs/architecture/strategy-platform.md`
section 16/18 for the actual evaluation criteria (OOS expectancyR, profit
factor, cost robustness, drawdown, temporal stability, cross-instrument
consistency - not win rate, not a single backtest).

## Research status - read before trusting any number

**RESEARCH_ONLY means exactly that: no backtest run in this repository has
been validated out-of-sample, and no strategy here has been promoted to
PAPER or LIVE.** A strategy card, backtest result, or plain-English
summary describes what a strategy *does*, never a claim that it *works*.
If a future backtest run shows a positive result, the correct framing is
"positive observed expectancy in this window" - never "profitable
strategy" (see `lib/strategy-platform/backtest.ts` `buildWarnings()` for
the neutral-language warnings every backtest result carries).

## Creating a built-in strategy

Built-in strategies are maintained in this repository's source code, not
through the UI:

1. Add pure, tested primitive/detection logic under `lib/strategy/<slug>/`
   (see `lib/strategy/jeanfx-v1/` for the pattern: `primitives/` for
   reusable detection functions, `state-machine.ts` or equivalent for the
   decision logic, `config.ts` for versioned parameters).
2. Wire it into the generic contract with one file under
   `lib/strategy-platform/built-in/<slug>.ts` implementing
   `StrategyContract` - this is the ONLY file where strategy-specific code
   may touch the platform layer. No strategy-specific logic belongs in
   `lib/strategy-platform/orchestrator.ts`, `backtest.ts`, `conflict.ts`,
   `portfolio-risk.ts`, or any DSL file.
3. Register it in `lib/strategy-platform/registry.ts`'s
   `BUILT_IN_STRATEGIES` array.
4. Write a spec document (`docs/strategies/<slug>-spec.md`) that labels
   every rule SOURCE RULE (traceable to an actual source/brief) or
   IMPLEMENTATION ASSUMPTION (a deterministic choice made to fill a gap
   the source left open) - see `jeanfx-v1-spec.md` for the pattern.
5. Seed a `strategy_definitions`/`strategy_platform_versions` row via an
   additive migration (see
   `supabase/migrations/20260918000000_strategy_platform_seed_built_ins.sql`)
   so "Use this strategy" works for it. Users can configure and assign a
   built-in strategy; they can never edit its source, and importing a
   custom strategy can never target a built-in's slug
   (`assertImportTargetSlugIsSafe()`).

For a user-created (DSL) strategy instead, see `docs/user-strategies.md`.
