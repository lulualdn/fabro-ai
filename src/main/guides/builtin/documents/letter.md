---
name: documents/letter
title: Formal letter
when: a printed or PDF letter: request, complaint, notice, official correspondence, thank-you letter
keywords: letter, lettre, courrier, lettre formelle, formal letter, reclamation, complaint, demande, request, resiliation, cancellation, mise en demeure, lettre officielle, correspondence, lettre de remerciement
---
# Formal letter

A letter is judged in one glance: does it look serious, and is the request clear? Layout conventions exist so the reader finds things where they expect them.

## Decide first
- Country conventions. French letters: sender top-left, recipient right, "Fait à …, le …", "Objet :", closing formula. English letters: sender top-right or letterhead, date, recipient left, "Dear …", "Yours sincerely".
- The single purpose, stated in the subject line and in the first sentence.
- Tone: firm, cordial, grateful, neutral.

## Build it
1. `@page { size: A4; margin: 20mm 22mm; }` and one column, max ~150mm of text width.
2. **Letterhead or sender block**: name, address, phone, email. A letterhead can be a single line of small caps with a thin rule.
3. **Recipient block**, then place and date, then the **subject** in bold.
4. **Body**: three or four short paragraphs: context, request or facts, what you expect and by when, polite close.
5. **Closing formula** and **signature** block with name (and role).
6. Attachments ("Pièces jointes :") if any.

## Techniques
```css
.recipient { margin: 18mm 0 10mm auto; width: 75mm; }
.subject { font-weight: 700; margin: 8mm 0; }
.body p { text-indent: 0; margin: 0 0 4mm; text-align: left; }
.sign { margin-top: 14mm; margin-left: auto; width: 70mm; }
```
- Window envelope: in France the recipient block sits ~45mm from the top and ~110mm from the left edge.
- Use the real names, dates and amounts the user gave; put references (contract number, invoice number) in the subject.

## Make it distinctive
A personal letterhead: initials in a serif, one accent rule, or the sender's trade expressed in a tiny detail (a craftsman's line drawing, a company colour). Keep the body sober.

## Avoid
- Justified text with big gaps, decorative fonts in the body.
- Long paragraphs, vague requests ("please do the necessary").
- Missing date or signature.

## Self-check
1. Is the purpose clear from the subject line?
2. Are sender, recipient, date and place where convention puts them?
3. Is the deadline or expected action explicit?
4. Does it fit on one page?
5. Is the closing formula right for the language?
