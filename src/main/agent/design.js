// Design tools: everything a model needs to make good-looking artifacts without being a designer —
// a guide with a complete example per kind (design_guide), libraries with exact CDN URLs (find_library),
// real free photos (find_images), and artifacts that are rendered and checked like a designer would
// (create_artifact / check_artifact: phone + desktop or printed pages, pictures + problems to fix).
const agent = require('./index');
const db = require('../db');
const kit = require('../kit');
const guide = require('../kit/guide');

// Libraries that work from a CDN without a build step, with pinned versions.
const LIBS = [
  { name: 'Chart.js', k: 'chart graph courbe graphique diagramme barres camembert statistics stats', tags: ['<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>'], use: 'new Chart(canvas, { type: "bar", data: { labels, datasets: [{ label, data }] } })', note: 'For simple static charts the kit’s data-chart is enough (and prints in PDF).' },
  { name: 'Leaflet (maps)', k: 'map carte géographique gps location localisation openstreetmap itinéraire', tags: ['<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">', '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>'], use: 'const m = L.map("map").setView([48.85, 2.35], 13); L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(m); L.marker([48.85, 2.35]).addTo(m);', note: 'Give #map a height (e.g. 360px).' },
  { name: 'three.js (3D)', k: '3d three webgl scène scene modèle model rotation globe', tags: ['<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>', '<script type="module">import * as THREE from "three"; /* … */</script>'], use: 'const r = new THREE.WebGLRenderer({ antialias: true }); …' },
  { name: 'GSAP (animations)', k: 'animation animer scroll timeline motion transition parallax', tags: ['<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>'], use: 'gsap.from(".hero h1", { y: 40, opacity: 0, duration: .8 })', note: 'For simple fade-ins the kit’s class="reveal" is enough.' },
  { name: 'canvas-confetti', k: 'confetti fête celebration bravo victoire win', tags: ['<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>'], use: 'confetti({ particleCount: 120, spread: 70 })' },
  { name: 'D3', k: 'd3 dataviz visualisation réseau network treemap force custom chart', tags: ['<script src="https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js"></script>'], use: 'd3.select("#viz").append("svg")…' },
  { name: 'Mermaid (diagrams)', k: 'diagram diagramme organigramme flowchart schéma séquence gantt mindmap', tags: ['<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.esm.min.mjs"; mermaid.initialize({ startOnLoad: true });</script>'], use: '<pre class="mermaid">graph TD; A-->B;</pre>' },
  { name: 'KaTeX (math)', k: 'math maths formule équation latex', tags: ['<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">', '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>'], use: 'renderMathInElement(document.body) — write $$E=mc^2$$' },
  { name: 'Alpine.js (reactivity)', k: 'interactive réactif state formulaire filter onglets tabs toggle', tags: ['<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/cdn.min.js"></script>'], use: '<div x-data="{ open: false }"><button @click="open = !open">…</button><p x-show="open">…</p></div>' },
  { name: 'Swiper (carousels)', k: 'carousel slider diaporama galerie swipe', tags: ['<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11.0.5/swiper-bundle.min.css">', '<script src="https://cdn.jsdelivr.net/npm/swiper@11.0.5/swiper-bundle.min.js"></script>'], use: 'new Swiper(".swiper", { pagination: { el: ".swiper-pagination" } })' },
  { name: 'SortableJS (drag & drop)', k: 'drag drop glisser déposer kanban trier sort list', tags: ['<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>'], use: 'new Sortable(listEl, { animation: 150 })' },
  { name: 'Howler (sound)', k: 'son sound audio musique music jeu game effects', tags: ['<script src="https://cdn.jsdelivr.net/npm/howler@2.2.4/dist/howler.min.js"></script>'], use: 'new Howl({ src: ["url.mp3"] }).play()' },
  { name: 'Tone.js (music synthesis)', k: 'synthé synth piano notes musique beat sequencer', tags: ['<script src="https://cdn.jsdelivr.net/npm/tone@14.7.77/build/Tone.js"></script>'], use: 'new Tone.Synth().toDestination().triggerAttackRelease("C4", "8n")' },
  { name: 'Phaser (2D games)', k: 'jeu game arcade platformer sprite physique physics', tags: ['<script src="https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js"></script>'], use: 'new Phaser.Game({ type: Phaser.AUTO, width: 800, height: 600, scene: { create() {}, update() {} } })', note: 'Small games are often simpler with a plain <canvas>.' },
  { name: 'Matter.js (physics)', k: 'physique physics gravité collision', tags: ['<script src="https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js"></script>'], use: 'const { Engine, Render, Bodies, Composite, Runner } = Matter;' },
  { name: 'Day.js (dates)', k: 'date calendrier calendar durée countdown compte à rebours', tags: ['<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>'], use: 'dayjs().add(7, "day").format("DD/MM/YYYY")' },
  { name: 'qrcode-generator', k: 'qr code qrcode', tags: ['<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>'], use: 'const q = qrcode(0, "M"); q.addData("https://…"); q.make(); el.innerHTML = q.createSvgTag(4);' },
  { name: 'Fuse.js (fuzzy search)', k: 'recherche search filtre fuzzy', tags: ['<script src="https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js"></script>'], use: 'new Fuse(items, { keys: ["name"] }).search(q)' },
  { name: 'marked (Markdown)', k: 'markdown md rendu texte', tags: ['<script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"></script>'], use: 'el.innerHTML = marked.parse(text)' },
  { name: 'highlight.js (code)', k: 'code coloration syntax highlight', tags: ['<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css">', '<script src="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js"></script>'], use: 'hljs.highlightAll()' },
  { name: 'jsPDF + html2canvas', k: 'export pdf télécharger download capture image png', tags: ['<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>'], use: 'html2canvas(el).then((c) => { const pdf = new jspdf.jsPDF(); pdf.addImage(c.toDataURL("image/png"), "PNG", 10, 10, 190, 0); pdf.save("x.pdf"); })' },
  { name: 'p5.js (creative coding)', k: 'art génératif generative dessin animation canvas créatif creative', tags: ['<script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"></script>'], use: 'function setup() { createCanvas(400, 400); } function draw() { circle(mouseX, mouseY, 20); }' },
];
const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9.]+/).filter((w) => w.length > 1);
function curated(need) {
  const q = words(need);
  return LIBS.map((l) => ({ l, s: q.filter((w) => words(l.k + ' ' + l.name).some((x) => x.startsWith(w) || w.startsWith(x))).length })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.l);
}
async function npmSearch(need) {
  try {
    const r = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(need)}&size=6&popularity=1.0`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.objects || []).map((o) => o.package).filter((p) => p && p.name).slice(0, 5).map((p) => ({ name: p.name, version: p.version, description: (p.description || '').slice(0, 140) }));
  } catch { return []; }
}

agent.register({
  name: 'design_guide', category: 'design', risk: 'read', core: true,
  description: 'Before making a web page, app, document/PDF, slide deck or drawing: get the design guide for that kind — what to think about, the Fabro Kit classes (themes, components, icons, real photos, charts) and a complete example to follow.',
  parameters: { type: 'object', properties: { kind: { type: 'string', enum: guide.kindsList(), description: 'What you are making' } }, required: ['kind'] },
  summarize: (a) => a.kind,
  async run(a) { return { content: guide.guide(a.kind) }; },
});

agent.register({
  name: 'find_library', category: 'design', risk: 'net', keywords: ['librar', 'bibliot', 'map', 'carte', '3d', 'jeu', 'game', 'graph', 'chart', 'anim', 'qr', 'math', 'drag', 'son', 'sound', 'music', 'confetti', 'diagram'],
  description: 'Find a JavaScript library for a web page or app (charts, maps, 3D, animations, games, sound, QR codes, maths, drag & drop…): returns the exact <script>/<link> tags with pinned CDN versions and a usage line.',
  parameters: { type: 'object', properties: { need: { type: 'string', description: 'What you need, e.g. "interactive map", "3d globe", "drag and drop list"' } }, required: ['need'] },
  summarize: (a) => a.need,
  async run(a) {
    const c = curated(a.need);
    const lines = c.map((l) => `## ${l.name}\n${l.tags.join('\n')}\nUse: ${l.use}${l.note ? `\nNote: ${l.note}` : ''}`);
    if (c.length < 2) {
      const npm = await npmSearch(a.need);
      if (npm.length) lines.push('## Other packages on npm (load from jsDelivr; check that they work in the browser)\n' + npm.map((p) => `- ${p.name}@${p.version} — ${p.description}\n  <script src="https://cdn.jsdelivr.net/npm/${p.name}@${p.version}"></script>  (ES module: import x from "https://cdn.jsdelivr.net/npm/${p.name}@${p.version}/+esm")`).join('\n'));
    }
    return { content: lines.length ? lines.join('\n\n') + '\n\nPut <link> in <head> and <script> before your own script at the end of <body>. Prefer no library when plain HTML/CSS/JS or the Fabro Kit can do it.' : `No library found for “${a.need}”. Plain JavaScript is often enough.` };
  },
});

