---
name: technique/responsive-layout
title: Responsive layout without a framework
when: making any web page work from a 390px phone to a wide desktop with plain CSS
keywords: responsive, mobile, phone, telephone, smartphone, tablette, tablet, media query, flexbox, css grid, adaptatif, mobile first, breakpoints, largeur, width
---
# Responsive layout without a framework

Modern CSS adapts by itself if you let it. Write the phone layout first, then add room for bigger screens.

## Decide first
- What is the single column order on a phone? That order is your HTML order.
- What changes on desktop: columns appear, images grow, navigation unfolds. Nothing else.

## Build it
1. Fluid container: `width: min(1120px, 100% - 40px); margin-inline: auto;`
2. Grids that wrap with no media query:
```css
.cards { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); }
```
3. Fluid type: `font-size: clamp(2rem, 6vw, 4rem);`
4. Side-by-side blocks that stack:
```css
.split { display: flex; flex-wrap: wrap; gap: 32px; }
.split > * { flex: 1 1 320px; }
```
5. One media query for what truly differs, e.g. the navigation: `@media (min-width: 760px) { … }`.

## Techniques
- **Container width, not device names**: breakpoints where your content breaks, usually 600px and 960px.
- **Aspect-ratio boxes** for media: `aspect-ratio: 16/9` instead of fixed heights.
- **Never fixed widths** on blocks; use `max-width`.
- **Tap targets** at least 44px tall on phones; links in text can stay inline.
- **Images**: `max-width: 100%; height: auto;` (Fabro sets this by default).

## Test mentally at three widths
390px (phone), 768px (tablet), 1280px (laptop). At each: does anything scroll sideways? Is the text too long per line? Are buttons reachable?

## Avoid
- `width: 1200px`, `height: 100vh` on content that can grow, `position: absolute` layouts.
- Hiding important content on phones.
- Font sizes in `vw` without a `clamp` minimum.
- Tables wider than the screen with no scroll wrapper.

## Self-check
1. Nothing wider than 390px on a phone?
2. Cards wrap by themselves?
3. Headings scale but stay readable?
4. Buttons big enough to tap?
5. The phone order tells the story in the right sequence?
