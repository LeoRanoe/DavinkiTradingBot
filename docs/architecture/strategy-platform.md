# Strategy Platform — Architecture (Prompt 1 foundation + Prompt 2 + Prompt 3)

**Status: audit-ready.** JeanFX is fully implemented and runs through this
platform's generic contract; a Strategy Builder UI exists; the DSL
compiles into a running, backtestable strategy; a generic orchestrator
(evaluation, compatibility, portfolio risk, conflict resolution, mode
authorization, failure isolation, observability) exists and is tested but
is **not** wired into the live scan job (Prompt 3 S33 - deliberate). V1's
production pipeline remains untouched throughout. This document was
written during Prompt 1 (sections 1-9: foundation), extended during
Prompt 2 (section 13: JeanFX + Strategy Builder + generic backtesting),
and extended again during Prompt 3 (section 14: orchestration/portfolio
risk/conflicts/mode authorization/security audit) rather than rewritten
each time, so it stays one coherent history. See `TASKS.md` /
`docs/BUILD_STATE.md` for where this sits in the overall build,
`docs/strategies/jeanfx-v1-spec.md` for the JeanFX-specific spec, and
`docs/strategies/README.md` / `docs/user-strategies.md` for the built-in
catalog and end-to-end user story.

**Read section 14 first if you only have time for one section** - it's the
Prompt 3 summary (including a "what's NOT wired to production" list) and
supersedes anything earlier that says "not implemented yet" or "future
work" that a later prompt actually built.

## 1. Product model / execution flow

```
MARKET DATA
    v
STRATEGY ENGINE      (lib/strategy-platform/ - this checkpoint)
    v
OPPORTUNITIES        (Opportunity, lib/strategy-platform/types.ts)
    v
PORTFOLIO / RISK POLICY   (existing lib/risk/ - untouched; conflict
                            resolution, lib/strategy-platform/conflict.ts)
    v
EXECUTION ENGINE      (existing lib/trading/ - untouched)
    v
PAPER / LIVE VENUE
```

Strategies (`StrategyContract.evaluate()`) are pure functions:
`StrategyContext -> StrategyDecision`. Nothing in `lib/strategy-platform/`
places an order, touches an account balance, reads a credential, or
authorizes its own execution mode - there is structurally no field on any
type in this layer that could carry an order id, a credential, or an
execution authorization. That boundary is enforced by what the types
*don't* contain, and further reinforced by `authorization.ts` (see S8).

## 2. Entities and relationships

```
StrategyDefinition (1) --- (N) StrategyPlatformVersion (1) --- (N) StrategyConfiguration (1) --- (N) StrategyAssignment
       |                                                                                                    |
  ownerUserId (null = built-in)                                                              userId, mode, instrumentIds
```

- **StrategyDefinition** - identity: slug, display name, type
  (`BUILT_IN`/`USER_DEFINED`), owner, visibility. `strategy_definitions`.
- **StrategyPlatformVersion** - one immutable logic snapshot of a
  definition. `strategy_platform_versions`.
- **StrategyConfiguration** - one user's parameterization of a specific
  immutable version (which markets, which risk %, etc).
  `strategy_configurations`.
- **StrategyAssignment** - the explicit "this configuration actually runs,
  in this mode, on these instruments" record. Nothing runs just because a
  configuration exists. `strategy_assignments`.

TypeScript mirrors: `lib/strategy-platform/types.ts`
(`StrategyDefinitionType`, `StrategyLifecycleStatus`,
`StrategyAssignmentMode`, `StrategyVisibility`).

## 3. Two strategy types, one contract

`StrategyContract` (`lib/strategy-platform/types.ts`) is the single shape
every strategy - built-in or (once compiled) user-defined - implements:

```ts
interface StrategyContract {
  metadata: StrategyMetadata;
  evaluate(ctx: StrategyContext): StrategyDecision;
  evaluatePositionManagement?(ctx: StrategyContext): StrategyDecision;
}
```

It has zero references to JeanFX, TRB, V1, Bybit, crypto, or forex.
`StrategyContext` carries `Instrument` (asset-class-tagged, not a Bybit
symbol) and `CanonicalCandle[]` per `Timeframe`, never a venue-specific
type.

### Built-in registry (`lib/strategy-platform/registry.ts`)

`BUILT_IN_STRATEGIES` is the one place any future code should resolve a
strategy by slug - no route should ever hardcode
`if (strategy === "jeanfx")`. Current entries, all **metadata-only in this
checkpoint** (see `built-in/*.ts` for why each `evaluate()` is a documented
`NO_ACTION` stub):

| slug | type | status | note |
|---|---|---|---|
| `v1` | BUILT_IN | DRAFT | Still runs through its own dedicated pipeline (`lib/strategy/v1`, `lib/candidates`) - NOT re-routed through this contract, per instruction not to convert V1 production behavior in this checkpoint. |
| `jeanfx-v1` | BUILT_IN | RESEARCH_ONLY | Detection logic (sweep/MSS/BOS/FVG state machine) is Prompt 2's work; spec lives at `docs/strategies/jeanfx-v1-spec.md`. |
| `v2-trb` | BUILT_IN | DRAFT | **Honesty note**: no TRB code, spec, or docs exist anywhere in this repository (searched before writing this file, same finding as the JeanFX spec checkpoint). This is a placeholder slug only - nothing was "preserved" because nothing was found. |

