// End-to-end: Settings in five sections. Every section and Advanced sub-tab renders without errors, old deep links land
// where their content now lives, live blocks are mounted (accounts, themes, finder, tiers, MCP, skills, Resources,
// My Fabro, prompts), and the settings that existed before are still reachable (docs/v02/settings-map.md).
// Usage: xvfb-run -a node scripts/settings-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-settings-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-settings-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: process.env.LANG_UI || 'fr', userName: 'Lulu', theme: process.env.THEME || 'light', onboarded: true, hotkey: { enabled: false } }));
const step = (s) => console.log('✓ ' + s);
const errors = [];

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERR', e.message); });
  win.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR/.test(m.text())) { errors.push(m.text()); console.log('CONSOLE', m.text().slice(0, 300)); } });
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  await win.setViewportSize({ width: 1280, height: 860 });
  // a little history for My Fabro
  await win.evaluate(async () => {
    const now = Date.now(); const d = 864e5;
    await api.conv.save({ id: 'c1', title: 'Plan du mémoire', messages: [{ role: 'user', content: 'Je prépare mon mémoire de master sur les tramways.' }, { role: 'assistant', content: 'Prochaines étapes : plan, sources.' }], createdAt: now - 40 * d, updatedAt: now - 20 * d });
    await api.myfabro.add({ title: 'Mémoire de master', content: 'Lulu écrit un mémoire sur les tramways.', kind: 'project' });
  }).catch((e) => console.log('seed', e.message));

  const open = async (tab) => { await win.evaluate((x) => openSettings(x), tab); await win.waitForSelector('#overlay-root .st-panel', { timeout: 5000 }); await win.waitForTimeout(350); };
  const shot = (n) => win.screenshot({ path: `${shots}/${n}.png` });
  const scrollTo = async (sel) => { await win.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, sel); await win.waitForTimeout(250); };

  // five sections in the nav, nothing else
  await open('account');
  const nav = await win.$$eval('.st-tabs .st-tab', (b) => b.map((x) => x.dataset.tab));
  assert.deepStrictEqual(nav, ['account', 'models', 'fabro', 'resources', 'advanced']);
  step('five sections');

  // My account
  for (const sel of ['[data-mount=accounts]', '[data-input=userName]', '[data-input=aiName]', '[data-input="gen.systemPrompt"]', '[data-input=language]', '[data-key=theme]', '[data-key=reduceMotion]', '[data-anchor=keys]', '[data-anchor=anywhere]'])
    assert.ok(await win.$(`.st-content ${sel}`), 'account: ' + sel);
  await shot('01-account');
  await scrollTo('[data-anchor=keys]'); await shot('01b-account-keys');
  step('My account: name, AI name, instructions, look, themes, keys, Anywhere');

  // My models
  await open('models');
  for (const sel of ['[data-mf=section] .mf', '[data-mf=tiers]', '[data-anchor=install]', '[data-anchor=storage]'])
    await win.waitForSelector(`.st-content ${sel}`, { timeout: 8000 });
  await shot('02-models');
  await scrollTo('[data-mf=tiers]'); await shot('02b-models-tiers');
  step('My models: finder, tiers, install, storage');

  // My Fabro
  await open('fabro');
  await win.waitForSelector('.mf2 .mf2-intro', { timeout: 8000 });
  assert.ok(/Mémoire de master/.test(await win.textContent('.mf2')), 'memory entry listed');
  await shot('03-myfabro');
  // add an entry, edit a profile line, pin
  await win.click('[data-action=mf2-e-add]'); await win.fill('#mf2-e-title', 'Café'); await win.fill('#mf2-e-content', 'Lulu boit son café sans sucre.');
  await win.click('[data-action=mf2-e-save]'); await win.waitForFunction(() => /sans sucre/.test(document.querySelector('.mf2').textContent), null, { timeout: 5000 });
  await win.click('[data-action=mf2-prof-edit]'); await win.fill('#mf2-prof-all', 'Lulu développe Fabro.'); await win.click('[data-action=mf2-prof-save]');
  await win.waitForFunction(() => /développe Fabro/.test(document.querySelector('.mf2').textContent), null, { timeout: 5000 });
  assert.ok(/écrit par toi/.test(await win.textContent('.mf2')), 'a line written by the user says so');
  await shot('03b-myfabro-edited');
  step('My Fabro: memory, profile with sources, add / edit');

  // Resources
  await open('resources');
  await win.waitForSelector('.st-content .res-bar, .st-content .res-loading', { timeout: 8000 });
  await win.waitForSelector('.st-content .res-chart', { timeout: 10000 });
  await win.waitForTimeout(2500);
  await shot('04-resources');
  step('Resources: disk bar, live charts');

  // Advanced: every sub-tab
  const subs = await win.evaluate(() => ST_SUBS.map((x) => x.id));
  for (const sub of subs) {
    await open('advanced:' + sub);
    const n = await win.evaluate(() => document.querySelector('.st-subbody').innerHTML.length);
    assert.ok(n > 40, 'advanced:' + sub + ' has content');
    await shot('05-adv-' + sub);
  }
  step('Advanced: ' + subs.join(', '));
  await open('advanced:connectors'); await win.waitForSelector('[data-mount=mcpeasy] .mc-list', { timeout: 8000 });
  await open('advanced:skills'); await win.waitForSelector('[data-mount=skillimport] .si-zone', { timeout: 8000 });
  await open('advanced:prompts');
  for (const k of ['sysprompts', 'notebook', 'guides']) await win.waitForFunction((x) => (document.querySelector(`.st-content [data-mount=${x}]`) || {}).innerHTML?.length > 20, k, { timeout: 8000 });
  step('MCP, skills import, prompts / notebook / guides mounted');

  // old deep links land where their content lives
  const legacy = { general: 'account', providers: 'account', anywhere: 'account', models: 'models', storage: 'models', usage: 'resources', engine: 'advanced:engine', generation: 'advanced:engine', agent: 'advanced:agent', shortcut: 'advanced:shortcuts', mods: 'advanced:mods', system: 'advanced:updates', about: 'advanced:about' };
  for (const [from, to] of Object.entries(legacy)) {
    await open(from);
    const v = await win.evaluate(() => stView());
    assert.strictEqual(v, to, `openSettings('${from}') → ${v}`);
  }
  step('old deep links');

  // settings that existed before are reachable somewhere (spot check of each old page's controls)
  const where = {
    'advanced:engine': ['[data-input="gen.temperature"]', '[data-input="gen.topP"]', '[data-input="gen.maxTokens"]', '[data-key=autoTitle]'],
    models: ['[data-input=hfToken]'],
    'advanced:agent': ['[data-key="agent.subagents"]'],
    'advanced:updates': ['[data-key=autoUpdate]', '[data-key="telemetry.crashReports"]'],
    'advanced:developer': ['[data-key=devMode]'],
    account: ['[data-key=lightMode]'],
  };
  for (const [v, sels] of Object.entries(where)) {
    await open(v);
    for (const sel of sels) assert.ok(await win.$(`.st-content ${sel}`), `${v}: ${sel}`);
  }
  step('existing settings still reachable');

  // no control lost: every control of every old page (rendered with the old page functions) exists in some new view
  const sig = () => { const c = document.querySelector('.st-content'); return [...c.querySelectorAll('[data-input],[data-key],[data-action],[data-form]')].map((e) => e.dataset.input ? 'i:' + e.dataset.input : e.dataset.key ? 'k:' + e.dataset.key : e.dataset.form ? 'f:' + e.dataset.form : 'a:' + e.dataset.action); };
  const oldSigs = await win.evaluate(() => {
    const out = {};
    for (const leaf of ['models', 'providers', 'shortcut', 'engine', 'storage', 'usage', 'agent', 'about', 'anywhere', 'mods']) {
      const d = document.createElement('div'); try { d.innerHTML = settingsBody(leaf); } catch (e) { out[leaf] = ['ERROR ' + e.message]; continue; }
      out[leaf] = [...new Set([...d.querySelectorAll('[data-input],[data-key],[data-action],[data-form]')].map((e) => e.dataset.input ? 'i:' + e.dataset.input : e.dataset.key ? 'k:' + e.dataset.key : e.dataset.form ? 'f:' + e.dataset.form : 'a:' + e.dataset.action))];
    }
    return out;
  });
  // the three old pages that lived inline in app.js (extracted from the code before the rework)
  oldSigs.general = ['k:autoUpdate', 'a:check-update', 'k:devMode', 'i:language', 'k:lightMode', 'k:reduceMotion', 'k:theme', 'i:userName'];
  oldSigs.generation = ['i:gen.temperature', 'i:gen.topP', 'i:gen.maxTokens', 'i:gen.systemPrompt'];
  oldSigs.system = ['k:telemetry.crashReports'];
  const now = new Set();
  const views = ['account', 'models', 'fabro', 'resources', ...(await win.evaluate(() => ST_SUBS.map((x) => 'advanced:' + x.id)))];
  for (const v of views) { await open(v); await win.evaluate(() => document.querySelectorAll('.st-content details').forEach((d) => { d.open = true; })); for (const k of await win.evaluate(sig)) now.add(k); }
  // devtools / crash buttons only show when dev mode is on / crashes exist: checked by their setting key above
  const missing = [];
  for (const [leaf, keys] of Object.entries(oldSigs)) for (const k of keys) if (!now.has(k) && !/^a:(devtools|crash-|settings-tab$)/.test(k)) missing.push(leaf + ' → ' + k);
  assert.deepStrictEqual(missing, [], 'controls of the old pages missing from the new settings');
  step('no control of the old pages is missing (' + Object.values(oldSigs).reduce((a, k) => a + k.length, 0) + ' checked)');

  // a setting changes and survives a re-render
  await open('account');
  await win.fill('[data-input=aiName]', 'Hélice'); await win.keyboard.press('Tab'); await win.waitForTimeout(400);
  assert.strictEqual(await win.evaluate(() => S.settings.aiName), 'Hélice');
  await win.evaluate(() => renderSettings());
  assert.strictEqual(await win.inputValue('[data-input=aiName]'), 'Hélice');
  step('a setting saves and survives a re-render');

  await win.evaluate(() => closeSettings()); await win.waitForTimeout(300);
  assert.ok(!(await win.$('#overlay-root .st-panel')), 'settings close');
  assert.deepStrictEqual(errors, [], 'no page errors');
  await app.close();
  console.log('settings-e2e: all passed → ' + shots);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); console.log('errors:', errors); process.exit(1); });
