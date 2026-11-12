// Electron e2e of local accounts on an existing install: create a second account → the picker appears at the
// next start → open it (empty history) → switch back (history is there) → password → lock → unlock.
// Run: flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/accounts-e2e.js /tmp/shots-accounts
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os'); const assert = require('assert');
const shots = process.argv[2] || path.join(os.tmpdir(), 'fabro-acc-shots'); fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-acc-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'light', onboarded: true, devModeReleased: true, hotkey: { enabled: false } }));
const step = (s) => console.log('•', s);
const launch = () => electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1', HOME: userData } });
const exited = (app) => new Promise((r) => { app.process().once('exit', r); setTimeout(r, 15000); });
async function mainOf(app) {
  const isMain = (w) => /index\.html/.test(w.url());
  const w = app.windows().find(isMain) || await app.waitForEvent('window', { predicate: isMain, timeout: 30000 });
  await w.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await w.waitForSelector('.greet', { timeout: 30000 });
  return w;
}

(async () => {
  // 1 — an existing install: migrated, opens straight away, no picker
  let app = await launch();
  let win = await app.firstWindow();
  assert.match(win.url(), /index\.html/, 'single account without password: no picker');
  win = await mainOf(app);
  assert.ok(fs.existsSync(path.join(userData, 'accounts.json')), 'migrated');
  await win.evaluate(() => api.conv.save({ id: 'c-lulu', title: 'Recette de crêpes', mode: 'chat', messages: [{ role: 'user', content: 'Des crêpes pour 4' }, { role: 'assistant', content: 'Voici…' }] }));
  await win.evaluate(async () => { S.convs = await api.conv.list(); renderSidebar(); });
  await win.click('.sb-user'); await win.waitForSelector('.acc-menu');
  step('switcher'); await win.screenshot({ path: `${shots}/acc-01-menu.png` });
  await win.click('[data-action=acc-new]');
  await win.waitForSelector('.acc-modal [data-acc-form=create]');
  await win.fill('.acc-modal input[name=name]', 'Emma');
  await win.click('.acc-modal [data-acc-icon=star]'); await win.click('.acc-modal [data-acc-color=teal]');
  step('create'); await win.screenshot({ path: `${shots}/acc-02-create.png` });
  await win.click('.acc-modal button[type=submit]');
  await win.waitForSelector('.acc-done');
  step('created'); await win.screenshot({ path: `${shots}/acc-03-created.png` });
  await win.click('.acc-done [data-action=acc-close]');
  await win.waitForTimeout(300);
  await win.evaluate(() => Accounts.openManager()); await win.waitForSelector('.acc-section .acc-chip');
  assert.match(await win.textContent('.acc-section'), /1 conversations/);
  step('my account'); await win.screenshot({ path: `${shots}/acc-04-my-account.png` });
  await app.close();

  // 2 — two accounts: the picker; Emma has no history
  app = await launch();
  let pk = await app.firstWindow();
  assert.match(pk.url(), /accounts\.html/, 'picker shown');
  await pk.waitForSelector('.acc-tile[data-id]');
  assert.strictEqual(await pk.locator('.acc-tile[data-id]').count(), 2);
  step('picker'); await pk.screenshot({ path: `${shots}/acc-05-picker.png` });
  await pk.click('.acc-tile:has-text("Emma")');
  win = await mainOf(app);
  const emma = await win.evaluate(async () => ({ convs: (await api.conv.list()).length, me: (await api.accounts.current()).name, name: S.settings.userName }));
  assert.deepStrictEqual(emma, { convs: 0, me: 'Emma', name: 'Emma' }, 'Emma starts empty');
  await win.waitForTimeout(400);
  step('emma'); await win.screenshot({ path: `${shots}/acc-06-emma.png` });
  await win.click('.sb-user'); await win.waitForSelector('[data-action=acc-switch]');
  const gone = exited(app);
  await win.click('[data-action=acc-switch]');
  await win.waitForSelector('.acc-switching.show').catch(() => {});
  await win.screenshot({ path: `${shots}/acc-07-switching.png` }).catch(() => {});
  await gone;

  // 3 — switched back to Lulu (no password): opens directly, history is there
  app = await launch();
  win = await mainOf(app);
  const back = await win.evaluate(async () => ({ convs: (await api.conv.list()).map((c) => c.id), me: (await api.accounts.current()).name }));
  assert.deepStrictEqual(back, { convs: ['c-lulu'], me: 'Lulu' }, 'Lulu has her history back');
  step('lulu again');
  const r = await win.evaluate(() => api.accounts.setPassword({ next: 'soleil' }));
  assert.ok(r.ok && r.hasPassword);
  const g2 = exited(app);
  await win.evaluate(() => Accounts.lock());
  await g2;

  // 4 — locked: the picker asks for Lulu's password
  app = await launch();
  pk = await app.firstWindow();
  assert.match(pk.url(), /accounts\.html/);
  await pk.waitForSelector('.acc-tile[data-id]');
  await pk.click('.acc-tile:has-text("Lulu")');
  await pk.waitForSelector('.acc-pw-in');
  await pk.fill('.acc-pw-in', 'pluie'); await pk.keyboard.press('Enter');
  await pk.waitForSelector('.acc-error:not(:empty)');
  step('wrong password'); await pk.screenshot({ path: `${shots}/acc-08-wrong.png` });
  await pk.fill('.acc-pw-in', 'soleil'); await pk.keyboard.press('Enter');
  win = await mainOf(app);
  assert.deepStrictEqual(await win.evaluate(async () => (await api.conv.list()).map((c) => c.id)), ['c-lulu']);
  await win.evaluate(() => Accounts.openManager()); await win.waitForSelector('.acc-section');
  step('my account (password)'); await win.screenshot({ path: `${shots}/acc-09-my-account-pw.png` });
  await app.close();
  console.log('accounts-e2e: all passed →', shots);
  process.exit(0);
})().catch(async (e) => { console.error(e); process.exit(1); });
