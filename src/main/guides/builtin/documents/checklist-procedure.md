---
name: documents/checklist-procedure
title: Checklist / procedure
when: a checklist, step-by-step procedure, SOP, safety instructions or to-do sheet that people follow and tick
keywords: checklist, check-list, liste de controle, procedure, mode operatoire, sop, standard operating procedure, instructions, consignes, consignes de securite, safety, etapes, steps, to do, todo, liste, protocole, aide memoire
---
# Checklist / procedure

People use a checklist while doing something else. Each line must be one clear action they can tick without thinking.

## Decide first
- Type: **do-confirm** (experts do it, then check) or **read-do** (follow line by line).
- Context: on a wall, on a clipboard, on a phone, in a binder. It sets size and contrast.
- Critical steps: which mistakes are dangerous or expensive? Those get special marking.

## Build it
1. **Title** naming the task and when to use it ("Closing the kitchen — every evening").
2. **Scope line**: who, how long it takes, required equipment.
3. **Phases** with short headings ("Before", "During", "After").
4. **Items**: a box, then a verb-first action, then (if needed) a short criterion.
5. **Critical items** marked with a symbol and a word ("STOP", "Danger").
6. **Footer**: version, date, owner, who to call if something goes wrong.

## Techniques
```css
.item { display: grid; grid-template-columns: 7mm 1fr; gap: 3mm; padding: 2.4mm 0; border-bottom: .5pt solid var(--line); break-inside: avoid; }
.box { width: 5mm; height: 5mm; border: 1.2pt solid var(--ink); border-radius: 1mm; }
.critical { background: #fde8e4; border-left: 3pt solid #c0392b; padding-left: 3mm; }
.criterion { font-size: 9pt; color: var(--muted); }
```
- 5–9 items per phase; split longer lists.
- Numbers for order-dependent procedures, boxes for order-free checks — or both.
- Write measurable criteria: "Fridge below 4 °C", not "Fridge cold".
- Add a blank line for signature/initials and date for regulated tasks.

## Make it fit
Wall poster: large type, A3, high contrast, pictograms drawn in SVG. Clipboard: A4, two columns of boxes. Phone: big tappable rows (it can be an interactive web page with saved ticks).

## Avoid
- Items with two actions joined by "and".
- Paragraph explanations inside the list (put them in an annex).
- Vague verbs ("check", "ensure") without what to look for.

## Self-check
1. Does every item start with a verb and contain one action?
2. Are critical steps impossible to miss?
3. Is the order right for doing the task?
4. Can it be read in the real context (distance, gloves, light)?
5. Version and owner present?
