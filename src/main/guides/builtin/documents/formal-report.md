---
name: documents/formal-report
title: Formal report
when: a multi-page report, study, audit or annual review that must look serious and be easy to navigate
keywords: report, rapport, rapport annuel, annual report, study, etude, audit, bilan, analyse, analysis, review, compte rendu d activite, dossier, synthese, white paper, livre blanc
---
# Formal report

A report helps a busy reader decide something. Most will read the summary and skim the headings; build for them first.

## Decide first
- Who decides what after reading it? Write that decision down; every section must serve it.
- Tone: institutional (public body, bank), corporate (company), or academic. It sets type and colour.
- Length: count the sections and plan the pages (see technique/multi-page-rhythm).

## Build it
1. **Cover**: title as a claim or a clear subject, organisation, date, author. One strong graphic element: a colour field, a large year, a line drawing — not a stock photo of handshakes.
2. **Summary page**: the answer in five lines, then three to five key figures, then the recommendation.
3. **Contents**: numbered sections with anchor links.
4. **Sections**: numbered headings (`1.`, `1.2`), short paragraphs, one figure or table per idea, each with a caption that states the finding.
5. **Conclusion and next steps**: actions, owners, dates.
6. **Annexes**: methods, sources, detailed tables.

## Techniques
- **Numbered hierarchy** that also navigates:
```css
h2 { counter-increment: sec; break-before: page; }
h2::before { content: counter(sec) ". "; color: var(--accent); }
```
- **Key figures band**: three cells, each a large number (tabular), a label, and a comparison ("+12 % vs 2025").
- **Findings in the margin**: a narrow column beside the text with the one-line takeaway of each part.
- **Captions as claims**: "Figure 2 — Costs fell in every region except the North."

## Make it distinctive
Pick one structure: (a) classic centred cover + single column; (b) wide left margin with hanging section numbers; (c) two-column reading pages with a full-width figure per chapter. Take the accent from the organisation or the topic (water → deep teal, energy → amber).

## Avoid
- A summary that only says what the report contains.
- Walls of text without figures, or decorative figures without data.
- Headings like "Analysis" with no information.

## Self-check
1. Does page 2 give the answer?
2. Can the reader follow the logic from headings alone?
3. Does every figure have a caption stating its point?
4. Are numbers consistent between summary and body?
5. Do chapters start on new pages, with no orphan headings?
