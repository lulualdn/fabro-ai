---
name: documents/cv-typographic
title: CV / résumé — single-column typographic
when: a CV for most jobs, especially corporate, academic, legal, finance or when applicant tracking systems read it; text-first and very clean
keywords: cv, resume, curriculum vitae, curriculum, lebenslauf, cv classique, cv simple, cv sobre, ats, cv une colonne, single column, job application, candidature, emploi, stage, alternance
---
# CV / résumé — single-column typographic

This approach wins with clarity: one column, strong typographic hierarchy, no sidebar, no skill bars. Recruiters scan it in ten seconds; software can read it.

## Decide first
- The target job. Everything on the page should argue for that job.
- One page (two only after ~10 years of experience).
- Order: experience first if relevant, education first for students.

## Build it
1. `@page { size: A4; margin: 14mm 16mm; }`, fixed to one sheet.
2. **Header**: name large (20–28pt), the target role in one line, then contact details on one line separated by middots (city · phone · email · link).
3. **Profile**: two lines saying what you bring, with one concrete proof.
4. **Experience**: for each job a line with role, organisation, dates aligned right; then two or three bullets starting with a verb and ending with a result or number.
5. **Education**, **Skills** (grouped words, not bars), **Languages** (with level: C1, B2…), **Interests** only if they say something.

## Techniques
```css
.entry-head { display: flex; justify-content: space-between; gap: 4mm; align-items: baseline; }
.date { font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted); }
h2 { font: 700 8.5pt/1 var(--sans); letter-spacing: .14em; text-transform: uppercase; border-bottom: .6pt solid; padding-bottom: 1.5mm; margin: 6mm 0 3mm; }
li { margin: .8mm 0; }
```
- **Hanging dates** variant: dates in a 28mm left column, content in the rest; strong vertical alignment.
- One accent colour, used only for the name or section rules.

## Make it distinctive
Typography is the personality: a serif name for law or humanities, a confident grotesk for tech, a slab for crafts. Keep everything else neutral.

## Avoid
- Photos unless the local custom expects them; skill bars and percentages; icons for every line.
- "Responsible for…" bullets without results.
- Text below 9pt, spilling to a second page by three lines.

## Self-check
1. Name, role and contact visible in three seconds?
2. Each bullet starts with a verb and shows an outcome?
3. Dates aligned and consistent?
4. One page, nothing cut?
5. Would a recruiter know which job this is for?
