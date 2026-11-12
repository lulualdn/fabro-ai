---
name: web/event-page
title: Event page
when: a website for an event: wedding, festival, conference, concert, party, meetup, tournament, with programme and registration
keywords: event, evenement, event page, page evenement, wedding, mariage, festival, conference, concert, soiree, party, fete, meetup, salon, tournoi, tournament, competition, rsvp, inscription, billetterie, tickets, programme, schedule, agenda
---
# Event page

An event page answers four questions over and over: what, when, where, how do I join. Then it builds desire to come.

## Decide first
- The event's mood: celebratory, professional, intimate, wild.
- The key facts: date(s), times, address with town, price, capacity, deadline.
- The action: buy a ticket, RSVP, register, add to calendar.

## Build it
1. **Hero**: event name, date and place in big type (they are the content), the action button. A countdown only if it adds urgency.
2. **Why come**: a short paragraph or three highlights (line-up, speakers, activities).
3. **Programme**: schedule by day, time on the left, item on the right; tabs for multiple days.
4. **People**: speakers/artists/hosts with photo, name, one line.
5. **Practical info**: address with a map link, transport, parking, accessibility, dress code, what to bring.
6. **Tickets / RSVP**: options and prices, or a form (name, number of guests, diet).
7. **FAQ** and **contact**.

## Techniques
```css
.schedule li { display: grid; grid-template-columns: 5.5rem 1fr; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); }
.schedule time { font-variant-numeric: tabular-nums; font-weight: 700; }
.date-big { font: 800 clamp(2.5rem, 9vw, 7rem)/.9 var(--grotesk); }
```
- **Add to calendar**: a link to a generated `.ics` (data URL) with the right date and time zone.
- **Map**: a link to OpenStreetMap or a Leaflet map (`find_library`) with the address.
- **RSVP form**: real labels, a clear confirmation message; say where answers go (in a single page they cannot be sent anywhere without a backend — say "copy and send" or use a mailto).

## Make it distinctive
Let the event's world lead: a wedding in botanical greens and an italic serif; a techno festival in black with one acid colour and condensed type; a developer meetup with a terminal-like programme. Use a recurring motif (the date numerals, a pattern) across sections.

## Avoid
- Date without the year or day of the week; address without the town.
- A programme as a paragraph.
- A form that pretends to send data with nowhere to send it.

## Self-check
1. What, when, where visible on the first screen?
2. One clear way to join?
3. Programme scannable by time?
4. Practical info complete (address, access)?
5. Mood matches the event?
