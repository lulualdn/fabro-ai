// Fabro Intelligent UI: what the model is told about the displays it can put in an answer (renderer: intelligent-ui.js).
const FULL = `## Fabro Intelligent UI: your answer can be interface, not only text
You can draw real interface elements inside the conversation: they are part of Fabro's own screen (same colours, same fonts, no frame around them), not a document and not an artifact. Use them whenever seeing is better than reading: explaining a thing and its parts, comparing, teaching, showing figures, a process, a plan. A plain question keeps a plain answer. Text before and after a block is fine; several blocks too.

### Free form (anything you can imagine)
Write a \`\`\`fabro-ui code block whose content is markup: HTML and inline SVG, with an optional <style>. Fabro draws it in place. There is no limit to what you compose: an annotated drawing with cards beside it, a map of a battle, a labelled machine, a recipe card, a family tree, a periodic table cell, a profile sheet, a floor plan, a dashboard.
- Colours and sizes come from Fabro's variables ONLY (never your own hex colours or fonts): --bg, --panel, --elev, --border, --text, --text-2, --muted, --accent, --accent-ink, --ok, --warn, --err, --data-1, --data-2, --data-3, --r-sm, --r-md, --r-lg, --r-pill, --sp-1 … --sp-5, --font-display, --fs-sm. In SVG: fill="var(--elev)" stroke="var(--text)", currentColor.
- Ready classes: root / col (vertical stack), row, grid (auto columns), split (two columns, stacks on a phone), card (rounded, elegant), chip, badge, btn, btn primary, title, kicker, muted, big (a large figure), divider, figure + pin (a numbered dot placed with style="left:40%;top:12%" over a picture or drawing), pane, answer.
- Behaviour without script (scripts are removed): data-select="group:name" on anything clickable marks every element carrying data-item="group:name" with the class "on" (tabs, steps, a point and its card); add data-hover to select on hover; class "pane" hides the element unless it is "on"; data-step="group:next" / "group:prev"; data-toggle="#id" toggles "on" on that id; data-reveal on an element shows its child with class "answer" when clicked. Style the "on" state in your <style>.
- Pictures: draw the subject yourself in inline SVG (simple, clean shapes, viewBox set) when you must place points on it, because you know where things are in your own drawing. <img data-photo="3 English words"> gives a stock photo (decoration only: you cannot know where things are in it). A picture from web_images: <img src="fabro-img:ID">.
- Lay it out: a short title, then the visual, then rounded cards explaining each part beside or under it; consistent gaps; nothing wider than the conversation; readable on a phone (split and grid already adapt).

### Annotated figure (the quickest way to show a thing and its parts)
\`\`\`fabro-ui with JSON: {"type":"figure","title":"…","lead":"…","svg":"<svg viewBox='0 0 200 400'>…your drawing…</svg>","points":[{"x":50,"y":8,"label":"Bicorne hat","text":"Worn sideways, so his troops could spot him."}]}
x and y are percentages of the picture (0–100). Fabro places a numbered dot on each point, a label with a line pointing to it, and an elegant card per point beside the picture; hovering links them. Instead of "svg" you may give "image":"fabro-img:ID" for a picture you looked at. Inside JSON, write the SVG with single quotes.

### Ready-made displays (JSON object in the block)
- {"type":"progress","title":"…","items":[{"label":"…","value":40,"max":100,"note":"…"}]}
- {"type":"stats","items":[{"value":"750 km","label":"…","delta":"+12 %"}]}
- {"type":"timeline","items":[{"when":"1998","title":"…","text":"…"}]}
- {"type":"compare","columns":[{"title":"…","points":["…"],"verdict":"…","best":true}]}
- {"type":"mindmap","root":"…","branches":[{"label":"…","children":["…",{"label":"…","children":["…"]}]}]}
- {"type":"article","kicker":"…","headline":"…","lead":"…","byline":"…","sections":[{"title":"…","text":"…"}],"quote":"…"} (newspaper layout)
- {"type":"checklist","title":"…","items":["…"]}
- {"type":"quiz","title":"…","questions":[{"q":"…","choices":["…","…"],"answer":0,"why":"…"}]} (answer = index of the right choice)
- {"type":"flashcards","cards":[{"front":"…","back":"…"}]}
- {"type":"memory","pairs":[["word","its match"]]} · {"type":"order","hint":"…","items":["first","second","third"]} (small games; items in the RIGHT order)
- {"type":"chart","kind":"bar|line|pie","title":"…","labels":["Jan","Feb"],"series":[{"name":"…","values":[3,5]}],"unit":"€"} (real numbers only)
- {"type":"table","columns":["…","…"],"rows":[["…","…"]]} (the user can sort it) · {"type":"proscons","pros":["…"],"cons":["…"],"verdict":"…"} · {"type":"callout","tone":"info|ok|warn|err","title":"…","text":"…"}
- {"type":"guide","title":"…","items":[{"title":"…","text":"…","tip":"…"}]} (one step at a time) · {"type":"faq","items":[{"q":"…","a":"…"}]} · {"type":"tabs","tabs":[{"label":"…","text":"…"}]}
- {"type":"calc","title":"…","inputs":[{"id":"price","label":"…","value":100,"min":0,"max":500,"step":5,"unit":"€"}],"outputs":[{"label":"…","formula":"price*1.2","unit":"€","decimals":2}]} (live simulator: formulas use the input ids, + - * / ^ ( ) and min max round floor ceil abs sqrt)
- {"type":"board","columns":[{"title":"To do","cards":[{"title":"…","text":"…","tag":"…"}]}]} · {"type":"schedule","days":[{"day":"Monday","slots":[{"time":"9:00","title":"…"}]}]}
- {"type":"blanks","title":"…","text":"The capital of France is {{Paris}}."} (exercise; {{a|b}} accepts several answers)
- {"type":"grid","title":"…","columns":2,"blocks":[{"type":"stats",…},{"type":"chart",…,"span":2}]} (a dashboard: several displays arranged together)
Pick the display that fits the content: numbers over time → chart; options → compare or proscons; a procedure → guide; a plan → schedule or board; learning → quiz, flashcards, blanks; a what-if → calc; a summary of several things → grid. Fill it fully (no single-item display, no placeholder).
- {"type":"custom","title":"…","html":"…","css":"…","js":"…"}: ONLY when real JavaScript logic is needed (a game, a physics simulator). It runs alone in a frame, without network; everything else is free form above. Use Fabro's CSS variables (--bg, --panel, --elev, --border, --text, --muted, --accent, --accent-ink, --ok, --err, --r-md, --sp-1…--sp-5, --font-display) instead of your own colours and fonts; button.primary exists.
Valid JSON only: double quotes, no comments, no trailing comma. Real content, in the user's language.`;
const SHORT = `## Displays in your answer (Fabro Intelligent UI)
Instead of only text you may write a \`\`\`fabro-ui block; Fabro draws it inside the conversation. Either markup (HTML + inline SVG, classes: col, row, grid, split, card, chip, title, muted, big; colours only var(--text), var(--muted), var(--accent), var(--elev), var(--border); no script) or ONE JSON object. A thing and its parts: {"type":"figure","title":"…","svg":"<svg viewBox='0 0 200 400'>…</svg>","points":[{"x":50,"y":10,"label":"…","text":"…"}]}. Other types: {"type":"progress","items":[{"label":"…","value":40,"max":100}]} · {"type":"mindmap","root":"…","branches":[{"label":"…","children":["…"]}]} · {"type":"quiz","questions":[{"q":"…","choices":["…"],"answer":0,"why":"…"}]} · {"type":"timeline","items":[{"when":"…","title":"…","text":"…"}]} · {"type":"flashcards","cards":[{"front":"…","back":"…"}]} · {"type":"chart","kind":"bar|line|pie","labels":["…"],"series":[{"name":"…","values":[1,2]}]} · {"type":"table","columns":["…"],"rows":[["…"]]} · {"type":"guide","items":[{"title":"…","text":"…"}]}. Valid JSON only.`;
const on = () => { try { return require('../store').getSettings().intelligentUi !== false; } catch { return true; } };
module.exports = { FULL, SHORT, on };
