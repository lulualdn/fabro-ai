// End-to-end UI test of the real Electron app (Playwright).
// Fake OpenAI-compatible server → connect provider → chat → quick bar → close-to-tray.
// Usage: node scripts/e2e.js [screenshotDir]   (on Linux CI: xvfb-run node scripts/e2e.js)
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-shots-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: process.env.THEME || 'light' }));

const reply = 'Bonjour ! Voici **une réponse** de test.\n\n```js\nconsole.log("ok")\n```';
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-model-large' }, { id: 'fake-model-mini' }] }));
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const parts = reply.match(/.{1,6}/gs);
      let i = 0;
      const tick = setInterval(() => {
        if (i < parts.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`); return; }
        clearInterval(tick); res.write('data: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":17}}\n\n'); res.end('data: [DONE]\n\n');
      }, 15);
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});

const step = (m) => console.log('•', m);

// Minimal valid GGUF (header + metadata, no tensors) so the model UI has something real to read.
function fakeGguf(file, { arch = 'llama', layers = 32, heads = 32, headsKv = 8, emb = 4096, ctx = 32768, experts = 0, name = 'Test Model', pad = 0 } = {}) {
  const parts = [];
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const str = (s) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
  const kvs = [['general.architecture', 8, str(arch)], ['general.name', 8, str(name)], ['general.file_type', 4, u32(15)],
    [`${arch}.block_count`, 4, u32(layers)], [`${arch}.attention.head_count`, 4, u32(heads)], [`${arch}.attention.head_count_kv`, 4, u32(headsKv)],
    [`${arch}.embedding_length`, 4, u32(emb)], [`${arch}.context_length`, 4, u32(ctx)], ...(experts ? [[`${arch}.expert_count`, 4, u32(experts)]] : [])];
  parts.push(Buffer.from('GGUF'), u32(3), u64(0), u64(kvs.length));
  for (const [k, t, v] of kvs) parts.push(str(k), u32(t), v);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([...parts, Buffer.alloc(pad)]));
}
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const errors = [];
  const win = await app.firstWindow();
  global.__fail = async () => { try { await win.screenshot({ path: `${shots}/FAIL.png` }); console.log('page errors:', errors, await win.evaluate(() => (document.querySelector('.pf-error') || {}).textContent)); } catch {} };
  app.process().stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  app.process().stderr.on('data', (d) => { const s = String(d); if (/Error|error:/.test(s) && !/ERROR:|dbus|Gtk|libva|viz|gpu/i.test(s)) console.log('[main]', s.trim().slice(0, 400)); });
  win.on('pageerror', (e) => errors.push('main: ' + e.message));
  await win.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await win.waitForSelector('.greet', { timeout: 20000 });
  await win.waitForTimeout(1200);
  step('welcome'); await win.screenshot({ path: `${shots}/01-welcome.png` });
  assert.match(await win.textContent('.greet'), /Lulu/);

  // Providers tab
  await win.keyboard.press('Control+,');
  await win.click('.st-tab[data-tab=providers]');
  await win.waitForSelector('.prov-empty');
  step('providers off'); await win.screenshot({ path: `${shots}/02-providers-off.png` });
  await win.click('.prov-empty [data-action=prov-enable]');
  await win.waitForSelector('.oc-grid');
  await win.waitForTimeout(2600); // local server detection
  step('providers on'); await win.screenshot({ path: `${shots}/03-providers-on.png` });
  await win.click('.prov-add[data-kind=custom]');
  await win.fill('.prov-form input[name=name]', 'Serveur de test');
  await win.fill('.prov-form input[name=baseUrl]', base);
  step('form'); await win.screenshot({ path: `${shots}/04-provider-form.png` });
  await win.click('.prov-form button[type=submit]');
  await win.waitForSelector('.prov-row');
  assert.match(await win.textContent('.prov-list'), /2 modèles/);
  // Bad key on a cloud provider shows an inline error
  await win.click('.prov-add[data-kind=openai]');
  await win.fill('.prov-form input[name=apiKey]', 'sk-invalid');
  step('connected'); await win.screenshot({ path: `${shots}/05-provider-added.png` });
  await win.click('[data-action=prov-cancel]');

  // Desktop tab
  await win.click('.st-tab[data-tab=shortcut]');
  await win.waitForSelector('.qb-preview');
  step('desktop tab'); await win.screenshot({ path: `${shots}/06-desktop.png` });
  await win.click('[data-action=close-settings]');
  await win.waitForTimeout(300);

  // Chat with a provider model
  await win.click('[data-action=model-menu]');
  step('model menu'); await win.screenshot({ path: `${shots}/07-model-menu.png` });
  await win.click('.popover [data-action=pick-model] >> text=fake-model-large');
  await win.fill('#prompt', 'Salut !');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /une réponse/.test(document.querySelector('.msg.assistant .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  await win.waitForTimeout(400);
  step('chat'); await win.screenshot({ path: `${shots}/08-chat.png` });
  assert.match(await win.textContent('.msg.assistant .stats'), /17/);

  // Quick bar (same IPC the global hotkey uses)
  await win.evaluate(() => api.quick.toggle());
  let quick;
  for (let i = 0; i < 50 && !quick; i++) { quick = app.windows().find((w) => w.url().endsWith('quick.html')); if (!quick) await win.waitForTimeout(100); }
  assert.ok(quick, 'quick bar window');
  quick.on('pageerror', (e) => errors.push('quick: ' + e.message));
  await quick.waitForSelector('#q');
  await quick.waitForTimeout(400);
  step('quick bar'); await quick.screenshot({ path: `${shots}/09-quick.png` });
  assert.match(await quick.textContent('#q-target'), /Salut/);
  await quick.fill('#q', 'Et maintenant ?');
  await quick.keyboard.press('Enter');
  await quick.waitForFunction(() => /une réponse/.test(document.querySelector('#q-ans')?.textContent || '') && !document.body.classList.contains('busy'), null, { timeout: 15000 });
  await quick.waitForTimeout(300);
  step('quick answer'); await quick.screenshot({ path: `${shots}/10-quick-answer.png` });
  const n = await win.evaluate(() => S.conv.messages.length);
  assert.strictEqual(n, 4, 'quick bar continued the current conversation');
  await quick.keyboard.press('Tab');
  assert.match(await quick.textContent('#q-target'), /Nouvelle/);
  await quick.keyboard.press('Escape');

  // ── Wave 2: models (import + per-model sheet), storage, engine, usage ──
  const fx = path.join(userData, 'fixtures');
  fakeGguf(path.join(fx, 'Mistral-7B-Instruct-Q4_K_M.gguf'), { name: 'Mistral 7B', pad: 1 << 20 });
  fakeGguf(path.join(fx, 'moe', 'Qwen3-30B-A3B-Q4_K_M.gguf'), { arch: 'qwen3moe', name: 'Qwen3 30B A3B', layers: 48, heads: 32, headsKv: 4, emb: 2048, experts: 128, pad: 1 << 20 });
  await win.evaluate(async (dir) => {
    await api.models.import([{ path: dir + '/Mistral-7B-Instruct-Q4_K_M.gguf', name: 'Mistral 7B', source: 'folder' }, { path: dir + '/moe/Qwen3-30B-A3B-Q4_K_M.gguf', name: 'Qwen3 30B A3B', source: 'lmstudio' }]);
    await refreshModels();
  }, fx);
  await win.keyboard.press('Control+,');
  await win.click('.st-tab[data-tab=models]');
  await win.waitForSelector('.m-card');
  await win.waitForTimeout(600);
  await win.click('.m-card .m-row >> nth=0');
  await win.waitForSelector('.m-sheet');
  await win.waitForTimeout(400);
  step('models + sheet'); await win.screenshot({ path: `${shots}/11-model-sheet.png` });
  await win.selectOption('.m-sheet select[data-key=ctx]', '32768');
  await win.waitForTimeout(700);
  assert.strictEqual(await win.evaluate(() => Object.values(S.settings.modelProfiles).some((p) => p && p.ctx === 32768)), true, 'profile saved');
  await win.click('.m-sheet [data-action=prof-set][data-key=kvType][data-value=q8_0]');
  await win.waitForTimeout(500);
  await win.click('.m-card .m-row >> nth=1');
  await win.waitForTimeout(600);
  step('moe sheet'); await win.screenshot({ path: `${shots}/12-moe-sheet.png` });
  assert.ok(await win.$('.m-sheet [data-key=cpuMoe]'), 'MoE option shown for MoE models');
  await win.click('.st-tab[data-tab=storage]');
  await win.waitForSelector('.lib-row');
  step('storage'); await win.screenshot({ path: `${shots}/13-storage.png` });
  await win.click('.st-tab[data-tab=engine]');
  await win.waitForSelector('#mon .meter');
  await win.click('[data-action=set][data-key="localApi.enabled"]');
  await win.waitForSelector('.api-box.ok', { timeout: 5000 });
  const apiModels = await (await fetch('http://127.0.0.1:11500/v1/models')).json();
  assert.ok(apiModels.data.some((m) => m.id.includes('fake-model-large')) && apiModels.data.some((m) => m.id.includes('mistral')), 'local API lists local + provider models');
  const apiChat = await (await fetch('http://127.0.0.1:11500/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: apiModels.data.find((m) => m.id.includes('fake-model-large')).id, messages: [{ role: 'user', content: 'hi' }] }) })).json();
  assert.match(apiChat.choices[0].message.content, /une réponse/);
  await win.waitForTimeout(500);
  step('engine'); await win.screenshot({ path: `${shots}/14-engine.png` });
  await win.evaluate(() => document.querySelector('.st-content').scrollTo(0, 99999));
  await win.waitForTimeout(300);
  step('engine bottom'); await win.screenshot({ path: `${shots}/15-engine-bottom.png` });
  await win.click('.st-tab[data-tab=usage]');
  await win.waitForSelector('.u-kpis');
  await win.waitForTimeout(800);
  step('usage'); await win.screenshot({ path: `${shots}/16-usage.png` });
  assert.ok(await win.evaluate(() => S.usage.total.requests >= 3), 'usage recorded (2 chats + API)');
  await win.click('[data-action=close-settings]');

  // Close → tray (window hidden, app alive)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('quick.html')).close());
  await win.waitForTimeout(500);
  const vis = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => [w.webContents.getURL().split('/').pop(), w.isVisible()]));
  assert.ok(vis.some(([u, v]) => u === 'index.html' && !v), 'main window hidden, not destroyed');
  step('closed to tray: ' + JSON.stringify(vis));

  assert.deepStrictEqual(errors, []);
  await app.evaluate(({ app }) => app.quit());
  srv.close();
  console.log('e2e: all passed →', shots);
})().catch(async (e) => { console.error(e); if (global.__fail) await global.__fail(); process.exit(1); });
