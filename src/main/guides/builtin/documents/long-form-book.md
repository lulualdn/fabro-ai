---
name: documents/long-form-book
title: Book / long-form document with table of contents
when: a book, booklet, thesis, guidebook, novel excerpt or any long document with chapters and a table of contents
keywords: book, livre, livret, booklet, ebook, roman, novel, these, thesis, memoire, chapters, chapitres, table des matieres, sommaire, table of contents, guide book, recueil, anthologie, carnet, edition
---
# Book / long-form document with table of contents

A book is built from a few page types repeated with discipline. Readers trust a book whose margins, running elements and chapter openings never waver.

## Decide first
- Trim size: A5 (148×210mm) for a book feel, A4 for a thesis or manual.
- Front matter: title page, copyright/credits, dedication (optional), contents.
- Chapter structure and approximate length (see technique/multi-page-rhythm).

## Build it
1. `@page { size: A5; margin: 18mm 16mm 22mm 20mm; }` — slightly wider inner and bottom margins.
2. **Title page**: title, author, publisher or place, year — centred, airy.
3. **Contents**: chapter titles with anchor links; numbering consistent.
4. **Chapter opener**: new page, space at the top (a third of the page), chapter number and title.
5. **Text pages**: serif body 10–11pt, line-height ~1.45, first paragraph not indented, others indented 1em.
6. **End matter**: notes, bibliography, index or acknowledgements.

## Techniques
```css
.chapter { break-before: page; padding-top: 55mm; }
.chapter .num { font: 400 11pt/1 var(--serif); letter-spacing: .3em; text-transform: uppercase; }
.chapter h2 { font: 400 24pt/1.15 var(--serif); margin: 4mm 0 12mm; }
.text p { margin: 0; text-indent: 1em; text-align: justify; hyphens: auto; orphans: 2; widows: 2; }
.text p:first-child { text-indent: 0; }
.toc a { display: flex; text-decoration: none; color: inherit; }
.toc a::after { content: ""; flex: 1; border-bottom: .5pt dotted; margin: 0 2mm .8mm; order: 1; }
.toc .pg { order: 2; }
```
- **Table of contents**: when you cannot compute page numbers, list chapters with anchors and leave numbers out rather than inventing them.
- **Section breaks** inside chapters: a blank line with a small ornament.
- **Lang** attribute set for correct hyphenation.

## Make it distinctive
Choose one typographic signature: chapter numbers spelled out in small caps; a large thin numeral; a coloured initial. Keep it on every chapter.

## Avoid
- Sans-serif body for long reading in print.
- Chapters starting mid-page.
- Fake page numbers in the contents.

## Self-check
1. Do all chapters open the same way on a new page?
2. Do contents entries link to their chapters?
3. Are margins and body type constant?
4. No widows or lonely headings?
5. Front matter complete?
