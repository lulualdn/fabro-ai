// Artifacts end to end, with a fake model: the design guide, an agent that creates a web page with a visible
// problem → Fabro's visual check catches it → the agent fixes it with edit_artifact → the check is clean;
// in chat, the documents guide is given for a poster and the document artifact is checked and pictured;
// find_library gives the right CDN tags; cards and the Artifacts page show page-1 pictures on pastels.
// Run: xvfb-run -a node scripts/artifacts-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-art-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-art-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'light', onboarded: true, devModeReleased: true, hotkey: { enabled: false }, agent: { permissions: { create_artifact: 'always', edit_artifact: 'always' } } }));
const step = (s) => console.log('✓', s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BAD = `<!doctype html><html lang="fr"><head><title>Boulangerie Dupain</title></head><body data-theme="forest">
<nav class="nav"><div class="container"><a class="logo"><i data-icon="coffee"></i> Dupain</a><div class="links"><a href="#pains">Pains</a><a href="#infos">Infos</a></div></div></nav>
<header class="hero center"><div class="container"><span class="eyebrow">Depuis 1972</span><h1>Le pain du quartier, cuit au feu de bois</h1><p class="lead">Levain naturel, farines locales, et des croissants qui partent avant 9 h.</p>
<div class="actions"><a class="btn" href="#infos">Nous trouver</a></div></div></header>
<section class="section" id="pains"><div class="container"><div style="width:1400px" class="grid-3"><div class="card"><h3>Tradition</h3><p>1,30 €</p></div><div class="card"><h3>Campagne</h3><p>3,90 €</p></div><div class="card"><h3>Croissant</h3><p>1,20 €</p></div></div></div></section>
<footer class="footer" id="infos"><div class="container"><p>12 rue Haute, Nantes · 7 h – 19 h30</p></div></footer></body></html>`;
const FLYER = `<!doctype html><html lang="fr"><head><title>Fête de l’école</title></head><body class="doc" data-theme="sunset">
<section class="page fixed poster"><div class="poster-body"><span class="eyebrow">Samedi 20 juin</span><h1>Fête de l’école Jules-Verne</h1><p class="lead">Jeux, kermesse, spectacle des CM2 et barbecue des parents.</p>
<div class="info"><div><b>Quand</b><br>Samedi 20 juin<br>de 10 h à 17 h</div><div><b>Où</b><br>Cour de l’école<br>3 rue des Écoles</div><div><b>Entrée</b><br>Libre<br>Tickets jeux 1 €</div></div></div></section></body></html>`;

const sse = (res, text) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const part of text.match(/[\s\S]{1,200}/g) || ['']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
const call = (res, name, args) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + Math.random().toString(36).slice(2, 7), function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
const seen = { sys: [], tools: [] };
const srv = http.createServer((req, res) => {
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-large' }] }));
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    const sys = String((body.messages[0] || {}).content || '');
    const users = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || '').join(' ')));
    const first = users.filter((u) => !/^\[Fabro/.test(u)).pop() || '';
    const tools = body.messages.filter((m) => m.role === 'tool').map((m) => String(m.content || ''));
    if (/You name conversations|maintain a short memory/.test(sys)) return sse(res, /memory/.test(sys) ? '[]' : 'Test');
    if (/boulangerie/i.test(first) && /site/i.test(first)) {
      seen.tools = tools;
      if (tools.length === 0) return call(res, 'design_guide', { kind: 'business' });
      if (tools.length === 1) return call(res, 'create_artifact', { type: 'html', title: 'Boulangerie Dupain', content: BAD });
      if (tools.length === 2) return /✗/.test(tools[1]) ? call(res, 'edit_artifact', { artifact: 'Boulangerie Dupain', edits: [{ old_text: '<div style="width:1400px" class="grid-3">', new_text: '<div class="grid-3">' }] }) : sse(res, 'Pas de problème vu.');
      return sse(res, 'Le site est prêt : tout passe sur téléphone et ordinateur.');
    }
    if (/affiche/i.test(first)) { seen.sys.push(sys); return sse(res, /Fabro Kit for documents/.test(sys) ? `Voici l’affiche.\n<artifact type="document" title="Fête de l’école">\n${FLYER}\n</artifact>` : 'NO GUIDE'); }
    if (/carte interactive/i.test(first)) {
      if (!tools.length) return call(res, 'find_library', { need: 'carte interactive' });
      return sse(res, 'Bibliothèque : ' + (tools[0].match(/## ([^\n]+)/) || [])[1]);
    }
    sse(res, 'ok');
  });
});
async function until(fn, ms = 20000, what = '') { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await wait(250); } throw new Error('timeout: ' + what); }

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  await win.evaluate(async (u) => { await api.providers.enable(true); await api.providers.add({ kind: 'custom', name: 'Fake', baseUrl: u }); await refreshModels(); const m = allModels()[0]; if (m) await saveSettings({ selectedModel: m.ref }); }, base);
  const lastMsg = () => win.evaluate(() => { const m = S.conv && S.conv.messages.at(-1); return m && { pending: !!m.pending, content: m.content, steps: (m.steps || []).map((s) => ({ name: s.name, status: s.status, view: s.view && { kind: s.view.kind, qa: s.view.qa, id: s.view.artifactId } })), artCheck: m.artCheck }; });

  // 1. agent: guide → page with a problem → check catches it → fix → clean
  await win.fill('#prompt', 'Crée un site pour ma boulangerie'); await win.keyboard.press('Enter');
  const m1 = await until(async () => { const m = await lastMsg(); return m && !m.pending && m.steps.length >= 3 && m; }, 60000, 'agent finished');
  assert.deepStrictEqual(m1.steps.map((s) => s.name), ['design_guide', 'create_artifact', 'edit_artifact'], 'tools: ' + JSON.stringify(m1.steps.map((s) => s.name)));
  assert.match(seen.tools[0], /Complete example to follow[\s\S]*class="hero image"/, 'the guide gives a complete example of the same kind');
  assert.match(seen.tools[1], /✗ At 390px wide the page is \d+px: it scrolls sideways on phones/, 'the check finds the page too wide on phones');
  assert.strictEqual(m1.steps[1].view.qa.ok, false); assert.strictEqual(m1.steps[2].view.qa.ok, true, 'clean after the fix');
  assert.match(seen.tools[2] || '', /no visible problem/);
  await until(() => win.evaluate(() => [...document.querySelectorAll('.msg.assistant:last-child .art-card .art-thumb img')].some((i) => i.naturalWidth > 0)), 30000, 'agent card picture');
  await wait(400); await win.screenshot({ path: path.join(shots, '01-agent-site.png') });
  step('agent: guide → problem caught (too wide on phones) → fixed with edit_artifact → clean check');

  // 2. chat: a poster gets the documents guide; the document is checked and pictured
  await win.click('[data-action=new-chat]');
  await win.fill('#prompt', 'Fais-moi une affiche pour la fête de l’école'); await win.keyboard.press('Enter');
  const m2 = await until(async () => { const m = await lastMsg(); return m && !m.pending && m; }, 40000, 'poster answer');
  assert.ok(/Fabro Kit for documents/.test(seen.sys.at(-1)) && /Making a flyer/.test(seen.sys.at(-1)), 'documents guide in the chat system prompt');
  assert.ok(m2.artCheck && m2.artCheck.status === 'ok', 'the poster was checked: ' + JSON.stringify(m2.artCheck));
  const doc = await win.evaluate(async () => (await api.artifacts.list()).find((a) => a.type === 'document'));
  assert.ok(doc, 'saved as a document artifact');
  await until(() => win.evaluate(() => [...document.querySelectorAll('.msg.assistant:last-child .art-card .art-thumb img')].some((i) => i.naturalWidth > 0)), 30000, 'poster card picture');
  await wait(800); await win.screenshot({ path: path.join(shots, '02-chat-poster.png') });
  step('chat: poster written with the documents guide, checked, card shows page 1');

  // 3. the right library, with pinned CDN tags
  await win.click('[data-action=new-chat]');
  await win.fill('#prompt', 'Il me faut une carte interactive des boulangeries'); await win.keyboard.press('Enter');
  const m3 = await until(async () => { const m = await lastMsg(); return m && !m.pending && m; }, 30000, 'library answer');
  assert.match(m3.content, /Leaflet/, 'find_library → Leaflet');
  step('find_library: Leaflet with pinned CDN tags');

  // 4. Artifacts page: pictures on pastels, a file icon for code
  await win.evaluate(() => api.artifacts.save({ id: 'art-code1', type: 'code', lang: 'python', title: 'script.py', versions: [{ content: 'print("hi")', at: Date.now(), by: 'user' }] }));
  await win.click('.nav-item[data-mode=artifacts]');
  await until(() => win.evaluate(() => document.querySelectorAll('.art-tile .art-thumb img').length >= 2 && [...document.querySelectorAll('.art-tile .art-thumb img')].every((i) => i.naturalWidth > 0)), 30000, 'gallery pictures');
  assert.ok(await win.$('.art-tile .art-thumb.is-code .at-file'), 'code artifact shows a file icon');
  const tints = await win.$$eval('.art-tile .art-thumb', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
  assert.ok(tints.every((c) => c !== 'rgba(0, 0, 0, 0)'), 'pastel backgrounds');
  await wait(500); await win.screenshot({ path: path.join(shots, '03-gallery.png') });
  step('Artifacts page: page-1 pictures on pastels, file icon for code');

  // 5. the document opens as A4 pages in the viewer
  await win.click(`.art-tile[data-id="${doc.id}"]`);
  await win.waitForSelector('.viewer iframe.art-frame');
  const f = await (await win.$('.viewer iframe.art-frame')).contentFrame();
  await f.waitForSelector('.page.poster', { timeout: 10000 });
  await wait(600); await win.screenshot({ path: path.join(shots, '04-document-viewer.png') });
  step('document artifact opens as an A4 sheet');

  assert.deepStrictEqual(errs, [], 'no page errors');
  await app.close(); srv.close();
  console.log('artifacts-e2e: all passed →', shots);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
