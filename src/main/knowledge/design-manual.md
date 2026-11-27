---
title: Design manual
when: Use this guide to design anything people will look at: a page, an app, a dashboard, a document, slides, a drawing or a game.
description: A method, not a style. How to find, decide and check colors, type, layout, motion, languages and libraries so each design fits its subject and does not look like every other AI design.
sources: Fabro (UFStudios, 2026-11). Signs of slop adapted from unslop by Damir Sokolovsky, https://github.com/heydamir/unslop (CC BY 4.0).
---
## [contents] Read this first
> The order of work and what to open next. Short on purpose.
Assume you know nothing about this subject's look. Follow the steps in order and open only the chapters you need:
1. brief: who, what action, what real material.
2. research: three varied references, one not from the web.
3. direction: three different directions, pick one, say why.
4. palette, type, layout, motion: decide each from the direction.
5. technique: the language and libraries (simplest that covers the need; the existing project first).
6. build: structure, real content, style, then motion.
7. control: screenshots on desktop and mobile, the checklist, the final question.
Then the chapter for the medium: supports/landing, supports/app, supports/dashboard, supports/document, supports/slides, supports/drawing, supports/game.
This manual never gives values to copy. Examples show a method; if you catch yourself reusing a color or font from an example, stop and redo that step. Before you start, call design_history to see your recent designs and do not repeat them unless the user wants the same brand. After, record yours with design_history({ add }).

## [brief] Brief
> Who it is for, the one action, and the real material before any pixel.
Write three lines before designing:
- Audience: who looks at it, where, on what screen, in what mood (a parent on a phone at night is not an engineer on two monitors).
- Action: the one thing the viewer must do or understand. Everything else is secondary.
- Material: the real texts, numbers, photos, logo, product. Ask for them or gather them. Placeholder text hides layout problems; fake numbers like 123,456 look fake.
If the user gave a brand (colors, fonts, logo), that is the direction: skip to technique and respect it.
Common mistake: designing a generic "modern" layout and pouring the content in afterwards. The content decides the layout.

## [research] Research
> Three references from different worlds, one of them off the web.
Find three references, each from a different place:
- one from the subject's own world (a real shop, a museum label, a train timetable, a lab report);
- one from another field that solves a similar problem (how a cookbook shows steps, how an airport shows status);
- one not from the web: print, signage, packaging, a place, a material, a photo you take or find.
For each, write one line: what you take from it (a rhythm, a contrast, a way of grouping), never "the style". Use see_images on them to really look.
Avoid as references: AI-made templates, "best landing pages" galleries, the first page of a design-inspiration site. They converge to the same look.

## [direction] Direction
> Three different directions, one chosen and justified in five lines.
Sketch three directions that differ in kind, not in color: e.g. editorial vs. instrument panel vs. hand-made. For each: a name and two lines.
Pick one and write the direction in five lines:
- Product: what it is, in plain words.
- Character: three words of voice. Banned: clean, modern, sleek, minimal, premium (they say nothing).
- World: the material or place it borrows from (paper, workshop, transit, kitchen…).
- Moments: the one or two places where rich color or motion is allowed.
- Signature: the one detail people will remember.
Say why this one fits the brief better than the other two.

## [palette] Palette
> From a source tied to the subject: extract, give roles, dose, check contrast, try in place.
1. Source: a photo, object or place from the research that belongs to the subject.
2. Extract 5 to 8 hues with a tool, not by guessing: run_python with Pillow (quantize or k-means on the image), or read the colors of the real brand.
3. Roles: background (and one step lighter or darker for surfaces), three text roles from one neutral ramp (primary, secondary, muted), one accent, status colors (ok, error) only if needed. Hairlines at 6 to 10% opacity of the text color.
4. Dose: neutrals cover most of the screen; the accent appears once or twice per screen, where it means something (the main action, the active state).
5. Contrast: body text at least 4.5:1 against its background, large text (24px+, or 19px+ bold) at least 3:1, icons and borders that carry meaning 3:1. Compute it, do not eyeball it.
6. Try in place: put the palette on the real layout, in light and dark if both exist, and look at a screenshot. Colors change next to each other.
Dark mode is not inverted light mode: raise surfaces by lightness steps, lower saturation of the accent slightly, keep text off pure white.

