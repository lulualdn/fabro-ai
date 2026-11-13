---
name: technique/dark-mode
title: Dark mode
when: a page or app that should follow the system dark setting, or a dark design for night, cinema, gaming, tech subjects
keywords: dark mode, mode sombre, theme sombre, dark theme, nuit, night, sombre, prefers-color-scheme, clair, light mode, theme toggle
---
# Dark mode

Dark mode is not "invert the colours". It is a second palette designed with the same care.

## Decide first
- **Follow the system** (most pages): light by default, dark when the system asks.
- **Dark by design**: the subject is nocturnal or immersive (cinema, game, music, astronomy); then dark is the only theme.
- **Toggle**: only for apps people use for a long time.

## Build it with variables
```css
:root { color-scheme: light dark;
  --ground: #f7f4ee; --surface: #ffffff; --ink: #1f1a16; --muted: #6b6259; --accent: #b4532a; --line: rgb(0 0 0 / .1); }
@media (prefers-color-scheme: dark) { :root {
  --ground: #15130f; --surface: #1e1b17; --ink: #ede6dc; --muted: #a39a8e; --accent: #e58a5c; --line: rgb(255 255 255 / .1); } }
body { background: var(--ground); color: var(--ink); }
```
Every colour in the page goes through a variable; no hard-coded `#fff` hidden in a card.

## Techniques
- **Raise surfaces with lightness, not shadows**: on dark grounds, cards are slightly lighter than the background.
- **Desaturate and lighten the accent** in dark mode; a saturated accent glows too much.
- **Text is off-white**, never pure `#fff` on pure `#000`.
- **Images**: reduce glare with `img { filter: brightness(.92); }` in dark mode.
- **SVG icons and charts** use `currentColor` so they follow the theme.
- A toggle stores the choice: `document.documentElement.dataset.mode = 'dark'` plus `localStorage`, and CSS `[data-mode=dark] { … }`.

## Avoid
- Pure black backgrounds with saturated colours.
- Forgetting form fields, tables and borders (set `color-scheme`).
- Low contrast grey-on-grey for secondary text: keep 4.5:1.

## Self-check
1. Every colour comes from a variable?
2. Text readable in both modes?
3. Accent adjusted for dark?
4. Inputs and scrollbars match (`color-scheme`)?
5. Charts and icons visible in both?
