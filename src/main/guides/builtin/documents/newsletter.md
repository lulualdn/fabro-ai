---
name: documents/newsletter
title: Newsletter
when: a printed or PDF newsletter, bulletin, internal news sheet or association gazette with several short articles
keywords: newsletter, lettre d information, bulletin, gazette, journal interne, internal newsletter, bulletin municipal, journal de l ecole, school newspaper, news, actualites, nouvelles, info lettre
---
# Newsletter

A newsletter is a mosaic of short pieces. The design gives each a clear weight so readers pick what interests them.

## Decide first
- Issue identity: name, number, date. The masthead is the newsletter's face and stays the same every issue.
- The lead story (one), secondary stories (two to four), briefs, a calendar or contacts.
- Pages: two (recto-verso) or four (folded A3).

## Build it
1. **Masthead**: the title in a strong style, issue number and date on a thin line.
2. **Lead story**: biggest headline, a photo or illustration, two columns of text.
3. **Secondary stories** in a grid; each with headline, a one-line standfirst, short text.
4. **Briefs**: a column of three to six items, headline in bold followed by two lines.
5. **Recurring box**: agenda, numbers of the month, a portrait, a quote.
6. **Footer**: who publishes it, contact, next issue.

## Techniques
```css
.masthead h1 { font: 900 44pt/0.9 var(--grotesk); letter-spacing: -.02em; }
.cols { column-count: 2; column-gap: 7mm; }
.cols p { margin: 0 0 2mm; }
.story { break-inside: avoid; border-top: 1.5pt solid var(--ink); padding-top: 2mm; }
.kicker { font: 700 7.5pt/1 var(--sans); text-transform: uppercase; letter-spacing: .12em; color: var(--accent); }
```
- **Kickers** above headlines name the rubric ("Vie du club", "Travaux").
- **Rules instead of boxes**: thick rules over stories, thin rules between columns.
- Jump lines only if a story continues ("Suite p. 3").

## Make it distinctive
Pick a masthead idea from the organisation: a stamp-like badge for a sports club, a hand-lettered feel (italic serif) for a village, a technical grid for an engineering team. Colours from the organisation, applied to kickers and the masthead only.

## Avoid
- All stories the same size.
- Text wrapping around many small images.
- Empty space at the bottom of columns: edit text to fit.

## Self-check
1. Is the lead story obvious?
2. Does the masthead show name, number and date?
3. Do columns end level?
4. Does each story have a kicker or clear headline?
5. Are contacts and next issue present?
