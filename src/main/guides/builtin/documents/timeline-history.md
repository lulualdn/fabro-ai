---
name: documents/timeline-history
title: Timeline / history piece
when: a chronology, history of a place/company/person, biography or timeline to print or present
keywords: timeline, frise chronologique, frise, chronologie, chronology, history, histoire, historique, biography, biographie, dates, evolution, retrospective, anniversaire d entreprise, heritage, patrimoine, epoque, siecle
---
# Timeline / history piece

A timeline turns dates into a story. Show the rhythm of time — gaps, accelerations, turning points — not just a list.

## Decide first
- Span and density: 10 events over a year, or 40 events over two centuries?
- The story's turning points (two or three). They get the most space.
- Orientation: vertical (reads well on A4 and phones) or horizontal (a landscape frieze, good for school).

## Pick a structure
1. **Vertical spine**: a line down the page, dates on the left, events on the right.
2. **Alternating**: events left and right of a central line (more visual, more space).
3. **Horizontal frieze**: landscape page, a scaled axis, events above and below.
4. **Eras**: coloured bands for periods, events placed inside.
5. **Chapters**: one page per era, a big year as the opener, a few key events.

## Build it
1. Scale matters for friezes: place events proportionally to time (`left: (year - start) / (end - start) * 100%`).
2. Each event: date (bold, tabular), title, one or two lines, optional small image.
3. Turning points: larger card, an image, the accent colour.
4. Eras: tinted background bands with a label.

## Techniques
```css
.tl { position: relative; padding-left: 28mm; }
.tl::before { content: ""; position: absolute; left: 22mm; top: 0; bottom: 0; width: 1pt; background: var(--ink); }
.ev { position: relative; margin-bottom: 5mm; break-inside: avoid; }
.ev time { position: absolute; left: -28mm; width: 19mm; text-align: right; font: 700 10pt var(--sans); font-variant-numeric: tabular-nums; }
.ev::before { content: ""; position: absolute; left: -7.4mm; top: 1.5mm; width: 2.8mm; height: 2.8mm; border-radius: 50%; background: var(--accent); }
```
- Mark gaps in time visibly ("… 40 years later") with a dashed segment.
- Use real dates only; if unsure, say "c. 1850".

## Make it distinctive
Let the era dress it: archival sepia and serif for old history, the brand's palette for a company's anniversary, a transit-map style (coloured line, station dots) for a journey.

## Avoid
- Every event the same weight.
- Dates evenly spaced on a frieze when time is not.
- Unsourced or invented dates.

## Self-check
1. Do the turning points stand out?
2. Are dates correct and consistent in format?
3. Does spacing reflect time where it matters?
4. Readable at print size?
5. Does the style suit the period?
