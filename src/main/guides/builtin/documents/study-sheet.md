---
name: documents/study-sheet
title: Study sheet / revision card
when: a revision sheet, cheat sheet, memo card or summary of a lesson for studying (bac, brevet, exams)
keywords: fiche de revision, fiche revision, revision, reviser, study sheet, cheat sheet, aide memoire, memo, fiche memo, fiche de cours, resume de cours, flashcard, bac, brevet, exam, examen, formules, formulas, lecon, lesson summary
---
# Study sheet / revision card

A study sheet compresses a lesson so memory can grab it. Structure and visual anchors matter more than completeness.

## Decide first
- The exam and what it asks: definitions, formulas, dates, methods, examples?
- Size: one A4 page (dense), an A5 card (one notion), or a set of flashcards (question front, answer back).
- What the student usually forgets — make that the most visible thing.

## Build it
1. Title with the subject, chapter and level ("Physique-chimie · Ondes · Terminale").
2. **Key idea** in one or two sentences at the top.
3. **Blocks** by type of knowledge, each with a recognisable style:
   - Definition: term in bold, one sentence.
   - Formula: centred, large, with units and what each letter means.
   - Method: numbered steps.
   - Example: a short worked case.
   - Trap: "Watch out" box for the classic mistake.
4. **Self-test** at the bottom: three quick questions, answers upside down or on the back.

## Techniques
```css
.formula { font: 600 14pt/1.3 var(--serif); text-align: center; padding: 3mm; border: 1pt solid var(--accent); border-radius: 2mm; }
.trap { background: #fff3d6; border-left: 3pt solid #d98b00; padding: 2mm 4mm; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
```
- Colour-code by type (definitions one colour, formulas another) and keep the code across all the sheets of a subject.
- Write formulas with real symbols (², √, →, Δ, λ) or simple inline SVG; never images of text.
- Mnemonics and small diagrams beat paragraphs.

## Pick a layout
- **Grid of boxes** (two columns) for many short notions.
- **Mind-map**: central concept with branches drawn in SVG.
- **Timeline** for history: dates down the left, events right.
- **Flashcards**: a grid of 8 cards per A4, cut lines dotted.

## Avoid
- Copying the whole lesson, full sentences everywhere.
- Ten colours; tiny 7pt text.
- Formulas without units.

## Self-check
1. Can the key idea be read in five seconds?
2. Is every formula complete with units?
3. Is the classic trap highlighted?
4. Does it fit the chosen format?
5. Are there self-test questions?
