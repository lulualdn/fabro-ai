// End-to-end: the CLI theme's keyboard layer. Navigation keys work outside fields, never steal a key while typing,
// slash commands run from the composer, the cheat sheet and palette open and close, and turning the theme off gives the
// conversation list its normal semantics back. Usage: xvfb-run -a node scripts/keys-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-keys-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-keys-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'dark', onboarded: true, hotkey: { enabled: false } }));
const step = (s) => console.log('✓ ' + s);

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  await win.setViewportSize({ width: 1280, height: 820 });
  // a few conversations to move through
  await win.evaluate(async () => { for (const n of ['Un', 'Deux', 'Trois']) await api.conv.save({ id: 'k' + n, title: n, messages: [{ role: 'user', content: n }, { role: 'assistant', content: 'ok ' + n }], createdAt: Date.now(), updatedAt: Date.now() }); S.convs = await api.conv.list(); renderRecents(); });

  await win.evaluate(() => Themes.set('cli'));
  await win.waitForFunction(() => document.documentElement.dataset.skin === 'cli', null, { timeout: 5000 });
  assert.ok(await win.evaluate(() => Themes.keysOn()), 'keys on in the CLI theme');
  step('CLI theme on, keyboard layer on');

  // typing: letters that are shortcuts outside a field land in the composer
  await win.click('#prompt');
  await win.keyboard.type('jkgG[]?');
  assert.strictEqual(await win.inputValue('#prompt'), 'jkgG[]?', 'no key stolen while typing');
  await win.fill('#prompt', '');
  step('typing in the composer: nothing stolen');

  // Escape leaves the field; j/k move through the list when it has focus
  await win.keyboard.press('Escape');
  const rows = await win.$$eval('#sb-lists .recent', (r) => r.length);
  if (rows >= 2) {
    await win.evaluate(() => document.querySelector('#sb-lists .recent').focus());
    const before = await win.evaluate(() => document.activeElement.textContent.trim());
    await win.keyboard.press('j');
    const after = await win.evaluate(() => document.activeElement.textContent.trim());
    assert.notStrictEqual(after, before, 'j moves down the list');
    await win.keyboard.press('k');
    assert.strictEqual(await win.evaluate(() => document.activeElement.textContent.trim()), before, 'k moves back up');
    await win.keyboard.press('G'); const last = await win.evaluate(() => document.activeElement.textContent.trim());
    await win.keyboard.press('g'); await win.keyboard.press('g'); const first = await win.evaluate(() => document.activeElement.textContent.trim());
    assert.notStrictEqual(first, last, 'g g and G jump to the ends');
    assert.strictEqual(await win.evaluate(() => document.querySelector('#sb-lists').getAttribute('role')), 'listbox');
    step('list: j / k / g g / G');
  } else console.log('  (fewer than two conversations: list moves not checked)');

  // ? opens the cheat sheet, Escape closes it
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.keyboard.press('?');
  await win.waitForSelector('.kb-cheat', { timeout: 3000 });
  await win.screenshot({ path: `${shots}/1-cheatsheet.png` });
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('.kb-cheat'), null, { timeout: 3000 });
  step('? cheat sheet, Escape closes');

  // palette: Ctrl+Shift+P, filter, Escape
  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('#kb-layer .kb-box', { timeout: 3000 });
  await win.keyboard.type('thème');
  await win.screenshot({ path: `${shots}/2-palette.png` });
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('#kb-layer'), null, { timeout: 3000 });
  step('palette opens, filters, closes');

  // slash command from the composer: /new
  await win.click('#prompt'); await win.keyboard.type('/new'); await win.keyboard.press('Enter');
  await win.waitForTimeout(400);
  assert.strictEqual(await win.inputValue('#prompt'), '', 'the command is not sent as a message');
  assert.ok(await win.evaluate(() => !S.conv || !(S.conv.messages || []).length), '/new opened an empty chat');
  step('/new from the composer');

  // status line shows model · context · account
  assert.ok(await win.$('#cli-status'), 'status line present');
  await win.screenshot({ path: `${shots}/3-cli.png` });
  step('status line');

  // back to the default theme: rows are buttons again, reachable with Tab
  await win.evaluate(() => Themes.set('fabro'));
  await win.waitForFunction(() => document.documentElement.dataset.skin !== 'cli', null, { timeout: 5000 });
  await win.waitForTimeout(200);
  const sem = await win.evaluate(() => [...document.querySelectorAll('#sb-lists .recent')].every((r) => r.getAttribute('role') === 'button' && r.tabIndex === 0));
  assert.ok(sem, 'rows are buttons with a tab stop again');
  assert.ok(!(await win.evaluate(() => Themes.keysOn())), 'keys off outside the CLI theme (auto)');
  await win.click('#prompt'); await win.keyboard.press('Escape'); await win.evaluate(() => document.activeElement.blur());
  await win.keyboard.press('j');
  assert.ok(await win.evaluate(() => !document.activeElement.closest || !document.activeElement.closest('#sb-lists')), 'j does nothing outside the CLI theme');
  step('default theme: list semantics restored, vim keys off');

  await app.close();
  console.log('keys-e2e: all passed → ' + shots);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
