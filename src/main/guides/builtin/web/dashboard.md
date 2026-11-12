---
name: web/dashboard
title: Dashboard
when: a dashboard, admin screen, analytics or monitoring page showing key numbers, charts and tables
keywords: dashboard, tableau de bord, analytics, statistiques, statistics, admin, back office, monitoring, suivi, kpi, indicateurs, reporting, metrics, metriques, graphiques, charts, donnees, data, panneau, console
---
# Dashboard

A dashboard answers "how are we doing, and what needs attention?" in one look. It is a tool used daily; calm and dense beats flashy.

## Decide first
- The 3–5 numbers the user checks every day. Those are the top row.
- What needs action: alerts, late items, outliers. They get the strongest visual signal.
- Time period and comparison (today vs yesterday, month vs last month).

## Build it
1. **Top bar**: title, period selector, last update time.
2. **KPI row**: each card = label, big number, delta with arrow and colour + words ("+12 % vs Oct").
3. **Main chart**: the most important trend, wide.
4. **Secondary charts** in a grid: breakdowns, shares.
5. **Detail table**: sortable rows, status chips, search.
6. **Alerts / to-do** panel if there are actions.

## Techniques
```css
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.kpi .n { font: 700 2rem/1.1 var(--sans); font-variant-numeric: tabular-nums; }
.delta.up { color: var(--good); } .delta.down { color: var(--bad); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
```
- **Charts in inline SVG** (technique/svg-charts), or Chart.js via `find_library` for interactivity.
- **Sparklines** inside KPI cards: a 100×24 polyline.
- **Status colours** reserved for meaning (good/warning/bad), never decoration; always with a word.
- **Interactivity**: period buttons swap data from a JS object; table sort on header click.
- Data: use the user's numbers, or plausible example data clearly labelled as sample.

## Make it distinctive
A dashboard about trains can use a timetable aesthetic (mono figures, yellow on dark); one about a bakery, a warm light ground with flour and crust tones. Dark mode suits monitoring screens (technique/dark-mode).

## Avoid
- Twelve KPI cards, gauges, 3D charts, rainbow series.
- Numbers without period or comparison.
- Decorative gradients on cards.

## Self-check
1. Are the daily numbers in the first row?
2. Is anything needing attention obvious?
3. Every number has a label, unit and period?
4. Charts consistent in colour meaning?
5. Usable on a laptop screen without scrolling to see the KPIs?