### User-defined strategies

A `USER_DEFINED` `StrategyDefinition` has `ownerUserId` set and its
`StrategyPlatformVersion.definition` is a `DslDefinition` (see S6) rather
than a pointer to built-in code. There is no path in this checkpoint from
"user creates a strategy" to actually running it - compiling a
`DslDefinition` into a live `StrategyContract.evaluate()` is future work;
this checkpoint ships the DSL, its validator, and its evaluator as
standalone, independently tested modules (`lib/strategy-platform/dsl/`).

## 4. Generic Opportunity

`Opportunity` (`lib/strategy-platform/types.ts`) is the sole output of the
strategy-engine layer:

```ts
type Opportunity = {
  strategyDefinitionId; strategyVersionId; strategyConfigurationId;
  instrumentId; side; signalTime;
  entry; stop; target; partialExitPlan;
  reasonCodes; featureSnapshot;
  confidence: number | null;   // only when a strategy defines one mathematically
  priority: number;
};
```

`confidence` is nullable and no strategy is required to populate it - V1's
100-point score is V1-specific and stays inside V1's own pipeline; it is
not forced onto this generic shape.

## 5. Versioning and lifecycle

- `StrategyLifecycleStatus`: `DRAFT -> RESEARCH_ONLY -> PAPER_ELIGIBLE ->
  PAPER_ACTIVE -> LIVE_ELIGIBLE -> ARCHIVED`. This is a *lifecycle*
  concept, tracked on the version row (`status`, `archived_at`) - it is
  explicitly **not** an execution authorization. A version can say
  `LIVE_ELIGIBLE` and still never execute a single LIVE order, because
  execution authorization is a separate concern (S8).
- **Immutability**: once a `strategy_platform_versions` row exists, every
  column except `status`/`archived_at` is frozen forever. Enforced twice,
  independently:
  1. A Postgres `BEFORE UPDATE` trigger
     (`strategy_platform_versions_block_mutation`) that raises on any other
     column change - the real enforcement boundary.
  2. `assertVersionMutationAllowed()` in `authorization.ts`, a pure-TS
     mirror application code (and this repo's test suite, which does not
     run against live Postgres) can check identically.
- Editing a strategy means inserting a **new** `strategy_platform_versions`
  row with `version_number + 1`; the old row and everything that ever
  referenced it (future configurations, opportunities, research) stays
  exactly as it was evaluated. No history is ever rewritten.

## 6. Safe declarative DSL (`lib/strategy-platform/dsl/`)

A `DslDefinition` is: `timeframes`, `side`, an `entry` condition tree
(`DslNode`), a `stop`/`target` formula, and a `parameterSchema`. It is pure
data - JSON-serializable, storable as-is in
`strategy_platform_versions.definition`.

### Registry / extensibility (`dsl/registry.ts`)

`IMPLEMENTED_PRIMITIVES` is the allow-list `validate.ts`/`evaluate.ts`
consult: `ALL, ANY, NOT, COMPARE, CROSS_ABOVE, CROSS_BELOW, SESSION,
PERCENT_CHANGE, PRICE, VOLUME, CONST, EMA, SMA, RSI, HIGHEST, LOWEST` - 16
primitives, deliberately a subset of everything the product brief
eventually wants. `FUTURE_PRIMITIVES` names the rest explicitly (`OHLC,
ATR, CANDLE_PATTERN, SWING_HIGH, SWING_LOW, FVG, LIQUIDITY_SWEEP, BOS,
MSS`) so a reference to one of them fails validation with a distinct,
honest "recognized but not yet implemented" error rather than "unknown
primitive" or silent ignoring. **No SMC/ICT concept is exposed to
user-authored strategies in this checkpoint** - swings, FVGs, sweeps,
BOS/MSS stay exclusive to JeanFX's own (not-yet-built) hardcoded detection
logic, not the general-purpose DSL, until a future checkpoint deliberately
promotes one.

Extending the registry later means: add the `DslNode` variant
(`dsl/types.ts`), add one entry to `IMPLEMENTED_PRIMITIVES`
(`dsl/registry.ts`), add its `case` to `validate.ts`'s walker and
`evaluate.ts`'s recursion, add tests. No other file changes.

### Safety (`dsl/limits.ts`, enforced in `validate.ts` and again at runtime
in `evaluate.ts` - defense in depth, same pattern as the risk engine):

| Limit | Value |
|---|---|
| `maxRuleDepth` | 6 |
| `maxRuleCount` | 60 |
| `maxLookback` (any indicator period) | 500 |
| `maxTimeframes` per strategy | 3 |
| `maxInstrumentsPerConfiguration` | 25 |

