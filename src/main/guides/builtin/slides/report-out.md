---
name: slides/report-out
title: Report-out deck
when: slides presenting results or status to colleagues or management: project update, quarterly review, project review, internship presentation
keywords: report out, bilan, point d avancement, status update, project update, quarterly review, revue trimestrielle, review, comite, steering committee, copil, retour d experience, rex, rapport de stage, presentation de stage, resultats, results, bilan annuel
---
# Report-out deck

People attending a review want the status, the problems and the decisions needed. Answer first, details after: the deck reads like a pyramid.

## Decide first
- The status in one line (on track / at risk / late) and why.
- The decision or help you need from this audience.
- Period covered and comparison point (plan, last quarter).

## Build it
1. **Title**: project, period, presenter.
2. **Summary**: status, three key results, one risk, the ask. This slide alone should be enough.
3. **Results**: one slide per key result, each with a number and a comparison to plan.
4. **What went wrong / risks**: honest, with the response.
5. **Next period**: milestones with dates.
6. **Decisions needed**: options and your recommendation.
7. **Appendix**: detailed tables for questions.

## Techniques
- **Status chips** that say the word, not only colour:
```css
.chip { font: 700 20px/1 var(--sans); padding: 8px 14px; border-radius: 999px; }
.chip.ok { background: #e3f3e8; color: #1f6b3a; } .chip.risk { background: #fff1d6; color: #8a5a00; } .chip.late { background: #fbe3df; color: #9b2d1f; }
```
- **Plan vs actual** bars side by side, drawn in SVG, plan in a muted tone.
- **Milestone timeline** across the slide, today marked with a vertical line.
- **Action titles**: "Deliveries are 2 weeks late because of the supplier" instead of "Deliveries".

## Make it fit
Corporate settings: the organisation's colours used sparingly, a clean sans, white ground. An internship presentation: add a slide about the company and your role, a photo of the workplace, and what you learned.

## Avoid
- Twenty slides of activity lists.
- Good news only; risks hidden in the appendix.
- Tables of 40 cells on one slide (put them in the appendix).

## Self-check
1. Is the status clear on slide 2?
2. Are numbers compared to a plan or a baseline?
3. Are risks shown with responses?
4. Is the decision needed explicit?
5. Can each slide be understood in 10 seconds?