## [type] Typefaces
> Three words of voice, the needs, three candidates compared on the real content, the licence, a fallback.
1. Three words for the voice, from the direction (e.g. calm, precise, warm).
2. Needs: languages and accents (é, ß, ł, Cyrillic?), figures (tabular for tables and prices), weights you will use (often 400 and 500 are enough), italics, a monospace for code.
3. Search more than one catalog: Google Fonts, Fontshare, the foundry pages (e.g. via research), system fonts. Do not always pick from the same short list.
4. Compare three candidates on the real headline and a real paragraph, side by side in a screenshot. Keep the one that reads best at the real sizes, not the most striking.
5. Licence: check it allows the use (web embedding, app, print). Note it in the project.
6. Fallback: a system stack that keeps the metrics close, so the page is fine before the font loads.
Scale: few sizes (e.g. 5 or 6), steps you can name; headings at 400 to 500 weight and sized for hierarchy rather than bolder. Sentence case. No negative letter spacing on small text.

## [layout] Layout
> Structure from the content and the one action; a spacing scale; nothing for decoration.
- Start from the action: what must be seen first, second, third. Size and position follow that order.
- Use a spacing scale on a base unit (4 or 8 px) and stick to it. Smaller gaps inside a group than between groups.
- Line length 50 to 75 characters for reading. Wide screens get margins or a second column, not wider text.
- Radius by size: controls small, cards medium, panels larger; a nested radius equals the outer radius minus the padding.
- Vary the rhythm: not every section the same card grid. One main element per screen, the rest compact.
- Mobile is a layout of its own: check what moves where at 375 px wide, keep touch targets 44 px.

## [motion] Motion
> Only with a purpose; cheap properties; one easing; respect reduced motion.
- Purpose: show a change of state, guide the eye to a result, or give feedback. If it does none of these, remove it.
- Animate opacity and transform only (and colors). Never width, height, top, left, margins or large blurs: they are slow.
- One easing curve and two or three durations for the whole product (e.g. 150 ms for hover, 250 ms for panels).
- Respect prefers-reduced-motion: turn motion off or replace it by a fade.
- The Moments of the direction may get one richer animation. Nowhere else.

## [technique/language] Choosing a language
> The simplest option that covers the need; an existing project decides first.
If the user has a project, use its language and framework. Otherwise pick the simplest that covers the need:
- A page or small tool in the browser: HTML, CSS and plain JavaScript. Add TypeScript when the code grows past a few hundred lines or several people work on it.
- A web app with many screens and shared state: a framework (React, Vue, Svelte…) chosen with the libraries chapter, often with TypeScript.
- Scripts, data, automation, AI: Python.
- A fast server or command-line tool: Go (simple deploys, one binary) or Rust (performance and safety, slower to write).
- A web back end on cheap hosting: PHP is still the most widely hosted; Node.js if the front end is JavaScript.
- Enterprise and Android back ends: Java or Kotlin; Kotlin for Android apps.
- Windows desktop: C# (.NET). Apple platforms: Swift.
- Games and engines: C++ (Unreal, custom engines), C# (Unity, Godot .NET), GDScript (Godot), Luau (Roblox), Lua (Love2D, mods).
- Something that runs a CPU or GPU to the limit: C++ or Rust.
State the choice and the reason in one line. A web artifact may use a framework or external files when it is justified (a real app, a chart library); say why.

## [technique/libraries] Choosing libraries
> Say the need, search live, compare three, read the docs, pin the version.
1. Write the need in one sentence ("draw an interactive map with markers and clusters").
2. Search live, with two different phrasings, in the right places: the package registry (npm, PyPI, crates.io…), GitHub topics, the framework's docs. find_library helps; do not rely on a list you remember.
3. Compare three candidates: last release and activity, size, licence, accessibility, how well the docs cover your need. Not always the most popular: sometimes the platform does it natively (CSS, <dialog>, Intl).
4. Read the docs page for your exact use before writing code. Check the version the examples are for.
5. Pin the exact version in the project (or the CDN URL). Note the licence.
Vary your sources: if your last three projects used the same library for the same need, check again whether it is the best here.

## [build] Building
> Structure, real content, style, then motion; small steps you can see.
1. Structure: the semantic HTML (or components) with the real content, no styling. Check the order makes sense read top to bottom.
2. Content: all real texts and numbers; final images or honest placeholders with the right size.
3. Style: tokens first (colors, type scale, spacing, radius as variables), then components. No one-off values.
4. Motion last, only where the direction allows it.
5. After each step, a screenshot (check_visual / preview). Fix before moving on.

## [control] Checking
> Screenshots on desktop and mobile, the checklist, and one last question.
Take screenshots at desktop width and at 375 px, in light and dark if both exist. Check:
- The one action is the first thing you see.
- Text contrast passes; nothing is cut, overlapping or overflowing.
- Spacing follows the scale; sibling cards have the same padding; groups read as groups.
- Every interactive element has hover, focus and disabled states; focus is visible.
- No sign from the anti-repetition chapter.
Then ask: would this design fit another product without changes? If yes, it is not designed yet: go back to direction and signature.