- **No eval(), no `new Function()`, no VM.** The evaluator is direct
  recursion over a typed, closed `DslNode` union - there is no code-as-text
  path anywhere. `dsl/no-arbitrary-code.test.ts` makes this a checked
  regression, not just a claim: it scans every non-test file under
  `dsl/` for `eval(`, `new Function(`, and `vm`/`child_process` usage.
- **NaN/Infinity**: every `COMPARE`/`CROSS_ABOVE`/`CROSS_BELOW`/
  `PERCENT_CHANGE` checks `Number.isFinite()` before comparing and returns
  a typed `{ ok: false, reason: "NON_FINITE_VALUE" }` rather than letting a
  `NaN` comparison silently evaluate to `false` (which would look
  indistinguishable from a legitimate "condition not met").
- **Division by zero**: `PERCENT_CHANGE` returns
  `{ ok: false, reason: "DIVISION_BY_ZERO" }` rather than propagating
  `Infinity`/`NaN`.
- **Lookahead**: `evaluateDslEntry()` filters `candlesByTimeframe[tf]` to
  `isClosed` candles before any node evaluates. A caller that mistakenly
  appends an unclosed/future candle cannot influence the result - this is
  structural (the filter runs first), not a convention strategies must
  remember, and it is covered by a test that appends a deliberately
  extreme "future" candle and asserts it has zero effect.
- **Unbounded nesting / huge expressions / unsupported timeframes**: all
  rejected by `validate.ts` before a definition is ever stored - see the
  limits table above and `dsl/validate.test.ts`.

### What the DSL does *not* do yet

Stop/target are a small closed set (`ATR_MULTIPLE`/`FIXED_PERCENT` for stop,
`R_MULTIPLE`/`FIXED_PERCENT` for target) - not a full expression language, and
not liquidity-pool-aware. Multi-timeframe evaluation is scoped to the
definition's primary (`timeframes[0]`) timeframe only; true cross-timeframe
rule evaluation is future work. Both are deliberate scope cuts for this
checkpoint, not oversights.

## 7. Strategy conflicts (`lib/strategy-platform/conflict.ts`)

Applied once per evaluation pass, after every enabled assignment has
produced its opportunities - never during evaluation, never by iteration
order. `resolveConflicts(opportunities, policy)` groups by `instrumentId`
and, within a group:

- **Same direction (or only one strategy signaled)**: all opportunities
  coexist, `executable` - portfolio sizing decides how many actually get
  taken; conflict resolution never silently picks a "winner" here.
- **Opposing directions, default policy (`BLOCK_OPPOSING_SIGNALS`)**: none
  become `executable`; both remain visible in `allOpportunities` - **never
  netted**. This is the conservative default called for explicitly.
- **`HIGHEST_PRIORITY`**: implemented - the single highest-`priority`
  opportunity wins; an exact tie blocks the whole group (a tie is itself
  an unresolved conflict, not a coin flip).
- **`PORTFOLIO_SELECTOR`**: throws `Error("...not implemented...")`
  rather than silently falling back to something else - it needs
  portfolio-wide risk state this checkpoint doesn't have.

## 8. Ownership, authorization, RLS

**Two layers, kept in sync deliberately** (the same pattern CLAUDE.md
already uses for the risk engine mirroring DB CHECK constraints):

1. **Database RLS** (`supabase/migrations/20260917000000_strategy_platform.sql`)
   - the real enforcement boundary.
2. **`lib/strategy-platform/authorization.ts`** - pure TS functions
   mirroring the same rules, used by future API routes and by this
   checkpoint's test suite (which, like the rest of this repo, does not
   run against live Postgres - see `lib/trading/*.test.ts` for the
   existing fake-store pattern this follows).

Rules (both layers):

- **Read**: `BUILT_IN` or `visibility = 'PUBLIC'` -> any authenticated
  user (including read-only guests). `USER_DEFINED` + `PRIVATE` -> owner
  only. A user can never read another user's private custom strategy.
- **Mutate a definition / create a version**: owner of a `USER_DEFINED`
  row, and never a guest. Built-in rows are never client-mutable (no
  insert/update policy grants `type = 'BUILT_IN'` to any authenticated
  role - only migrations/service-role code can seed them).
- **Version immutability**: see S5 - trigger + `assertVersionMutationAllowed`.
- **Configurations / assignments**: plain per-user ownership
  (`user_id = auth.uid()`), never a guest.
- **Execution mode**:
  - New assignments default to `RESEARCH`
    (`DEFAULT_ASSIGNMENT_MODE`). Never `PAPER`/`LIVE` by default.
  - `LIVE` has **no path** through `canSetAssignmentMode()` for any
    viewer/role, and a DB `CHECK (mode <> 'LIVE')` blocks it even if
    application code were bypassed entirely. This is an **additional**
    layer scoped to `strategy_assignments` - it does not replace or touch
    the three existing LIVE-disable layers CLAUDE.md names (the
    `system_settings` CHECK, the `trades`/`orders` CHECK, and
    `lib/risk/engine.ts`), which are untouched by this migration.
  - `PAPER` requires `paper_authorized_by` to be set, and a Postgres
    trigger (`strategy_assignments_protect_authorization`) - not RLS alone
    - is what actually stops a non-owner from setting that column, on
    insert or update, regardless of which RLS policy let the statement
    through. This was a deliberate fix during this checkpoint: an earlier
    two-policy RLS-only design would have also blocked a user from routine
    self-updates (toggling `enabled`) on their own already-authorized
    row; the trigger lets RLS stay a simple per-user CRUD policy while
    still making self-service PAPER authorization impossible.
