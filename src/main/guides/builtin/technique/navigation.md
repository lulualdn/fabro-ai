---
name: technique/navigation
title: Navigation patterns
when: deciding how people move around a website or app: top bar, sidebar, tabs, anchors, mobile menu
keywords: navigation, nav, menu, navbar, barre de navigation, header, sidebar, barre laterale, tabs, onglets, burger, hamburger, liens, links, footer, fil d ariane, breadcrumb
---
# Navigation patterns

Navigation should match how much there is to navigate. A one-page site needs almost none; a documentation site needs a lot.

## Choose the pattern
- **No nav at all**: a single message page, link-in-bio, invitation. One button is the navigation.
- **Name + one action**: landing pages. Logo/name on the left, the main action button on the right. Optional 2–4 anchor links.
- **Top bar with sections**: small business, portfolio. 3–6 links, current one marked.
- **Sidebar**: documentation, dashboards, tools. Grouped links, always visible on desktop.
- **Tabs**: switching views of the same thing (monthly / yearly, ingredients / steps).
- **Bottom bar**: phone-first apps with 3–5 main screens.

## Build it
1. Use `<header><nav aria-label="Main">` with a list of links.
2. On phones, let links wrap or scroll horizontally before reaching for a burger:
```css
nav ul { display: flex; gap: 18px; overflow-x: auto; list-style: none; padding: 0; margin: 0; }
```
3. If you need a burger, use `<details>` — it works without JavaScript:
```html
<details class="menu"><summary aria-label="Menu">☰</summary><ul>…</ul></details>
```
4. Mark the current place: `aria-current="page"` and a visible underline or weight.
5. Anchor links need matching ids and `scroll-margin-top` if the header is sticky.

## Techniques
- **Sticky header, slim**: `position: sticky; top: 0;` with a solid background (not blurred glass).
- **Footer as second navigation**: contacts, hours, all links, legal lines.
- **Table of contents** for long articles: a sticky list in the margin on desktop, at the top on phones.

## Avoid
- Ten links in a top bar, dropdowns on hover only (unusable on phones).
- Links that go nowhere (`href="#"`).
- A burger on desktop when there is room.

## Self-check
1. Is the pattern proportional to the amount of content?
2. Does every link work?
3. Can you see where you are?
4. Works on a phone without hover?
5. Is the main action reachable from the top?
