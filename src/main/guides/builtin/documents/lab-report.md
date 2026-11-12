---
name: documents/lab-report
title: Lab report
when: a scientific or technical lab report: experiment, measurements, results, discussion (school or professional)
keywords: lab report, compte rendu de tp, compte rendu tp, tp, travaux pratiques, experience, experiment, protocole, protocol, mesures, measurements, resultats, results, physique, chimie, biologie, sciences, sti2d, lab, laboratoire
---
# Lab report

A lab report lets someone else understand and repeat what you did, and judge whether your conclusion follows from your data.

## Decide first
- The question or hypothesis, written as one testable sentence.
- What was measured, with which instrument and uncertainty.
- The expected format (school TP, IMRaD for university: Introduction, Methods, Results, Discussion).

## Build it
1. **Header**: title, date, names, class or lab, equipment reference if any.
2. **Objective / hypothesis**.
3. **Materials and protocol**: a list of materials, then numbered steps; a schematic of the setup drawn in SVG (boxes, lines, labels).
4. **Results**: a data table (values with units and uncertainty), then a graph of the key relation.
5. **Analysis**: calculations shown step by step, with formulas and units.
6. **Discussion**: does the data support the hypothesis? Sources of error, improvements.
7. **Conclusion** in two or three lines.

## Techniques
- **Data table** with units in the header and consistent decimals:
```html
<tr><th scope="col">U (V)</th><th scope="col">I (mA)</th><th scope="col">R = U/I (Ω)</th></tr>
```
- **Graph by hand** (technique/svg-charts): axes with labels and units, measured points as dots, the fitted line as a stroke; state the slope.
- **Calculation blocks**:
```css
.calc { font-family: var(--mono); background: #f4f4f1; padding: 2mm 4mm; border-radius: 1.5mm; }
```
- Number figures and tables and refer to them ("see Table 1").

## Make it fit
Keep the look technical and quiet: white ground, one accent for figure numbers and the hypothesis box, a sans or a serif with a mono for values. A grid-paper background on the setup schematic is a nice nod to the lab notebook.

## Avoid
- Results without units or uncertainties.
- Graphs without axis labels.
- A conclusion that claims more than the data shows.
- Inventing measurements: use the user's data or say clearly that values are examples.

## Self-check
1. Is the hypothesis testable and stated?
2. Could someone repeat the protocol from your steps?
3. Do all values have units?
4. Are calculations shown?
5. Does the conclusion follow from the results?