- **Known limitation, stated rather than silently assumed**: the
  `strategy_assignments` RLS still requires `user_id = auth.uid()` for
  every write, including PAPER authorization - correct for today's
  single-owner app (the owner authorizes their own row), but a true
  multi-tenant flow where the owner authorizes a *different* user's
  assignment needs an additional RLS carve-out on top of the existing
  trigger. Not added here, since no second non-guest role/account exists
  yet.

## 9. Database migration

`supabase/migrations/20260917000000_strategy_platform.sql` - **additive
only, not yet applied to the live Supabase project** (schema changes to
shared infrastructure are treated as requiring explicit confirmation, and
this checkpoint's brief only asked for `typecheck`/`lint`/`test`/`build`,
not a live verification pass - see the final report for how to apply it
when ready).

New tables: `strategy_definitions`, `strategy_platform_versions`,
`strategy_configurations`, `strategy_assignments`. New enums:
`strategy_definition_type`, `strategy_platform_status`,
`strategy_assignment_mode`, `strategy_visibility`.

**Compatibility decision on the legacy `strategy_versions` table**
(existing since the original schema, used by V1's `signals`/`trades`/
`backtests`/`knowledge_documents` foreign keys): it is **not** touched,
renamed, or repointed. The new `strategy_platform_versions` table has a
deliberately different name and a different shape (explicit
definition/ownership model, immutability trigger) rather than overloading
the legacy one. A future adapter could map V1's single legacy row onto one
`strategy_definitions`/`strategy_platform_versions` pair purely for
discoverability in the registry; this checkpoint does not attempt that
mapping, since V1's actual execution never needs to go through it.

## 10. Future extensibility (not built now, not precluded)

- `StrategyVisibility` already has `PUBLIC`/`UNLISTED` alongside the
  default `PRIVATE`, and `strategy_definitions_select` RLS already honors
  it - so a later marketplace/sharing feature is additive (new UI +
  flipping a row's `visibility`), not a schema rework. No marketplace
  functionality is built now.
- `ConflictPolicy` already has 4 named values with 2 implemented -
  `PORTFOLIO_SELECTOR` is a clean extension point once portfolio-wide risk
  state exists.
- The DSL registry (`IMPLEMENTED_PRIMITIVES`/`FUTURE_PRIMITIVES`) is
  designed so JeanFX's own SMC/ICT primitives (FVG, swings, sweeps,
  BOS/MSS) can be promoted from "future" to "implemented" for user
  strategies later, independently of whether JeanFX's own built-in
  `evaluate()` (hardcoded, not DSL-based) uses the same or different code.

## 11. Tests

All under `lib/strategy-platform/` and `lib/indicators/sma.test.ts`
(the one new pure-function indicator this checkpoint added, needed by the
`SMA` DSL primitive):

- `registry.test.ts` - built-in registry completeness, no duplicate slugs,
  unknown-slug resolution, V1 not re-routed.
- `conflict.test.ts` - same-direction coexistence, opposing-signal
  blocking with no netting, order-independence, `HIGHEST_PRIORITY`
  resolution and tie-blocking, `PORTFOLIO_SELECTOR` failing loudly,
  per-instrument grouping.
- `authorization.test.ts` - definition read/mutate isolation (including
  guest exclusion and `PUBLIC` visibility), version immutability
  (allowed vs rejected field changes), configuration/assignment
  ownership isolation, default-RESEARCH, LIVE refused unconditionally
  for every role, no custom-strategy-creation path to LIVE, PAPER
  requires owner authorization, an already-authorized row survives a
  routine self-update.
- `dsl/validate.test.ts` - valid definitions accepted; unknown primitive
  rejected; future-looking primitives (FVG/BOS/MSS/SWING/
  LIQUIDITY_SWEEP/CANDLE_PATTERN) rejected distinctly; excessive
  depth/count/lookback/timeframes rejected; VALUE-vs-CONDITION position
  mismatches rejected.
- `dsl/evaluate.test.ts` - deterministic value/condition evaluation;
  division-by-zero and non-finite-value guards; insufficient-history
  guard; a deliberately-appended unclosed "future" candle proven to have
  zero effect; missing-market-data handling.
- `dsl/no-arbitrary-code.test.ts` - static regression guard: no
  `eval`/`Function`/`vm`/`child_process` anywhere under `dsl/`.

