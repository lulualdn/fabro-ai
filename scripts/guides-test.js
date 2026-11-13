// Built-in realization guides + chat-mode selection + the forgiving artifact parser + legacy-kit stamping.
// Plain node, no Electron. Run: node scripts/guides-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const g = require('../src/main/kit/guide');
const parse = require('../src/main/kit/artparse');
const legacy = require('../src/main/kit/legacy');
const runtime = require('../src/main/kit/runtime');

let n = 0; const ok = (m) => { n++; console.log('✓', m); };

// 1. every guide: valid front matter, name = folder/file, unique, within the word budget, a method not a page
const files = [];
for (const cat of fs.readdirSync(g.ROOT)) for (const f of fs.readdirSync(path.join(g.ROOT, cat))) if (f.endsWith('.md')) files.push([cat, f]);
const names = new Set();
const perCat = {};
for (const [cat, f] of files) {
  const src = fs.readFileSync(path.join(g.ROOT, cat, f), 'utf8');
  assert.ok(/^---\nname: [^\n]+\ntitle: [^\n]+\nwhen: [^\n]+\nkeywords: [^\n]+\n---\n/.test(src), `${cat}/${f}: front matter must be name/title/when/keywords in that order`);
  const p = g.parseFront(src);
  assert.strictEqual(p.meta.name, `${cat}/${f.slice(0, -3)}`, `${cat}/${f}: name matches the path`);
  assert.ok(!names.has(p.meta.name), 'unique name ' + p.meta.name); names.add(p.meta.name);
  assert.ok(p.meta.keywords.split(',').length >= 6, `${p.meta.name}: at least 6 keywords`);
  const words = p.body.split(/\s+/).filter(Boolean).length;
  const how = cat === 'agent'; // agent know-how guides are short notes, not design methods
  assert.ok(words >= (how ? 60 : 250) && words <= 450, `${p.meta.name}: ${words} words`);
  if (!how) assert.ok(/self-check/i.test(p.body) && /avoid/i.test(p.body), `${p.meta.name}: has "Avoid" and "Self-check"`);
  assert.ok(!/<!doctype|<body[\s][^>]*>|data-theme=|Fabro Kit/i.test(p.body), `${p.meta.name}: no full page to paste, no kit`);
  for (const ref of p.body.match(/\b(technique|documents|web|slides|svg)\/[a-z0-9-]+/g) || []) assert.ok(fs.existsSync(path.join(g.ROOT, ref + '.md')), `${p.meta.name}: links to an existing guide (${ref})`);
  perCat[cat] = (perCat[cat] || 0) + 1;
}
assert.ok(perCat.documents >= 25 && perCat.web >= 12 && perCat.slides >= 6 && perCat.svg >= 4 && perCat.technique >= 14, JSON.stringify(perCat));
ok(`${files.length} guides, valid and within budget: ${JSON.stringify(perCat)}`);

