// End-to-end test of the Agents app: a fake OpenAI-compatible server plays the agents, the watchdog
// and the background reflection. Verifies: the app appears in the sidebar, agents reply, in a group
// they address each other, ask_user is redirected, and the proactive reflection posts a message.
// Usage: xvfb-run -a node scripts/agents-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-ag-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-ag-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'dark', onboarded: true, devModeReleased: true, hotkey: { enabled: false } }));

const sse = (res, text) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
const srv = http.createServer((req, res) => {
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-large' }] }));
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = JSON.parse(b);
    const sys = String((body.messages[0] || {}).content || '');
    const users = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : ''));
    const lastUser = users[users.length - 1] || '';
    const didTool = body.messages.some((m) => m.role === 'tool' || (Array.isArray(m.tool_calls) && m.tool_calls.length)); // a tool already ran this turn
    if (/You supervise an AI agent/.test(sys)) return sse(res, 'DONE');
    if (/get better at its role/.test(sys)) return sse(res, '-');
    if (/proactively PROPOSE/.test(sys)) return sse(res, /propose-please/.test(users.join(' ')) ? 'Tiens, je peux te créer un petit skill pour ça si tu veux 🙂' : 'NOTHING');
    // The persona rides along as the agent prompt's "base", so match the agent name there (not the Fabro lead).
    const m = sys.match(/You are (\w+), an AI agent on/);
    if (m) {
      const name = m[1]; const group = /teammates here/.test(sys);
      if (didTool) return sse(res, 'Ok je décide: option A 👍'); // after ask_user was redirected, it decides itself
      if (/ask_user test/i.test(lastUser)) { // force one ask_user call to check it is redirected, not blocked
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Quelle option ?', options: ['A', 'B'] }) } }] } }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      if (group && name === 'Alpha') return sse(res, 'ok je m\'y mets 👍 @Beta tu confirmes le plan ?');
      if (group && name === 'Beta') return sse(res, 'oui c\'est bon de mon côté ✅');
      return sse(res, 'Bien reçu, voilà: 42.');
    }
    sse(res, 'ok');
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, what = 'condition') { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await wait(250); } throw new Error('timeout: ' + what); }

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERR', e.message));
  win.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await win.waitForSelector('#sb-lists', { timeout: 30000 });

  // connect the fake model as the default
  await win.evaluate(async (u) => { await api.providers.enable(true); await api.providers.add({ kind: 'custom', name: 'Fake', baseUrl: u }); await refreshModels(); const m = allModels()[0]; if (m) await saveSettings({ selectedModel: m.ref }); }, base);

  // 1. Agents app is in the sidebar (enabled by default)
  await until(() => win.$('.app-item[data-id=agents]'), 15000, 'agents app in sidebar');
  await win.click('.app-item[data-id=agents]');
  await win.waitForSelector('.ag-wrap');
  console.log('✓ Agents app opens from the sidebar');

  // 2. create two agents
  const teamNames = () => win.$$eval('.ag-team-item b', (b) => b.map((x) => x.textContent));
  const addAgent = async (name, role) => { await win.click('[data-ag=new-agent]'); await win.waitForSelector('.ag-dialog'); await win.fill('#f-name', name); await win.fill('#f-role', role); await win.click('[data-ag=save-agent]'); await until(async () => (await teamNames()).includes(name), 15000, name + ' created'); };
  await addAgent('Alpha', 'Développeur');
  await addAgent('Beta', 'Testeur');
  await win.screenshot({ path: path.join(shots, '01-team.png') });
  console.log('✓ two agents created');

  const idle = () => until(() => win.evaluate(() => api.mods.call('agents', 'idle', [])), 25000, 'agents idle');

  // 3. DM: message one agent, it replies
  await win.click('.ag-team-item[data-id] >> text=Alpha');
  await win.waitForSelector('#ag-input');
  await win.fill('#ag-input', 'Salut Alpha, prêt ?'); await win.keyboard.press('Enter');
  await until(() => win.$$eval('.ag-m:not(.me) .ag-b', (b) => b.some((x) => /42/.test(x.textContent))), 20000, 'Alpha replied');
  await idle();
  console.log('✓ DM: agent replies');

  // 4. ask_user is redirected (the agent is told to ask directly, then answers)
  await win.fill('#ag-input', 'ask_user test stp'); await win.keyboard.press('Enter');
  await until(() => win.$$eval('.ag-m:not(.me) .ag-b', (b) => b.some((x) => /option A/i.test(x.textContent))), 20000, 'ask_user redirected');
  await idle();
  console.log('✓ ask_user is redirected to the person (no blocking prompt)');

  // 5. group: both agents respond and address each other
  await win.click('[data-ag=new-group]'); await win.waitForSelector('.ag-dialog');
  await win.fill('#g-name', 'Projet X');
  for (const n of ['Alpha', 'Beta']) await win.locator('.ag-pk', { hasText: n }).locator('input').check();
  await win.click('[data-ag=save-group]');
  await win.waitForSelector('#ag-input');
  await win.fill('#ag-input', 'On lance le projet, qui fait quoi ?'); await win.keyboard.press('Enter');
  await until(() => win.$$eval('.ag-m:not(.me) .ag-who', (w) => { const names = w.map((x) => x.textContent.replace(/\s*spontané\s*/, '').trim()); return names.includes('Alpha') && names.includes('Beta'); }), 30000, 'both agents spoke');
  assert(await win.$$eval('.ag-m:not(.me) .ag-b', (b) => b.some((x) => /@Beta/.test(x.textContent))), 'Alpha addressed Beta');
  await win.screenshot({ path: path.join(shots, '02-group.png') });
  await idle();
  console.log('✓ group: agents reply and address each other');

  // 6. background reflection posts a proactive message
  await win.fill('#ag-input', 'note: propose-please'); await win.keyboard.press('Enter'); await idle(); await wait(500);
  await win.evaluate(() => api.mods.call('agents', 'reflectNow', []));
  await until(() => win.$$eval('.ag-tag', (t) => t.length > 0), 15000, 'proactive message');
  await win.screenshot({ path: path.join(shots, '03-proactive.png') });
  console.log('✓ background reflection proposes something proactively');

  await app.close(); srv.close();
  console.log('ALL OK →', shots);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
