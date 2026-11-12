---
name: svg/icon
title: Icon
when: a single icon or a small consistent set of icons in SVG (interface, pictogram, app icon, symbol)
keywords: icon, icons, icone, icones, pictogram, pictogramme, picto, symbol, symbole, glyph, app icon, icone d application, favicon, ui icon, set d icones, icon set, svg icon
---
# Icon

An icon must be recognised at 16–24px in a fraction of a second. Simplicity and consistency matter more than detail.

## Decide first
- The metaphor: the most common, concrete object for the idea (envelope = mail, bell = notification). Do not invent new metaphors for standard actions.
- Style for the set: **outline** (stroke 1.5–2px on a 24 grid) or **filled** (solid shapes). One style per set.
- Corners: sharp, slightly rounded, or round — same for all.

## Build it
1. Work on a 24×24 grid with a 2px safe padding (draw within 2–22).
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>
</svg>
```
2. Build from basic shapes: rectangles, circles, straight lines, simple arcs.
3. Snap coordinates to whole or half pixels so strokes stay sharp.
4. Use `currentColor` so the icon takes the text colour.
5. For a set: draw them side by side and compare weight, size and optical centre.

## Techniques
- **Optical balance**: circles look smaller than squares of the same size; make them slightly bigger (circle diameter 20 vs square 18).
- **Consistent stroke** everywhere; no mixing 1.5 and 2.
- **Negative space** for details instead of extra lines (a cut in a shape).
- **App icon** variant: the glyph centred on a rounded square of the brand colour, glyph white, 60% of the area.

## Make it distinctive
Personality comes from small consistent choices: round caps and joins (friendly), square caps (technical), a single corner cut (signature), duotone (stroke + a light fill in the accent).

## Avoid
- Text inside icons, gradients, shadows, more than 5–6 shapes.
- Copying a well-known brand's icon or logo.
- Thin hairlines that vanish at small size.

## Self-check
1. Recognisable at 16px (imagine it tiny)?
2. Fits the 24 grid with padding?
3. Uses currentColor or the set's palette only?
4. Same stroke, caps and corners as its siblings?
5. Is the metaphor the obvious one?
