---
name: svg/diagram
title: Diagram
when: an explanatory diagram: flowchart, process, architecture, cycle, organisation chart, system or mind map in SVG
keywords: diagram, diagramme, schema, schema explicatif, flowchart, organigramme, logigramme, process, processus, architecture, cycle, mind map, carte mentale, systeme, synoptique, workflow, flux, arbre, tree, sequence, chaine
---
# Diagram

A diagram shows relationships that are hard to say in words: order, flow, hierarchy, cause. Reduce the drawing to exactly those relationships.

## Decide first
- The relationship type: **sequence** (steps), **cycle**, **hierarchy** (tree), **network** (components and connections), **comparison** (Venn, matrix), **space** (a labelled schematic).
- The reading direction: left to right for processes, top to bottom for hierarchies, clockwise for cycles.
- The number of nodes: under 12. If more, group them.

## Build it
1. Choose a canvas (`viewBox="0 0 960 540"`) and a grid unit (e.g. 40).
2. Place nodes on the grid with equal spacing. Compute positions: node i at `x = margin + i * step`.
3. Draw nodes as rectangles with generous padding and short labels (1–4 words).
4. Connect with straight or right-angled lines and one arrowhead marker:
```svg
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>
<rect x="40" y="200" width="200" height="80" rx="12" fill="var(--surface)" stroke="currentColor"/>
<text x="140" y="246" text-anchor="middle" font-size="20">Order received</text>
<path d="M240 240H320" stroke="currentColor" stroke-width="2" marker-end="url(#a)"/>
```
5. Label connections only when the meaning is not obvious ("if paid").

## Techniques
- **Encode with few means**: shape for type (rectangle = step, diamond = decision, cylinder = data), colour for group, line style for kind of link (dashed = optional).
- **One highlight**: the critical path or the element under discussion in the accent.
- **Legend** only if you used more than one encoding.
- **Text** at least 14px at the final display size; use `text-anchor="middle"` and compute the centre.

## Make it distinctive
Take a visual metaphor from the subject: a supply chain as a rail line with stations; a water cycle with real sky and sea colours; an organisation chart as a family tree. Keep it clean even when themed.

## Avoid
- Crossing lines (reorder nodes), arrows in both directions everywhere.
- Long sentences in boxes.
- Uneven spacing and random sizes.

## Self-check
1. Can you state the relationship it shows in one sentence?
2. Do lines avoid crossing?
3. Equal spacing and aligned nodes?
4. Labels short and readable?
5. Is the reading direction obvious?
