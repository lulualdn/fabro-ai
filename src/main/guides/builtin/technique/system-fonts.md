---
name: technique/system-fonts
title: Typography with system fonts
when: choosing fonts and sizes for any page, document or slide without downloading web fonts
keywords: typography, typographie, font, fonts, police, polices, typeface, serif, sans serif, font pairing, taille de texte, font size, lisibilite, readability, hierarchy, hierarchie, titres
---
# Typography with system fonts

Fabro pages work offline, so build type from fonts already on the computer. Good typography is mostly size, weight, spacing and contrast — not exotic fonts.

## Decide first
- The voice of the subject: institutional, warm, technical, playful, literary?
- One family or two? Two at most: one for headings, one for text.

## Font stacks that work everywhere
```css
--serif: Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif;
--sans: system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--grotesk: "Avenir Next", Avenir, Montserrat, Corbel, "URW Gothic", sans-serif;
--mono: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
--slab: Rockwell, "Roboto Slab", "DejaVu Serif", Georgia, serif;
--didone: Didot, "Bodoni MT", "Noto Serif Display", Georgia, serif;
```
Pick pairings from the subject, for example:
- Law firm, report, letter: serif headings + serif text, generous leading.
- Startup, product, dashboard: sans everywhere, weights 400/600/800.
- Fashion, wine, luxury: didone headings in large sizes + sans text.
- Workshop, food truck, kids: slab or grotesk headings, heavy weight.
- Code, tech docs: sans text + mono for code and numbers.

## Build a scale
Choose a ratio (1.2 calm, 1.333 classic, 1.5 dramatic) and stick to it:
```css
h1 { font-size: clamp(2.2rem, 5vw, 3.6rem); line-height: 1.05; letter-spacing: -0.02em; }
h2 { font-size: 1.6rem; line-height: 1.2; }
p  { font-size: 1.05rem; line-height: 1.6; max-width: 66ch; }
```

## Techniques
- **Contrast of weight**: a 800 heading next to 400 text reads better than two sizes that are close.
- **Small caps labels**: `font-size:.75rem; letter-spacing:.12em; text-transform:uppercase` for eyebrows, table headers, dates.
- **Numbers**: `font-variant-numeric: tabular-nums` in tables and prices.
- **Measure**: 50–75 characters per line for reading text.

## Avoid
- More than two families, or more than three weights.
- Centred paragraphs longer than three lines.
- Body text under 15px on screen or 9pt in print.
- Light grey text on white.

## Self-check
1. Can you tell h1, h2 and text apart from across the room?
2. Do the fonts suit this subject, not "any website"?
3. Lines no longer than about 75 characters?
4. Numbers aligned in tables?
5. Only one or two families?
