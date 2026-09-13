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

## Status
UI build starts in Phase 9. This document will be extended with concrete
component names (`MetricCard`, `SetupScore`, etc.) as they're implemented.
