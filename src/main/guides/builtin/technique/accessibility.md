---
name: technique/accessibility
title: Accessibility basics
when: any web page, app or document: making it usable with a keyboard, a screen reader, low vision or a small screen
keywords: accessibility, accessibilite, a11y, wcag, contrast, contraste, screen reader, lecteur d ecran, alt, keyboard, clavier, aria, handicap, lisible, readable, inclusive
---
# Accessibility basics

Accessible pages are better pages for everyone: clearer structure, readable text, controls that work. These basics cover most of it.

## Structure
- One `<h1>`, then `<h2>`, `<h3>` in order. Headings describe what follows.
- Landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`. Sections with a heading.
- Set the language: `<html lang="fr">` (or the user's language).
- Lists are `<ul>/<ol>`, tables are `<table>` with `<th>`.

## Text and colour
- Contrast at least 4.5:1 for text, 3:1 for big headings and icons.
- Body at least 16px on screen; line-height 1.5.
- Never colour alone: an error is red **and** says "Required".
- Links look like links in text (underline).

## Images and media
- `alt` says what the image shows or does: `alt="Croissants on a wooden counter"`. Decorative images: `alt=""`.
- Charts get `role="img"` and an `aria-label` with the key finding, or a table next to them.
- Videos: captions if you have them; no autoplay with sound.

## Controls
- Use real elements: `<button>` for actions, `<a href>` for navigation, `<label for>` on every input.
```html
<label for="email">Email</label>
<input id="email" type="email" autocomplete="email" required>
```
- Keep a visible focus ring: `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }`
- Everything works with Tab, Enter and Space. Custom widgets need `aria-expanded`, `aria-pressed` or similar.
- Touch targets at least 44×44px.
- Icon-only buttons get `aria-label`.

## Motion and time
- Respect `prefers-reduced-motion`.
- Nothing flashes; nothing disappears on a timer the user cannot stop.

## Avoid
- `div onclick`, placeholder text used as the label, removing outlines, text in images.

## Self-check
1. Can you use the whole page with the keyboard only?
2. Every image has a meaningful or empty alt?
3. Every input has a visible label?
4. Contrast passes for all text?
5. Headings form a sensible outline?
