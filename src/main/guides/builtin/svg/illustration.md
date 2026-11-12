---
name: svg/illustration
title: Illustration
when: a decorative or narrative illustration in SVG: scene, landscape, character, object, background, spot illustration for a page
keywords: illustration, illustrer, dessin, drawing, draw, dessine, scene, paysage, landscape, personnage, character, mascotte, mascot, decoration, spot illustration, vector art, art, svg art, image vectorielle, poster art, fond, background
---
# Illustration

Code-drawn illustrations look best when they embrace geometry: flat shapes, a limited palette and clear silhouettes. Do not try to imitate a photograph.

## Decide first
- The subject and the one feeling (calm morning, busy market, adventure).
- The style — pick one:
  1. **Flat geometric**: circles, rectangles, triangles; no outlines.
  2. **Line art**: one stroke weight, no fills or one light fill.
  3. **Layered landscape**: horizontal bands from far (light) to near (dark).
  4. **Isometric**: shapes on a 30° grid, three tones per face.
  5. **Paper cut**: overlapping shapes with small offset shadows.
- Palette: 3–5 colours from the subject plus one dark (technique/colour-from-subject).

## Build it
1. Canvas: `viewBox="0 0 800 600"`. Sketch the composition as big shapes first: sky, ground, main subject.
2. Background to foreground: draw far layers first so near layers overlap them.
3. The main subject large and slightly off-centre (rule of thirds: around x=270 or 530).
4. Add details last and sparingly: windows, leaves, a sun, birds.
5. Group parts with `<g>` and reuse repeated elements with `<use>`.

## Techniques
```svg
<rect width="800" height="600" fill="#f4e7d3"/>
<circle cx="610" cy="150" r="70" fill="#f2a541"/>
<path d="M0 420 C160 360 300 400 420 370 S700 330 800 360 V600 H0Z" fill="#7a9e7e"/>
<path d="M0 480 C200 440 380 500 560 460 S760 450 800 470 V600 H0Z" fill="#3e6b4f"/>
```
- **Depth with value**: farther = lighter and less saturated.
- **Curves with C/S commands** for hills and waves; keep control points smooth.
- **Texture** with small repeated shapes (`<pattern>`), at low contrast.
- **Characters** from simple primitives: a circle head, a rounded rectangle body, no facial detail or just two dots.

## Avoid
- Hundreds of tiny shapes, gradients everywhere, realistic faces.
- Copying characters or logos from existing brands, films or games.
- Unbalanced compositions with everything at the centre top.

## Self-check
1. Is the main subject clear in a thumbnail?
2. Palette limited and from the subject?
3. Far-to-near layering correct?
4. One consistent style?
5. Nothing borrowed from an existing brand or character?
