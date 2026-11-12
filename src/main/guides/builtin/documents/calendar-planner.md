---
name: documents/calendar-planner
title: Calendar / planner
when: a printable calendar, weekly/monthly planner, timetable, school schedule, revision plan or habit tracker
keywords: calendar, calendrier, planner, planning, agenda, emploi du temps, timetable, schedule, semainier, weekly planner, monthly planner, planning de revision, revision plan, habit tracker, suivi, to do semaine, programme, calendrier annuel
---
# Calendar / planner

A planner is a grid people write into. Get the grid exactly right (correct dates, enough room), then give it a quiet personality.

## Decide first
- Period: year on one page, a month per page, a week per page, a day.
- Use: hanging on a wall (big, visual), carried in a bag (A5, dense), on a desk (A4 landscape).
- What goes in it: appointments, tasks, revision slots, habits.

## Build it
1. Compute the dates correctly: which weekday does the month start on? Number of days? Week starts Monday in France. Mark public holidays only if you are sure of them.
2. **Month grid**: 7 columns, 5–6 rows, weekday headings, day numbers in a corner of each cell.
```css
.month { display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 30mm; border-top: .6pt solid; border-left: .6pt solid; }
.month > div { border-right: .6pt solid; border-bottom: .6pt solid; padding: 1.5mm; font: 600 9pt var(--sans); }
.month .out { color: #bbb; } .month .we { background: #f6f4ef; }
```
3. **Week planner**: days as columns or rows with time slots, plus a "priorities" box and "notes".
4. **Timetable**: hours down the left, days across, blocks coloured by subject with a legend.
5. Leave margins for binding or hole punching if needed.

## Techniques
- **Writing room**: cells at least 25mm tall for a month you write in.
- **Weekends tinted**, today/key dates marked with a circle in the accent.
- **Habit tracker**: a row per habit, a small circle per day.
- **Revision plan**: subjects as colours, sessions as blocks, exam dates highlighted.

## Make it distinctive
Seasonal touch per month (a colour or a small SVG motif: leaf, snowflake), or a strong typographic month name. Keep the grid lines fine and the ink low so handwriting stands out.

## Avoid
- Wrong weekdays (check the first day of each month).
- Cells too small to write in.
- Heavy dark grid lines.

## Self-check
1. Are the dates and weekdays correct?
2. Enough writing space for the intended use?
3. Week starts on the right day for the user's country?
4. Key dates marked and explained?
5. Fits the page with margins?
