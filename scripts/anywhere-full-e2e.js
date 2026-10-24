// Fabro Anywhere — the computer's full interface on a phone, end to end: the real desktop app and the phone
// app (mobile Chromium) pair with the text code, then the phone loads the computer's own interface in its
// sandboxed frame and uses it: chat answered by the computer's model, agent mode, the Agents app, settings,
// a computer image shown and zoomed, a computer file opened on the phone, the "computer away" bar, and the
// switch back to the light view. Also checks: no horizontal scroll, inputs that don't zoom the page.
// Run: xvfb-run -a node scripts/anywhere-full-e2e.js [shotsDir]
const { _electron: electron, chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const zlib = require('zlib');
const { execFileSync } = require('child_process');
const relayServer = require('./mqtt-relay');

const ROOT = path.join(__dirname, '..');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'faf-shots-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'faf-pc-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'dark', onboarded: true, devModeReleased: true, hotkey: { enabled: false } }));
const step = (s) => console.log('•', s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a real picture on the computer (gradient + rings), in Fabro's folder
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const r = Math.hypot(x - w / 2, y - h / 2); raw[i] = (x * 255 / w) | 0; raw[i + 1] = (Math.sin(r / 9) * 127 + 128) | 0; raw[i + 2] = (y * 255 / h) | 0; } }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const picture = path.join(userData, 'photos', 'vacances.png');
fs.mkdirSync(path.dirname(picture), { recursive: true }); fs.writeFileSync(picture, png(640, 420));
const secret = path.join(os.homedir(), '.fabro-e2e-secret-' + Date.now() + '.txt'); // outside Fabro's folders, never shown

