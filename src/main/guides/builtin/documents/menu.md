---
name: documents/menu
title: Menu
when: a restaurant, café, bar, wine or event menu, or a price list to print
keywords: menu, carte, carte du restaurant, restaurant menu, carte des vins, wine list, cafe menu, bar menu, cocktails, price list, liste de prix, tarifs, brunch, plats, dishes, boissons, drinks, traiteur
---
# Menu

A menu sells food through words and order. Guests read it in a specific way: they scan categories, then look at names, then prices.

## Decide first
- The restaurant's character: bistrot, gastronomic, street food, café, cocktail bar.
- Format: A4 single page, A3 folded, long narrow card (1/3 A4), or table board.
- Sections and their order (Starters, Mains, Desserts, Drinks; or by time of day).

## Build it
1. Name of the place at the top, with a small detail (since, address, season, chef).
2. Sections with clear headings; within each, items with:
   - **Name** (strong), **description** (one line, ingredients and origin), **price**.
3. Notes at the bottom: allergens, vegetarian marks, prices incl. tax, service.

## Pick a price layout
- **Dotted leaders**: name … price on the same line (classic bistrot).
```css
.dish { display: flex; gap: 2mm; align-items: baseline; }
.dish .name { font-weight: 700; } .dish .dots { flex: 1; border-bottom: 1pt dotted; transform: translateY(-1mm); }
.dish .price { font-variant-numeric: tabular-nums; }
```
- **Price after the description** with no currency symbol ("18"), modern gastronomic style; prices don't form a column people compare.
- **Centred stack**: name, description, price, each centred; very elegant, fewer items.
- **Board**: two columns, prices in a right column, like a chalkboard.

## Techniques
- Descriptions are concrete: "Roast cod, white beans, chorizo oil" not "Delicious fish dish".
- Mark dishes with small letters (V, VG, GF) explained once.
- Use the place's language; keep French dish names in a French place.
- Signature dish: one item highlighted with a box, a small illustration or the accent colour.

## Make it distinctive
Draw the palette from the food and the room: a seafood place in salt white and deep navy; a pizzeria in tomato and flour; a wine bar in burgundy on cream. A single hand-drawn SVG motif (an olive branch, a fish) is enough decoration.

## Avoid
- Prices aligned in a column for upscale menus (people choose by price).
- Clip-art food, five typefaces, text over photos.
- Spelling mistakes in dish names.

## Self-check
1. Can a guest find each section in a second?
2. Does every item have a name, a short description and a price?
3. Is the style right for this type of restaurant?
4. Are allergens/notes present?
5. Does it fit the chosen format?
