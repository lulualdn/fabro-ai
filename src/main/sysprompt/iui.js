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
- {"type":"custom","title":"…","html":"…","css":"…","js":"…"}: anything else (another game, a simulator, a diagram, a calculator). It runs alone in a frame, without network. Use Fabro's CSS variables (--bg, --panel, --elev, --border, --text, --muted, --accent, --accent-ink, --ok, --err, --r-md, --sp-1…--sp-5, --font-display) instead of your own colours and fonts; button.primary exists.
Valid JSON only: double quotes, no comments, no trailing comma. Real content, in the user's language.`;
const SHORT = `## Displays in your answer
Instead of only text you may write a \`\`\`fabro-ui block with ONE JSON object; Fabro draws it. Types: {"type":"progress","items":[{"label":"…","value":40,"max":100}]} · {"type":"mindmap","root":"…","branches":[{"label":"…","children":["…"]}]} · {"type":"quiz","questions":[{"q":"…","choices":["…"],"answer":0,"why":"…"}]} · {"type":"timeline","items":[{"when":"…","title":"…","text":"…"}]} · {"type":"flashcards","cards":[{"front":"…","back":"…"}]}. Valid JSON only.`;
const on = () => { try { return require('../store').getSettings().intelligentUi !== false; } catch { return true; } };
module.exports = { FULL, SHORT, on };