agent.register({
  name: 'find_images', category: 'design', risk: 'net', keywords: ['photo', 'image', 'picture', 'illustration'],
  description: 'Find real, free-to-use photos (with the credit to show). Usually simpler: write <img data-photo="2-4 concrete words"> and Fabro inserts a photo itself.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: '2-4 concrete English words describing what is visible' }, count: { type: 'number' } }, required: ['query'] },
  summarize: (a) => a.query,
  async run(a) {
    const list = await kit.searchPhotos(String(a.query || ''), Math.max(1, Math.min(8, a.count | 0 || 4)));
    if (!list.length) return { content: `No photo found for “${a.query}” (or offline). Try simpler, concrete words (e.g. "coffee cup", "mountain lake").` };
    return { content: list.map((p, i) => `${i + 1}. ${p.url}\n   credit: ${p.credit}${p.title ? ` · “${p.title.slice(0, 60)}”` : ''} · ${p.width || '?'}×${p.height || '?'}`).join('\n') + '\n\nUse <img src="URL" data-credit="CREDIT" alt="…"> — the kit lists the credits at the bottom of the page.' };
  },
});

const TYPES = ['html', 'document', 'slides', 'sheet', 'svg', 'markdown', 'code'];
const visual = (t) => ['html', 'document', 'slides', 'svg'].includes(t);

