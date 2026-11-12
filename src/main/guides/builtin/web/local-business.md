---
name: web/local-business
title: Restaurant / local business website
when: a website for a restaurant, café, bakery, shop, salon, craftsperson, hotel or any place people visit or call
keywords: restaurant, cafe, bar, boulangerie, bakery, patisserie, boutique, shop, magasin, commerce, salon, coiffeur, hairdresser, artisan, plombier, plumber, garage, hotel, gite, chambre d hotes, fleuriste, florist, local business, commerce local, site de restaurant, epicerie
---
# Restaurant / local business website

Most visitors want three answers on their phone: is it open, where is it, how do I book or call. Make those instant, then show the atmosphere.

## Decide first
- The business's character in three words (family bistrot, natural wine bar, 24h plumber).
- The main action: call, book a table, order, get directions.
- Real facts from the user: address, hours, phone, prices, specialities. Never invent a phone number or address; leave a clear note if missing.

## Build it
1. **Header**: name, a call/book button always visible on phones.
2. **First screen**: one real photo of the place or the product (agent mode: `web_images`; or `<img data-photo="…">`), a one-line description, opening status for today, the main action.
3. **Offer**: menu highlights with prices, services with prices, or products.
4. **Story**: the people, the origin, the craft — short, with a photo.
5. **Reviews**: a few real quotes if given.
6. **Visit**: address, map link, hours table, phone, email, accessibility, parking.
7. **Footer**: legal mentions, socials.

## Techniques
```css
.hours { display: grid; grid-template-columns: auto 1fr; gap: 4px 20px; font-variant-numeric: tabular-nums; }
.hours .today { font-weight: 700; color: var(--accent); }
.callbar { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 10px; background: var(--ground); border-top: 1px solid var(--line); }
@media (min-width: 800px) { .callbar { display: none; } }
```
- **Open now**: a few lines of JS compare the current time with the hours and show "Open until 19:30" or "Opens tomorrow at 7:00".
- `tel:` and `mailto:` links; a map link `https://www.openstreetmap.org/search?query=…`.
- **Menu section** reuses documents/menu ideas (names, short descriptions, prices).

## Make it distinctive
The place itself: its facade colour, its sign's lettering style (approximate with system fonts), its materials. A crêperie in Breton blue and white stripes; a barber in black, cream and brass; a florist with a seasonal colour that changes the accent.

## Avoid
- Hours and address only in the footer.
- Stock photos of food that is not theirs presented as theirs.
- Autoplaying music or video.

## Self-check
1. On a phone, can I call or book in one tap?
2. Are today's hours and the address visible quickly?
3. Are all facts real (or clearly marked as to be completed)?
4. Does the page feel like this particular place?
5. Map/phone/email links work?
