---
name: documents/decision-memo
title: Comparison / decision memo
when: a memo that compares options and recommends one: choosing a supplier, a tool, a plan, a purchase
keywords: decision memo, note de decision, comparison, comparatif, comparaison, benchmark, options, choix, choose, recommandation, recommendation, avantages inconvenients, pros and cons, pour et contre, matrice de decision, decision matrix, arbitrage
---
# Comparison / decision memo

The memo's job is to make a choice easy and defensible. Lead with the recommendation, then show the comparison that justifies it.

## Decide first
- The decision to make and the deadline.
- Two to four real options (including "do nothing" if relevant).
- Criteria, weighted by what matters to this reader (cost, time, risk, quality, effort).

## Build it
1. **Header**: To, From, Date, Subject ("Decision: choice of print supplier").
2. **Recommendation** in two lines at the top, with the main reason.
3. **Options** summarised in one line each.
4. **Comparison table**: criteria as rows, options as columns, with values (prices, delays) not just ticks.
5. **Trade-offs**: what we lose with the recommended option, honestly.
6. **Next steps** if approved: actions, owners, dates.

## Techniques
- **Highlighted column** for the recommended option:
```css
.cmp td:nth-child(3), .cmp th:nth-child(3) { background: color-mix(in srgb, var(--accent) 10%, white); }
.cmp th[scope=row] { text-align: left; font-weight: 600; }
.cmp td { text-align: center; font-variant-numeric: tabular-nums; }
```
- **Scores with meaning**: ●●●○○ or 3/5, with a legend; or better, the real values.
- **Weighted total** row, showing the weights in the row headers.
- **Pros/cons pairs** in two short columns under each option when the table cannot capture nuance.

## Pick a form
- Table-led (many criteria), card-led (2–3 options with rich descriptions side by side), or prose-led (two options, a nuanced argument).

## Make it fit
A memo is internal and quick: one page, sober sans, one accent for the recommended option. No cover.

## Avoid
- Burying the recommendation at the end.
- Strawman options nobody would choose.
- Criteria invented to favour the answer.

## Self-check
1. Is the recommendation in the first three lines?
2. Do the options get comparable data on the same criteria?
3. Is the recommended option visually marked?
4. Are trade-offs stated?
5. Is the next step clear?
