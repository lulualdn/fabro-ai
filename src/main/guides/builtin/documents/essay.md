---
name: documents/essay
title: Essay
when: an essay, dissertation, opinion piece, commentary or long argued text meant to be read on paper or as PDF
keywords: essay, essai, dissertation, commentaire, commentaire de texte, philosophie, philosophy, opinion, argumentation, tribune, chronique, redaction, composition, long text, texte argumentatif
---
# Essay

An essay is pure reading. Design disappears into comfortable typography; structure is shown by the argument, not by boxes.

## Decide first
- Context: school (formal plan required), publication (title and standfirst), personal (free).
- Length and paper: A4 for school; A5-like narrow column for a literary feel.
- The thesis in one sentence.

## Build it
1. `@page { size: A4; margin: 25mm 28mm; }` — generous margins are part of the look.
2. **Title block**: title, optional subtitle, author, date. Leave space below it.
3. **Text**: serif at 11–12pt, line-height 1.5–1.6, measure ~65 characters.
4. **Parts**: for a formal dissertation, short headings or Roman numerals; for an opinion piece, no headings, just a line break or a centred ornament between movements.
5. **Quotes** set apart when longer than three lines; **notes** as numbered footnotes at the end.

## Techniques
```css
body { font: 11.5pt/1.58 var(--serif); hyphens: auto; }
p { margin: 0; text-indent: 1.4em; orphans: 3; widows: 3; }
h1 + p, h2 + p, .break + p { text-indent: 0; }
.break { text-align: center; margin: 6mm 0; letter-spacing: .5em; } /* * * * */
blockquote { margin: 4mm 8mm; font-size: 10.5pt; }
```
- **First-paragraph opener**: the first words in small caps (`font-variant: small-caps`) or a drop cap (`p:first-of-type::first-letter { float: left; font-size: 3.2em; line-height: .9; padding-right: .06em; }`).
- **Notes**: superscript numbers linked to an endnotes list.

## Choose a feel
- **Academic**: justified text with hyphenation, numbered parts, plain title.
- **Literary**: narrow column, ragged right, drop cap, ornament breaks.
- **Editorial**: large title, a standfirst paragraph in a bigger size, a pull-quote in the margin.

## Avoid
- Sans-serif 10pt with tight lines for long reading.
- Bold scattered in the text.
- Big gaps from justification without hyphenation.

## Self-check
1. Is the thesis clear in the first paragraph?
2. Is the line length comfortable (~65 characters)?
3. Are quotes and sources formatted consistently?
4. Is the hierarchy visible without boxes or colours?
5. No widows or lonely headings?
