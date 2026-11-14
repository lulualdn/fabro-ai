// Fabro Intelligent UI: what the model is told about the displays it can put in an answer (renderer: intelligent-ui.js).
const FULL = `## Displays in your answer (Fabro Intelligent UI)
An answer does not have to be only text. When a display explains or teaches better, write a \`\`\`fabro-ui code block holding ONE JSON object: Fabro draws it in its own design and the user can interact with it. Text before and after is fine, several blocks too. Plain questions keep a plain answer.
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
- {"type":"custom","title":"…","html":"…","css":"…","js":"…"}: anything else (another game, a simulator, a diagram, a calculator). It runs alone in a frame, without network. Use Fabro's CSS variables (--bg, --panel, --elev, --border, --text, --muted, --accent, --accent-ink, --ok, --err, --r-md, --sp-1…--sp-5, --font-display) instead of your own colours and fonts; button.primary exists.
Valid JSON only: double quotes, no comments, no trailing comma. Real content, in the user's language.`;
const SHORT = `## Displays in your answer
Instead of only text you may write a \`\`\`fabro-ui block with ONE JSON object; Fabro draws it. Types: {"type":"progress","items":[{"label":"…","value":40,"max":100}]} · {"type":"mindmap","root":"…","branches":[{"label":"…","children":["…"]}]} · {"type":"quiz","questions":[{"q":"…","choices":["…"],"answer":0,"why":"…"}]} · {"type":"timeline","items":[{"when":"…","title":"…","text":"…"}]} · {"type":"flashcards","cards":[{"front":"…","back":"…"}]} · {"type":"chart","kind":"bar|line|pie","labels":["…"],"series":[{"name":"…","values":[1,2]}]} · {"type":"table","columns":["…"],"rows":[["…"]]} · {"type":"guide","items":[{"title":"…","text":"…"}]}. Valid JSON only.`;
const on = () => { try { return require('../store').getSettings().intelligentUi !== false; } catch { return true; } };
module.exports = { FULL, SHORT, on };
