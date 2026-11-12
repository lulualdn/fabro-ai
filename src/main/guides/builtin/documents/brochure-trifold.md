---
name: documents/brochure-trifold
title: Brochure / tri-fold leaflet
when: a folded leaflet or brochure (tri-fold A4, bi-fold A4/A5) presenting a service, place, association or event
keywords: brochure, depliant, triptyque, tri-fold, trifold, leaflet, plaquette, plaquette commerciale, pamphlet, prospectus, flyer plie, folded, bi-fold, catalogue, livret
---
# Brochure / tri-fold leaflet

A folded leaflet is read in a sequence of panels: the cover, the inside flap, then the open spread. Design the order of discovery.

## Decide first
- Fold: **tri-fold A4 landscape** (6 panels of 99×210mm) or **bi-fold** (4 pages).
- The sequence for tri-fold: outside = [inside flap | back | cover], inside = [panel 1 | panel 2 | panel 3].
- The one action the reader should take (call, visit, sign up) — it goes on the back and the last inside panel.

## Build it
1. `@page { size: A4 landscape; margin: 0; }` and two sheets (outside, inside), each a 3-column grid:
```css
.sheet { width: 297mm; height: 210mm; display: grid; grid-template-columns: repeat(3, 1fr); break-after: page; }
.panel { padding: 10mm 9mm; overflow: hidden; }
```
2. **Cover panel** (right of the outside sheet): name, a strong image or graphic, a one-line promise.
3. **Inside flap** (left of outside): a teaser or "Who we are".
4. **Back** (middle of outside): contacts, map or address, opening hours, QR code if relevant.
5. **Inside spread**: three panels telling the offer — what, why, how — with headings, short text, small images.

## Techniques
- Keep 4–5mm safe margin from each fold line; never put text across folds.
- Use the open spread as one composition: an image or colour band can run across all three inside panels.
- Give each panel one heading and one visual.
- Draw fold guides only for screen preview: `@media screen { .panel + .panel { border-left: 1px dashed #ccc; } }`.

## Make it distinctive
Choose a cover strategy: full photo; big typographic name on a colour from the subject; or an illustrated pattern in SVG. Inside, keep a calmer white or tinted ground.

## Avoid
- Mixing up panel order (the cover is the rightmost outside panel).
- Text crossing fold lines.
- Six panels of identical text blocks.

## Self-check
1. Is the cover on the right panel of the outside sheet?
2. Does every panel fit with nothing cut?
3. Contacts and action easy to find?
4. Nothing important within 5mm of a fold?
5. Does the inside spread read left to right as a story?
