---
name: technique/micro-interactions
title: Micro-interactions in plain CSS and JS
when: adding hover states, feedback, small animations or interactivity to a web page or app without a library
keywords: animation, animations, hover, survol, transition, interaction, interactions, effet, effects, javascript, js, click, clic, feedback, toggle, accordion, accordeon, scroll, smooth
---
# Micro-interactions in plain CSS and JS

Small, honest feedback makes a page feel made with care. Big decorative motion makes it feel like a template.

## Decide first
- Which actions need feedback? Buttons, links, form fields, toggles, copying, adding to a list.
- What is the subject's tempo? A spa is slow and soft; a game is snappy.

## Build it
1. Hover and press on things you can click:
```css
.btn { transition: transform .15s ease, background-color .15s ease; }
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: translateY(1px) scale(.98); }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
```
2. Animate only `transform` and `opacity`. They are smooth and never shift the layout.
3. Respect people who turn motion off:
```css
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```
4. Small JavaScript, at the end of `<body>`, no library:
```js
document.querySelector('#copy').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(code.textContent);
  e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1500);
});
```

## Ideas that fit most pages
- **Accordion** with `<details><summary>` (no JS needed), animate the marker rotation.
- **Underline that grows** on links: `background-size` transition on a gradient underline.
- **Live result**: a calculator updates on `input`, not on a "Calculate" button.
- **State you can see**: selected cards get a border in the accent and a check mark.

## Important for Fabro
Content must be **visible without animation**. Never start content at `opacity: 0` waiting for a scroll event: the checker, printers and some readers will see an empty page. Animate from visible to visible, or only on hover.

## Avoid
- Infinite animations, parallax, bouncing arrows, typewriter headings.
- Animating `width`, `height`, `top`, `margin` (janky).
- Scroll-jacking.

## Self-check
1. Every clickable thing reacts on hover and focus?
2. Only transform/opacity animated?
3. Reduced-motion respected?
4. All content visible with JavaScript off?
5. Feedback messages say what happened?
