---
name: technique/tables
title: Tables that read well
when: presenting numbers, prices, schedules or comparisons in rows and columns
keywords: table, tables, tableau, tableaux, colonnes, lignes, rows, data, donnees, chiffres, numbers, comparatif, comparison, prix, prices, horaires, schedule, planning
---
# Tables that read well

A table is for looking things up and comparing. Design for the eye moving along a row and down a column.

## Decide first
- What does the reader look up? That column goes first (the item, the date, the name).
- What do they compare? Put comparable numbers in adjacent columns, same units, same decimals.
- Could it be shorter? Remove columns nobody needs; round numbers.

## Build it
1. Use real table markup: `<table>`, `<thead>`, `<th scope="col">`, `<tbody>`, and `<caption>` for the title.
2. Align text left, numbers right, and keep numbers tabular:
```css
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: .55em .8em; text-align: left; vertical-align: top; }
td.num, th.num { text-align: right; }
thead th { font-size: .78em; letter-spacing: .06em; text-transform: uppercase; border-bottom: 2px solid currentColor; }
tbody tr + tr td { border-top: 1px solid rgb(0 0 0 / .1); }
```
3. Put units in the header ("Price (€)"), not in every cell.
4. Add a total row with a stronger rule above it.

## Techniques — choose one emphasis
- **Hairlines only**: horizontal rules, no vertical lines, no boxes. Calm and editorial.
- **Zebra**: very light alternate rows for wide tables (`tbody tr:nth-child(even) { background: … }`).
- **Highlight the answer**: the recommended option or the best value gets a tinted column or bold.
- **Inline bars**: a thin bar in the cell shows magnitude: `<span style="display:inline-block;width:62%;height:6px;background:var(--accent)"></span>`.

## On phones and paper
- Wide tables on phones: wrap in `<div style="overflow-x:auto">`, or turn each row into a card below 600px.
- In print: `tr { break-inside: avoid; }` and repeat `<thead>` (browsers repeat it on each page).

## Avoid
- Borders around every cell, centred numbers, mixed decimals.
- Colour on every row.
- Tables used for page layout.

## Self-check
1. Do numbers line up on the decimal point?
2. Is the first column the thing people look up?
3. Are units in the headers?
4. Is there one clear emphasis, not five?
5. Does it work on a 390px phone?
