---
name: documents/infographic
title: Infographic
when: a single tall or poster-size visual that explains a topic with numbers, icons, steps and short text
keywords: infographic, infographie, infographics, visual summary, resume visuel, poster pedagogique, chiffres cles, data visualisation, visualisation, explainer, schema explicatif, sensibilisation, awareness, campagne d information
---
# Infographic

An infographic explains one topic visually, read top to bottom in about a minute. It is a story with numbers, not a collage of icons.

## Decide first
- The single message ("A shower uses 4× less water than a bath").
- Three to six sections that build it: context → numbers → comparison → process → what to do.
- Format: tall web image (800px wide), A3/A4 poster, or a social square.

## Build it
1. **Title** as the message, big, plus a one-line subtitle.
2. **Sections** stacked vertically, each with a short heading and one visual device:
   - big number with a unit,
   - comparison (two bars, two shapes sized by value),
   - pictogram array (10 figures, 3 coloured = 30%),
   - process (numbered steps with arrows),
   - map or diagram,
   - "What you can do" checklist.
3. **Sources** and credits at the bottom.

## Techniques
- **Pictogram array** in SVG with `<use>`:
```html
<svg viewBox="0 0 500 60"><defs><circle id="p" r="18" cy="30"/></defs>
  <g fill="var(--accent)"><use href="#p" x="30"/><use href="#p" x="80"/><use href="#p" x="130"/></g>
  <g fill="var(--support)"><use href="#p" x="180"/><use href="#p" x="230"/>…</g></svg>
```
- **Area matters**: when comparing with circles, the area (not the radius) must be proportional — radius ∝ √value.
- **Visual connectors**: a continuous line or path running down the page links sections.
- **Two type levels only**: big numbers/headings, and short text (≤ 25 words per block).

## Make it distinctive
Build the icons yourself in one style (same stroke, same corner radius) from the topic: drops for water, wheels for cycling. Palette from the subject, with one accent for "the point".

## Avoid
- Icon soup, numbers without units or sources.
- Text paragraphs; more than 8 sections.
- Circles sized by radius.

## Self-check
1. Is the message clear from the title alone?
2. Does each section have one visual device?
3. Are proportions honest (areas, bar lengths)?
4. Sources listed?
5. Can it be read top to bottom in a minute?