// 2. chat selection: ~20 requests in French and English → sensible guides (first pick), or nothing when nothing visual is asked
const CASES = [
  ['Crée un site pour ma boulangerie', 'web/local-business'],
  ['Fais-moi une affiche pour la fête de l’école', 'documents/flyer-poster'],
  ['Make a CV for a junior accountant', /documents\/cv-/],
  ['Rédige une lettre de résiliation pour mon abonnement internet', 'documents/letter'],
  ['une facture pour un client, 3 jours de formation', 'documents/invoice-quote'],
  ['Fais une présentation sur les volcans pour ma classe de 4e', /slides\/(lesson|talk)-deck/],
  ['Dessine un logo pour mon club de vélo', 'svg/logo-mark'],
  ['fiche de révision sur les ondes en physique', 'documents/study-sheet'],
  ['Make me a pitch deck for my startup', 'slides/pitch-deck'],
  ['Écris un rapport annuel avec des graphiques', /documents\/(formal-report|data-report)/],
  ['a dashboard for my sales', 'web/dashboard'],
  ['Un menu pour mon restaurant italien', 'documents/menu'],
  ['compte rendu de la réunion de lundi', 'documents/meeting-minutes'],
  ['create a landing page for my app', 'web/landing-page'],
  ['Fais un quiz sur les capitales européennes', 'web/web-app-tool'],
  ['a recipe card for banana bread', 'documents/recipe-card'],
  ['Make a timeline of the French Revolution', 'documents/timeline-history'],
  ['certificat de participation au tournoi de foot', 'documents/certificate'],
  ['un schéma du cycle de l’eau', 'svg/diagram'],
  ['Make a portfolio site for a photographer', 'web/portfolio'],
  ['lettre de motivation pour un stage chez un architecte', 'documents/cover-letter'],
  ['faire un calendrier de révision pour le bac', 'documents/calendar-planner'],
  ['invitation pour les 18 ans de Léa', 'documents/postcard-invitation'],
  ['compte rendu de TP de chimie sur les titrages', 'documents/lab-report'],
];
for (const [q, want] of CASES) {
  const p = g.pick(q); const got = p[0] && p[0].guide.name;
  assert.ok(want instanceof RegExp ? want.test(got || '') : got === want, `“${q}” → ${got} (want ${want})`);
}
for (const q of ['Quelle est la capitale de la France ?', 'Comment ouvrir le menu démarrer de Windows ?', 'Explique-moi la photosynthèse', 'merci beaucoup', 'Peux-tu corriger ce code python ?', 'what letter comes after B?']) assert.deepStrictEqual(g.pick(q), [], `nothing for “${q}”`);
// chat.js falls back to "<title> site|pdf|slides|svg" from the previous artifact
for (const [q, cat] of [['Ma page site', 'web'], ['Rapport pdf', 'documents'], ['Deck slides', 'slides'], ['Logo svg', 'svg']]) assert.strictEqual(g.pick(q)[0].guide.category, cat, q);
ok(`${CASES.length} requests pick the right guide; 6 non-visual messages pick none; fallbacks work`);

// 3. chatSection: format reminder + guide, under the token budget, nothing about a kit
for (const [q] of CASES) {
  for (const budget of [900, 600, 400]) {
    const s = g.chatSection(q, { budgetTokens: budget });
    assert.ok(s && g.tokens(s) <= budget, `“${q}” @${budget}: ${g.tokens(s)} tokens`);
    assert.ok(/<artifact type="(html|document|slides|svg)" title="…">/.test(s) && /Self-check|Build it|Decide first/.test(s), 'format + guide body');
    assert.ok(!/data-theme|Fabro Kit|class="(hero|card|btn)"/.test(s), 'no kit');
  }
}
assert.match(g.chatSection('Crée un site pour ma boulangerie'), /type="html"/);
assert.match(g.chatSection('Fais-moi une affiche'), /type="document"[\s\S]*A4/);
assert.match(g.chatSection('une présentation sur les volcans'), /type="slides"[\s\S]*section class="slide"/);
assert.strictEqual(g.chatSection('merci !'), '');
ok('chatSection respects 900/600/400-token budgets and gives the right format line');

