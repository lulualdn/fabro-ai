---
name: documents/user-manual
title: User manual
when: a manual, user guide or instruction booklet for a product, device, app or service, for non-experts
keywords: user manual, manuel, manuel utilisateur, mode d emploi, notice, notice d utilisation, user guide, guide utilisateur, instructions, how to use, tutoriel, tutorial, quick start, guide de demarrage, faq, depannage, troubleshooting
---
# User manual

A manual is opened when someone is stuck or starting. Organise it by what people want to do, not by how the product is built.

## Decide first
- The top five tasks users need. They become the chapters.
- Reader: complete beginner? Then every step names the button exactly and shows it.
- Format: A5 booklet (feels like a real manual), A4 for printing at home, or a quick-start single sheet.

## Build it
1. **Cover**: product name, a drawing of the product (simple SVG), version.
2. **Safety and what's in the box** (for physical products).
3. **Quick start**: three to five steps to the first success.
4. **Task chapters**: "Connect to Wi-Fi", "Change the battery". Each = goal, numbered steps, expected result.
5. **Troubleshooting** table: problem · likely cause · what to do.
6. **Specifications, contacts, warranty**.

## Techniques
- **Steps with visuals**: number, short instruction, a small SVG figure (the button highlighted with the accent).
```css
.step { display: grid; grid-template-columns: 10mm 1fr 40mm; gap: 4mm; align-items: start; break-inside: avoid; }
.step .n { font: 800 18pt/1 var(--sans); color: var(--accent); }
.ui { font-weight: 700; } /* exact button names */
kbd { font-family: var(--mono); border: .6pt solid; border-radius: 1mm; padding: 0 1.2mm; }
```
- Name interface elements exactly as they appear, in bold.
- One action per step; the result in italics ("*The light turns green.*").
- **Callouts** connect labels to parts of a drawing with thin lines and numbers.
- Thumb tabs: a coloured tab on the page edge per chapter for booklets.

## Make it distinctive
Take the product's colour and shape language: rounded and friendly for a kids' gadget, precise and gridded for a tool. Draw icons in one consistent stroke width.

## Avoid
- Chapters per menu instead of per task.
- Walls of text; warnings hidden in paragraphs.
- Invented specifications: use what the user gives or mark values to confirm.

## Self-check
1. Can a beginner reach first success from the quick start?
2. Does each step name the exact button and the result?
3. Is troubleshooting organised by symptom?
4. Are warnings visible before the risky step?
5. Same drawing style throughout?
