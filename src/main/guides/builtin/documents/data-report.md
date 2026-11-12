---
name: documents/data-report
title: Data report with hand-drawn SVG charts
when: a report built around numbers: survey results, sales, statistics, monitoring, with several charts
keywords: data report, rapport chiffre, rapport de donnees, statistics report, statistiques, resultats d enquete, survey results, sondage, kpi, indicateurs, tableau de bord pdf, chiffres cles, analyse de donnees, ventes, sales report, graphiques, charts
---
# Data report with hand-drawn SVG charts

Numbers do not speak for themselves. Each chart in a data report states a finding, and the page order builds an argument.

## Decide first
- The three findings that matter most. Write each as a sentence.
- For each finding, the chart form that proves it (technique/svg-charts): comparison → bars, trend → line, share → stacked bar or donut, distribution → dot strip.
- The source and date of the data, and the sample size for surveys.

## Build it
1. **Cover or title block** with the period covered.
2. **Key figures band**: three to five numbers, each with a label and a comparison (vs last year, vs target).
3. **Finding pages**: headline = the finding; chart; two or three lines of interpretation; the data table below or in the annex.
4. **Method note**: source, sample, definitions, caveats.
5. **Annex tables** with all numbers.

## Techniques
- **Compute before drawing**: write the values, the max, the scale factor, then the coordinates. Double-check one bar by hand.
- **Consistent chart system**: same fonts, same colours, same axis style on every chart; the accent always means "this year" or "the focus".
- **Direct labels** at the end of lines and on top of bars; no legends when possible.
- **Small multiples**: the same small chart repeated per region or category, same scale, in a grid.
```css
.kpi .n { font: 800 26pt/1 var(--sans); font-variant-numeric: tabular-nums; }
.kpi .delta.up { color: #2f7d4f; } .kpi .delta.down { color: #b23a2a; }
figure.chart { break-inside: avoid; margin: 0 0 6mm; }
figure.chart figcaption { font-size: 8.5pt; color: var(--muted); } /* source line */
```

## Make it distinctive
The palette comes from the subject (water → blues and a sand accent; elections → neutral greys plus one colour per party only when necessary). Pick one display treatment for numbers — huge thin digits, or compact bold ones — and apply it everywhere.

## Avoid
- Charts without a finding in the title.
- Rainbow palettes, 3D, dual axes.
- Percentages that do not add up to 100 without explanation.
- Numbers that differ between text, chart and table.

## Self-check
1. Does each chart title state a finding?
2. Do drawn shapes match the numbers?
3. Is the source shown for every chart?
4. Same chart style throughout?
5. Key figures consistent with the details?
