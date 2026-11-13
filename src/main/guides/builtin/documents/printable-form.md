---
name: documents/printable-form
title: Form to print and fill in by hand
when: a paper form: registration, application, survey, order form, consent form, to fill in with a pen
keywords: form, formulaire, formulaire a imprimer, printable form, fiche d inscription, inscription, registration form, bulletin d adhesion, adhesion, questionnaire, survey, sondage papier, autorisation parentale, consent form, fiche de renseignements, application form
---
# Form to print and fill in by hand

A good paper form is fast to fill in with a pen and easy for someone else to read back. Space is the most important design element.

## Decide first
- What you really need to know. Every field costs time; cut the optional ones.
- Who fills it in (parents, customers, children) and where (on a counter, at home).
- How it is processed afterwards: the order of fields should match the spreadsheet or file it ends up in.

## Build it
1. **Title** and one line explaining what the form is for and where to return it.
2. **Sections** with short headings ("Child", "Parent or guardian", "Health", "Signature").
3. **Fields**: label above or left, a writing line of a realistic width (names long, postcode short).
4. **Choices** as boxes to tick, all options visible, "Other: ____" when needed.
5. **Signature** block with date and place.
6. **Office use** box at the bottom if staff add information.

## Techniques
```css
.field { display: grid; grid-template-columns: 38mm 1fr; align-items: end; gap: 3mm; margin: 4.5mm 0; }
.line { border-bottom: .7pt solid var(--ink); height: 7mm; }
.row { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 6mm; }
.choice { display: inline-flex; gap: 1.5mm; align-items: center; margin-right: 6mm; }
.choice::before { content: ""; width: 3.8mm; height: 3.8mm; border: .8pt solid; }
.comb { display: grid; grid-template-columns: repeat(10, 6mm); } .comb span { height: 7mm; border: .5pt solid; border-left: 0; }
```
- **Writing height**: at least 7–8mm per line for handwriting.
- **Comb boxes** (one box per character) for codes, dates (JJ/MM/AAAA) and phone numbers.
- Group related fields on one row (postcode + town).
- Label clarity: "Date of birth (dd/mm/yyyy)".

## Make it fit
Forms should look trustworthy, not decorated: the organisation's name and colour in the header, one accent for section titles, the rest black on white so it photocopies well.

## Avoid
- Lines too short for real names or emails.
- Grey or light lines that disappear on photocopies.
- Questions with overlapping choices.

## Self-check
1. Is every field necessary?
2. Enough space to write by hand?
3. All choices visible with boxes?
4. Signature and date present?
5. Does it print well in black and white?
