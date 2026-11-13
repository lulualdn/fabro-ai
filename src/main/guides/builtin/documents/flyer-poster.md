---
name: documents/flyer-poster
title: Flyer / poster
when: a one-page flyer, poster or announcement to print or share: event, sale, campaign, lost cat, concert
keywords: flyer, affiche, poster, tract, annonce, announcement, prospectus, fete, party, concert, soiree, kermesse, vide grenier, braderie, evenement, event, campagne, campaign, avis
---
# Flyer / poster

A poster is seen from three metres in two seconds. It must say what, when, where — and make someone stop.

## Decide first
- The hook: the one thing that makes people stop (a word, an image, a price, a date).
- Information hierarchy: 1. what, 2. when and where, 3. details (price, contact, booking).
- Format: A4 or A3 portrait for walls; A5 for handouts. One fixed sheet.

## Pick one composition
1. **Huge type**: the event name fills the width (8–12 words maximum on the whole poster).
2. **Image-led**: one striking photo or illustration taking 60% of the sheet, info in a solid band.
3. **Swiss grid**: strict columns, big numbers for the date, lots of white, one colour.
4. **Ticket**: the poster looks like a ticket or a stamp related to the event.
5. **Pattern**: an SVG pattern from the theme (confetti, waves, music notes) behind a clear info block.

## Build it
1. `@page { size: A4; margin: 0 }` and `.sheet { width: 210mm; height: 297mm; overflow: hidden; position: relative; }`.
2. Place the hook first and make it the largest thing by far (headline at 60–120pt).
3. Date and place in a second level (20–28pt), easy to photograph.
4. Details at 11–14pt; one line for contact or booking.

## Techniques
```css
.title { font: 900 96pt/.85 var(--grotesk); letter-spacing: -.03em; text-transform: uppercase; }
.date { font: 800 26pt/1 var(--sans); font-variant-numeric: tabular-nums; }
.band { position: absolute; inset: auto 0 0 0; padding: 12mm; background: var(--ink); color: var(--ground); }
```
- **Fit text to the width** by trying sizes, then check nothing overflows.
- Two colours plus black or white is plenty; high contrast for distance reading.
- A QR code only if there is a real link.

## Make it distinctive
Take the visual language of the event: a brass band → bold slab type and a gold; a bake sale → warm cream and a hand-drawn SVG cake; a techno night → black, one neon, condensed type.

## Avoid
- Ten pieces of information at the same size.
- Clip-art, drop shadows, five fonts.
- Missing year/day of the week, or an address without the town.

## Self-check
1. Can you read what/when/where from three metres (zoom out)?
2. Is there one dominant element?
3. Does everything fit on the sheet?
4. Is the date complete (day, date, time)?
5. Could this poster only be for this event?
