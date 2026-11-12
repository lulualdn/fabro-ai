---
name: documents/cv-sidebar
title: CV / résumé — two-column with sidebar
when: a CV for creative, design, marketing, hospitality or student profiles where personality and a photo help; dense but visual
keywords: cv, resume, curriculum vitae, cv moderne, modern cv, cv creatif, creative resume, cv design, cv deux colonnes, two column, sidebar, cv avec photo, photo, portfolio cv, graphiste, etudiant
---
# CV / résumé — two-column with sidebar

The sidebar holds the facts people look up (contact, skills, languages); the main column tells the career story. Good when the job values presentation.

## Decide first
- Side: left sidebar feels classic; right sidebar keeps the name and story first.
- Width: about one third (62–70mm on A4).
- Photo or not: include it only where customary (France, Germany often yes; UK, US no).

## Build it
1. Fixed sheet: `@page { size: A4; margin: 0 }`, `.sheet { width: 210mm; height: 297mm; display: grid; grid-template-columns: 66mm 1fr; }`.
2. **Sidebar** (tinted background from the palette): photo or monogram, contact, skills grouped by theme, languages with levels, tools, interests.
3. **Main column** (white): name, role, profile line, experience entries, education, projects.
4. Align the first lines of both columns on the same baseline.

## Techniques
- **Monogram instead of a photo**: initials in a circle drawn with CSS, in the accent colour.
- **Skill groups instead of bars**: "Design — Figma, Illustrator, typography". Bars invent precision.
- **Timeline rule** in the main column:
```css
.entry { position: relative; padding-left: 6mm; border-left: .8pt solid var(--line); }
.entry::before { content: ""; position: absolute; left: -1.6mm; top: 1.5mm; width: 3mm; height: 3mm; border-radius: 50%; background: var(--accent); }
```
- **Sidebar contrast**: dark sidebar with light text, or a pale tint with dark text — check contrast.

## Make it distinctive
Let the profession set the palette: a pastry chef's warm cream and cocoa, a UX designer's ink and one bright signal colour, an environmental engineer's moss green. One small signature (a hand-drawn line, an unusual heading font) is enough.

## Avoid
- Sidebar crammed to the bottom while the main column is half empty (balance the content).
- Icons beside every word, five colours.
- Text in the sidebar below 8.5pt.

## Self-check
1. Both columns end at a similar height?
2. Contact details readable at a glance?
3. Experience bullets show results?
4. Sidebar contrast passes?
5. Fits one sheet with nothing cut?
