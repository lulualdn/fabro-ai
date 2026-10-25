// Computer Use end to end on X11 (Linux backend): the real tools drive the real mouse and keyboard
// through XTEST on a test window, and the page checks what it received: clicks on a button found by
// OCR, typing (accents included), shortcuts, a smooth drag on a canvas, scrolling, a chained gesture
// with shift held, zoom, the "nothing changed" signal and the user-takeover stop.
// Run: xvfb-run -a -s "-screen 0 1440x900x24" node scripts/computer-test.js [outDir]
// Needs python3 with python-xlib (pip install python-xlib) and tesseract.
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cu-'));
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cu-ud-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', computer: { speed: 'natural', ocr: 'always' } }));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:22px Arial;background:#fff;color:#111}
#go{position:absolute;left:40px;top:40px;width:220px;height:70px;font:bold 28px Arial;background:#1565c0;color:#fff;border:0;border-radius:8px}
#count{position:absolute;left:300px;top:58px;font-size:26px}
#field{position:absolute;left:40px;top:150px;width:520px;height:44px;font-size:22px}
#pad{position:absolute;left:40px;top:230px;width:520px;height:220px;border:2px solid #333}
#list{position:absolute;left:620px;top:40px;width:220px;height:200px;overflow:auto;border:1px solid #999}
#list div{height:40px;line-height:40px;padding-left:8px;border-bottom:1px solid #eee}
#items{position:absolute;left:620px;top:280px;user-select:none}#items span{display:inline-block;margin:6px;padding:8px 14px;border:2px solid #555;font-size:24px}
#items span.sel{background:#ffd54f}
</style></head><body>
<button id="go">VALIDER</button><div id="count">Clicks: 0</div>
<input id="field" placeholder="">
<canvas id="pad" width="520" height="220"></canvas>
<div id="list">${Array.from({ length: 30 }, (_, i) => `<div>Ligne ${i + 1}</div>`).join('')}</div>
<div id="items"><span>ALPHA</span><span>BRAVO</span><span>DELTA</span></div>
<script>
window.LOG = { clicks: 0, keys: [], moves: 0, drag: null, sel: [] };
const g = document.getElementById('pad').getContext('2d'); g.lineWidth = 3;
go.onclick = () => { LOG.clicks++; count.textContent = 'Clicks: ' + LOG.clicks; };
addEventListener('keydown', (e) => LOG.keys.push((e.ctrlKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + e.key));
let down = null;
pad.onmousedown = (e) => { down = { x: e.offsetX, y: e.offsetY, moves: 0 }; g.beginPath(); g.moveTo(e.offsetX, e.offsetY); };
pad.onmousemove = (e) => { LOG.moves++; if (down) { down.moves++; g.lineTo(e.offsetX, e.offsetY); g.stroke(); } };
pad.onmouseup = (e) => { if (down) LOG.drag = { from: [down.x, down.y], to: [e.offsetX, e.offsetY], moves: down.moves }; down = null; };
document.querySelectorAll('#items span').forEach((s) => s.onclick = (e) => { if (!e.shiftKey) document.querySelectorAll('#items span').forEach((x) => x.classList.remove('sel')); s.classList.add('sel'); LOG.sel = [...document.querySelectorAll('#items span.sel')].map((x) => x.textContent); });
</script></body></html>`;

// A scripted model for the chat phase: look, click the button it read, then answer.
const http = require('http');
const sse = (res, delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`); res.end('data: [DONE]\n\n'); };
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-vision' }] }));
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
    const body = JSON.parse(b);
    const sys = String((body.messages[0] || {}).content || '');
    if (/You name conversations|maintain a short memory/.test(sys)) return sse(res, { content: 'Test' });
    const tools = body.messages.filter((m) => m.role === 'tool');
    const call = (name, args) => sse(res, { tool_calls: [{ index: 0, id: 'k' + tools.length, function: { name, arguments: JSON.stringify(args) } }] });
    if (!tools.length) return call('computer_look', {});
    if (tools.length === 1) { const id = (String(tools[0].content).match(/\[(\d+)\] text "VALIDER"/) || [])[1]; return id ? call('computer_click', { element: +id }) : sse(res, { content: 'VALIDER introuvable' }); }
    return sse(res, { content: 'C’est fait : j’ai cliqué sur VALIDER.' });
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERR', e.message));
  const root = path.join(__dirname, '..');
  // the app under test: a plain window on the screen
  await app.evaluate(async ({ BrowserWindow }, { html }) => {
    for (const w of BrowserWindow.getAllWindows()) w.hide();
    const t = new BrowserWindow({ x: 100, y: 60, width: 900, height: 560, frame: false, show: true, webPreferences: { sandbox: true } });
    global.__target = t;
    await t.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    t.setAlwaysOnTop(true); t.focus();
    await new Promise((r) => setTimeout(r, 1500));
    for (const w of BrowserWindow.getAllWindows()) if (w !== t) w.hide();
    t.focus();
  }, { html: PAGE });
  await new Promise((r) => setTimeout(r, 500));
  const page = (js) => app.evaluate((_e, js) => global.__target.webContents.executeJavaScript(js, true), js);
  const run = (name, args = {}) => app.evaluate(async (_e, { name, args, root }) => {
    const agent = process.mainModule.require(root + '/src/main/agent/index.js');
    process.mainModule.require(root + '/src/main/computer/index.js');
    global.__grants = global.__grants || new Set(['computer']); // asked once per conversation: checked at the end
    const ctx = { reqId: 'turn1', convId: 'c1', emit: () => {}, grants: global.__grants, onAbort: () => {}, ask: async () => 'once' };
    try {
      const r = await agent.execute({ name, args }, ctx);
      return { content: r.content, refused: r.refused, view: r.view && { ...r.view, shot: !!r.view.shot }, image: r.image || null };
    } catch (e) { return { error: e.message, code: e.code }; }
  }, { name, args, root });
  const save = (r, f) => { if (r.image) fs.writeFileSync(path.join(out, f), Buffer.from(r.image.split(',')[1], 'base64')); };
  const marks = () => app.evaluate((_e, root) => [...process.mainModule.require(root + '/src/main/computer/index.js')._internal.S.look.marks.values()].map((m) => ({ id: m.id, name: m.name, cx: m.cx, cy: m.cy, ocr: !!m.ocr })), root);
  const L = () => app.evaluate((_e, root) => { const l = process.mainModule.require(root + '/src/main/computer/index.js')._internal.S.look; return { W: l.W, H: l.H, scale: l.scale, mon: l.mon }; }, root);
  // a point of the test page → screenshot coordinates
  const at = async (x, y) => { const l = await L(); return { x: Math.round((100 + x) * l.scale), y: Math.round((60 + y) * l.scale) }; };
  const t0 = Date.now();

  // 1. look: a marked screenshot + OCR text
  let r;
  // (on slow machines Fabro's own window shows up late: keep only the app under test on screen)
  const onlyTarget = () => app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w !== global.__target && w.isVisible() && !/Computer Use/.test(w.getTitle())) w.hide(); global.__target.setAlwaysOnTop(true, 'screen-saver'); global.__target.show(); });
  for (let i = 0; i < 4; i++) { await onlyTarget(); r = await run('computer_look', { wait_ms: i ? 1500 : 300 }); assert.ok(!r.error, r.error); if (/VALIDER/.test(r.content)) break; }
  console.log(r.content.split('\n').slice(0, 14).join('\n'));
  assert.ok(r.image && r.image.startsWith('data:image/jpeg'), 'screenshot returned');
  assert.match(r.content, /screenshot 1280×800 px \(real screen 1440×900\)/);
  save(r, '1-look.jpg');
  const m = (await marks()).find((x) => /VALIDER/i.test(x.name));
  if (!m) console.log(r.content);
  assert.ok(m, 'the button text is found on screen (OCR)');

  // 2. click it by id
  r = await run('computer_click', { element: m.id });
  assert.ok(!r.error, r.error);
  assert.match(r.content, /Done: clicked \[\d+\] text "VALIDER"/);
  assert.equal((await page('LOG.clicks')), 1, 'the button received exactly one click');
  assert.match(r.content, /Screen after the action: changed/, 'the counter changed on screen');
  save(r, '2-after-click.jpg');

  // 3. double-click = 2 more clicks
  const m2 = (await marks()).find((x) => /VALIDER/i.test(x.name));
  assert.ok(m2, 'still read after the click (the pointer is not drawn into the OCR picture)');
  r = await run('computer_click', { element: m2.id, clicks: 2 });
  assert.equal(await page('LOG.clicks'), 3);

  // 4. type into the field (click it first), accents and all, then shortcuts
  const f = await at(200, 172);
  r = await run('computer_type', { text: 'Bonjour Lulu', x: f.x, y: f.y });
  assert.ok(!r.error, r.error);
  assert.equal(await page('field.value'), 'Bonjour Lulu');
  r = await run('computer_key', { keys: 'ctrl+a backspace' });
  assert.equal(await page('field.value'), '', 'ctrl+a then backspace cleared the field');
  assert.ok((await page('LOG.keys')).includes('ctrl+a'), 'ctrl+a arrived as a combination');
  r = await run('computer_type', { text: 'déjà vu', clear: true });
  assert.equal(await page('field.value'), 'déjà vu', 'characters missing from the layout are typed too');

  // 5. a card number is refused
  r = await run('computer_type', { text: '4111 1111 1111 1111' });
  assert.ok(r.refused, 'card numbers are never typed');

  // 6. smooth drag on the canvas
  const a = await at(80, 300), b = await at(460, 400);
  r = await run('computer_drag', { x: a.x, y: a.y, to_x: b.x, to_y: b.y });
  assert.ok(!r.error, r.error);
  const drag = await page('LOG.drag');
  console.log('drag', JSON.stringify(drag));
  assert.ok(drag && drag.moves >= 15, 'the drag is a smooth path, not a jump');
  assert.ok(Math.abs(drag.to[0] - 420) <= 3 && Math.abs(drag.to[1] - 170) <= 3, 'released exactly on the target');
  save(r, '3-after-drag.jpg');

  // 7. scroll the list
  const li = await at(730, 140);
  r = await run('computer_scroll', { x: li.x, y: li.y, direction: 'down', amount: 4 });
  assert.ok((await page('list.scrollTop')) > 50, 'the list scrolled');

  // 8. one fluid gesture: click ALPHA, then shift+click DELTA (positions from the page: OCR is tested above)
  r = await run('computer_look', {});
  const box = async (t) => { const b = await page(`(() => { const s = [...document.querySelectorAll('#items span')].find((x) => x.textContent === '${t}'); const r = s.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`); return at(b[0], b[1]); };
  const pa = await box('ALPHA'), pd = await box('DELTA');
  r = await run('computer_actions', { actions: [{ action: 'click', x: pa.x, y: pa.y }, { action: 'click', x: pd.x, y: pd.y, modifiers: ['shift'] }] });
  assert.ok(!r.error, r.error);
  assert.deepEqual(await page('LOG.sel'), ['ALPHA', 'DELTA']);

  // 9. zoom with rulers
  const zp = await at(690, 330);
  r = await run('computer_zoom', { x: zp.x, y: zp.y });
  save(r, '4-zoom.jpg');
  assert.match(r.content, /DELTA/, 'the zoomed area is read');
  assert.ok(r.image, 'zoomed picture'); assert.match(r.content, /Zoom ×/);
  save(r, '4-zoom.jpg');

  // 10. clicking empty space: "nothing changed"
  const empty = await at(860, 520);
  r = await run('computer_click', { x: empty.x, y: empty.y });
  assert.match(r.content, /NOTHING CHANGED/);

  // 11. blocked keys
  r = await run('computer_key', { keys: 'win+l' });
  assert.ok(r.refused, 'locking the session is refused');

  // 11b. the user moving the mouse to answer a card (permission, question) is not a takeover
  r = await run('computer_look', {});
  await app.evaluate((_e, root) => process.mainModule.require(root + '/src/main/computer/index.js').hold(true), root);
  require('child_process').execFileSync('python3', ['-c', 'import time\nfrom Xlib import display; from Xlib.ext import xtest; from Xlib import X; d=display.Display()\nfor i in range(12): xtest.fake_input(d, X.MotionNotify, x=200+i*30, y=200); d.sync(); time.sleep(0.02)']);
  await app.evaluate((_e, root) => process.mainModule.require(root + '/src/main/computer/index.js').hold(false), root);
  r = await run('computer_look', {});
  assert.ok(!r.error, 'still working after the user answered a card: ' + r.error);
  const ok2 = await at(860, 500);
  r = await run('computer_click', { x: ok2.x, y: ok2.y });
  assert.ok(!r.error, 'and still acting: ' + r.error);

  // 12. the user takes over: moving the mouse during an action stops Fabro
  const p1 = await at(100, 300), p2 = await at(500, 420);
  const slow = run('computer_actions', { actions: [{ action: 'move', x: p1.x, y: p1.y }, { action: 'wait', ms: 1500 }, { action: 'move', x: p2.x, y: p2.y }] });
  await new Promise((res) => setTimeout(res, 900));
  require('child_process').execFileSync('python3', ['-c', 'from Xlib import display; from Xlib.ext import xtest; from Xlib import X; d=display.Display(); xtest.fake_input(d, X.MotionNotify, x=20, y=20); d.sync()']);
  r = await slow;
  console.log('takeover:', r.error || r.content.slice(0, 80));
  assert.equal(r.code, 'USER_CONTROL', 'Fabro stops when the user moves the mouse');
  r = await run('computer_look', {});
  assert.equal(r.code, 'USER_CONTROL', 'and stays stopped for the rest of the turn');

  // 12b. once allowed, nothing asks again (not even a "Send" button)
  const g2 = await app.evaluate(async (_e, root) => process.mainModule.require(root + '/src/main/agent/index.js').get('computer_click').guard({ element: 1 }, { grants: new Set(['computer']) }), root);
  assert.equal(g2, null, 'no more confirmation once Computer Use is allowed');

  // 13. a new conversation asks first
  const g = await app.evaluate(async ({ BrowserWindow }, root) => {
    const agent = process.mainModule.require(root + '/src/main/agent/index.js');
    for (const w of BrowserWindow.getAllWindows()) if (w !== global.__target) w.hide();
    return agent.get('computer_look').guard({}, { grants: new Set() });
  }, root);
  assert.deepEqual(g, { confirm: 'computer_use' });

  // 14. through the real chat: the model looks, Fabro asks once, the click happens, steps show what Fabro saw
  // (Xvfb has no window manager, so Fabro cannot minimize itself here: keep the app under test on top)
  await app.evaluate(() => { global.__target.show(); global.__target.setAlwaysOnTop(true, 'screen-saver'); });
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  await win.evaluate(async (u) => { await api.providers.enable(true); await api.providers.add({ kind: 'custom', name: 'Fake', baseUrl: u }); await refreshModels(); const m = allModels()[0]; if (m) await saveSettings({ selectedModel: m.ref }); }, base);
  const before = await page('LOG.clicks');
  await win.click('[data-action=new-chat]');
  await win.fill('#prompt', 'Clique sur le bouton VALIDER sur mon écran');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.perm-card', { timeout: 30000 });
  const card = await win.textContent('.perm-card');
  assert.match(card, /Laisser Fabro utiliser votre ordinateur/, 'asked once, in plain words');
  await win.screenshot({ path: path.join(out, '5-ask.png') });
  await win.click('.perm-card [data-v=once]');
  try { await win.waitForFunction(() => document.body.innerText.includes('j’ai cliqué sur VALIDER'), null, { timeout: 60000 }); }
  catch (e) { await win.screenshot({ path: path.join(out, 'fail-chat.png') }); console.log((await win.evaluate(() => document.querySelector('#messages, main') ? document.querySelector('#messages, main').innerText : document.body.innerText)).slice(-1500)); throw e; }
  assert.equal(await page('LOG.clicks'), before + 1, 'the click from the chat reached the app');
  await win.evaluate(() => document.querySelectorAll('details.steps, details').forEach((d) => { d.open = true; }));
  await win.waitForTimeout(400);
  assert.ok(await win.$('.agent-step.c-computer .step-img'), 'the steps show what Fabro saw');
  await win.screenshot({ path: path.join(out, '6-chat.png') });

  // 15. Settings › Agent › Computer Use, with its test
  await win.keyboard.press('Control+,');
  await win.click('.st-tab[data-tab=agent]');
  await win.click('[data-action=cu-test]');
  await win.waitForFunction(() => /Écran \d+×\d+/.test(document.body.innerText), null, { timeout: 60000 });
  await win.evaluate(() => [...document.querySelectorAll('.st-sec')].find((x) => /Computer Use/.test(x.textContent)).scrollIntoView());
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(out, '7-settings.png') });

  console.log(`\nComputer Use e2e OK in ${((Date.now() - t0) / 1000).toFixed(1)} s — pictures in ${out}`);
  await app.close(); srv.close();
})().catch(async (e) => { console.error(e); process.exit(1); });
