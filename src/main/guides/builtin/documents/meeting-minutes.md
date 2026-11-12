---
name: documents/meeting-minutes
title: Meeting minutes
when: notes of a meeting, council, assembly or call: decisions, actions, attendees
keywords: minutes, meeting minutes, compte rendu, compte-rendu, cr de reunion, proces verbal, pv, reunion, meeting, assemblee generale, conseil, notes de reunion, actions, decisions, ordre du jour, agenda
---
# Meeting minutes

People open minutes to find two things: what was decided and what they must do. Put those first and make them scannable.

## Decide first
- Format: summary minutes (decisions + actions) or formal minutes (procès-verbal, votes recorded).
- Audience: attendees only, or people who missed the meeting (then add context).

## Build it
1. **Header**: meeting name, date, time, place or link, chair, note-taker.
2. **Attendees** in two short lists: present, excused/absent.
3. **Decisions** box at the top: numbered, one sentence each.
4. **Actions table**: action, owner, due date, status.
5. **Discussion by agenda item**: item title, key points in two to five bullets, decision reference.
6. **Next meeting**: date and provisional agenda.

## Techniques
```css
.decisions { border-left: 3pt solid var(--accent); padding: 3mm 5mm; background: color-mix(in srgb, var(--accent) 8%, white); }
.actions td.owner { font-weight: 600; white-space: nowrap; }
.actions td.due { font-variant-numeric: tabular-nums; }
.item h3 { counter-increment: item; }
.item h3::before { content: counter(item) " · "; color: var(--accent); }
```
- Write decisions in the past tense ("The board approved the 2027 budget.") and actions in the imperative ("Send the quote to the printer").
- Names with initials in tables to save space, full names in the attendees list.
- Votes: "For 12 · Against 2 · Abstentions 1".

## Choose a register
- **Business**: compact sans, tight table, one accent.
- **Association / council**: serif headings, a small emblem or the association's colour, formal wording.
- **Team stand-up**: one page, three columns (done · doing · blocked).

## Avoid
- Transcribing who said what.
- Actions without an owner or date.
- Decisions buried in paragraphs.

## Self-check
1. Are all decisions listed at the top?
2. Does each action have an owner and a date?
3. Are attendees and date correct?
4. Can someone who missed the meeting understand each decision?
5. Is it as short as possible?
