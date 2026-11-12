---
name: documents/magazine-layout
title: Magazine-style layout
when: a feature article, interview or spread designed like a print magazine: big type, photos, columns, pull-quotes
keywords: magazine, mise en page magazine, editorial, feature, article magazine, interview, portrait, reportage, spread, double page, zine, fanzine, revue, journal, presse, editorial design
---
# Magazine-style layout

Magazine layouts are about contrast and pacing: a dramatic opening, then calm reading pages with surprises. They work on A4 portrait or as a landscape spread.

## Decide first
- The story's emotion: intimate (interview), energetic (sport), contemplative (travel), investigative (data).
- Opening move — pick one:
  1. **Full-bleed photo** with the headline over a calm area.
  2. **Giant headline** filling half the page, photo below.
  3. **Portrait + quote**: a person's picture and their strongest sentence as the title.
- Number of pages: an opener plus one to three reading pages.

## Build it
1. Opener as a fixed sheet (`.sheet`, `@page { margin: 0 }`): headline, standfirst (2–3 lines, larger than body), byline.
2. Reading pages: a grid of 3 columns (two for text, one for images, captions, pull-quotes), or 2 columns with a wide margin.
3. A **pull-quote** every page or two, set big in the headline font.
4. **Captions** that add information, not just labels.
5. Finish with a sign-off mark (■) at the end of the text.

## Techniques
```css
.headline { font: 800 54pt/.92 var(--didone); letter-spacing: -.02em; }
.standfirst { font: 400 14pt/1.35 var(--serif); max-width: 120mm; }
.body { column-count: 2; column-gap: 6mm; font: 9.8pt/1.45 var(--serif); hyphens: auto; }
.pull { column-span: all; font: italic 600 20pt/1.2 var(--didone); margin: 6mm 0; padding: 4mm 0; border-block: .8pt solid; }
.drop::first-letter { float: left; font: 700 4.2em/.8 var(--didone); padding: .05em .08em 0 0; color: var(--accent); }
```
- **Scale contrast**: the headline is 5–6× the body size.
- **Images in two sizes only**: one big, the others small; align to the column grid.

## Make it distinctive
Choose the magazine "title" it could belong to — a culture weekly, a surf quarterly, a tech monthly — and borrow its attitude, not its logo. Colour comes from the main photo (pick one tone from it for the drop cap and kickers).

## Avoid
- Uniform sizes, centred body text, text over busy photos without a scrim.
- Pull-quotes repeating the previous paragraph word for word nearby.

## Self-check
1. Does the opener have one dominant element?
2. Is reading text comfortable (≥ 9.5pt, columns ≥ 55mm)?
3. Do images align to the grid?
4. Are pull-quotes and captions adding something?
5. Does it feel like a specific magazine, not a template?