497/497 tests pass repo-wide (57 new), `npm run typecheck`, `npm run
lint` (only the two pre-existing non-blocking warnings already documented
in `docs/BUILD_STATE.md`), and `npm run build` all clean.

## 12. Safety carried forward unchanged

- V1 (`lib/strategy/v1/`, `lib/candidates/`, `app/api/jobs/scan/route.ts`)
  is untouched - byte-for-byte, not just behaviorally.
- The three existing LIVE-disable layers (system_settings CHECK,
  trades/orders CHECK, `lib/risk/engine.ts`) are untouched.
- PAPER's existing behavior (Telegram approval flow, position management)
  is untouched.
- This checkpoint adds a **fourth, new-table-scoped** LIVE-disable layer
  (`strategy_assignments_live_forbidden` CHECK) rather than modifying any
  of the three above.

## 13. Prompt 2 summary — JeanFX, the Strategy Builder, and a generic backtest engine

Everything below was added in Prompt 2, on top of the foundation in
sections 1-12 above, which stayed structurally unchanged (types, registry
shape, conflict policy, authorization, migration) except where noted.

### JeanFX is implemented and runs through the generic contract

`lib/strategy/jeanfx-v1/primitives/` (swings, equal-levels, sweep,
structure/BOS-MSS, FVG, candles, sessions, liquidity - each with its own
tests) plus `state-machine.ts` (`runJeanfxDirection()`) implement the full
sequence from `docs/strategies/jeanfx-v1-spec.md`. Wired into the platform
at `lib/strategy-platform/built-in/jeanfx-v1.ts` - the ONLY file where
JeanFX-specific code touches `lib/strategy-platform/`. Nothing in
`backtest.ts`, `dsl/`, `conflict.ts`, or `authorization.ts` knows JeanFX
exists; they only know `StrategyContract`.

### The DSL primitive library grew, using JeanFX's own primitives

`SWING_HIGH`/`SWING_LOW`/`BOS`/`LIQUIDITY_SWEEP`/`FVG`/`CANDLE_PATTERN`/
`ATR` moved from `FUTURE_PRIMITIVES` to `IMPLEMENTED_PRIMITIVES`
(`dsl/registry.ts`) - each one a thin `dsl/evaluate.ts` case that calls
the exact same function JeanFX's state machine calls
(`lib/strategy/jeanfx-v1/primitives/*`), never a second implementation.
`MSS` stays exclusive to JeanFX (it needs reversal-vs-prior-structure
context a stateless per-candle DSL condition can't cleanly express);
`OHLC` stays out as redundant with `PRICE(field)`.

### A DSL definition compiles into a real, runnable StrategyContract

`dsl/compile.ts` (`compileDslStrategy()`) validates once (at compile time,
mirroring "a version is validated once, then immutable") and returns a
`StrategyContract` whose `evaluate()` calls the same `evaluateDslEntry()`
the DSL's own tests exercise directly, plus one of a closed set of stop
builders (`FIXED_PERCENT`/`ATR_MULTIPLE`/`BELOW_SWING`/`ABOVE_SWING`/
`BELOW_SIGNAL_LOW`/`ABOVE_SIGNAL_HIGH`, LONG/SHORT-semantic-checked by
`validate.ts`) and target builders
(`R_MULTIPLE`/`FIXED_PERCENT`/`NEXT_SWING`/`NEXT_LIQUIDITY_POOL`). No new
execution path - no eval, no dynamic code, ever.

### One generic backtest engine, not two

`lib/strategy-platform/backtest.ts` (`runGenericBacktest()`) takes any
`StrategyContract` - built-in or DSL-compiled - plus historical candles
per timeframe, and steps through bar by bar: trims every timeframe to "as
of this bar" before calling `evaluate()` (no lookahead), enters no earlier
than the next bar's open, and reuses `evaluateTradeRisk()`/
`computePositionSizeFromBudget()` UNCHANGED for LONG sizing - the exact
math live PAPER trading uses (`computeMetrics()` in
`lib/backtest/metrics.ts` was loosened to a structural `Pick` type so both
V1's and the generic engine's trade records can share it, with zero
behavior change for V1). SHORT sizing is a separate, self-contained,
clearly-labeled research-only mirror of the same formulas - deliberately
NOT routed through the production (intentionally spot/long-only) risk
engine, which this checkpoint does not modify. Every trade carries a
`direction` so a SHORT backtest can never be mistaken for an executable
one. `buildWarnings()` emits neutral-language evidence-quality warnings
(too few trades, short history, high parameter count, in-sample only,
zero-cost assumption) - never "profitable strategy" from one run.

### Strategy Builder UI (first cut, not the final polish pass)

`/strategies` - built-in cards from the registry (JeanFX marked
Featured) plus the signed-in user's custom strategies (gracefully empty,
not a crash, if the migration below hasn't been applied to an
environment). `/strategies/new` - a single scrolling wizard (Basics,
Markets & Timeframes, a real visual ALL/ANY/NOT rule builder over the
actual `DslNode` tree via `dsl/editor-model.ts`, Stop, Target,
Preview/Validate with a plain-English summary from `dsl/describe.ts` and
a JSON export view) rather than 12 separate routed steps - "exit
conditions" and "risk compatibility" are folded into Stop/Target and the
validation panel, since the DSL has no separate exit-condition node type
yet. `/strategies/[slug]` - Overview/Rules/Versions/"Use this strategy"
tabs, working for both built-in and custom strategies off one
`strategy_definitions` lookup by slug. "Use this strategy" only ever
offers RESEARCH/SHADOW (`components/strategy-builder/use-strategy-form.tsx`
-> `POST /api/strategies/assign`); PAPER/LIVE are never in that form's
option list, matching the DB CHECK/trigger layer from section 8.

