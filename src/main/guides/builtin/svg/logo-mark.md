---
name: svg/logo-mark
title: Logo-like mark
when: a simple logo, wordmark, monogram, emblem or badge for a person, project, club, shop or event (original, never an existing brand)
keywords: logo, logotype, wordmark, monogram, monogramme, emblem, embleme, badge, blason, crest, mark, identite visuelle, visual identity, branding, marque, brand, signature, ecusson, sigle, initiales
---
# Logo-like mark

A good mark is simple enough to draw from memory and works in one colour at 32px. Never reproduce or imitate an existing brand's logo.

## Decide first
- What it represents: the name, an initial, an activity, a place, a value.
- Type of mark — pick one:
  1. **Wordmark**: the name in a carefully chosen font with one custom detail.
  2. **Monogram**: one or two initials combined into a shape.
  3. **Symbol + name**: a simple pictogram next to the name.
  4. **Emblem / badge**: the name inside a shape (circle, shield, stamp).
- Personality in two words (solid & local, playful & bold, precise & technical).

## Build it
1. Explore three ideas as quick SVGs side by side, then refine one.
2. Build the symbol from a few geometric shapes on a grid (e.g. 100×100).
3. Pair with type: choose a system font stack matching the personality; set the name with tuned `letter-spacing`.
4. Make variants: horizontal (symbol left of name), stacked, symbol alone; one colour and reversed (light on dark).
```svg
<svg viewBox="0 0 360 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="40" fill="#1f4d3a"/>
  <path d="M30 62 50 30 70 62Z" fill="#f3efe6"/>
  <text x="110" y="62" font-family="Avenir Next, Avenir, Montserrat, sans-serif" font-size="34" font-weight="700" letter-spacing="1">Col du Lac</text>
</svg>
```

## Techniques
- **One idea**: a mountain in the initial, a wave in the bowl of a letter, a leaf as the dot of an i.
- **Negative space**: the gap between two shapes forms the second meaning.
- **Text on a circle** for badges: `<textPath href="#ring">`.
- **Test small**: imagine it at 32px; remove details that disappear.
- **Colour**: design in black first, then one or two colours from the subject.

## Avoid
- Gradients, drop shadows, more than three colours, thin hairlines.
- Clichés with no link to the subject (swooshes, globes, light bulbs).
- Anything resembling a real company's logo, mascot or trademark.

## Self-check
1. Recognisable in one colour at 32px?
2. Is there one clear idea linked to the subject?
3. Name legible and well spaced?
4. Works on light and dark backgrounds?
5. Clearly original, not close to an existing brand?
