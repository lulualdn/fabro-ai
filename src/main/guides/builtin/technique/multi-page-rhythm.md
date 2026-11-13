---
name: technique/multi-page-rhythm
title: Multi-page rhythm
when: documents of three pages or more (reports, booklets, manuals) that must stay interesting and navigable from page to page
keywords: multi page, plusieurs pages, long document, rapport long, booklet, livret, chapitres, chapters, sections, rythme, rhythm, pagination, sommaire, structure, consistency
---
# Multi-page rhythm

A long document is read like a walk: the reader needs landmarks, variety and rest. Plan the pages before writing the HTML.

## Decide first — sketch the page plan
Write it as a list before coding, for example:
1. Cover · 2. Contents + summary · 3–4. Chapter 1 · 5. Full-page figure · 6–7. Chapter 2 · 8. Conclusion + contacts.
Each page has one job. Mark which ones are "loud" (cover, chapter openers, a big figure) and which are "quiet" (reading pages).

## Build it
1. Define three page types and reuse them: **opener**, **reading page**, **feature page**.
```css
.opener { break-before: page; padding-top: 60mm; }
.opener .num { font-size: 64pt; line-height: 1; color: var(--accent); }
.feature { break-before: page; break-after: page; }
```
2. Keep the furniture consistent: same margins, same running title position, same caption style on every page.
3. Alternate density: after two pages of text, give a figure, a pull-quote or a key-numbers band.
4. Put a short summary at the top of each chapter (two lines, bold or in the accent).

## Techniques — choose one or two
- **Chapter numbers** as a big graphic element on openers.
- **Colour per part**: each chapter gets a support colour on its opener and its headings; the rest stays neutral.
- **Margin notes**: a narrow outer column for definitions, sources, key figures.
- **Key-figure spreads**: three numbers in large type with one line each.
- **Contents with page anchors**: `<a href="#ch2">` links work in the PDF.

## Avoid
- Twenty identical pages of text.
- Changing margins, fonts or heading styles midway.
- Chapter titles at the bottom of a page.
- A figure separated from the text that mentions it by three pages.

## Self-check
1. Can you list what each page is for?
2. Is there a landmark at least every three pages?
3. Same margins and running elements throughout?
4. Each chapter opens on a new page?
5. Is the loudest page the cover?
