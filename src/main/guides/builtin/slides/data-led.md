---
name: slides/data-led
title: Data-led deck
when: a deck that presents data and analysis: survey results, statistics, research findings, market analysis, KPI review
keywords: data, donnees, chiffres, statistiques, statistics, survey, enquete, sondage, analysis, analyse, research findings, resultats de recherche, market analysis, etude de marche, kpi, metrics, charts, graphiques, dataviz, infographie
---
# Data-led deck

Each slide shows one finding with the simplest chart that proves it. The audience should read the finding in the title before looking at the chart.

## Decide first
- The 5–8 findings that matter, written as sentences.
- For each, the form (technique/svg-charts): comparison → bars, trend → line, share → stacked bar, relation → scatter.
- Data source, period and sample size for a method slide.

## Build it
1. **Title slide** and **headline findings** slide (three numbers).
2. **One finding per slide**: title = the finding, a large chart, a one-line takeaway or the "so what".
3. **Method slide**: source, sample, dates, definitions.
4. **Implications** slide: what we should do.
5. **Appendix**: detailed tables.

## Techniques
- **Chart sized for the room**: labels at least 20px, lines 4px, bars generous.
- **Highlight one series or bar** in the accent; everything else muted grey.
- **Annotate** the chart: an arrow and a short label at the key point ("Launch of the app").
- **Big number slides** for single statistics, with the comparison under it.
- **Consistent axes** across slides that should be compared.
```css
.slide.chart { display: grid; grid-template-rows: auto 1fr auto; padding: 56px 72px; }
.slide.chart svg { width: 100%; height: 100%; }
.slide.chart .so { font-size: 26px; color: var(--muted); }
```
- Compute coordinates carefully: bars proportional to values, axis from zero.

## Make it distinctive
Colour from the subject (health → a clinical teal with a warm alert colour; energy → amber and charcoal). One typographic treatment for numbers used everywhere.

## Avoid
- Titles like "Results" or "Chart 3".
- Legends far from data, rainbow series, 3D.
- Tables of numbers as the main visual.

## Self-check
1. Does every chart title state a finding?
2. Are shapes proportional to the data?
3. Is the highlight on what matters?
4. Labels readable at the back of the room?
5. Source and method shown?
