# UI System

## Component strategy
- shadcn/ui (Base UI primitives) for every solved UI primitive — sidebar,
  dialogs, sheets, dropdowns, command palette, tables, forms, tooltips, etc.
  Never hand-rolled.
- TanStack Table + shadcn Data Table patterns for signals/trades/orders/
  backtests/audit/knowledge/job-history tables.
- Recharts + shadcn Chart wrapper for analytical charts (equity, drawdown,
  P/L breakdowns).
- TradingView `lightweight-charts` (v5 API) for candlestick charts with
  entry/exit/stop/target markers and EMA overlays.
- lucide-react for icons, used sparingly and consistently.

## Design tokens
Defined as CSS variables via shadcn's `app/globals.css` (Tailwind v4
`@theme`). Semantic status colors layered on top of the shadcn neutral base:
- `--positive` (profit/win) → green
- `--negative` (loss/critical) → red
- `--warning` → amber
- `--info` → blue
- neutral/muted → slate, used for the majority of the UI (financial colors
  are accents, not backgrounds).
Dark mode and light mode both fully defined; dark is the primary target given
this is a trading dashboard.

## Layout
Desktop: persistent sidebar (shadcn Sidebar) + top contextual header (mode
badge, scanner health, theme toggle, command palette trigger) + multi-column
grids. Tablet: collapsible sidebar. Mobile: sheet-based nav, single column,
priority content first (mode, equity, open positions, latest signal).

## Language
Factual, non-promotional (spec #84/85): "Candidate setup," "No valid setup,"
"Risk limit reached," "Paper trade," never "guaranteed," "safe trade," or
enthusiastic marketing copy. No sparkle icons, no robot imagery, no fake
confidence gauges.

## Command center implementation (Milestone 5)

- **Davinki Trading** is the product name in the application shell and page
  metadata. Geist Sans is the interface font and Geist Mono is reserved for
  prices, P/L, timestamps, quantities, and other tabular data.
- The terminal uses compact neutral surfaces, one restrained blue information
  accent, and semantic positive/negative/warning states. Dark mode is the
  default, while both token sets maintain the same hierarchy.
- The shared shell consists of AppSidebar, DashboardHeader, ModeBadge,
  SystemStatusBadge, MetricCard, and EmptyState. It stays server-first; only
  small table filtering and decision controls are client components.
- /dashboard is the operations overview: status strip, account/risk metrics,
  current action, $50 growth-experiment context, market state, news context,
  activity, learning evidence, and the V1 DRAFT gate.
- /candidates is the qualified-setup workspace, with state filters, text
  filtering, compact desktop table, mobile cards, review links, and existing
  owner-only approval/rejection actions. /signals remains the broader
  closed-candle evaluation history.
- /positions separates open PAPER positions, pending approvals, and recent
  closures. /trades is responsive history with fees, R, exit reason, and
  mobile summaries.

All metrics, timelines, statuses, and empty states are backed by persisted
data. The UI never manufactures balances, candidate setups, P/L, health, news,
or research evidence. Strategy V1 remains DRAFT and there is no UI path to
activate LIVE trading.
