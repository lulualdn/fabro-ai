// End-to-end: easy skill import (.skill preview → install → export) and easy MCP add (paste → test → add,
// popular list, per-tool switch). Usage: xvfb-run -a node scripts/install-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { writeZip } = require('../src/main/ziplite');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-install-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-install-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: process.env.THEME || 'light', onboarded: true, hotkey: { enabled: false } }));
const SKILL = '---\nname: pdf-tools\ndescription: Extraire le texte des PDF. À utiliser quand on parle de PDF.\nlicense: MIT\n---\n\n# PDF tools\nUse the `Read` tool then `Bash` to run scripts/extract.py.\n';
const skillFile = path.join(userData, 'pdf-tools.skill');
fs.writeFileSync(skillFile, writeZip([
  { path: 'pdf-tools/SKILL.md', data: Buffer.from(SKILL) },
  { path: 'pdf-tools/scripts/extract.py', data: Buffer.from('import sys\nprint(open(sys.argv[1], "rb").read()[:10])\n') },
  { path: 'pdf-tools/references/forms.md', data: Buffer.from('# forms') },
]));
const echo = path.join(__dirname, 'fixtures', 'mcp-echo.js');
const step = (s) => console.log('✓ ' + s);

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1', HOME: userData, USERPROFILE: userData } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERR', e.message));
  win.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  await win.setViewportSize({ width: 1280, height: 860 });

  // Settings → Agent: the two new blocks are mounted
  await win.keyboard.press('Control+,');
  await win.evaluate(() => openSettings('mcp')); await win.waitForTimeout(300);
  await win.waitForSelector('[data-mount=mcpeasy] .mc-list', { timeout: 8000 });
  await win.evaluate(() => document.querySelector('[data-mount=mcpeasy]').scrollIntoView({ block: 'start' }));
  await win.waitForTimeout(250);
  await win.screenshot({ path: `${shots}/01-agent-mcp-skills.png` });
  step('settings: MCP list and skill drop zone mounted');

  // MCP: paste a command line → a card with the exact command, test, add
  await win.click('[data-action=mc-open]');
  await win.waitForSelector('.mc-modal #mc-paste');
  await win.fill('#mc-paste', `node ${echo}`);
  await win.waitForSelector('.mc-card [data-action=mc-test]', { timeout: 8000 });
  assert.ok((await win.textContent('.mc-cmd')).includes('mcp-echo.js'), 'the exact command is shown');
  assert.ok(await win.$eval('.mc-card [data-action=mc-save]', (b) => b.disabled), 'add is disabled before a test');
  await win.screenshot({ path: `${shots}/02-mcp-paste.png` });
  await win.click('.mc-card [data-action=mc-test]');
  await win.waitForSelector('.mc-test.ok', { timeout: 15000 });
  await win.screenshot({ path: `${shots}/03-mcp-tested.png` });
  step('MCP: pasted command parsed, tested, tools listed');
  await win.click('.mc-card [data-action=mc-save]');
  await win.waitForSelector('.mc-card.done', { timeout: 10000 });
  step('MCP: added after a successful test');

  // bad paste → a plain error, not a crash
  await win.fill('#mc-paste', 'bonjour ceci n’est pas un serveur');
  await win.waitForSelector('.mc-err', { timeout: 8000 });
  step('MCP: nonsense paste → plain message');

  // popular list
  await win.click('[data-action=mc-tab][data-tab=popular]');
  await win.waitForSelector('.mc-pop-row', { timeout: 8000 });
  await win.click('.mc-pop-row[data-id=filesystem]');
  await win.waitForSelector('.mc-pop-card .mc-card', { timeout: 8000 });
  await win.screenshot({ path: `${shots}/04-mcp-popular.png` });
  step('MCP: popular list opens a server card');

  // other apps (none in this fresh HOME) → explained empty state
  await win.click('[data-action=mc-tab][data-tab=other]');
  await win.waitForFunction(() => !document.querySelector('.mc-loading'), null, { timeout: 15000 });
  await win.screenshot({ path: `${shots}/05-mcp-other.png` });
  step('MCP: other apps tab renders');
  await win.click('.mc-head [data-action=mc-close]');
  await win.waitForTimeout(300);

  // the added server is ready in the list, its tools have switches
  await win.waitForSelector('[data-mount=mcpeasy] .mc-st.st-ready', { timeout: 10000 });
  await win.click('[data-mount=mcpeasy] [data-action=mc-expand]');
  await win.waitForSelector('[data-mount=mcpeasy] .mc-tool .switch', { timeout: 5000 });
  await win.evaluate(() => document.querySelector('[data-mount=mcpeasy]').scrollIntoView({ block: 'start' }));
  await win.waitForTimeout(200);
  await win.screenshot({ path: `${shots}/06-mcp-tools.png` });
  const before = (await win.evaluate(() => api.agent.tools())).filter((x) => /echo/i.test(x.name || x.id || '')).length;
  await win.click('[data-mount=mcpeasy] .mc-tool .switch');
  await win.waitForTimeout(400);
  const after = (await win.evaluate(() => api.agent.tools())).filter((x) => /echo/i.test(x.name || x.id || '')).length;
  assert.ok(after < before, `switching a tool off hides it from the agent (${before} → ${after})`);
  step('MCP: per-tool switch hides the tool from the agent');

  // Skills (Settings › Advanced › Skills & tools): a .skill opens the preview (same path as double-click), nothing runs, install
  await win.evaluate(() => openSettings('advanced:skills')); await win.waitForTimeout(300);
  await win.waitForSelector('[data-mount=skillimport] .si-zone', { timeout: 8000 });
  await win.waitForFunction(() => !document.querySelector('[data-mount=skillimport] .si-found .spinner'), null, { timeout: 8000 }).catch(() => {});
  await win.screenshot({ path: `${shots}/06b-skills-tab.png` });
  await win.evaluate((p) => SkillsImport.openFile(p), skillFile);
  await win.waitForSelector('.si-modal .si-card', { timeout: 10000 });
  const pv = await win.textContent('.si-modal');
  assert.ok(/pdf-tools/.test(pv), 'name shown');
  assert.ok(/extract\.py/.test(pv), 'file list shown');
  await win.click('.si-files summary');
  await win.screenshot({ path: `${shots}/07-skill-preview.png` });
  step('skills: .skill preview (files, scripts, compat note)');
  await win.click('.si-modal [data-action=si-install]');
  await win.waitForFunction(() => !document.querySelector('.si-modal'), null, { timeout: 10000 });
  const list = await win.evaluate(() => api.skills.list());
  assert.ok(list.some((s) => s.name === 'pdf-tools'), 'skill installed');
  await win.waitForSelector('[data-action=skill-export][data-name=pdf-tools]', { timeout: 8000 });
  await win.evaluate(() => document.querySelector('[data-action=skill-export][data-name=pdf-tools]').scrollIntoView({ block: 'center' }));
  await win.waitForTimeout(200);
  await win.screenshot({ path: `${shots}/08-skill-installed.png` });
  step('skills: installed, listed with export and delete');

  // same file again → collision choice (keep both / replace)
  await win.evaluate((p) => SkillsImport.openFile(p), skillFile);
  await win.waitForSelector('.si-modal .si-coll', { timeout: 10000 });
  await win.screenshot({ path: `${shots}/09-skill-collision.png` });
  await win.click('.si-modal [data-action=si-close]');
  step('skills: second import offers keep both / replace');

  // link dialog: a bad link gives a plain error
  await win.evaluate(() => SkillsImport.openLink());
  await win.fill('#si-link-text', 'pas un lien');
  await win.click('[data-action=si-link-go]');
  await win.waitForSelector('.si-modal .si-err', { timeout: 10000 });
  await win.screenshot({ path: `${shots}/10-skill-bad-link.png` });
  await win.click('.si-modal [data-action=si-close]');
  step('skills: bad link → plain error');

  await app.close();
  console.log('install-e2e: all passed → ' + shots);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
