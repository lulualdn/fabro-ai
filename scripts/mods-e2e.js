// End-to-end test of mods (Claude for Fabro on a local copy of the site), fabro:// links, file paste
// and the quick bar (screenshot + /command handoff).
// Usage: xvfb-run -a node scripts/mods-e2e.js [screenshotDir]
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-mods-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-mods-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'en', userName: 'Lulu', theme: 'dark', onboarded: true, devModeReleased: true, hotkey: { enabled: false } }));

// ── a tiny copy of claude.ai: sign-in, new chat from ?q=, chat pages, recents with times ──
const chats = [{ id: '11111111-2222-3333-4444-555555555555', title: 'Trip to Lisbon', ago: 'Last message 2 hours ago' }, { id: '66666666-7777-8888-9999-000000000000', title: 'Old project notes', ago: 'Last message 3 days ago' },
  { id: '77777777-0000-0000-0000-000000000001', title: 'Name only on its page', ago: 'Last message 5 days ago', hidden: true }]; // listed without a name
const sent = [];
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.svg"><style>body{font:15px sans-serif;background:#faf9f5;color:#222;margin:0;padding:30px}[contenteditable]{border:1px solid #ccc;border-radius:12px;padding:14px;min-height:40px;background:#fff}</style></head><body>${body}</body></html>`;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cookie = req.headers.cookie || '';
  const authed = /sessionKey=ok/.test(cookie);
  const html = (s) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(s); };
  if (u.pathname === '/favicon.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#d97757"/></svg>'); }
  if (u.pathname === '/login') return html(page('Sign in', '<h1>Sign in</h1><form method="post" action="/do-login"><input name="email" value="lulu@example.com"><button id="go">Continue</button></form>'));
  if (u.pathname === '/do-login') { res.writeHead(302, { 'Set-Cookie': 'sessionKey=ok; Path=/; HttpOnly', Location: '/new?onboarding=1' }); return res.end(); }
  if (!authed) { res.writeHead(302, { Location: '/login' }); return res.end(); }
  if (u.pathname === '/new') {
    const q = u.searchParams.get('q') || '';
    return html(page('New chat', `<h2>How can I help you today?</h2><div contenteditable="true" id="box"></div>
      <script>
        const q = ${JSON.stringify(q)};
        setTimeout(() => { document.getElementById('box').innerText = q; }, 400); // the site fills the box itself, a moment later
        document.getElementById('box').addEventListener('keydown', async (e) => {
          if (e.key !== 'Enter') return; e.preventDefault();
          const text = e.target.innerText.trim(); if (!text) return;
          const r = await fetch('/api/send', { method: 'POST', body: text }); const { id } = await r.json();
          history.pushState({}, '', '/chat/' + id); document.title = text.slice(0, 30) + ' - Claude';
          document.body.innerHTML = '<p><b>You:</b> ' + text + '</p><p>Hello from the test site.</p>';
        });
      </script>`));
  }
  if (u.pathname === '/api/send') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const id = 'aaaaaaaa-bbbb-cccc-dddd-' + String(Date.now()).padStart(12, '0').slice(-12); sent.push(b); chats.unshift({ id, title: b.slice(0, 40), ago: 'Last message just now' }); res.end(JSON.stringify({ id })); }); return; }
  if (u.pathname.startsWith('/chat/')) { const c = chats.find((x) => x.id === u.pathname.slice(6)); return html(page((c ? c.title : 'Chat') + ' - Claude', `<h2>${c ? c.title : 'Unknown chat'}</h2><p>Messages of this chat.</p><button id="rename" onclick="fetch('/api/rename?id=${c ? c.id : ''}&name=' + encodeURIComponent('Lisbon, 4 days')).then(() => { document.title = 'Lisbon, 4 days - Claude'; })">Rename</button>`)); }
  // claude.ai's own data (what the mod reads first): names and update times
  if (u.pathname === '/api/organizations') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([{ uuid: 'org-1', capabilities: ['chat'] }])); }
  if (u.pathname === '/api/organizations/org-1/chat_conversations') {
    const ago = (c) => ({ 'Last message just now': 0, 'Last message 2 hours ago': 2, 'Last message 3 days ago': 72, 'Last message 5 days ago': 120 }[c.ago] || 0) * 3600e3;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(chats.map((c) => ({ uuid: c.id, name: c.title, updated_at: new Date(Date.now() - ago(c)).toISOString() }))));
  }
  if (u.pathname === '/api/rename') { const c = chats.find((x) => x.id === u.searchParams.get('id')); if (c) c.title = u.searchParams.get('name'); return res.end('{}'); }
  if (u.pathname === '/recents') return html(page('Recents', `<main><h1>Your chat history</h1>${chats.map((c) => `<a href="/chat/${c.id}" style="display:block;padding:8px"><div>${c.hidden ? '' : c.title}</div><div>${c.ago}</div></a>`).join('')}</main>`));
  res.writeHead(404); res.end();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, what = 'condition') { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await wait(200); } throw new Error('timeout: ' + what); }

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1', FABRO_MODTEST_CLAUDE: base } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERR', e.message));
  win.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  const webUrls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  const viewWc = (re) => app.evaluate(({ webContents }, src) => { const w = webContents.getAllWebContents().find((x) => new RegExp(src).test(x.getURL())); return w ? w.id : null; }, re);

  // 1. Settings › Mods lists the three built-in mods
  await win.evaluate(() => openSettings('mods'));
  await win.waitForSelector('.mod-row');
  const names = await win.$$eval('.mod-row b', (b) => b.map((x) => x.textContent));
  assert(['Claude for Fabro', 'ChatGPT for Fabro', 'Gemini for Fabro'].every((n) => names.some((x) => x.includes(n))), 'built-in mods listed: ' + names);
  await win.screenshot({ path: path.join(shots, '01-mods.png') });
  console.log('✓ mods listed');

  // 2. Install Claude: window reloads, the sign-in page opens in the chat area
  await win.click('[data-action="mod-install"][data-id="claude"]');
  await until(async () => (await webUrls()).some((u) => u.startsWith(base + '/login')), 20000, 'login page');
  await win.waitForSelector('#mod-web', { timeout: 15000 });
  const collapsed = await win.evaluate(() => document.getElementById('app').classList.contains('sb-collapsed'));
  assert(collapsed, 'sidebar hidden while signing in');
  console.log('✓ sign-in page shown');
  await wait(800); await win.screenshot({ path: path.join(shots, '02-login.png') });

  // 3. Sign in on the site → redirected to /new?onboarding=1 → Fabro notices, goes back, syncs the chats
  await app.evaluate(({ webContents }, b) => { const w = webContents.getAllWebContents().find((x) => x.getURL().startsWith(b + '/login')); return w.executeJavaScript("document.getElementById('go').click()"); }, base);
  await until(() => win.evaluate(() => !S.modView), 15000, 'back to Fabro after sign-in');
  await until(() => win.$$eval('.recent.ext', (x) => x.length >= 2), 20000, 'Claude chats in history');
  const ext = await win.$$eval('.recent.ext .r-title', (x) => x.map((e) => e.textContent));
  assert(ext.includes('Trip to Lisbon') && ext.includes('Old project notes') && ext.includes('Name only on its page') && !ext.includes('Untitled'), 'synced titles: ' + ext);
  const hasIcon = await win.$$eval('.recent.ext img.r-src', (x) => x.length);
  assert(hasIcon >= 2, 'site icon shown on synced chats');
  console.log('✓ signed in, chats synced with the site icon:', ext.join(', '));
  await win.screenshot({ path: path.join(shots, '03-history.png') });

  // 3b. Claude appears in the model picker; selecting it and sending talks to it directly (no /command)
  await win.click('.model-pill');
  await win.waitForSelector('.models-pop');
  assert(await win.$$eval('.models-pop .pm-item b', (b) => b.map((x) => x.textContent).includes('Claude')), 'Claude in the model picker');
  await win.screenshot({ path: path.join(shots, '03b-modelpicker.png') });
  await win.locator('.models-pop .pm-item', { hasText: 'Claude' }).click();
  assert(await win.evaluate(() => (S.settings.selectedModel || {}).backend === 'mod'), 'Claude selected as the model');
  await win.click('#prompt'); await win.fill('#prompt', 'Direct to Claude as model');
  await win.click('#send-btn');
  await until(() => sent.includes('Direct to Claude as model'), 25000, 'sent via model select');
  assert(await win.evaluate(() => !!S.modView), 'picking Claude + send opened the web view');
  console.log('✓ Claude selectable as a model; sending routes to it');
  await win.evaluate(() => { S.settings.selectedModel = null; fabro.view.close(); });

  // 4. /claude in the message box → new chat on the site, Enter pressed automatically
  await win.click('#prompt'); await win.keyboard.type('/cla');
  await win.waitForSelector('.cmd-menu .cm-item');
  await win.screenshot({ path: path.join(shots, '04-cmdmenu.png') });
  await win.keyboard.press('Tab'); await win.keyboard.type('Plan a weekend in Porto');
  await win.keyboard.press('Enter');
  await until(() => sent.includes('Plan a weekend in Porto'), 25000, 'prompt sent on the site');
  await until(async () => (await webUrls()).some((u) => u.startsWith(base + '/chat/aaaaaaaa')), 10000, 'chat page');
  assert(await win.evaluate(() => !!S.modView && document.getElementById('app').classList.contains('sb-collapsed')), 'web view full width');
  assert(await win.evaluate(() => !!document.querySelector('#topbar [data-action="toggle-sidebar"]') && document.querySelectorAll('#topbar button').length === 1), 'topbar shows only the sidebar button');
  await until(() => win.$$eval('.recent.ext .r-title', (x) => x.some((e) => /Porto/.test(e.textContent))), 20000, 'new chat in history');
  console.log('✓ /claude started a chat and pressed Enter; it is in the history');
  await wait(600); await win.screenshot({ path: path.join(shots, '05-claude-view.png') });

  // 5. The sidebar button brings the sidebar back; opening a Fabro chat leaves the site
  await win.click('#topbar [data-action="toggle-sidebar"]');
  assert(await win.evaluate(() => !document.getElementById('app').classList.contains('sb-collapsed')), 'sidebar shown');
  await win.click('[data-action="new-chat"]');
  await until(() => win.evaluate(() => !S.modView && !!document.querySelector('#prompt')), 5000, 'Fabro UI back');
  const stored = await win.evaluate(() => api.settings.get().then((s) => s.sidebarCollapsed));
  assert(stored === false, 'sidebar state not saved by the web view');
  console.log('✓ sidebar button + back to Fabro');

  // 6. A synced chat opens the site with the sidebar still open
  await win.click('.recent.ext >> text=Trip to Lisbon');
  await until(async () => (await webUrls()).some((u) => u === base + '/chat/11111111-2222-3333-4444-555555555555'), 10000, 'chat page opened');
  await until(() => win.evaluate(() => !!S.modView && !!document.getElementById('mod-web') && !document.getElementById('app').classList.contains('sb-collapsed')), 5000, 'sidebar stays open');
  const b = await win.evaluate(() => { const r = document.getElementById('mod-web').getBoundingClientRect(); return { x: r.x, w: r.width }; });
  assert(b.x > 150, 'web view sits next to the sidebar');
  // a chat the list showed without a name got its name from its own page
  await until(() => win.$$eval('.recent.ext .r-title', (x) => x.some((e) => e.textContent === 'Name only on its page')), 20000, 'name read from the chat page');
  // renaming on the site renames it in the history right away
  await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((x) => x.getURL() === u).executeJavaScript("document.getElementById('rename').click()"), base + '/chat/11111111-2222-3333-4444-555555555555');
  await until(() => win.$$eval('.recent.ext .r-title', (x) => x.some((e) => e.textContent === 'Lisbon, 4 days') && !x.some((e) => e.textContent === 'Trip to Lisbon')), 8000, 'live rename');
  console.log('✓ chat names synced (missing names, live renames)');
  await wait(600); await win.screenshot({ path: path.join(shots, '06-history-open.png') });
  console.log('✓ history chat opened next to the sidebar');

  // 7. fabro:// link → new chat with the message filled in
  await app.evaluate(({ app }) => app.emit('open-url', { preventDefault() {} }, 'fabro://new?q=Hello%20from%20a%20link'));
  await until(() => win.evaluate(() => document.querySelector('#prompt') && document.querySelector('#prompt').value === 'Hello from a link'), 8000, 'link prefill');
  assert(await win.evaluate(() => !S.modView), 'link left the web view');
  console.log('✓ fabro:// link');

  // 8. Paste an image file into the message box
  await win.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 20, 20);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.querySelector('#prompt').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await until(() => win.evaluate(() => S.pending.some((a) => a.kind === 'image' && a.name === 'shot.png')), 5000, 'pasted image attached');
  console.log('✓ paste an image');

  // 9. Quick bar: screenshot chip, then /claude hands over to the main window
  await win.evaluate(() => api.quick.toggle());
  const quick = await until(async () => app.windows().find((w) => w.url().endsWith('quick.html')), 15000, 'quick bar');
  await quick.waitForSelector('#q');
  await win.evaluate(() => api.quick.toggle());
  await until(() => quick.$('.q-att'), 8000, 'screenshot chip');
  await quick.screenshot({ path: path.join(shots, '07-quick.png') });
  console.log('✓ quick bar shows the screenshot');
  await quick.fill('#q', '/claude Quick question'); await quick.press('#q', 'Enter');
  await until(() => sent.includes('Quick question'), 25000, 'quick → claude');
  assert(await win.evaluate(() => !!S.modView), 'claude view opened from the quick bar');
  console.log('✓ /claude from the quick bar');

  // 10. Uninstall removes the chats and the sign-in
  await win.evaluate(() => { S.modView && fabro.view.close(); return openSettings('mods'); });
  await until(() => win.evaluate(() => (S.modsList || []).find((m) => m.id === 'claude')?.status?.lastVia === 'api'), 8000, 'names read from the site data');
  console.log('✓ sync used the site data:', await win.$eval('.mod-row small.muted', (e) => e.textContent).catch(() => ''));
  await win.waitForSelector('[data-action="mod-uninstall"][data-id="claude"]');
  win.once('dialog', (d) => d.accept());
  await win.click('[data-action="mod-uninstall"][data-id="claude"]');
  await until(() => win.evaluate(() => document.querySelectorAll('.recent.ext').length === 0 && !!document.querySelector('#sb-lists')), 15000, 'chats gone');
  console.log('✓ uninstall');

  // 11. Import the sign-in from a browser: a planted Firefox cookie store → chooser → one click → connected
  const ffDir = fs.mkdirSync(path.join(userData, 'fakeff'), { recursive: true }) || path.join(userData, 'fakeff');
  const ffCookies = path.join(userData, 'fakeff', 'cookies.sqlite');
  { const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(ffCookies);
    db.exec('CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)');
    db.prepare('INSERT INTO moz_cookies (host,name,value,path,expiry,isSecure,isHttpOnly,sameSite) VALUES (?,?,?,?,?,?,?,?)')
      .run('127.0.0.1', 'sessionKey', 'ok', '/', Math.floor(Date.now() / 1000) + 86400, 0, 1, 1); db.close(); }
  // tell the main process to offer this fake browser (browser-import reads the env live)
  await app.evaluate(({}, p) => { process.env.FABRO_IMPORT_FAKE = JSON.stringify({ id: 'firefox', name: 'Firefox', kind: 'firefox', cookies: p }); }, ffCookies);
  await win.evaluate(() => openSettings('mods'));
  await win.waitForSelector('[data-action="mod-install"][data-id="claude"]');
  await win.click('[data-action="mod-install"][data-id="claude"]');
  // install → the connect chooser appears (not the login page) because a browser is available
  await win.waitForSelector('.wc-import [data-wc-imp="firefox"]', { timeout: 15000 });
  assert(!(await webUrls()).some((u) => u.startsWith(base + '/login')), 'chooser shown, not the login page');
  await win.screenshot({ path: path.join(shots, '08-import.png') });
  console.log('✓ import chooser lists the browser');
  await win.click('.wc-import [data-wc-imp="firefox"]');
  await until(() => win.$$eval('.recent.ext', (x) => x.length >= 2), 20000, 'connected by import');
  assert(!(await webUrls()).some((u) => u.startsWith(base + '/login')), 'never showed the login page');
  const ext2 = await win.$$eval('.recent.ext .r-title', (x) => x.map((e) => e.textContent));
  assert(ext2.includes('Old project notes'), 'chats synced after import: ' + ext2);
  console.log('✓ imported the sign-in from Firefox, connected without the login page');

  await app.close(); srv.close();
  console.log('ALL OK →', shots);
})().catch(async (e) => { console.error('FAIL', e); process.exit(1); });
