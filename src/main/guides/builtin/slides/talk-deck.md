---
name: slides/talk-deck
title: Talk deck
when: slides supporting a talk, conference, keynote, oral presentation or webinar where the speaker carries the content
keywords: slides, diapos, diaporama, presentation, talk, conference, keynote, webinar, oral, expose oral, grand oral, soutenance, speech, discours, intervention, presentation orale, powerpoint, deck
---
# Talk deck

In a talk the audience listens to the speaker; slides give them something to look at that reinforces one point at a time. See technique/slide-rhythm for pacing.

## Decide first
- The one thing the audience should remember. It is the title of your last content slide.
- Length: minutes ≈ slides. 10 minutes → 8–12 slides.
- The room: big screen far away (very large type) or laptop sharing (a bit denser).

## Build it
1. Write the outline as claims, one per slide. Then design.
2. Slide markup: one `<section class="slide">` per slide, 1280×720px, your own CSS:
```css
.slide { padding: 72px 96px; display: flex; flex-direction: column; justify-content: center; background: var(--ground); color: var(--ink); }
.slide h2 { font: 700 56px/1.08 var(--sans); max-width: 20ch; }
.slide p, .slide li { font-size: 30px; line-height: 1.35; max-width: 34ch; }
```
3. Structure: title slide → why it matters → 3 parts (each opened by a section slide) → the takeaway → thanks/contact.
4. Speaker notes, if useful, go in an `<aside class="notes">` hidden on screen (`display:none`).

## Techniques
- **Statement slides**: one sentence at 64–80px, left-aligned, nothing else.
- **Progressive build**: duplicate a slide and add one element per copy.
- **Visual anchors**: a recurring element per part (a colour, a number in the corner) so people know where they are.
- **Contrast for projectors**: dark text on light ground or light on very dark; mid tones wash out.

## Make it distinctive
Pick a deck personality from the subject: a history talk with a serif and archival paper tone; a tech talk with a dark ground and mono accents; a school exposé on volcanoes with basalt black and lava orange. Repeat one signature (a corner mark, a rule, a big numeral) on every slide.

## Avoid
- Bullet lists on every slide, text under 24px, logos everywhere.
- The same layout repeated.
- Agenda slides with five generic words.

## Self-check
1. Do the titles alone tell the story?
2. One idea per slide?
3. Minimum text size 24px?
4. Is the takeaway explicit near the end?
5. Does it look made for this subject?
