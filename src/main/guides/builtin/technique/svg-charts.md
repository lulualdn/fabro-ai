---
name: technique/svg-charts
title: Charts drawn by hand in SVG
when: showing a few numbers as a bar, line, donut or dot chart without any library, on screen or in print
keywords: chart, charts, graph, graphique, graphiques, courbe, histogramme, barres, bar chart, line chart, camembert, donut, pie, diagramme, statistiques, statistics, data, donnees, svg chart, dataviz
---
# Charts drawn by hand in SVG

For a handful of numbers an inline SVG chart is lighter than a library, prints sharply and looks exactly as you decide.

## Decide first
- The one sentence the chart proves ("sales doubled after June"). Put it as the chart title.
- The form: comparing categories → bars; change over time → line; parts of a whole (2–5 parts) → donut or a stacked bar; ranking → horizontal bars sorted.

## Build it — compute, then draw
Pick a viewBox (e.g. 600×300), a plot area with margins, and map values to pixels yourself: `y = bottom - value / max * height`.
Bars (values 12, 30, 22, max 30, plot height 200, bottom 250):
```html
<svg viewBox="0 0 600 300" role="img" aria-label="Sales by quarter">
  <g fill="var(--accent)">
    <rect x="80"  y="170" width="80" height="80"/>
    <rect x="240" y="50"  width="80" height="200"/>
    <rect x="400" y="103" width="80" height="147"/>
  </g>
  <line x1="60" y1="250" x2="560" y2="250" stroke="currentColor" stroke-opacity=".3"/>
  <g font-size="14" text-anchor="middle" fill="currentColor">
    <text x="120" y="272">Q1</text><text x="280" y="272">Q2</text><text x="440" y="272">Q3</text>
    <text x="280" y="40" font-weight="700">30</text>
  </g>
</svg>
```
Line: one `<polyline points="x1,y1 x2,y2 …" fill="none" stroke-width="3">`, plus a dot and label on the last point.
Donut: a circle with `stroke-dasharray="share*C C"` where C = 2πr; rotate -90° so it starts at the top.

## Techniques
- **Label directly** instead of a legend: the series name at the end of its line, the value on top of its bar.
- **One highlight**: the bar that matters in the accent, the others in a muted tone.
- **Few gridlines**: two or three faint lines, or none when values are labelled.
- Check your arithmetic: each bar height must match its value.

## Avoid
- 3D, shadows, rainbow colours, pie charts with 8 slices.
- Axis not starting at zero for bars.
- Tiny labels: at least 12px at the final size.

## Self-check
1. Does the title state what the chart shows?
2. Do bar heights or points match the numbers?
3. Is the important value highlighted and labelled?
4. Readable when printed in greyscale?
5. Has `role="img"` and an `aria-label`?
