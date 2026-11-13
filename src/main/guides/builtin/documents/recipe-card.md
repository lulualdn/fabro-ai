---
name: documents/recipe-card
title: Recipe card
when: a printable recipe, recipe card or small cookbook page with ingredients and steps
keywords: recipe, recette, recette de cuisine, fiche recette, recipe card, cookbook, livre de cuisine, ingredients, cuisine, cooking, patisserie, baking, gateau, cake, plat, dish, carnet de recettes
---
# Recipe card

People use a recipe with flour on their hands, reading from a distance, glancing back between steps. Optimise for glances.

## Decide first
- Format: A5 card (one recipe), A4 page (with a photo), or index card 4×6in.
- Key facts: servings, prep time, cook time, oven temperature, difficulty.
- Who cooks: a beginner needs more detail in steps; an expert wants it compact.

## Build it
1. **Title** and a one-line description (what it is, why it is good).
2. **Facts row**: servings · prep · cook · temperature, as small labelled items.
3. **Ingredients** in a separate column or box: quantities first, aligned, grouped by component ("For the dough", "For the filling").
4. **Steps** numbered, one action per step, with times and visual cues ("until golden, about 12 min").
5. **Tip** or variation box at the end.

## Pick a layout
- **Side by side**: ingredients in a narrow left column (1/3), steps right (2/3).
- **Photo on top**: a real photo across the top half, two columns below.
- **Index card**: everything compact, ingredients as a comma list, steps short.

## Techniques
```css
.facts { display: flex; gap: 6mm; font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; }
.ing li { display: grid; grid-template-columns: 18mm 1fr; }
.ing .qty { font-variant-numeric: tabular-nums; font-weight: 700; }
.steps { counter-reset: s; list-style: none; padding: 0; }
.steps li { counter-increment: s; display: grid; grid-template-columns: 9mm 1fr; margin-bottom: 3mm; }
.steps li::before { content: counter(s); font: 800 16pt/1 var(--serif); color: var(--accent); }
```
- Bold the ingredient names inside steps so cooks can match them.
- Metric units (g, ml, °C) for French users; add °F if asked.

## Make it distinctive
Colour from the dish (tomato red, matcha green, caramel). Choose a voice: grandmother's card (serif, cream, handwritten-style italic headings), modern food blog (white, bold sans), bistrot (chalkboard dark).

## Avoid
- Steps that combine five actions.
- Ingredients mentioned in steps but missing from the list.
- Small text: steps at least 11pt.

## Self-check
1. Every ingredient in steps is in the list (and vice versa)?
2. Times and temperatures given?
3. Readable at arm's length?
4. Quantities aligned?
5. Fits the chosen card size?