Known UI scope cuts, stated rather than hidden: no drag-and-drop (the rule
builder is add/remove/nest via buttons and selects, which is still fully
"visual, not JSON" per the brief); `NOT` only wraps a single leaf
condition in the editor, not an arbitrary subgroup (the underlying DSL
supports `NOT` around anything - `dsl/evaluate.ts` doesn't care - only the
UI's `editor-model.ts` scopes it this way); the generic backtest page is
not yet built as its own route - `runGenericBacktest()` exists and is
tested, but nothing in `app/` calls it yet for an arbitrary saved strategy
version. Mobile layout reuses this repo's existing Tailwind responsive
patterns (stacked flex/grid, `sm:`-gated multi-column) rather than a
dedicated mobile design pass.

### Import/export and templates

`import-export.ts`: JSON export/import gated by the exact same
`validateDslDefinition()` a freshly-authored strategy goes through -
`importDslDefinition()` only ever parses JSON (never executes it) and
`assertImportTargetSlugIsSafe()` refuses to let an import target a
built-in slug. `templates.ts`: three starter templates (EMA Trend, RSI
Pullback, Breakout), each a plain valid `DslDefinition`, clearly labeled,
with `cloneDefinition()` as the one primitive "duplicate as custom
strategy" / "duplicate JeanFX configuration" actually needs.

### Database: one more additive migration, not a rewrite

`supabase/migrations/20260918000000_strategy_platform_seed_built_ins.sql`
- additive, idempotent, seeds `strategy_definitions`/
`strategy_platform_versions` rows for `v1`/`jeanfx-v1`/`v2-trb` (a
built-in's `definition` column is a `{builtIn: true, slug}` pointer, never
DSL - its real logic stays in code) so "Use this strategy" has a real
`strategy_version_id` to point a configuration at for built-ins, the same
as for custom strategies. Like the Prompt 1 migration, **neither migration
has been applied to the live Supabase project** - see the final report for
how to apply both when ready. `app/api/strategies/route.ts` and
`app/api/strategies/assign/route.ts` follow this repo's existing mutation
convention (RLS-respecting server client, `isOwner()` gate, Zod body
validation) and cast the Supabase client for just these two new tables,
since `lib/supabase/database.types.ts` won't include them until it's
regenerated against the live schema post-migration.

### Tests added in Prompt 2

Per-primitive unit tests (`lib/strategy/jeanfx-v1/primitives/*.test.ts`);
`state-machine.test.ts` (LONG, SHORT as an exact mirror, bias mismatch,
flat-market no-signal, FVG invalidation, no-valid-target invalidation, no
lookahead via an appended absurd future candle); `built-in/jeanfx-v1.test.ts`;
DSL acceptance tests for every newly-implemented primitive plus their
validation-rejection cases; `dsl/compile.test.ts`; `backtest.test.ts`
(LONG trade generation with warnings, no-overlapping-positions, SHORT
symmetric stop/target, and the JeanFX built-in strategy running through
the identical `runGenericBacktest()` entry point as a compiled DSL
strategy); `templates.test.ts`; `import-export.test.ts` (including a
"sneaky" payload proving a string that looks like JS source is inert data,
never executed); `editor-model.test.ts` (UI state -> DSL -> validation
round trip); `describe.test.ts`.

## 14. Prompt 3 summary — orchestration, portfolio risk, conflicts, mode authorization

Everything below is new in Prompt 3, composed on top of sections 1-13
without changing the core `StrategyContract`/`Opportunity` shape except
additive fields (see "Attribution" below).

### The orchestrator (`lib/strategy-platform/orchestrator.ts`)

`runOrchestrator()` implements the exact pipeline the brief specifies:

```
assignments x instruments -> evaluations -> opportunities
  -> policy filtering (compatibility)
  -> risk (portfolio limits, same-instrument aggregation)
  -> conflict resolution (opposing directions)
  -> [caller's execution selection / execution - OUT OF SCOPE]
```

It never executes anything - there is no order-placement call anywhere in
the module, by construction, so "never execute while iterating" is
structurally true rather than merely a promise. It collects every
opportunity from every assignment/instrument cell first, then runs risk
and conflict resolution once over the whole collected set. Every internal
grouping step sorts its own keys before iterating (assignment IDs,
instrument IDs, `(instrumentId, side)` pairs), so shuffling the input
`assignments` or `instruments` arrays never changes the result - see
`orchestrator.test.ts` "determinism regardless of array order" and
`orchestrator.e2e.test.ts`.

### Attribution (Prompt 3 S3)

`Opportunity` (`types.ts`) gained `userId`, `strategyAssignmentId`, and
`parameterSnapshot` (the exact parameters the strategy was evaluated
with, frozen at signal time - a later configuration edit never rewrites
what an old signal says it used). Combined with the fields it already had
(`strategyDefinitionId`/`strategyVersionId`/`strategyConfigurationId`/
`featureSnapshot`/`reasonCodes`), every opportunity the orchestrator
produces is fully attributable back to exactly who/what produced it. This
attribution is NOT yet threaded into a persisted signals feed or trade
history - see "What's not wired to production" below.

### Market-data dedupe (`evaluation-plan.ts`, Prompt 3 S28)

`buildEvaluationPlan()` computes the distinct `(instrumentId, timeframe)`
pairs across every assignment x its instruments x its strategy's
`requiredTimeframes`. `loadMarketData()` calls the supplied
`MarketDataProvider` exactly once per distinct pair, however many
assignments need it - `orchestrator.test.ts` asserts a mock provider is
called exactly once when two different strategies both need BTCUSDT H1.
`distributeMarketData()` then does a pure in-memory lookup to build each
assignment's `StrategyContext.candlesByTimeframe` - no second fetch, ever.

### Compatibility (`compatibility.ts`, Prompt 3 S10)

`checkStrategyCompatibility()` separates RESEARCH compatibility (asset
class, side, minimum history) from EXECUTION compatibility (venue
capability - e.g. long-only spot). A SHORT JeanFX setup on a long-only
venue is `researchCompatible: true, executionCompatible: false` with the
reason spelled out verbatim: *"JeanFX Liquidity System SHORT setups cannot
currently execute on this venue because production execution here is
long-only. Research/backtesting is still available."* The orchestrator
routes execution-incompatible opportunities to `researchOnly` regardless
of the assignment's own mode, since they could never execute anyway.

### Same-instrument aggregation + portfolio risk (`portfolio-risk.ts`, Prompt 3 S4/S5)

`applyPortfolioRisk()` groups same-instrument/same-direction opportunities
into one `PositionIntent` (JeanFX LONG ETH + TRB LONG ETH -> one ETH LONG
intent, combined risk, both opportunities preserved in
`contributingOpportunities` for attribution) and enforces, in order: the
instrument risk cap on the combined intent, a correlation-group cap (see
below), per-strategy risk cap, per-strategy position cap, total position
cap (deterministic acceptance order), then total open risk and
per-asset-class exposure caps. Every rejection carries a reason
(`INSTRUMENT_RISK_CAP`, `STRATEGY_RISK_CAP`, `TOTAL_POSITION_CAP`, etc.) -
nothing is silently dropped.

**Correlation is honestly NOT modeled as solved** (Prompt 3 S4 explicit
instruction): `CorrelationPolicy` is an architecture hook -
`NO_CORRELATION_MODELING` (the default) treats every instrument as its own
group, so `maxCorrelatedExposurePct` has no effect beyond the per-
instrument cap unless a caller supplies a real grouping (e.g. "BTC and ETH
are correlated") - tested explicitly in `portfolio-risk.test.ts` showing
both the no-op default and a real grouping actually capping combined
exposure.

### Opposing-direction conflicts (`conflict.ts`, unchanged from Prompt 1)

Runs AFTER portfolio risk, on whatever survived it. The conservative
default (`BLOCK_OPPOSING_SIGNALS` - functionally identical to what the
brief calls `BLOCK_CONFLICTING_DIRECTION`, kept under its original name to
avoid churning already-tested Prompt 1 code) blocks BOTH sides of an
opposing pair from `executable`, while every opportunity - both sides -
remains in the orchestrator's `researchOnly`/`shadowed`/`blocked` output
for analytics. Nothing is netted.

### Mode authorization - less permissive always wins (`authorization.ts`, Prompt 3 S8)

`resolveEffectiveMode(requestedMode, systemAuthorizedMode)` ranks
`RESEARCH < SHADOW < PAPER < LIVE` and returns whichever side is LESS
permissive. `AssignmentInput.effectiveMode` (the orchestrator's input) is
expected to already be this resolved value - the orchestrator does not
re-derive authorization itself, but it DOES refuse an `effectiveMode` of
`LIVE` unconditionally as one more layer of defense in depth, logging an
`EvaluationError` rather than silently accepting it, since `LIVE` should
be structurally unreachable in this codebase regardless.

### Failure isolation (Prompt 3 S30)

Each `(assignment, instrument)` cell's `strategy.evaluate()` call is
wrapped in its own `try/catch` inside the orchestrator's loop. A throwing
custom strategy produces one `EvaluationError` scoped to that cell
(`strategyAssignmentId`, `strategyDefinitionId`, `instrumentId`, message)
and the loop continues - every other assignment (JeanFX, TRB, other
users, other instruments) still evaluates normally in the same run. Tested
directly in `orchestrator.test.ts`.

### Observability (`ScanObservability`, Prompt 3 S29)

One aggregate-counts object per orchestrator run (`assignmentsEvaluated`,
`strategyEvaluations`, `instrumentsEvaluated`, `opportunitiesGenerated`,
`conflicts`, `riskRejected`, `executed`, `shadowed`, plus a
`byStrategy` breakdown keyed by `strategyDefinitionId`) - never one record
per no-op rule evaluation, which would flood the DB/logs for no benefit.

### AI assistant boundary (`ai-assistant.ts`, Prompt 3 S24/S25)

A CONTRACT, not a live integration - no LLM provider is called anywhere in
this file. `AiDslProposal` is always `status: "DRAFT"`; `reviewAiProposal()`
is the only door a proposal can pass through, and it runs the identical
`validateDslDefinition()` a human-authored strategy goes through - no
separate, looser "AI path" exists. `AI_ASSISTANT_BOUNDARY` documents the
allowed/forbidden action lists as data, and a test
(`ai-assistant.test.ts`) asserts the module exports nothing named after any
forbidden capability (`activatePaper`, `activateLive`, etc.) - the boundary
is checked, not just claimed.

### RLS audit findings and fixes (Prompt 3 S26/S27)

Auditing `app/api/strategies/*` and the Prompt 1/2 migrations found two
real foreign-key-level authorization gaps: `strategy_configurations` could
be inserted referencing another user's private `strategy_version_id`
(only row ownership was checked, not the referenced version's
readability), and the same class of gap existed for
`strategy_assignments` -> `strategy_configuration_id`. Both are fixed in
`supabase/migrations/20260919000000_strategy_platform_configuration_version_check.sql`
(additive RLS policy replacement, constrains each foreign key to rows the
inserting/updating user can actually read) plus a matching app-layer check
in `app/api/strategies/assign/route.ts` (`canReadDefinition()`) that
returns a clear 403 before ever attempting the insert. Every mutation
route resolves identity exclusively from the authenticated session
(`supabase.auth.getUser()`) - client-supplied `userId`, `mode` beyond
`RESEARCH`/`SHADOW`, or `owner_user_id` are never trusted; the `mode`
field in every request schema is a Zod enum that structurally cannot
contain `"PAPER"` or `"LIVE"` for `POST /api/strategies/assign`, and
`PATCH /api/strategies/assignments/[id]` (new in Prompt 3, backs Settings
-> Strategies) has the identical restriction. Both routes also apply
`isOwner()` /`eq("user_id", user.id)` explicitly as defense in depth on
top of RLS, not instead of it.

### Settings → Strategies (`/settings/strategies`, Prompt 3 S15)

Lists the signed-in user's assignments (strategy name, configuration,
markets, priority, mode, enabled) with inline enable/disable and a
RESEARCH<->SHADOW mode switch. PAPER is displayed but never offered as a
switchable option from this screen - it requires the separate owner-
authorization step from Prompt 1/2's trigger-enforced model, which this
UI does not attempt to add a path around.

### What's NOT wired to production (stated plainly, not hidden)

- `runOrchestrator()` is a complete, tested, standalone module. **It is
  not called from `app/api/jobs/scan/route.ts`** - the live scan job still
  runs V1's own dedicated pipeline exactly as before. Prompt 3 S33
  explicitly says not to migrate the active PAPER experiment into the new
  orchestration mid-window, so this is intentional, not an oversight: the
  orchestrator is ready to be invoked by a future research/shadow job
  once that's explicitly approved.
- There is consequently no persisted "signals" feed row for a JeanFX or
  custom-strategy opportunity yet, and no trade-history entry either -
  attribution exists end-to-end on the `Opportunity` type and is proven in
  tests, but nothing writes an `Opportunity` to a database table in this
  checkpoint. A signal feed UI showing "JeanFX Liquidity System / ETH/USDT
  / LONG / liquidity sweep -> bullish BOS -> FVG retrace" per Prompt 3 S16
  needs that persistence layer built first.
- Multi-strategy analytics (PnL/expectancy/profit factor by strategy,
  Prompt 3 S17/S18) has the same dependency - there is nothing to
  aggregate until opportunities/trades are persisted with attribution.
- Strategy health status values (Prompt 3 S19: `ACTIVE`, `DISABLED`,
  `INSUFFICIENT_HISTORY`, etc.) are producible today from
  `OrchestratorResult.incompatible`/`errors`, but no page surfaces them yet.
- A user strategy audit log (Prompt 3 S20 - who/what/when/old-new for
  created/versioned/configured/assigned/archived) is not implemented; the
  four Prompt 1/2 migrations' `created_at`/`created_by` columns are the
  only audit trail that exists today.
- The `docs/strategies/README.md` catalog page content and
  `docs/user-strategies.md` are new in this checkpoint (see the repo root)
  and describe the end-to-end user story; they are documentation, not new
  UI surfaces beyond what's listed above.
