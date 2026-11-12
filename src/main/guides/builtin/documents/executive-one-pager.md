---
name: documents/executive-one-pager
title: Executive one-pager
when: a single page that summarises a project, proposal, product or situation for a decision-maker
keywords: one pager, one-pager, une page, fiche synthese, synthese, executive summary, resume executif, fiche projet, project summary, brief, note de synthese, fact sheet, fiche produit
---
# Executive one-pager

One A4 sheet, read in two minutes, that lets someone say yes, no, or "tell me more". Everything must fit; cutting is the work.

## Decide first
- The single question it answers ("Should we fund the new bike lane?").
- The reader: what do they already know, what do they fear, what number will they look for?
- Write the bottom line as one sentence before anything else.

## Build it
1. Fixed sheet: `@page { size: A4; margin: 0 }` and a `.sheet` of 210×297mm with 14–16mm padding (technique/print-css).
2. **Top band**: title, one-line bottom line, date and owner.
3. **Body in a grid**: problem · proposal · impact · cost · risks · next step. Each block: a label, two to four lines.
4. **Numbers block**: the two or three figures that matter, large.
5. **Footer**: contact, sources in small type.

## Pick a structure
- **Z-pattern**: bottom line top-left, key number top-right, details bottom-left, action bottom-right.
- **Two columns 2:1**: argument on the left, a column of facts and figures on the right.
- **Question-answer**: five bold questions down the page, each answered in two lines.

## Techniques
```css
.sheet { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: auto 1fr auto; gap: 8mm; }
.label { font: 700 7.5pt/1 var(--sans); letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.big { font: 800 28pt/1 var(--sans); font-variant-numeric: tabular-nums; }
```
- Use verbs in labels ("What we propose", "What it costs").
- One small chart at most, drawn in SVG, with its point as the title.

## Make it distinctive
Use the organisation's or project's colour as a single vertical band or a top rule; choose a font voice that matches (serif for public policy, sans for tech).

## Avoid
- Spilling onto a second page; fonts under 8.5pt to make it fit.
- Background stories longer than the proposal.
- Undefined acronyms.

## Self-check
1. Can you find the bottom line in five seconds?
2. Does it fit one page with margins intact?
3. Are the numbers specific and sourced?
4. Is the next step concrete (who, when)?
5. Is any text below 8.5pt?
