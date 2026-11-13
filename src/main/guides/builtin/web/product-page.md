---
name: web/product-page
title: Product page
when: a page that sells or presents one physical or digital product: specs, photos, price, buy button
keywords: product page, fiche produit, page produit, product, produit, e-commerce, ecommerce, boutique en ligne, online shop, shop, vente, acheter, buy, specs, caracteristiques, prix, price, article, objet, gadget
---
# Product page

People arrive wanting to know three things: what it is, whether it fits them, and how much. Answer in that order, then reassure.

## Decide first
- The product's main reason to buy, and the main hesitation.
- The buyer's comparison: what else are they considering?
- The facts available: price, variants, sizes, specs, delivery. Use only what the user gave or clearly mark values to confirm.

## Build it
1. **Buy block** (first screen): photo or gallery left, name, one-line description, price, variant choice, buy button, delivery note — right. Stacks on phones with the photo first.
2. **Why it's good**: three or four specific benefits with close-up photos or simple drawings.
3. **Specs table**: dimensions, materials, compatibility, in a clean two-column table (technique/tables).
4. **In use**: photos or a short scenario.
5. **Reviews** (only real ones), **FAQ**, **delivery and returns**.
6. **Related products** if relevant.

## Techniques
```css
.buy { display: grid; grid-template-columns: 1.2fr 1fr; gap: 48px; align-items: start; }
@media (max-width: 800px) { .buy { grid-template-columns: 1fr; } }
.price { font: 800 2rem/1 var(--sans); font-variant-numeric: tabular-nums; }
.variants { display: flex; gap: 8px; flex-wrap: wrap; } .variants input:checked + label { outline: 2px solid var(--accent); }
```
- Variant pickers as real radio buttons styled as chips (accessible).
- A sticky buy bar on phones: `position: sticky; bottom: 0` with price and button.
- Gallery: one big image + thumbnails, switched with a few lines of JS; all images same ratio.

## Make it distinctive
Let the product set everything: a ceramic mug → warm off-white ground, serif, soft shadows of real photos; a mechanical keyboard → dark ground, mono labels, sharp grid. Take the accent from the product's own colour.

## Avoid
- Burying the price.
- Spec walls before benefits.
- Fake reviews, fake scarcity ("only 2 left!").

## Self-check
1. Name, price and buy button visible on the first screen (desktop and phone)?
2. Are the main hesitations answered?
3. Specs accurate and in a table?
4. Variant choice works with keyboard?
5. Does the page look like this product's world?
