---
name: documents/postcard-invitation
title: Postcard / invitation card
when: an invitation, greeting card, postcard, save-the-date, birth announcement or thank-you card to print or send
keywords: invitation, carte d invitation, faire part, faire-part, carte, card, postcard, carte postale, greeting card, carte de voeux, voeux, save the date, mariage, wedding, anniversaire, birthday, bapteme, naissance, birth announcement, remerciement, thank you card
---
# Postcard / invitation card

A card is held in the hand and kept on a fridge. It carries an emotion first and the practical details second.

## Decide first
- The feeling: joyful, elegant, intimate, funny, solemn.
- Format: A6 postcard (148×105mm), 5×7in (127×178mm), or A5 folded. Recto (image/feeling) and verso (details/message).
- The facts: who invites, what, date and time, place with address, RSVP how and by when.

## Build it
1. `@page { size: 148mm 105mm; margin: 0 }` (or the chosen size) and one `.card` per side with `break-after: page`.
2. **Recto**: one idea, big — a name pair for a wedding, a large age number for a birthday, an illustration, a photo.
3. **Verso**: the invitation sentence, date/time, place, RSVP, a small signature or monogram.
4. For postcards: a message area on the left, address lines and a stamp box on the right.

## Pick a style
- **Elegant**: ivory ground, a didone or italic serif, a thin frame, one metallic-like accent (#a8863b).
- **Joyful**: a saturated colour ground, heavy rounded type, confetti drawn in SVG.
- **Minimal**: white, a single line drawing, small sans text with large spacing.
- **Botanical**: an SVG branch or flowers in two greens, serif type.
- **Retro**: travel-poster colours, condensed type, a stamp-like badge.

## Techniques
```css
.card { width: 148mm; height: 105mm; padding: 9mm; overflow: hidden; position: relative; break-after: page; }
.names { font: italic 400 30pt/1.05 var(--didone); }
.amp { color: var(--accent); font-size: 1.3em; }
.details { font: 500 9.5pt/1.5 var(--sans); letter-spacing: .04em; }
```
- Write dates in full: "Saturday 20 June 2026, 4 pm".
- Ampersand, numerals and monograms make beautiful focal points.

## Avoid
- Clip-art and many fonts.
- Details too small (under 8.5pt) or missing RSVP date.
- Text too close to the edge (keep 5mm).

## Self-check
1. Is the feeling clear from the recto alone?
2. Who, what, when, where and RSVP all on the verso?
3. Fits the card size with safe margins?
4. Date and address complete?
5. One idea, not five?
