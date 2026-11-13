---
name: documents/certificate
title: Certificate / diploma
when: a certificate, diploma, award, attestation or certificate of participation, usually landscape
keywords: certificate, certificat, diplome, diploma, attestation, award, prix, recompense, certificat de participation, certificate of completion, certificate of achievement, honneur, merite, trophee, remise de prix
---
# Certificate / diploma

A certificate makes a moment official. It needs ceremony (symmetry, space, a seal) and exact facts (name, reason, date, signatures).

## Decide first
- The register: formal (institution, training), warm (club, school), playful (kids' award).
- Orientation: landscape A4 is customary.
- The facts: who awards, to whom, for what, when, who signs.

## Build it
1. `@page { size: A4 landscape; margin: 0 }`, one fixed sheet of 297×210mm.
2. **Frame**: a border drawn with CSS or SVG (double rule, guilloche-like pattern, or a simple inset line).
3. **Issuer** at the top in small caps.
4. **Title**: "Certificate of Achievement" / "Diplôme" / "Attestation".
5. **Recipient name**, the largest text, often in an elegant serif or italic.
6. **Reason**: one or two lines.
7. **Bottom row**: date and place left, signature lines right (name and role under each line), a seal or emblem in the middle.

## Techniques
```css
.sheet { width: 297mm; height: 210mm; padding: 14mm; }
.frame { height: 100%; border: 1.2pt solid var(--accent); outline: .5pt solid var(--accent); outline-offset: -3mm; display: grid; place-items: center; text-align: center; }
.name { font: italic 600 40pt/1.1 var(--didone); }
.sig { border-top: .6pt solid; width: 60mm; padding-top: 2mm; font-size: 9pt; }
```
- **Seal in SVG**: a circle with text on a path (`<textPath>`) and a star or the year in the centre, in the accent colour.
- Use letter-spacing on small caps lines for a formal look.

## Pick a style
- **Classic**: cream ground, deep green or burgundy, serif, double frame, gold-like accent (#a8863b).
- **Modern**: white, one bold colour band on the left, sans, no frame.
- **Kids**: bright colours, a drawn star or medal, rounded type.

## Avoid
- Fake institutional logos; never imitate a real organisation's seal.
- Name too small or squeezed; misspelled names.
- Clutter around the name.

## Self-check
1. Is the recipient name the biggest element?
2. Are issuer, reason and date all present and exact?
3. Is the layout symmetrical and centred?
4. Signature lines have names and roles?
5. Fits one landscape sheet?
