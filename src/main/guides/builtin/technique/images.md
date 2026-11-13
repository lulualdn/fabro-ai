---
name: technique/images
title: Using real images well, and designing without them
when: deciding whether a piece needs photos, finding them, placing them, or making it strong with no image at all
keywords: image, images, photo, photos, picture, pictures, illustration, visuel, visuels, banniere, banner, galerie, gallery, web_images, data-photo, sans image, no image, cover image
---
# Using real images well, and designing without them

A wrong or blurry photo hurts more than no photo. Decide if images earn their place.

## Decide first
- Is the subject visual (a place, a dish, a product, a person)? Then one strong real picture helps.
- Is it abstract (a policy, a method, numbers)? Then type, colour and diagrams usually do better.

## Getting real pictures
- **A specific real thing** (this game, this monument, this product): in agent mode call `web_images` and use the URLs it returns. Never invent an image URL.
- **A generic scene** (coffee cup, mountain lake, workshop): write `<img data-photo="coffee cup wooden table" alt="…">`. Use 2–4 concrete English words describing what is visible; Fabro inserts a free photo and its credit.
- Show credits as a small caption near the photo when you can.

## Placing them
- **Crop with intent**: `object-fit: cover` plus a fixed `aspect-ratio` keeps photos consistent:
```css
.photo { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; object-position: 50% 35%; }
```
- **One hero image, large**, rather than six small thumbnails.
- **Text on a photo** needs a scrim: `background: linear-gradient(transparent, rgb(0 0 0 / .65))` behind the text, or put the text beside the photo instead.
- **Duotone feel** with CSS: `filter: grayscale(1) contrast(1.1)` over an accent background with `mix-blend-mode: multiply`.

## Without images — pick one
- **Typographic hero**: a huge word or number as the visual.
- **Colour fields**: big blocks of the palette with one sharp line of text.
- **A drawn shape**: a simple inline SVG (wave, sun, track, map line) that echoes the subject.
- **Pattern**: `repeating-linear-gradient` stripes or dots from the accent at low contrast.
- **Real data as image**: a chart or a timeline instead of a stock photo.

## Avoid
- Stretched or pixelated images, random stock smiles, the same photo twice.
- Images without `alt`.
- Text over a busy photo with no scrim.

## Self-check
1. Does every image show something specific to this subject?
2. Same aspect ratio within a group?
3. Is text on images readable?
4. Every image has meaningful alt text?
5. Would the page still work if the photos failed to load?
