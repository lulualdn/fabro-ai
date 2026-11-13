---
name: web/pricing-page
title: Pricing page
when: a page or section comparing plans, offers, packages or subscription tiers with prices
keywords: pricing, tarifs, tarif, prix, prices, plans, offres, offers, abonnement, subscription, formules, packages, forfait, pricing table, grille tarifaire, comparatif des offres, free trial, essai gratuit, premium
---
# Pricing page

A pricing page helps someone pick the right plan without feeling tricked. Clarity is the persuasion.

## Decide first
- Number of plans: two or three (four maximum). Who is each for, in a few words?
- The recommended plan, and why.
- Billing: monthly, yearly (with the saving stated), one-off. Taxes included or not.

## Build it
1. **Title + one line** that frames value ("Simple prices. Cancel anytime.").
2. **Billing toggle** if there are monthly/yearly prices.
3. **Plan cards**: name, who it is for, price with period, main button, 4–6 key features.
4. **Comparison table** below for the details (technique/tables), grouped by category.
5. **FAQ**: billing, cancellation, refunds, students/nonprofits.
6. **Reassurance**: guarantee, secure payment, contact for custom needs.

## Techniques
```css
.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 20px; align-items: stretch; }
.plan { display: flex; flex-direction: column; padding: 28px; border: 1px solid var(--line); border-radius: 16px; }
.plan.rec { border: 2px solid var(--accent); }
.plan .price { font: 800 2.6rem/1 var(--sans); font-variant-numeric: tabular-nums; }
.plan .btn { margin-top: auto; }
```
- **Toggle**: two radio buttons styled as a segmented control; JS swaps prices stored in `data-month` / `data-year`.
- **Feature lines** start with what the user gets ("10 projects"), not internal names.
- **Same feature order** in every card so eyes can compare across.
- Mark the recommended plan with a label word ("Most chosen"), not only colour.

## Pick a layout
- **Cards** (2–3 plans), **single plan** with a calculator (usage-based), or **table-first** for many features (B2B).

## Make it distinctive
Use the product's world: a coffee subscription priced in bags with a photo per plan; a SaaS in a crisp grid. Avoid default blue/purple.

## Avoid
- Hidden fees, prices without period, "Contact us" for everything.
- Five plans, or features that are only marketing names.
- Decoy plans meant to confuse.

## Self-check
1. Can a visitor say which plan fits them in ten seconds?
2. Is every price clear about period and tax?
3. Features in the same order across plans?
4. Recommended plan labelled with words?
5. Toggle and buttons work on a phone?