## [anti-repetition] Not repeating yourself
> Fingerprints of past designs, and the usual signs of AI-made interfaces.
Call design_history before designing and record each design after (colors, fonts, layout in one line). Do not reuse a recent palette, font pair or layout unless the user asks for the same brand.
Signs to remove (from unslop by Damir Sokolovsky, CC BY 4.0):
- Purple-to-blue or violet-to-pink gradients on backgrounds, cards, buttons; gradient text; colored glows and glowing pills; blurred blobs behind content.
- Every element highlighted; many near-identical tints for text; neon borders instead of hairlines.
- Headings at weight 800-900; uppercase labels with wide tracking; too many sizes; italic for emphasis.
- Emoji as icons or status; a sparkle for anything AI; icons in many sizes and colors.
- Arbitrary spacing values; uneven padding in sibling cards.
- Greeting headlines, exclamation marks, hype words (supercharge, seamless, unlock, magic), wordy placeholders, fake-looking data.
- "New" and "Beta" badges everywhere; every element a full pill; equal cards side by side each with the same mini chart.
- A pill badge above the hero headline; a headline that fits any product; everything stacked and centered; three or more buttons; unsourced "trusted by 10,000+".
- Glossy 3D blobs, robots, glowing brains or circuit lines as visuals for anything AI.
Glass or reflections can be part of a direction when they are a deliberate signature: keep them sober and keep text readable.

## [supports/landing] Landing page
> One promise, proof, one action.
- Headline: what it does for whom, in plain words. Then one line of detail, then one primary action (and at most one secondary).
- Show the real product early (a real screenshot or a short loop), not an illustration of "AI".
- Proof that is specific: a number with its source, a named customer with permission, a quote with a name.
- Sections vary in form: a split, a full-width product view, a short list, not five identical card rows.
- Pricing or download where people look for it; the footer is for the rest.

## [supports/app] Application
> Built for repeated use: the main task in reach, the rest out of the way.
- Find the one task people do most and put it in the middle with the fewest steps. Settings and rare modes go elsewhere.
- Navigation: as flat as possible, labels in words. The current place is always clear.
- States: empty (says what to do), loading (keeps the layout), error (says what happened and what to do), success (quiet).
- Keyboard: every action reachable, focus order logical, shortcuts for frequent actions.
- Density: a tool for daily work can be denser than a landing page; keep the spacing scale.

## [supports/dashboard] Dashboard
> One question per screen; the main chart leads; numbers in one format.
- Start from the decision the viewer makes with it. One main chart answers it; compact stats support it.
- Numbers: one format, tabular figures, units, a comparison with its reference ("+12% vs last month").
- Charts: one or two series, muted grid, labels on the data rather than in a legend when possible, one highlight color for what matters.
- No sparkline on every card, no rainbow of series, no 3D.
- Use the dataviz rules of the project if there are any.

## [supports/document] Document
> Built for reading and printing: hierarchy, measure, page rhythm.
- Title, date and author where people expect them; headings that summarize, not decorate.
- Line length 60 to 75 characters, generous leading, margins that suit the paper size.
- Tables: aligned numbers, light rules, headers that repeat across pages.
- Page breaks: no heading alone at the bottom of a page, no table cut without its header.
- Check the PDF pages one by one.

## [supports/slides] Slides
> One idea per slide, read from the back of the room.
- Each slide has a title that states the point ("Costs fell 18% after the switch"), not a topic ("Costs").
- Few words, large type (often 28 px or more for body), one visual per slide.
- A consistent grid and a small set of layouts (title, statement, chart, image, quote).
- Numbers big, with their unit and reference. Charts simplified for the slide.
- Check every slide as a screenshot at presentation size.

## [supports/drawing] Drawing and illustration
> A concept first, a limited palette, consistent strokes.
- Decide what the picture must say in one sentence; sketch two compositions before details.
- Limited palette from the palette chapter; consistent line weight and corner style across a set.
- For SVG: clean paths, a viewBox, no hidden or off-canvas shapes, colors as variables if themable.
- Check at the smallest size it will be shown.

## [supports/game] Game
> Readable at a glance while playing; feedback for every action.
- The player must read the state instantly: health, score, objective. Contrast with the scene, stable positions.
- Every action gets feedback within 100 ms (sound, motion, color), stronger for important events.
- A visual language: shapes and colors that mean the same thing everywhere (danger, collectible, interactive).
- Menus: big targets, controller and keyboard navigation, readable on a TV from a couch.
- Test with a screenshot during play, not only on the menu.
