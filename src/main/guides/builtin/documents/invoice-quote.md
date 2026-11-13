---
name: documents/invoice-quote
title: Invoice or quote
when: an invoice, quote/estimate, receipt or order form with line items and totals
keywords: invoice, facture, quote, devis, estimate, estimation, receipt, recu, bon de commande, order form, purchase order, billing, facturation, proforma, note d honoraires, tarif, payment
---
# Invoice or quote

An invoice must be correct, complete and quick to pay. Design is about making the total, the due date and the payment details impossible to miss.

## Decide first
- Invoice or quote? A quote has a validity date and a signature line ("Bon pour accord"); an invoice has a due date and payment details.
- Legal mentions for the country. France: SIRET, VAT number or "TVA non applicable, art. 293 B du CGI" for micro-entreprises, payment terms, late penalties, the fixed €40 recovery fee for businesses.
- Currency, VAT rates, rounding.

## Build it
1. One A4 sheet: `@page { size: A4; margin: 16mm; }`.
2. **Header**: seller name/logo and details left; document type, number, issue date, due date (or validity) right.
3. **Parties**: "Billed to" block and, if useful, project or delivery reference.
4. **Items table**: description, quantity, unit price, total — numbers right-aligned and tabular (technique/tables).
5. **Totals block** aligned right: subtotal, VAT per rate, total due in the largest type on the page.
6. **Payment**: IBAN/BIC, payment methods, terms; legal mentions in small type at the bottom.

## Techniques
```css
.items td.num, .items th.num { text-align: right; font-variant-numeric: tabular-nums; }
.totals { margin-left: auto; width: 75mm; }
.totals .due { font: 800 16pt/1.2 var(--sans); border-top: 1.5pt solid; padding-top: 2mm; }
```
- **Check the arithmetic** line by line: qty × unit = line total; sum = subtotal; VAT computed on the subtotal; total = subtotal + VAT. Write numbers with the user's locale (1 234,50 € in French).
- Number format: `FAC-2026-0042` style, consistent.

## Make it distinctive
The seller's identity carries it: a wordmark set in their font, their colour as a thin top bar or as the total's background. Everything else stays functional.

## Avoid
- Totals that do not add up.
- Missing invoice number, date, or legal mentions.
- Decorative backgrounds behind the table.

## Self-check
1. Do every line and the totals compute exactly?
2. Can you find the amount due and the due date in three seconds?
3. Are both parties' details complete?
4. Are the legal mentions for the country present?
5. Does it fit one page?
