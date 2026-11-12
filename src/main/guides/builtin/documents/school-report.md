---
name: documents/school-report
title: School report / exposé
when: a written school project, exposé, dossier or research report for middle school, high school or university
keywords: expose, dossier scolaire, school report, school project, devoir maison, rapport de stage, projet, tpe, grand oral, college, lycee, universite, homework, projet scolaire, recherche, research project, eleve, student
---
# School report / exposé

A school report shows that the student understood a subject and can organise it. Teachers look for a clear plan, sources and personal work.

## Decide first
- Level and expectations: page count, required parts (introduction, problématique, plan, conclusion, bibliography).
- The problem question (problématique) in one sentence. The plan answers it.
- The plan: two or three parts, each with two or three sub-parts.

## Build it
1. **Cover**: title, subtitle or problem question, student name(s), class, school, teacher, date. One image or drawing related to the subject.
2. **Contents** with page anchors.
3. **Introduction**: hook, context, problem question, announced plan.
4. **Parts** with numbered headings (I., A., 1.), short paragraphs, illustrations with captions and sources.
5. **Conclusion**: answer the question, open a new one.
6. **Bibliography / sitography**: author, title, site or publisher, date consulted.
7. Optional: glossary, annexes.

## Techniques
```css
h2 { break-before: page; }
h2::before { content: attr(data-num) " "; color: var(--accent); }
figure figcaption { font-size: 9pt; color: var(--muted); }
.source { font-size: 8.5pt; }
```
- **Captions with sources**: "Fig. 3 — Le viaduc de Millau (photo : Wikimedia Commons)".
- **Definition boxes** for key terms, used sparingly.
- **One chart or map** made from real data shows personal work (technique/svg-charts).

## Make it fit the subject
History → serif and an archival feel (cream ground, sepia accent). Biology → clean sans, a green from the subject. Technology (STI2D) → technical drawing look: grid background on the cover, mono labels. Pick one and keep it.

## Avoid
- Copy-pasted paragraphs without sources.
- A plan that lists topics instead of answering a question.
- Decorative fonts, word-art titles.

## Self-check
1. Is the problem question stated and answered?
2. Do the headings show a logical plan?
3. Does every image and fact have a source?
4. Are names, class and date on the cover?
5. Does each part start on a new page?
