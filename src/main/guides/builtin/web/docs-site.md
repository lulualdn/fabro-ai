---
name: web/docs-site
title: Documentation site
when: an online documentation, help center, knowledge base or API docs page with navigation and code
keywords: documentation, docs, doc, documentation site, site de documentation, help center, centre d aide, knowledge base, base de connaissances, api docs, wiki, guide developpeur, developer docs, faq site, manuel en ligne, reference
---
# Documentation site

Documentation is navigated more than read. People land from a search, scan for their answer, copy a snippet and leave.

## Decide first
- The sections, by user need: Getting started · Guides (tasks) · Reference · Troubleshooting.
- The first page's job: get someone to their first success in five minutes.
- The product name, version and the language of code examples.

## Build it
1. **Layout**: top bar (product name, search, version), left sidebar (sections and pages), content, and on wide screens a right "On this page" list.
2. **Content page**: title, one-line summary, prerequisites, steps or reference blocks, next steps.
3. **Code blocks** with a language label and a copy button.
4. **Callouts**: Note, Tip, Warning — each with a word label.
5. **Previous / next** links at the bottom.

## Techniques
```css
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr) 200px; gap: 40px; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } .toc { display: none; } }
.sidebar { position: sticky; top: 64px; max-height: calc(100vh - 64px); overflow: auto; }
pre { position: relative; overflow-x: auto; padding: 16px; border-radius: 8px; background: var(--code-bg); }
```
- **Sidebar on phones** inside a `<details>` "Menu" at the top.
- **Search** in a single page: filter sidebar links as the user types (ten lines of JS).
- **Anchored headings**: `id` on every h2/h3, a small `#` link on hover.
- **Copy button**: `navigator.clipboard.writeText(pre.innerText)` and "Copied" feedback.

## Make it distinctive
Use the product's colour for links and the active sidebar item; choose a mono font stack that suits (ui-monospace). A small illustrated header on the home page is enough personality.

## Avoid
- Marketing copy in docs; walls of text without examples.
- Code examples that cannot work.
- A sidebar with 80 flat links (group them).

## Self-check
1. Can a newcomer reach a first success from the start page?
2. Is the current page highlighted in the sidebar?
3. Do code blocks scroll horizontally instead of breaking the layout?
4. Callouts labelled with words?
5. Usable on a phone?
