---
name: web/link-in-bio
title: Link-in-bio page
when: a single mobile page with a person's or brand's links: social profiles, latest video, shop, contact (like a Linktree)
keywords: link in bio, linktree, lien bio, page de liens, links page, liens, social links, reseaux sociaux, bio, profile page, carte de visite en ligne, digital business card, creator, createur, youtubeur, streamer, instagram, tiktok
---
# Link-in-bio page

Visitors arrive from a phone, tap one link and leave within ten seconds. The page is a beautiful, very short list.

## Decide first
- The person or brand's personality in three words.
- The links, ranked: the current priority first (new video, shop drop, event), then permanent ones.
- Five to eight links maximum.

## Build it
1. **Identity**: avatar or monogram, name, one-line bio. Centred or left-aligned — choose deliberately.
2. **Featured link**: the priority, larger, possibly with an image or a short description.
3. **Link list**: full-width buttons, 52–60px tall, label + small icon or arrow.
4. **Social icons row** (drawn as inline SVG, simple, same stroke) for secondary profiles.
5. **Footer**: contact email, small.

## Techniques
```css
body { min-height: 100vh; display: grid; place-items: start center; padding: 48px 20px; }
main { width: min(440px, 100%); }
.link { display: flex; align-items: center; justify-content: space-between; min-height: 56px; padding: 0 20px; border-radius: 14px; margin: 12px 0; text-decoration: none; }
.link:active { transform: scale(.98); }
```
- **Background with character**: a colour from the person’s world, a crisp pattern or a single big shape in SVG, or a photo with a solid panel behind the links.
- **Shape language**: pill buttons (friendly), square buttons with thick borders (bold, brutalist), underlined text links (minimal, editorial).
- **Monogram** when there is no photo: initials in a circle in the accent.

## Make it distinctive — pick one look
- **Sticker**: thick black borders, offset hard shadows, saturated colours.
- **Editorial**: off-white, a serif name, links as numbered lines.
- **Gaming**: dark ground, neon accent, mono labels, a pixel motif.
- **Craft**: paper-like ground colour, hand-drawn SVG underline, warm palette.

## Avoid
- Twenty links, autoplay video, generic gradient backgrounds.
- Icons only (labels must say where each link goes).
- Real-looking brand logos redrawn badly: use simple neutral glyphs or text.

## Self-check
1. Is the priority link first and largest?
2. Every link labelled with its destination?
3. Comfortable to tap on a phone?
4. Does it look like this person, not a template?
5. Loads with nothing broken (no external images that fail)?
