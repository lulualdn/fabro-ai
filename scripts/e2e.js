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
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const errors = [];
  const win = await app.firstWindow();
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
})().catch(async (e) => { console.error(e); process.exit(1); });