// fake OpenAI-compatible model
const llm = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
    const body = JSON.parse(b || '{}'); const sys = String((body.messages && body.messages[0] && body.messages[0].content) || '');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const words = /You name conversations/.test(sys) ? ['Capitale'] : /maintain a short memory/.test(sys) ? ['[]'] : 'La capitale de la France est **Paris**.'.split(/(?<= )/);
    let i = 0; const tick = () => { if (i < words.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`); setTimeout(tick, 30); } else res.end('data: [DONE]\n\n'); }; tick();
  });
});
const dist = path.join(ROOT, 'site', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const site = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p); if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' }); fs.createReadStream(f).pipe(res);
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

(async () => {
  execFileSync('node', [path.join(ROOT, 'site', 'build.js')], { stdio: 'ignore' });
  const relay = await relayServer.start(0);
  const llmPort = await listen(llm), sitePort = await listen(site);

  // ── the computer ──
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1', FABRO_ANYWHERE_RELAYS: relay.url } });
  const win = await app.firstWindow();
  const pcErrors = []; win.on('pageerror', (e) => pcErrors.push(e.message));
  await win.waitForFunction(() => typeof S !== 'undefined' && S.settings, null, { timeout: 30000 });
  await win.evaluate(async (base) => {
    await api.providers.enable(true);
    const v = await api.providers.add({ kind: 'custom', baseUrl: base, name: 'Fake' });
    await saveSettings({ selectedModel: { backend: 'provider', provider: v.list[0].id, model: 'fake-model' } });
    await refreshModels();
  }, `http://127.0.0.1:${llmPort}/v1`);
  const code = await win.evaluate(() => api.anywhere.pairStart());

  // ── the phone ──
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile() ? '/opt/pw-browsers/chromium' : undefined) });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', colorScheme: 'dark', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  const phone = await ctx.newPage();
  const phErrors = []; phone.on('pageerror', (e) => phErrors.push('page: ' + e.message));
  // ("Not allowed to load local resource": the browser's first attempt at a file:// src, before the frame swaps in the copy from the computer)
  phone.on('console', (m) => { if (/needs the computer/.test(m.text())) console.log('  [phone]', m.text()); });
  phone.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|WebGPU|gpu|Not allowed to load local resource/i.test(m.text())) phErrors.push(m.text().slice(0, 300)); });
  await phone.goto(`http://127.0.0.1:${sitePort}/app/`);
  await phone.waitForFunction(() => window.__fa && window.FAHost, null, { timeout: 15000 });
  await phone.evaluate((u) => { window.__fa.S.settings.customRelay = u; }, relay.url);
  await phone.click('[data-act=code]');
  await phone.fill('#code-in', code.text);
  await phone.press('#code-in', 'Enter');
  await phone.waitForFunction(() => window.__fa.S.view === 'paired', null, { timeout: 60000 })
    .catch(async (e) => { console.log('pairing', await phone.evaluate(() => JSON.stringify({ view: window.__fa.S.view, err: window.__fa.S.pairErr }))); console.log('phone errors', phErrors, 'pc', pcErrors); await phone.screenshot({ path: path.join(shots, 'FAIL-pair.png') }); throw e; });
  step('paired with the text code');
  await phone.click('[data-act=start]');

  // ── the full interface loads from the computer ──
  await phone.waitForSelector('#full', { timeout: 30000 });
  const frameOf = () => phone.frames().find((f) => /\/app\/full\.html/.test(f.url()));
  await phone.waitForFunction(() => document.body.classList.contains('full-on') && !document.body.classList.contains('full-loading'), null, { timeout: 60000 })
    .catch(async (e) => { console.log('phone errors', phErrors, 'pc', pcErrors); await phone.screenshot({ path: path.join(shots, 'FAIL-load.png') }); throw e; });
  const F = frameOf(); assert.ok(F, 'interface frame');
  await F.waitForSelector('#prompt', { timeout: 30000 });
  const sandbox = await phone.$eval('#full', (f) => f.getAttribute('sandbox'));
  assert.ok(!/allow-same-origin/.test(sandbox), 'the interface runs in an opaque origin');
  assert.strictEqual(await F.evaluate(() => { try { return typeof indexedDB.open('x'); } catch { return 'blocked'; } }), 'blocked', 'no access to the phone app storage');
  await wait(600);
  await phone.screenshot({ path: path.join(shots, '01-full-home.png') });
  step('the computer’s interface runs on the phone (sandboxed)');
  const noScroll = async (where) => {
    const F = frameOf(); await F.waitForSelector('#app');
    const ok = await F.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1);
    if (!ok) console.log('overflow', where, JSON.stringify(await F.evaluate(() => { const W = innerWidth; const out = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' ' + Math.round(r.left) + '→' + Math.round(r.right)); } return { W, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, out: out.slice(0, 12) }; })));
    assert.ok(ok, 'no horizontal scroll: ' + where);
  };
  await noScroll('home');
  const fontOk = await F.evaluate(() => [...document.querySelectorAll('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file])')].filter((e) => e.offsetParent).every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16));
  assert.ok(fontOk, 'text fields are at least 16px (no zoom on focus)');

  // ── chat answered by the computer's model ──
  await F.fill('#prompt', 'Quelle est la capitale de la France ?');
  await F.press('#prompt', 'Enter');
  await F.waitForFunction(() => /Paris/.test(document.querySelector('.msg.assistant .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 30000 })
    .catch(async (e) => { console.log('phone errors', phErrors, 'pc', pcErrors); await phone.screenshot({ path: path.join(shots, 'FAIL-chat.png') }); throw e; });
  await wait(400); await phone.screenshot({ path: path.join(shots, '02-full-chat.png') });
  await noScroll('chat');
  const onPc = await win.evaluate(async () => (await api.conv.list()).length);
  assert.ok(onPc >= 1, 'the conversation is on the computer');
  step('chat answered by the computer (streamed to the phone)');

  // ── sidebar as a drawer, the Agents app, settings ──
  await F.click('.topbar [data-action=toggle-sidebar]');
  await F.waitForFunction(() => document.querySelector('#app').classList.contains('drawer-open') && /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(getComputedStyle(document.querySelector('#sidebar')).transform)); // slid in
  await wait(400); await phone.screenshot({ path: path.join(shots, '03-full-drawer.png') });
  assert.ok(await F.$eval('#sb-lists', (e) => /Capitale/.test(e.textContent)), 'the chat is listed in the drawer');
  step('sidebar opens as a drawer');
  await F.click('.app-item[data-id=agents]');
  await F.waitForSelector('.ag-wrap', { timeout: 10000 });
  await wait(300); await phone.screenshot({ path: path.join(shots, '04-full-agents.png') });
  await noScroll('agents app');
  step('Agents app opens on the phone');
  await F.evaluate(() => openSettings('general'));
  await F.waitForSelector('.overlay.shown .st-panel', { timeout: 10000 });
  await wait(300); await phone.screenshot({ path: path.join(shots, '05-full-settings.png') });
  await noScroll('settings');
  await F.evaluate(() => { try { closeSettings(); } catch {} try { closeModal(); } catch {} });
  step('settings open on the phone');

  // ── a picture from the computer, shown and zoomed ──
  await F.evaluate((p) => openViewer({ type: 'image', title: 'vacances.png', src: 'file://' + p }), picture);
  await F.waitForFunction(() => { const i = document.querySelector('.v-media img'); return i && /^blob:/.test(i.src) && i.naturalWidth === 640; }, null, { timeout: 20000 });
  // pinch: two fingers moving apart
  await F.evaluate(() => {
    const img = document.querySelector('.v-media img'); const r = img.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, id, x) => img.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true, cancelable: true, isPrimary: id === 1 }));
    ev('pointerdown', 1, cx - 20); ev('pointerdown', 2, cx + 20);
    for (let k = 1; k <= 10; k++) { ev('pointermove', 1, cx - 20 - k * 8); ev('pointermove', 2, cx + 20 + k * 8); }
    ev('pointerup', 1, cx - 100); ev('pointerup', 2, cx + 100);
  });
  const scale = await F.evaluate(() => { const m = (document.querySelector('.v-media img').style.transform || '').match(/scale\(([\d.]+)\)/); return m ? +m[1] : 1; });
  assert.ok(scale > 2.5, 'pinch zooms the picture: ' + scale);
  await wait(200); await phone.screenshot({ path: path.join(shots, '06-full-zoom.png') });
  step(`computer picture shown on the phone and pinch-zoomed (×${scale.toFixed(1)})`);
  // a file the phone was never shown, outside Fabro's folders: refused
  fs.writeFileSync(secret, 'nope');
  const refused = await phone.evaluate((p) => window.__fa.rpc('ui.file', { path: p }).then(() => 'served', (e) => e.message), secret);
  assert.match(refused, /not available/i, 'files outside what the phone was shown are refused');
  fs.unlinkSync(secret);
  step('a file the phone was never shown is refused');

  // ── "open" a computer file: opens on the phone, not on the computer ──
  await F.evaluate((p) => api.shell.openPath(p), picture);
  await phone.waitForSelector('#full-fv .fv-zoom img', { timeout: 20000 });
  await wait(300); await phone.screenshot({ path: path.join(shots, '07-full-open-file.png') });
  await phone.click('#full-fv [data-fv=close]');
  step('opening a computer file shows it on the phone');

  // ── the computer goes away, comes back ──
  await win.evaluate(() => api.anywhere.configure({ enabled: false }));
  await phone.waitForSelector('#full-offbar', { timeout: 20000 });
  await phone.screenshot({ path: path.join(shots, '08-full-away.png') });
  step('"computer unreachable" bar while away');
  await win.evaluate(() => api.anywhere.configure({ enabled: true }));
  await phone.waitForFunction(() => !document.querySelector('#full-offbar') && !document.body.classList.contains('full-loading'), null, { timeout: 90000 });
  const F2 = frameOf(); await F2.waitForSelector('#prompt', { timeout: 30000 });
  step('back: the interface reloads from the computer');

  // ── back to the light view ──
  await F2.click('.sb-user, [data-action=user-menu]').catch(() => {});
  const lite = await F2.$('[data-action=remote-lite]');
  if (lite) await lite.click(); else await F2.evaluate(() => window.FABRO_REMOTE.lite());
  await phone.waitForFunction(() => !document.querySelector('#full') && !document.body.classList.contains('full-on'), null, { timeout: 10000 });
  await phone.waitForSelector('#prompt', { timeout: 10000 });
  await phone.screenshot({ path: path.join(shots, '09-lite.png') });
  step('switched back to the light phone view');

  // ── a tablet / desktop browser gets the desktop layout ──
  await phone.evaluate(async () => { window.__fa.S.settings.ui = 'full'; await window.FAFull.open(); });
  await phone.waitForFunction(() => document.body.classList.contains('full-on') && !document.body.classList.contains('full-loading'), null, { timeout: 30000 });
  await phone.setViewportSize({ width: 1280, height: 800 }); await wait(500);
  await phone.screenshot({ path: path.join(shots, '10-full-wide.png') });
  await noScroll('wide');

  assert.deepStrictEqual(pcErrors, [], 'no errors on the computer');
  assert.deepStrictEqual(phErrors, [], 'no errors on the phone');
  console.log('anywhere-full-e2e: all passed →', shots);
  await browser.close();
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  relay.close(); llm.close(); site.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