// 4. design_guide text
assert.match(g.guide('restaurant website'), /# Guide: Restaurant \/ local business website/);
assert.match(g.guide('documents/letter'), /# Guide: Formal letter/);
assert.match(g.guide('zzzz'), /No guide matches/);
ok('design_guide: by words, by exact name, and a list when nothing matches');

// 5. the forgiving artifact parser
const A = (s) => parse.artifacts(s).map((a) => [a.type, a.title, a.open]);
assert.deepStrictEqual(A('Voici.\n<artifact type="html" title="Boulangerie">\n<!doctype html><html><body><h1>Pain</h1></body></html>\n</artifact>'), [['html', 'Boulangerie', false]]);
assert.deepStrictEqual(A("<artifact title='Menu' type=document><html><body>a</body></html>"), [['document', 'Menu', true]], 'single quotes, no quotes, any order, unclosed');
assert.deepStrictEqual(A('<artifact>\n<!doctype html><html><head><title>Ma page</title></head><body></body></html></artifact>'), [['html', 'Ma page', false]], 'no type, no title');
assert.deepStrictEqual(A('<artifact><style>@page{size:A4}</style><h1>Rapport 2026</h1></artifact>'), [['document', 'Rapport 2026', false]], '@page → document, title from h1');
assert.deepStrictEqual(A('<artifact title="Deck"><section class="slide">1</section><section class="slide">2</section></artifact>'), [['slides', 'Deck', false]]);
const fenced = parse.split('Voici :\n```html\n<artifact type="svg" title="Logo"><svg viewBox="0 0 10 10"></svg></artifact>\n```\nok');
assert.deepStrictEqual(fenced.map((s) => s.kind), ['text', 'artifact', 'text']); assert.ok(!/```/.test(fenced.map((s) => s.text || '').join('')), 'fence around the tag removed');
const page = '<!doctype html>\n<html><head><style>body{margin:0}</style></head><body><h1>Café du Port</h1>' + '<p>x</p>'.repeat(40) + '</body></html>';
assert.deepStrictEqual(A('Voici la page :\n```html\n' + page + '\n```\nBonne journée'), [['html', 'Café du Port', false]], 'complete page in a code fence');
assert.deepStrictEqual(A('```html\n' + page), [['html', 'Café du Port', true]], 'unclosed fence at the end of the stream');
assert.deepStrictEqual(A('```js\nconsole.log(1)\n```\n```html\n<b>hi</b>\n```'), [], 'ordinary code stays code');
assert.deepStrictEqual(A('<artifact type="markdown" title="Notes">\n# Notes\n- a\n</artifact>'), [['markdown', 'Notes', false]]);
const cc = require('../src/main/kit/chatcheck');
assert.strictEqual(cc.visualArtifacts('<artifact type="html" title="P"><!doctype html><html><body><h1>Unclosed page here</h1>').length, 1, 'chat check sees an unclosed artifact');
ok('parser: attribute order/quotes, missing title/type, unclosed, fenced tag, fenced page, code stays code');

// 6. legacy kit: old versions keep the kit, new ones are plain
const now = Date.now();
const old = { versions: [{ content: '<body data-theme="ocean"><div class="card">x</div></body>', at: now - 86400000, by: 'ai' }] };
legacy.stamp(old); assert.strictEqual(old.versions[0].plain, undefined, 'old version untouched'); assert.ok(legacy.legacyArt(old));
const neu = { versions: [{ content: '<div class="card">x</div>', at: now, by: 'ai' }] };
legacy.stamp(neu); assert.strictEqual(neu.versions[0].plain, true); assert.ok(!legacy.legacyArt(neu));
old.versions.push({ content: old.versions[0].content + ' ', at: now, by: 'user' }); legacy.stamp(old); assert.strictEqual(old.versions[1].plain, false, 'user edit of a kit page keeps the kit');
old.versions.push({ content: '<h1>new</h1>', at: now, by: 'ai' }); legacy.stamp(old); assert.strictEqual(old.versions[2].plain, true, 'a new AI version is plain');
ok('legacy stamping: old versions keep the kit, AI versions are plain, user edits inherit');

// 7. runtime plumbing: no styling decisions, page size for print, nothing for the kit
const r = runtime.prepare('<h1>Hi</h1><p>text</p>', { kind: 'doc' });
assert.ok(/@page\{size:A4/.test(r) && /<html[^>]*data-fabro-paper/.test(r) && !/fabro-kit/.test(r));
assert.ok(!/font-family|font:|color:#[0-9a-f]{3,6}(?![^{]*data-fabro)/i.test(r.match(/<style id="fabro-base">([\s\S]*?)<\/style>/)[1].replace(/@media screen\{[\s\S]*$/, '')), 'base CSS sets no fonts or colours outside the screen-only paper frame');
assert.ok(!/<html[^>]*data-fabro-paper/.test(runtime.prepare('<style>.sheet{width:210mm;height:297mm}</style><div class="sheet">x</div>', { kind: 'doc' })), 'own sheets: no paper frame');
assert.ok(/size:1280px 720px/.test(runtime.prepare('<section class="slide">a</section>', { kind: 'deck' })));
assert.strictEqual(runtime.kindOf('<section class="slide">a</section><section class="slide">b</section>'), 'deck');
assert.ok(/<img src="a.jpg" data-credit="Ann · CC BY">[\s\S]*Photos: Ann · CC BY/.test(runtime.prepare('<img src="a.jpg" data-credit="Ann · CC BY">', { kind: 'web' })), 'credits listed when not shown');
ok('runtime: only page plumbing (A4/16:9 print size, paper frame on screen, credits)');

console.log(`guides-test: ${n} groups passed`);
