---
name: technique/print-css
title: Print CSS and page breaks
when: any document that will be printed or exported to PDF and must break into pages cleanly
keywords: print, pdf, a4, page break, saut de page, imprimer, impression, marges, margins, @page, en-tete, header, footer, pied de page, orphans, widows, pagination
---
# Print CSS and page breaks

A printed page is a fixed rectangle. Your job is to decide where content breaks, not to let the printer decide.

## Decide first
- Paper: A4 portrait unless asked (A5 for booklets, landscape for certificates and wide tables).
- Flowing or fixed? Flowing text (reports, essays) runs over as many pages as needed. Fixed sheets (poster, CV, menu) are one page each and must never spill.

## Build it
1. Set the page once, at the top of your CSS:
```css
@page { size: A4; margin: 18mm 16mm 20mm; }
@page :first { margin-top: 0; } /* a full-bleed cover */
```
2. Use real units for print: `mm`, `pt`. Body text 10–11.5pt, line-height 1.4–1.55.
3. Start each big part on a new page: `h2.chapter { break-before: page; }`.
4. Keep things together: `figure, table, .card { break-inside: avoid; }` and `h2, h3 { break-after: avoid; }`.
5. Stop lonely lines: `p { orphans: 3; widows: 3; }`.

## Techniques
- **Fixed sheet**: a box exactly the size of the paper. Pair it with `@page { margin: 0 }`.
```css
.sheet { width: 210mm; height: 297mm; padding: 16mm; overflow: hidden; break-after: page; }
```
- **Running footer** without JavaScript: repeat a small `<footer>` at the bottom of each fixed sheet (`position:absolute; bottom:10mm`). For flowing text, put the title and date in the footer of the cover only; do not fake page numbers.
- **Colours survive print**: backgrounds print because Fabro sets `print-color-adjust: exact`, but large dark areas waste ink; keep them for covers.
- **Screen vs print**: `@media print { nav, button { display: none } }` for anything interactive.

## Avoid
- Heights in `vh` or `px` for sheets (use `mm`).
- A last page holding two lines: tighten spacing or cut a sentence.
- `position: fixed` (it repeats unpredictably).

## Self-check
1. Does every fixed sheet fit, with nothing cut at the bottom?
2. Does each chapter start where you want it?
3. No heading alone at the bottom of a page?
4. No nearly empty last page?
5. Text at least 9pt everywhere?
