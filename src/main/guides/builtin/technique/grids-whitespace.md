---
name: technique/grids-whitespace
title: Grids and whitespace
when: laying out any page so it looks deliberate; deciding columns, margins and spacing
keywords: grid, grille, layout, mise en page, colonnes, columns, whitespace, espace, espacement, spacing, margins, marges, alignment, alignement, composition, balance, equilibre
---
# Grids and whitespace

Amateur layouts put things where there is room. Designed layouts put things on a grid and leave space on purpose.

## Decide first
- How many columns does the content need? Text: 1. Text + aside: 2 unequal. Cards or products: 3–4.
- One spacing unit. Everything is a multiple of it (8px on screen, 4mm on paper).

## Build it
1. Define the unit and use it everywhere:
```css
:root { --u: 8px; }
section { padding: calc(var(--u) * 12) 0; }
.stack > * + * { margin-top: calc(var(--u) * 2); }
```
2. Set a content width and centre it: `max-width: 1120px; margin-inline: auto; padding-inline: 24px;`
3. Lay out with CSS grid. A 12-column grid lets you vary spans:
```css
.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 24px; }
.main { grid-column: span 8; } .aside { grid-column: span 4; }
```
4. Group related things close together, separate groups with more space (proximity is the strongest signal).

## Techniques — pick what fits
- **Asymmetry**: a 7/5 or 8/4 split feels more designed than 6/6.
- **Hanging labels**: a narrow left column holds dates or section names; text aligns on one strong vertical line.
- **Breathing room around the hero**: the most important thing gets the most empty space around it.
- **Rhythm**: alternate dense and airy sections; a full-width band between two narrow ones.

## Make it yours
Break the grid once, deliberately: an image that bleeds to the edge, a giant number crossing two columns, a pull-quote in the margin. One break is a signature; five is chaos.

## Avoid
- Random gaps (13px here, 22px there).
- Everything centred.
- Boxes inside boxes inside boxes; use space instead of borders.
- Content touching the edges of the screen or paper.

## Self-check
1. Do left edges line up down the page?
2. Is all spacing a multiple of one unit?
3. Is the most important element surrounded by the most space?
4. Can you name the grid you used?
5. Is there exactly one deliberate break of the grid, or none?
