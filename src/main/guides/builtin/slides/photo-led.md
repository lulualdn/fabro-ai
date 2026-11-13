---
name: slides/photo-led
title: Photo-led deck
when: a deck built mostly from photographs: travel story, portfolio presentation, event recap, place or product showcase
keywords: photo, photos, photographies, photo deck, travel, voyage, carnet de voyage, recap, retrospective, souvenirs, showcase, portfolio presentation, album, visual story, storytelling visuel, images, reportage photo
---
# Photo-led deck

Here the pictures tell the story and words are captions. Your work is selection, order and framing.

## Decide first
- The story arc: arrival → discovery → climax → departure; or before → during → after.
- 10–20 photos, chosen for variety of scale (wide, medium, detail) and emotion. Cut duplicates.
- Source: the user's photos, `web_images` for a specific real place, or `<img data-photo="…">` for generic scenes.

## Build it
1. **Opening**: the strongest wide photo full-bleed with the title in a calm area.
2. **Sequence**: alternate full-bleed photos with paired photos and occasional text-only slides for chapter titles.
3. **Captions**: short, factual and specific (place, date, one detail you would tell aloud).
4. **Closing**: a quiet image and one sentence.

## Layouts to mix
```css
.slide.full img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.slide.full .cap { position: absolute; left: 48px; bottom: 40px; padding: 10px 16px; background: rgb(0 0 0 / .55); color: #fff; font-size: 24px; }
.slide.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; }
.slide.pair img { width: 100%; height: 100%; object-fit: cover; }
.slide.detail { display: grid; grid-template-columns: 2fr 1fr; align-items: end; gap: 48px; padding: 64px; }
```
- **Full-bleed**: one photo, caption on a solid strip.
- **Pair**: two related photos (wide + detail).
- **Grid of three** for a sequence (morning, noon, night).
- **Detail + text**: a photo with a short paragraph beside it.

## Techniques
- Choose `object-position` so faces and subjects are not cropped.
- Keep a consistent treatment: all colour, or all black and white, with the same caption style.
- Chapter slides use a colour sampled from the next photos.

## Avoid
- Text over busy areas without a strip.
- Ten photos of the same thing.
- Low-resolution images stretched to full screen.

## Self-check
1. Does the order tell a story?
2. Variety of shot scale?
3. Captions readable and specific?
4. No stretched or badly cropped images?
5. Same treatment throughout?