async function checkResult(art, extra = '') {
  const qa = require('../kit/qa');
  const content = art.versions[art.versions.length - 1].content;
  const r = await qa.check(content, { type: art.type, title: art.title }).catch((e) => ({ ok: true, text: `(Visual check failed: ${e.message})`, image: null, errors: [], warnings: [] }));
  art.qa = { ok: r.ok, errors: r.errors.length, warnings: r.warnings.length, v: art.versions.length - 1, at: Date.now() };
  db.saveArtifact(art);
  return { content: `${extra}${extra ? '\n' : ''}Artifact ${art.id} “${art.title}” (${art.type}, version ${art.versions.length}).\n${r.text}`, image: r.image || undefined, view: { kind: 'artifact', artifactId: art.id, title: art.title, type: art.type, v: art.versions.length - 1, shot: r.image || undefined, qa: art.qa } };
}

agent.register({
  name: 'create_artifact', category: 'design', risk: 'read', core: true,
  description: 'Create an artifact the user can open, edit and export: a web page/app (type html), Fabro Docs (type document: report, CV, letter, invoice… — exports to PDF, Word .docx, OpenDocument .odt), Fabro Slides (type slides — exports to PDF, PowerPoint .pptx, .odp), Fabro Calc (type sheet: a spreadsheet with formulas — exports to Excel .xlsx, .ods, CSV), an SVG drawing, Markdown notes (only if asked) or code. Or open a file the user gave (from_file: Word, PowerPoint, Excel, OpenDocument, CSV, HTML, code…): it becomes an artifact; documents and decks keep their original layout and you change their text with edit_artifact. Visual ones are rendered and checked automatically.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: TYPES },
      title: { type: 'string' },
      content: { type: 'string', description: 'The full content: a complete HTML page (Fabro Kit: <body data-theme="…">, class "doc" for documents, "deck" for slides), for sheet a JSON workbook {"sheets":[{"name":"…","rows":[["Item","Price"],["A",12],["Total","=SUM(B2:B2)"]],"cols":[160,90],"style":{"1":{"b":1,"bg":"#f2efe8"},"B3":{"fmt":"# ##0.00 €"}},"freeze":1}]} (or CSV), an <svg>, Markdown or code' },
      lang: { type: 'string', description: 'For code: the language' },
      from_file: { type: 'string', description: 'Instead of content: path of a file to open as an artifact (docx, odt, pptx, odp, xlsx, ods, csv, html, md, svg, code)' },
    },
    required: ['title'],
  },
  summarize: (a) => `${a.title} (${a.type})`,
  async run(a, ctx) {
    if (a.from_file) {
      const files = require('./files'); const f = files.resolvePath(a.from_file, ctx); await files.access(f, ctx, false);
      let art; try { art = require('../office').importFile(f, { convId: ctx.convId || null }); } catch (e) { return { error: e.message }; }
      if (a.title) art.title = String(a.title).slice(0, 120);
      db.saveArtifact(art); if (ctx.emit) ctx.emit({ type: 'artifact_updated', id: art.id });
      const head = `Opened “${require('path').basename(f)}” as artifact ${art.id} (${art.type}${art.office ? `, original ${art.office.ext.toUpperCase()} layout kept` : ''}). Read it with read_artifact; change it with edit_artifact.`;
      if (art.type === 'sheet' || !visual(art.type)) return { content: head, view: { kind: 'artifact', artifactId: art.id, title: art.title, type: art.type, v: 0 } };
      return checkResult(art, head);
    }
    const type = TYPES.includes(a.type) ? a.type : 'html';
    let content = String(a.content || '');
    if (type === 'sheet') {
      const office = require('../office'); const wb = office.calc.normalize(content);
      const art = db.saveArtifact({ id: 'art-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), convId: ctx.convId || null, type, title: String(a.title || 'Untitled').slice(0, 120), versions: [{ content: JSON.stringify(wb), at: Date.now(), by: 'ai' }] });
      if (ctx.emit) ctx.emit({ type: 'artifact_updated', id: art.id });
      return { content: `Created Fabro Calc ${art.id} “${art.title}”.\n${sheetText(wb, 30)}`, view: { kind: 'artifact', artifactId: art.id, title: art.title, type, v: 0 } };
    }
    if (!content.trim()) return { error: 'Empty content.' };
    if (visual(type) && type !== 'svg' && /^\s*(#|\*|-)\s/m.test(content) && !/<[a-z][\s\S]*>/i.test(content)) return { error: 'This looks like Markdown. Visual artifacts are HTML: call design_guide for the example to follow, or use type "markdown" if the user asked for Markdown.' };
    const baked = visual(type) ? await kit.bake(content).catch(() => ({ html: content })) : { html: content };
    const art = db.saveArtifact({ id: 'art-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), convId: ctx.convId || null, type, title: String(a.title || 'Untitled').slice(0, 120), lang: a.lang || '', versions: [{ content: baked.html, at: Date.now(), by: 'ai' }] });
    if (ctx.emit) ctx.emit({ type: 'artifact_updated', id: art.id });
    if (!visual(type)) return { content: `Created artifact ${art.id} “${art.title}” (${type}).`, view: { kind: 'artifact', artifactId: art.id, title: art.title, type, v: 0 } };
    return checkResult(art, baked.photos ? `${baked.photos} photo(s) inserted.` : '');
  },
});

agent.register({
  name: 'check_artifact', category: 'design', risk: 'read', core: true,
  description: 'Look at an artifact the way a designer would: rendered on desktop and phone (or as printed pages / slides), with a picture and the list of visible problems (overflow, overlaps, unreadable contrast, broken images, cut text, empty pages, JavaScript errors…).',
  parameters: { type: 'object', properties: { artifact: { type: 'string', description: 'Artifact id or title' } }, required: ['artifact'] },
  summarize: (a) => a.artifact,
  async run(a, ctx) {
    const art = require('./layout').findArtifact(a.artifact, ctx);
    if (!art) return { error: `No artifact "${a.artifact}".` };
    if (!visual(art.type) && art.type !== 'markdown') return { content: `“${art.title}” is ${art.type}: nothing to look at.` };
    return checkResult(art);
  },
});

// A workbook as text for the AI: each non-empty cell with its reference, formula and value.
function sheetText(wbIn, maxRows = 200) {
  const office = require('../office'), C = office.calc, book = new C.Workbook(wbIn);
  return book.wb.sheets.map((sh, si) => {
    const vals = book.computed(si), lines = [`Sheet “${sh.name}” (${sh.rows.length} rows)`];
    sh.rows.slice(0, maxRows).forEach((row, r) => { const cells = row.map((raw, c) => { if (raw === '' || raw == null) return null; const v = vals[r][c], f = typeof raw === 'string' && raw[0] === '=' ? `${raw} → ${C.format(v, C.styleOf(sh, r, c).fmt)}` : JSON.stringify(raw); return `${C.ref(r, c)}: ${f}`; }).filter(Boolean); if (cells.length) lines.push(cells.join(' | ')); });
    if (sh.rows.length > maxRows) lines.push(`… ${sh.rows.length - maxRows} more rows`);
    return lines.join('\n');
  }).join('\n\n');
}

agent.register({
  name: 'export_artifact', category: 'documents', risk: 'write', keywords: ['export', 'docx', 'word', 'excel', 'xlsx', 'powerpoint', 'pptx', 'odt', 'ods', 'odp', 'libreoffice', 'opendocument', 'fichier', 'file', 'télécharg', 'download', 'csv'],
  description: 'Save an artifact as a file: Fabro Docs → docx / odt, Fabro Slides → pptx / odp, Fabro Calc → xlsx / ods / csv (PDF: the user exports it from the artifact). A file that was imported keeps its exact original layout in its own format.',
  parameters: { type: 'object', properties: { artifact: { type: 'string', description: 'Artifact id or title' }, format: { type: 'string', enum: ['docx', 'odt', 'pptx', 'odp', 'xlsx', 'ods', 'csv'] }, folder: { type: 'string', description: 'Optional folder (default Documents/Fabro)' } }, required: ['artifact', 'format'] },
  summarize: (a) => `${a.artifact} → .${a.format}`,
  async run(a, ctx) {
    const art = require('./layout').findArtifact(a.artifact, ctx); if (!art) return { error: `No artifact "${a.artifact}".` };
    const files = require('./files'), fs = require('fs'), path = require('path');
    const dir = a.folder ? files.resolvePath(a.folder, ctx) : files.defaultOut(); fs.mkdirSync(dir, { recursive: true }); if (a.folder) await files.access(path.join(dir, 'x'), ctx, true);
    const safe = String(art.title || 'Fabro').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Fabro';
    let file = path.join(dir, `${safe}.${a.format}`); for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${safe} (${i}).${a.format}`);
    let buf; try { buf = await require('../office').exportArtifact(art, a.format); } catch (e) { return { error: e.message }; }
    fs.writeFileSync(file, buf); files.touched(ctx, file, 'created');
    return { content: `Saved ${path.basename(file)} (${Math.round(buf.length / 1024)} KB). The user sees the artifact card; mention the file name only.`, view: { kind: 'artifact', artifactId: art.id, title: art.title, type: art.type, v: art.versions.length - 1 } };
  },
});

module.exports = { checkResult, visual, LIBS, sheetText };
