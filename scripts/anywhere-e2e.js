// Fabro Anywhere end to end: the real desktop app and the phone app (in a mobile Chromium with a fake camera)
// pair by reading the circular code, then: a question from the phone answered by the computer's model in
// streaming, a desktop conversation synced to the phone, a message queued while the computer is away and sent
// when it's back, and revocation from the computer. Uses a local relay and a fake model server.
// Run: xvfb-run -a node scripts/anywhere-e2e.js [shotsDir]
const { _electron: electron, chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { execFileSync } = require('child_process');
const relayServer = require('./mqtt-relay');

const ROOT = path.join(__dirname, '..');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fa-shots-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-pc-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: process.env.FA_THEME || 'dark' }));
const step = (s) => console.log('•', s);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
async function audit(page, name) {
  await page.evaluate(AXE);
  const v = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, rules: { 'color-contrast': { enabled: false } } })).violations.map((x) => ({ id: x.id, impact: x.impact, ex: x.nodes[0] && x.nodes[0].html.slice(0, 140) })));
  const bad = v.filter((x) => x.impact === 'critical' || x.impact === 'serious');
  if (v.length) console.log(`  axe ${name}:`, JSON.stringify(v));
  assert.deepStrictEqual(bad, [], `no serious accessibility problems (${name})`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// fake OpenAI-compatible model
const ANSWER = 'Bonjour depuis ton **ordinateur** ! La capitale de la France est Paris.';
const llm = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
    const body = JSON.parse(b || '{}');
    const sys = String((body.messages && body.messages[0] && body.messages[0].content) || '');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const words = /You name conversations/.test(sys) ? ['Capitale de la France'] : /maintain a short memory/.test(sys) ? ['[]'] : ANSWER.split(/(?<= )/);
    let i = 0;
    const tick = () => { if (i < words.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`); setTimeout(tick, 40); } else res.end('data: [DONE]\n\n'); };
    tick();
  });
});
// static site (the phone app is served from site/dist/app)
const dist = path.join(ROOT, 'site', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.webp': 'image/webp' };
const site = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p); if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

// RGBA frame → a looping Y4M "camera" file for Chromium's fake capture device
function y4m(rgba, w, h, file) {
  const Y = Buffer.alloc(w * h), U = Buffer.alloc((w / 2) * (h / 2)), V = Buffer.alloc((w / 2) * (h / 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; Y[y * w + x] = Math.max(0, Math.min(255, 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])); }
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) {
    const i = ((y * 2) * w + x * 2) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    U[y * (w / 2) + x] = Math.max(0, Math.min(255, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b));
    V[y * (w / 2) + x] = Math.max(0, Math.min(255, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b));
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
}

(async () => {
  execFileSync('node', [path.join(ROOT, 'site', 'build.js')], { stdio: 'ignore' });
  const relay = await relayServer.start(0);
  const llmPort = await listen(llm), sitePort = await listen(site);
  step(`relay ${relay.url}, site :${sitePort}`);

  // ── the computer ──
  const app = await electron.launch({
    executablePath: require('electron'), args: [ROOT, `--user-data-dir=${userData}`, '--no-sandbox'],
    env: { ...process.env, FABRO_E2E: '1', FABRO_ANYWHERE_RELAYS: relay.url },
  });
  const win = await app.firstWindow();
  const pcErrors = []; win.on('pageerror', (e) => pcErrors.push(e.message));
  await win.setViewportSize({ width: 1280, height: 820 });
  await win.waitForFunction(() => typeof S !== 'undefined' && S.settings, null, { timeout: 30000 });
  await win.evaluate(async (base) => {
    await api.providers.enable(true);
    const v = await api.providers.add({ kind: 'custom', baseUrl: base, name: 'Fake' });
    await saveSettings({ selectedModel: { backend: 'provider', provider: v.list[0].id, model: 'fake-model' } });
    await refreshModels();
  }, `http://127.0.0.1:${llmPort}/v1`);
  await win.evaluate(() => openSettings('anywhere'));
  await win.waitForSelector('[data-action=aw-pair]');
  await win.screenshot({ path: path.join(shots, 'pc-anywhere-empty.png') });
  await audit(win, 'settings tab');
  await win.click('[data-action=aw-pair]');
  await win.waitForSelector('.aw-code svg[role=img]', { timeout: 15000 });
  await wait(2600); // reveal animation
  await win.screenshot({ path: path.join(shots, 'pc-pair-code.png') });
  await audit(win, 'pairing dialog');
  const codePng = await (await win.$('.aw-code')).screenshot();
  step('pairing code shown');

  // ── the phone ──
  // a camera that films the computer's screen: the code, smaller, tilted and rotated, on a desk
  const pre = await chromium.launch({ executablePath: process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile() ? '/opt/pw-browsers/chromium' : undefined) });
  const pg = await pre.newPage();
  const frame = await pg.evaluate(async (b64) => {
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
    const W = 1280, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    g.fillStyle = '#3a3630'; g.fillRect(0, 0, W, H);
    g.translate(W / 2 + 20, H / 2 - 10); g.rotate(0.14); g.scale(1, 0.95);
    const d = H * 0.62; g.fillStyle = '#12161d'; g.fillRect(-d * 0.7, -d * 0.7, d * 1.4, d * 1.4); g.drawImage(img, -d / 2, -d / 2, d, d);
    window.__png = cv.toDataURL();
    return Array.from(g.getImageData(0, 0, W, H).data);
  }, codePng.toString('base64'));
  fs.writeFileSync(path.join(shots, 'camera-frame.png'), Buffer.from((await pg.evaluate(() => window.__png)).split(',')[1], 'base64'));
  fs.writeFileSync(path.join(shots, 'code.png'), codePng);
  await pre.close();
  const cam = path.join(userData, 'camera.y4m'); y4m(Uint8Array.from(frame), 1280, 720, cam);

  const phoneBrowser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile() ? '/opt/pw-browsers/chromium' : undefined),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`],
  });
  const ctx = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', colorScheme: process.env.FA_THEME || 'dark', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: `http://127.0.0.1:${sitePort}` });
  const phone = await ctx.newPage();
  const phErrors = []; phone.on('pageerror', (e) => phErrors.push(e.message));
  phone.on('console', (m) => { if (m.type() === 'warning') console.log('  [phone warn]', m.text().slice(0, 300)); if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) phErrors.push(m.text()); });
  await phone.goto(`http://127.0.0.1:${sitePort}/app/`);
  await phone.waitForSelector('[data-act=scan]');
  await phone.screenshot({ path: path.join(shots, 'phone-welcome.png') });
  await audit(phone, 'phone welcome');
  await phone.evaluate((u) => { window.__fa.S.settings.customRelay = u; }, relay.url);
  await phone.click('[data-act=scan]');
  await phone.waitForFunction(() => ['pairing', 'paired'].includes(window.__fa.S.view), null, { timeout: 30000 });
  step('code read by the camera');
  await phone.waitForFunction(() => window.__fa.S.view === 'paired', null, { timeout: 60000 }).catch(async (e) => { console.log('phone', await phone.evaluate(() => JSON.stringify({ view: window.__fa.S.view, err: window.__fa.S.pairErr }))); console.log('phone errors', phErrors, 'pc', pcErrors); throw e; });
  await win.waitForSelector('.aw-done', { timeout: 15000 });
  await phone.screenshot({ path: path.join(shots, 'phone-paired.png') });
  await win.screenshot({ path: path.join(shots, 'pc-paired.png') });
  step('paired');

  // ── a question from the phone ──
  await phone.click('[data-act=start]');
  await phone.waitForFunction(() => ['relay', 'direct'].includes(window.__fa.S.conn.state) && window.__fa.S.conn.info, null, { timeout: 30000 }).catch(async (e) => {
    console.log('phone conn', await phone.evaluate(() => JSON.stringify({ conn: window.__fa.S.conn, link: { ...window.__fa.S.link, k: '…' } })));
    console.log('pc', JSON.stringify(await win.evaluate(() => api.anywhere.status())));
    console.log('phone errors', phErrors, 'pc errors', pcErrors);
    throw e;
  });
  await phone.fill('#prompt', 'Quelle est la capitale de la France ?');
  await phone.click('.composer .send');
  await phone.waitForFunction(() => /Paris/.test((document.querySelector('.msg.ai .md') || {}).textContent || ''), null, { timeout: 30000 });
  await phone.waitForFunction(() => { const c = window.__fa.S.convs.get(window.__fa.S.cur); return c && !c.nodes.some((n) => n.pending); }, null, { timeout: 30000 });
  const via = await phone.evaluate(() => window.__fa.S.conn.state);
  step(`answered in streaming (${via})`);
  await phone.screenshot({ path: path.join(shots, 'phone-chat.png') });
  await audit(phone, 'phone chat');
  const pcConv = await win.evaluate(async () => { const l = await api.conv.list(); return l.find((c) => /capitale/i.test(c.title)); });
  assert.ok(pcConv, 'the conversation is on the computer, titled by the AI');
  await win.evaluate(() => closeModal());
  await win.evaluate(() => closeSettings());
  await win.waitForFunction((id) => S.convs.some((c) => c.id === id), pcConv.id, { timeout: 10000 });
  step('desktop list shows the phone conversation');

  // direct link (WebRTC) should come up on the same machine
  await phone.waitForFunction(() => window.__fa.S.conn.state === 'direct', null, { timeout: 15000 }).then(() => step('direct WebRTC channel up'), () => step('still via relay (no direct path here)'));

  // ── a desktop conversation reaches the phone ──
  await win.evaluate(async () => {
    const t0 = Date.now();
    await api.conv.save({ id: 'desk-' + t0, title: 'Liste de courses', createdAt: t0, updatedAt: t0, leafId: 'n2', nodes: [
      { id: 'n1', role: 'user', content: 'Fais une liste de courses', createdAt: t0, parentId: null },
      { id: 'n2', role: 'assistant', content: '- Pommes\n- Pain', createdAt: t0 + 1, parentId: 'n1' }] });
  });
  await phone.evaluate(() => window.__fa.syncNow());
  await phone.waitForFunction(() => [...window.__fa.S.convs.values(), ...window.__fa.S.metas].some((c) => c.title === 'Liste de courses'), null, { timeout: 15000 });
  step('desktop conversation synced to the phone');

  // the phone model's runtime (WebLLM) loads under the app's security policy
  const webllm = await phone.evaluate(() => import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm').then((m) => typeof m.CreateMLCEngine).catch((e) => 'error: ' + e.message));
  step(`phone model runtime: ${webllm === 'function' ? 'loads' : webllm}`);
  if (!process.env.OFFLINE) assert.strictEqual(webllm, 'function', 'WebLLM loads in the phone app');

  // ── a photo from the phone ──
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAG0lEQVR4nGP4z8BAEmIY1TCqYVTDqIaRqQEAKZ0f8bWgo4MAAAAASUVORK5CYII=', 'base64');
  await phone.setInputFiles('#photo-in', { name: 'tomate.png', mimeType: 'image/png', buffer: png });
  await phone.waitForSelector('.c-att img');
  await phone.fill('#prompt', 'Qu’est-ce que c’est ?');
  await phone.click('.composer .send');
  await phone.waitForFunction(() => { const c = window.__fa.S.convs.get(window.__fa.S.cur); const p = c && window.FabroAnywhere.pathOf(c); return p && p.length >= 4 && !p[p.length - 1].pending && p[p.length - 1].role === 'assistant'; }, null, { timeout: 30000 });
  const withImg = await win.evaluate(async (id) => { const c = await api.conv.get(id); return (c.nodes || []).some((n) => (n.attachments || []).some((a) => a.kind === 'image' && /^data:image\/jpeg/.test(a.data))); }, await phone.evaluate(() => window.__fa.S.cur));
  assert.ok(withImg, 'the photo reached the computer');
  step('photo sent to the computer');

  // ── notifications: the computer posts an encrypted Web Push to the phone's push service ──
  const pushes = [];
  const push = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { pushes.push({ headers: req.headers, size: Buffer.concat(ch).length }); res.writeHead(201); res.end(); }); });
  const pushPort = await listen(push);
  await phone.evaluate(async (endpoint) => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = window.FabroAnywhere.b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    await window.__fa.rpc('push.sub', { sub: { endpoint, keys: { p256dh, auth: window.FabroAnywhere.b64u(crypto.getRandomValues(new Uint8Array(16))) } } });
    await window.__fa.rpc('push.test', { body: 'test' });
  }, `http://127.0.0.1:${pushPort}/push/abc`);
  assert.ok(pushes.length === 1 && pushes[0].headers['content-encoding'] === 'aes128gcm' && /^vapid t=/.test(pushes[0].headers.authorization), 'Web Push sent (aes128gcm + VAPID)');
  push.close();
  step('Web Push notification sent by the computer');

  // ── the computer goes away: the message waits, then goes ──
  await win.evaluate(() => api.anywhere.configure({ enabled: false }));
  await phone.waitForFunction(() => window.__fa.S.conn.state === 'off', null, { timeout: 15000 });
  await phone.fill('#prompt', 'Et celle de l’Espagne ?');
  await phone.click('.composer .send');
  await phone.waitForSelector('.queued', { timeout: 5000 });
  await phone.screenshot({ path: path.join(shots, 'phone-queued.png') });
  step('queued while the computer is away');
  await win.evaluate(() => api.anywhere.configure({ enabled: true }));
  await phone.waitForFunction(() => { const c = window.__fa.S.convs.get(window.__fa.S.cur); if (!c) return false; const p = window.FabroAnywhere.pathOf(c); const l = p[p.length - 1]; return p.length >= 6 && l.role === 'assistant' && !l.pending && /Paris/.test(l.content); }, null, { timeout: 90000 });
  step('sent and answered when the computer came back');

  // ── revoke from the computer ──
  const devs = await win.evaluate(() => api.anywhere.status().then((s) => s.devices));
  assert.strictEqual(devs.length, 1);
  await win.evaluate((id) => api.anywhere.revoke(id), devs[0].id);
  await phone.waitForFunction(() => window.__fa.S.view === 'welcome', null, { timeout: 20000 });
  step('revoked: the phone is back to the welcome screen');

  assert.deepStrictEqual(pcErrors, [], 'no errors on the computer');
  assert.deepStrictEqual(phErrors.filter((e) => !/WebGPU|gpu/i.test(e)), [], 'no errors on the phone');
  const st = relay.stats(); step(`relay carried ${st.published} encrypted messages`);
  console.log('anywhere-e2e: all passed');
  await phoneBrowser.close();
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  relay.close(); llm.close(); site.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
