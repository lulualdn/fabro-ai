---
name: web/blog-article
title: Blog post / article
when: an article, blog post, news story, guide or tutorial page meant to be read on screen
keywords: blog, article, blog post, billet, post, news, actualite, guide, tutorial, tutoriel, how to, chronique, story, recit, long read, editorial, page article
---
# Blog post / article

On screen, reading comfort beats decoration. The design's job is to make a long text inviting and easy to follow.

## Decide first
- The reader's goal: learn something, follow steps, be entertained, be informed.
- Length: a short post (one screen of headings) or a long read (needs a table of contents).
- Assets: photos, quotes, data, code.

## Build it
1. **Header**: category or kicker, headline, standfirst (one or two sentences), author, date, reading time.
2. **Lead image** if it shows the subject (technique/images); otherwise a typographic header.
3. **Body** in one column of 60–72 characters, with h2 subheads every few paragraphs.
4. **Rich blocks** where they help: pull-quote, figure with caption, note box, code block, small chart.
5. **End**: summary or takeaway, author box, related posts, share or subscribe.

## Techniques
```css
article { width: min(68ch, 100% - 40px); margin-inline: auto; font: 1.125rem/1.7 var(--serif); }
article h2 { font: 700 1.5rem/1.25 var(--sans); margin: 2.4em 0 .6em; }
article figure { margin: 2em calc(50% - min(50vw - 20px, 560px)); } /* wider than the text */
article blockquote { font-size: 1.4em; line-height: 1.35; border-left: 3px solid var(--accent); padding-left: 1em; }
```
- **Breakout figures**: images wider than the text column for rhythm.
- **Sticky table of contents** in the margin on wide screens for long reads.
- **Tutorial steps**: numbered h2s ("1. Install…") and code blocks with a copy button.

## Pick an editorial voice
- **Magazine**: serif text, big headline, drop cap, breakout images.
- **Technical**: sans text, mono code, note boxes, numbered steps.
- **Personal**: warm off-white, handwriting-like italic headings, smaller images.
- **News**: compact header, timestamp, key facts box at the top.

## Avoid
- Lines wider than 80 characters, light grey text, pop-ups.
- Headings that are only labels ("Introduction").
- Placeholder text: write the real article.

## Self-check
1. Comfortable line length and size on desktop and phone?
2. Does the standfirst tell me why to read?
3. Headings every few paragraphs?
4. Images captioned and relevant?
5. A clear ending, not just stopping?
