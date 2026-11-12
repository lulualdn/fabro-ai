---
name: technique/hero-alternatives
title: Hero alternatives to the centred gradient
when: designing the top of a web page so it is specific to the subject instead of a generic centred title on a gradient
keywords: hero, header, banniere, banner, haut de page, above the fold, accroche, headline, titre principal, first screen, premier ecran, intro, landing hero
---
# Hero alternatives to the centred gradient

The first screen decides if the page feels made for its subject. Centred title + subtitle + two buttons on a gradient is the default every AI produces. Pick something else.

## Decide first
- What is the most convincing thing about the subject: a picture, a number, a promise, the product itself, a person?
- Make that thing the hero. The headline supports it.

## Pick one of these structures
1. **Editorial split**: headline left (7 columns), a real photo or object right (5 columns), aligned to the top, not centred.
2. **The product is the hero**: a large screenshot, the dish, the object, cropped big and bleeding off the edge; one short line above it.
3. **Big number**: "1 972" or "42 km" in giant type, with one sentence explaining it.
4. **Typographic poster**: one word or short phrase filling the width, set in the subject's font, with small details (date, place) in corners.
5. **Ticket / label**: information laid out like the real-world artefact of the subject (a train ticket, a wine label, a menu board, a boarding pass).
6. **Straight to the tool**: for apps and calculators, the working tool is the first thing; the explanation comes after.
7. **Quiet text**: a short paragraph in large serif type, left aligned, lots of space; for studios, writers, lawyers.

## Techniques
```css
.hero { display: grid; grid-template-columns: 7fr 5fr; gap: 40px; align-items: end; min-height: min(80vh, 760px); }
.hero h1 { font-size: clamp(2.6rem, 7vw, 6rem); line-height: .95; letter-spacing: -.03em; }
@media (max-width: 760px) { .hero { grid-template-columns: 1fr; min-height: auto; } }
```
- Fit text to a width with `clamp()` and check it on a 390px phone.
- One button, labelled with the real action ("Book a table", "Download the app"), not "Get started".
- Real details make it credible: an address, a price, a date, a name.

## Avoid
- Gradient blobs, glassmorphism cards, floating emoji.
- "Welcome to our website" or "Unlock the power of…".
- Two equal buttons fighting for attention.
- A hero taller than the screen with nothing below the fold hint.

## Self-check
1. Would the hero be wrong for a different subject? (It should be.)
2. Is the most convincing thing the biggest thing?
3. One clear action?
4. Works on a phone without overlapping?
5. No gradient used as decoration?
