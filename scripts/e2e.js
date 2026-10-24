// End-to-end UI test of the real Electron app (Playwright).
// Fake OpenAI-compatible server → connect provider → chat → quick bar → close-to-tray.
// Usage: node scripts/e2e.js [screenshotDir]   (on Linux CI: xvfb-run node scripts/e2e.js)
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-shots-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-e2e-'));
const agentDir = path.join(userData, 'dossier-agent'); fs.mkdirSync(agentDir);
// A small JS project with a failing test, in git, for Code mode.
const proj = path.join(userData, 'calc-app');
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'calc-app', version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2));
fs.writeFileSync(path.join(proj, 'src', 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
fs.writeFileSync(path.join(proj, 'test.js'), "const assert = require('assert');\nconst { add } = require('./src/math');\nlet ok = 0, ko = 0;\nfor (const [n, f] of [['adds', () => assert.strictEqual(add(2, 3), 5)], ['zero', () => assert.strictEqual(add(0, 0), 0)]]) { try { f(); ok++; console.log('✓ ' + n); } catch (e) { ko++; console.log('✕ ' + n); } }\nconsole.log(ok + ' passed, ' + ko + ' failed');\nprocess.exit(ko ? 1 : 0);\n");
fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html><title>Calc</title><h1>Calc app</h1>');
const gitOk = (() => { try { const cp = require('child_process'); const g = (a) => cp.execFileSync('git', a, { cwd: proj, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } }); g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-q', '-m', 'init']); return true; } catch { return false; } })();
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: process.env.THEME || 'light' }));

const reply = 'Bonjour ! Voici **une réponse** de test.\n\n```js\nconsole.log("ok")\n```';
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-model-large' }, { id: 'fake-model-mini' }] }));
    if (req.url === '/login') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>Connexion test</title><h1>Connexion</h1><form><input name="user" placeholder="Identifiant"><input type="password" name="pw" placeholder="Mot de passe"><button>Se connecter</button></form>'); }
    if (req.url.startsWith('/search')) return res.end(JSON.stringify({ results: [{ title: 'Fabro — Lift off, locally', url: 'https://fabro.example/a', snippet: 'Local AI app' }, { title: 'llama.cpp', url: 'https://github.com/ggml-org/llama.cpp', snippet: 'Inference' }] }));
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(b);
      const sys = String((body.messages[0] || {}).content || '');
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
      const ut = String(lastUser && (typeof lastUser.content === 'string' ? lastUser.content : '') || '');
      const one = (text) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
      if (/You name conversations/.test(sys)) return one('Test de Fabro');
      if (/maintain a short memory/.test(sys)) return one('["Teste Fabro en profondeur"]');
      // ── agent scripts ──
      const toolsDone = body.messages.filter((m) => m.role === 'tool');
      const call1 = (name, args) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't' + toolsDone.length, function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
      const callN = (calls) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.map(([name, args], i) => ({ index: i, id: `m${toolsDone.length}-${i}`, function: { name, arguments: JSON.stringify(args) } })) } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
      if (/sub-agent working for the main/.test(sys)) {
        if (toolsDone.length === 0) return call1('web_search', { query: ut });
        return setTimeout(() => one(`Rapport sur « ${ut} » : Fabro est une app d’IA locale [1].`), 600);
      }
      if (/compare deux moteurs/i.test(body.messages.filter((m) => m.role === 'user').map((m) => typeof m.content === 'string' ? m.content : '').join(' '))) {
        if (toolsDone.length === 0) return call1('web_search', { query: 'moteur a' });
        if (toolsDone.length === 1) return setTimeout(() => call1('web_search', { query: 'moteur b' }), 1500);
        const prec = body.messages.some((m) => m.role === 'user' && /Précision ajoutée/.test(String(m.content)));
        return one(`Les deux moteurs diffèrent [1, ${toolsDone[0].content.match(/\[(\d+)\]/g).length + 1}].${prec ? ' (précision reçue : en français)' : ''}`);
      }
      if (/fais un truc cool/i.test(ut)) {
        if (toolsDone.length === 0) return call1('ask_user', { question: 'Tu veux quoi exactement ?', options: ['Un poème', 'Une blague'] });
        return one('OK : ' + toolsDone[0].content);
      }
      if (/dossier de veille/i.test(ut)) {
        const P = (a, b, c) => ({ steps: [{ title: 'Répartir les recherches', status: a }, { title: 'Chercher en parallèle', status: b }, { title: 'Rédiger la synthèse', status: c }] });
        if (toolsDone.length === 0) return call1('update_plan', P('done', 'in_progress', 'pending'));
        if (toolsDone.length === 1) return callN([['run_subagent', { description: 'Veille moteurs locaux', task: 'moteurs locaux' }], ['run_subagent', { description: 'Veille interfaces', task: 'interfaces' }]]);
        if (toolsDone.length === 3) return call1('update_plan', P('done', 'done', 'done'));
        return one('Synthèse : deux sous-agents ont couvert les moteurs locaux et les interfaces.');
      }
      if (/# Project: Potager/.test(sys)) return one(/Réponds comme un jardinier/.test(sys) && /Arroser les tomates le soir/.test(sys) ? 'D’après notes.md : arrosez les tomates le soir. 🌱' : 'Pas de contexte projet.');
      if (/# Code session/.test(sys) && /corrige le bug/i.test(ut)) {
        if (toolsDone.length === 0) return call1('read_file', { path: 'src/math.js' });
        if (toolsDone.length === 1) return call1('edit_file', { path: 'src/math.js', old_text: 'return a - b;', new_text: 'return a + b;' });
        if (toolsDone.length === 2) return call1('run_tests', {});
        return one('Corrigé : `add` soustrayait au lieu d’additionner. Les tests passent.');
      }
      if (/range mon dossier/i.test(ut)) {
        if (toolsDone.length === 0) return call1('write_file', { path: path.join(agentDir, 'resume.md'), content: '# Résumé\nTout est rangé.' });
        if (toolsDone.length === 1) return call1('create_document', { format: 'docx', title: 'Rapport Fabro', content: '# Rapport\n\nTout va **bien**.\n\n- un\n- deux', folder: agentDir });
        return one('C’est fait : resume.md et Rapport Fabro.docx sont dans ton dossier.');
      }
      if (/connecte-toi/i.test(ut)) {
        if (toolsDone.length === 0) return call1('browser_open', { url: global.__base.replace('/v1', '/login') });
        if (toolsDone.length === 1) return call1('browser_type', { id: 2, text: 'hunter2' });
        if (toolsDone.length === 2) return call1('browser_type', { id: 1, text: 'lulu' });
        return one('Je ne tape pas les mots de passe : à toi de le saisir dans le panneau.');
      }
      if (/additionne/i.test(ut)) {
        const t = (body.tools || []).map((x) => x.function.name).find((n) => /echo__add/.test(n));
        if (toolsDone.length === 0 && t) return call1(t, { a: 2, b: 40 });
        return one('Résultat : ' + (toolsDone[0] ? toolsDone[0].content : '?'));
      }
      if (/cherche/i.test(ut) && body.tools && !body.messages.some((m) => m.role === 'tool')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"fabro app"}' } }] } }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      if (body.messages.some((m) => m.role === 'tool')) return one('D’après les résultats, Fabro est une app d’IA locale [1].');
      if (/version B/.test(ut)) return one('Réponse à la version B.');
      if (/rédige/i.test(ut)) return one('Voici la lettre.\n\n<artifact type="markdown" title="Lettre de motivation">\n# Lettre de motivation\n\nMadame, Monsieur,\n\nJe souhaite rejoindre **votre équipe**.\n\n- Motivé\n- Curieux\n</artifact>\n\nDites-moi si vous voulez l’ajuster.');
      if (/diapos/i.test(ut)) return one('Voici le deck.\n<artifact type="slides" title="Présentation Fabro">\n# Fabro\nLift off, locally.\n\n---\n\n## Pourquoi\n- Local\n- **Rapide**\n- Privé\n\n---\n\n## Merci\n</artifact>');
      if (/page web/i.test(ut)) return one('<artifact type="html" title="Compteur">\n<!doctype html><html><body><h1 id="n">0</h1><button onclick="n.textContent=+n.textContent+1">+1</button></body></html>\n</artifact>');
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
  const base = `http://127.0.0.1:${srv.address().port}/v1`; global.__base = base;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const errors = [];
  const win = await app.firstWindow();
  global.__fail = async () => { try { await win.screenshot({ path: `${shots}/FAIL.png` }); console.log('page errors:', errors, await win.evaluate(() => (document.querySelector('.pf-error') || {}).textContent)); console.log('last steps:', JSON.stringify(await win.evaluate(() => S.conv && S.conv.messages.at(-1) && { c: S.conv.messages.at(-1).content, e: S.conv.messages.at(-1).error, steps: (S.conv.messages.at(-1).steps || []).map((s) => [s.id, s.name, s.status, s.error]) }))); } catch {} };
  app.process().stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  app.process().stderr.on('data', (d) => { const s = String(d); if (/Error|error:/.test(s) && !/ERROR:|dbus|Gtk|libva|viz|gpu/i.test(s)) console.log('[main]', s.trim().slice(0, 400)); });
  win.on('pageerror', (e) => errors.push('main: ' + e.message));
  await win.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await win.waitForSelector('.greet', { timeout: 20000 });
  // Clean screenshots for the website: E2E_CLEAN=1 hides the internal banner, E2E_THEME=dark|light.
  if (process.env.E2E_CLEAN) await win.evaluate(async (th) => { await applySetting('devMode', false); if (th) await applySetting('theme', th); }, process.env.E2E_THEME || '');
  await win.waitForTimeout(1200);
  step('welcome'); await win.screenshot({ path: `${shots}/01-welcome.png` });
  assert.match(await win.textContent('.greet'), /Lulu/);
  // onboarding: the propeller asks a few questions (skipped in tests unless forced)
  await win.evaluate(() => { ONB.i = 0; ONB.a = {}; renderOnboarding(); });
  await win.click('.onb [data-action=onb-next]', { timeout: 8000 });
  await win.waitForSelector('#onb-in'); await win.waitForFunction(() => document.querySelector('.onb-ans').style.opacity === '1');
  await win.fill('#onb-in', 'Lulu'); await win.keyboard.press('Enter');
  await win.waitForFunction(() => document.querySelector('.onb-ans').style.opacity === '1' && /Lulu/.test(document.querySelector('.onb-q').textContent));
  await win.fill('#onb-in', 'Nova');
  step('onboarding'); await win.screenshot({ path: `${shots}/01b-onboarding.png` });
  await win.keyboard.press('Enter');
  await win.click('.onb-chip[data-v=code]', { timeout: 8000 }); await win.click('.onb [data-action=onb-next]');
  await win.click('.onb-chip[data-v=concise]', { timeout: 8000 });
  await win.click('.onb-chip[data-v=light]', { timeout: 8000 });
  await win.click('.onb [data-action=onb-finish]', { timeout: 8000 });
  await win.waitForFunction(() => !document.getElementById('onb'));
  const ob = await win.evaluate(() => ({ s: S.settings, sys: systemPrompt() }));
  assert.ok(ob.s.onboarded && ob.s.aiName === 'Nova' && ob.s.activeStyle === 'concise' && ob.s.useFor.includes('code'), 'onboarding saved');
  assert.match(ob.sys, /named you "Nova"/);
  await win.evaluate(() => saveSettings({ activeStyle: 'default', aiName: '', useFor: [] }));

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
  assert.match(await quick.textContent('#q-target'), /Salut|Test de Fabro/);
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

  // ask_user: the AI asks when the request is vague
  await win.click('[data-action=new-chat]'); await win.fill('#prompt', 'Fais un truc cool'); await win.keyboard.press('Enter');
  await win.waitForSelector('.q-card .q-opts button', { timeout: 15000 });
  step('ask_user'); await win.screenshot({ path: `${shots}/08b-ask-user.png` });
  await win.click('.q-card .q-opts button >> text=Une blague');
  await win.waitForFunction(() => /answered: Une blague/.test(S.conv.messages.at(-1).content || '') && !S.streaming, null, { timeout: 15000 });
  // scheduled task: weekly on Monday and Thursday at 15:00, with a variable
  const tk = await win.evaluate(async () => { const t = await api.tasks.create({ title: 'Test hebdo', prompt: 'Dis bonjour à {{name}}', when: { type: 'weekly', days: ['mon', 'thu'], time: '15:00' }, vars: { name: 'Lulu' } }); return (await api.tasks.list()).find((x) => x.id === t.id); });
  const nd = new Date(tk.next); assert.ok([1, 4].includes(nd.getDay()) && nd.getHours() === 15 && nd.getMinutes() === 0, 'weekly next run: ' + nd);
  await win.evaluate((id) => api.tasks.run(id), tk.id);
  await win.waitForFunction(async (id) => { const l = await api.tasks.list(); const k = l.find((x) => x.id === id); return k && k.runs && k.runs.length; }, tk.id, { timeout: 20000, polling: 500 });
  await win.click('.nav-item[data-mode=tasks]'); await win.waitForSelector('.tk'); await win.waitForTimeout(300);
  step('tasks page'); await win.screenshot({ path: `${shots}/08c-tasks.png` });
  assert.match(await win.textContent('.tk'), /Test hebdo/);
  await win.evaluate((id) => api.tasks.remove(id), tk.id);
  await win.evaluate(() => { S.mode = 'chat'; newChat(); renderSidebar(); renderView(); });

  // ── Wave 3: tools, branches, regenerate, search, title, memory, personalization ──
  await win.evaluate(async () => { await saveSettings({ search: { engine: 'ducky', duckyUrl: location.protocol === 'file:' ? '' : '' } }); S.memDelay = 400; });
  await win.evaluate((u) => saveSettings({ search: { engine: 'ducky', duckyUrl: u } }), base.replace('/v1', '/search?q={q}'));
  await win.click('[data-action=new-chat]');
  await win.waitForTimeout(300);
  await win.fill('#prompt', 'Je cherche des infos sur Fabro');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /app d’IA locale/.test(document.querySelector('.msg.assistant .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  await win.waitForTimeout(400);
  step('web search answer'); await win.screenshot({ path: `${shots}/17-search.png` });
  assert.ok(await win.$('.step.done .src'), 'search step with sources');
  assert.ok(await win.$('.cites .cite'), 'cited sources');
  await win.waitForFunction(() => S.conv && S.conv.title === 'Test de Fabro', null, { timeout: 8000 });
  // several searches: numbering runs on, citations become links, tools fold into one summary; a precision mid-answer
  const searchConv = await win.evaluate(() => S.conv.id);
  await win.click('[data-action=new-chat]'); await win.waitForTimeout(300);
  await win.fill('#prompt', 'Compare deux moteurs **vite**');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => S.streaming && (S.streaming.msg.steps || [])[0]?.status === 'done', null, { timeout: 15000 });
  await win.fill('#prompt', 'Réponds en français');
  assert.equal(await win.getAttribute('#send-btn', 'data-action'), 'inject', 'typing while answering offers a precision');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /précision reçue/.test(document.querySelector('.msg.assistant .a-body > .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  await win.waitForTimeout(300);
  assert.ok(await win.$('.msg.user .u-md strong'), 'user markdown');
  assert.ok(await win.$('.precision.used'), 'precision shown as taken into account');
  assert.match(await win.textContent('.steps-sum summary'), /2 fois/i, 'tools summary');
  assert.equal((await win.$$('.md a.cit')).length, 2, 'inline citation links');
  assert.ok(await win.evaluate(() => S.conv.messages.at(-1).steps[1].view.offset > 0), 'numbering continues across searches');
  assert.ok((await win.$$('.cites .cite')).length >= 1 && /Sources cit/.test(await win.textContent('.cites-h')), 'cited sources listed (deduplicated)');
  step('summary + citations + precision'); await win.screenshot({ path: `${shots}/17b-cites.png` });
  await win.click('.steps-sum summary'); await win.waitForTimeout(200);
  await win.screenshot({ path: `${shots}/17c-steps-open.png` });
  await win.evaluate((id) => openConv(id), searchConv); await win.waitForTimeout(500);
  await win.waitForFunction(() => (S.memories || []).some((m) => /profondeur/.test(m.text)), null, { timeout: 8000 });
  // edit → branch
  await win.hover('.msg.user');
  await win.click('.msg.user [data-action=edit-msg]');
  await win.fill('.edit-ta', 'Et la version B ?');
  await win.click('[data-action=edit-save]');
  await win.waitForFunction(() => /version B/.test(document.querySelector('.msg.assistant .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  assert.match(await win.textContent('.msg.user .branch-nav'), /2\/2/);
  step('branch'); await win.screenshot({ path: `${shots}/18-branch.png` });
  await win.click('.msg.user [data-action=branch][data-dir="-1"]');
  await win.waitForTimeout(300);
  assert.match(await win.textContent('.msg.assistant .md'), /app d’IA locale/);
  // regenerate → assistant sibling
  await win.hover('.msg.assistant');
  await win.click('[data-action=regen]');
  await win.waitForFunction(() => !document.querySelector('.msg.assistant.pending') && document.querySelectorAll('.msg.assistant .branch-nav').length === 1, null, { timeout: 15000 });
  // full-text search in the sidebar
  await win.fill('#sb-q', 'profondeur infos');
  await win.waitForTimeout(500);
  await win.fill('#sb-q', 'infos Fabro');
  await win.waitForSelector('.recent.sr mark', { timeout: 4000 });
  step('fts'); await win.screenshot({ path: `${shots}/19-fts.png` });
  await win.fill('#sb-q', '');
  // composer menus
  await win.click('[data-action=reasoning-menu]');
  await win.waitForTimeout(200);
  step('reasoning menu'); await win.screenshot({ path: `${shots}/20-reasoning.png` });
  await win.click('[data-action=set-reasoning][data-value=off]');
  await win.click('[data-action=plus-menu]');
  await win.waitForTimeout(200);
  step('plus menu'); await win.screenshot({ path: `${shots}/21-plus.png` });
  await win.keyboard.press('Escape');
  // personalization
  await win.click('[data-action=user-menu]'); await win.waitForSelector('.popover'); await win.click('.pm-item[data-mode=custom]');
  await win.waitForSelector('.custom-page');
  await win.fill('.mem-add input', 'Préfère les réponses en français');
  await win.click('.mem-add button');
  await win.waitForTimeout(400);
  step('personalization'); await win.screenshot({ path: `${shots}/22-custom.png` });
  assert.ok(await win.evaluate(() => S.memories.length >= 2));
  // ephemeral chat is never saved
  await win.click('[data-action=new-chat]');
  await win.click('[data-action=plus-menu]');
  await win.click('[data-action=ephemeral-toggle]');
  await win.fill('#prompt', 'secret éphémère');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => !document.querySelector('.msg.assistant.pending') && document.querySelector('.msg.assistant .md'), null, { timeout: 15000 });
  await win.waitForTimeout(900);
  step('ephemeral'); await win.screenshot({ path: `${shots}/23-ephemeral.png` });
  assert.ok(!(await win.evaluate(() => api.conv.list())).some((c) => /secret/.test(c.title || '')), 'ephemeral not saved');

  // ── Artifacts: document edit + versions, slides theme, web page preview, gallery ──
  await win.click('[data-action=new-chat]');
  await win.fill('#prompt', 'Rédige une lettre de motivation');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.art-card[data-action=art-open]', { timeout: 15000 });
  await win.waitForSelector('.viewer .art-doc', { timeout: 5000 });
  await win.waitForTimeout(500);
  step('artifact doc'); await win.screenshot({ path: `${shots}/24-art-doc.png` });
  await win.click('[data-action=art-edit]');
  await win.waitForSelector('#art-rich');
  await win.click('#art-rich h1');
  await win.keyboard.press('End');
  await win.keyboard.type(' — Fabro');
  await win.evaluate(() => { const p = document.querySelector('#art-rich p strong'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await win.dispatchEvent('.rt-color[data-arg="#d0342c"]', 'mousedown');
  step('artifact editing'); await win.screenshot({ path: `${shots}/25-art-edit.png` });
  await win.click('[data-action=art-save]');
  await win.waitForTimeout(400);
  const art = await win.evaluate(() => curArt());
  assert.strictEqual(art.versions.length, 2);
  assert.match(art.versions[1].content, /# Lettre de motivation — Fabro/);
  assert.match(art.versions[1].content, /color:#d0342c/);
  const blocks = await win.evaluate(() => mdToBlocks(curArt().versions[1].content));
  assert.ok(blocks.some((b) => b.type === 'h1') && blocks.some((b) => b.type === 'li') && blocks.some((b) => (b.runs || []).some((r) => r.color === '#d0342c')), 'docx blocks keep heading, list and color');
  await win.fill('#prompt', 'Fais des diapos');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.viewer .deck .slide', { timeout: 15000 });
  await win.waitForTimeout(500);
  await win.click('[data-action=art-edit]');
  await win.click('.deck-theme .dt >> nth=1');
  await win.waitForTimeout(300);
  step('slides edit'); await win.screenshot({ path: `${shots}/26-slides.png` });
  await win.click('[data-action=art-save]');
  assert.strictEqual(await win.evaluate(() => curArt().style.bg), '#12161d');
  assert.strictEqual(await win.evaluate(() => splitSlides(curArt().versions.at(-1).content).length), 3);
  await win.fill('#prompt', 'Une page web avec un compteur');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.viewer iframe.art-frame', { timeout: 15000 });
  await win.waitForFunction(() => !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  await win.waitForTimeout(800); // the viewer re-renders once the artifact is saved
  const frame = await (await win.$('.viewer iframe.art-frame')).contentFrame();
  await frame.waitForSelector('button');
  await frame.click('button'); await frame.click('button');
  await frame.waitForFunction(() => document.querySelector('#n').textContent === '2', null, { timeout: 5000 });
  step('html artifact'); await win.screenshot({ path: `${shots}/27-html.png` });
  await win.click('[data-action=viewer-close]');
  await win.click('.nav-item[data-mode=artifacts]');
  await win.waitForSelector('.art-tile');
  await win.waitForTimeout(500);
  step('gallery'); await win.screenshot({ path: `${shots}/28-gallery.png` });
  assert.strictEqual(await win.$$eval('.art-tile', (x) => x.length), 3);

  // ── Agent: auto-switch, permissions, files, documents, browser guard, MCP ──
  await win.click('[data-action=new-chat]');
  await win.fill('#prompt', 'Range mon dossier stp');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.perm-card', { timeout: 15000 });
  await win.waitForTimeout(300);
  step('agent permission'); await win.screenshot({ path: `${shots}/29-agent-perm.png` });
  assert.ok(await win.evaluate(() => S.conv.agent), 'conversation switched to agent');
  assert.ok(await win.$('.agent-chip'), 'agent badge');
  await win.click('.perm-card [data-v=always]'); // folder: always
  await win.waitForSelector('.perm-card [data-v=once]', { timeout: 8000 });
  await win.click('.perm-card [data-v=once]'); // write_file
  await win.waitForSelector('.perm-card [data-v=once]', { timeout: 8000 });
  await win.click('.perm-card [data-v=once]'); // create_document
  await win.waitForFunction(() => /C’est fait/.test(document.querySelector('.msg.assistant:last-child .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  assert.strictEqual(fs.readFileSync(path.join(agentDir, 'resume.md'), 'utf8'), '# Résumé\nTout est rangé.');
  assert.ok(fs.existsSync(path.join(agentDir, 'Rapport Fabro.docx')), 'docx created');
  await win.waitForTimeout(300);
  step('agent done'); await win.screenshot({ path: `${shots}/30-agent-done.png` });
  // browser: opens live view, never types passwords
  await win.fill('#prompt', 'Connecte-toi sur le site de test');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /mots de passe/.test(document.querySelector('.msg.assistant:last-child .md')?.textContent || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 25000 });
  const steps = await win.evaluate(() => S.conv.messages.at(-1).steps.map((s) => [s.name, s.status]));
  assert.deepStrictEqual(steps.map((x) => x[1]), ['done', 'refused', 'done'], 'password typing refused, username typed');
  await win.click('.ws-tab-browser, [data-action=ws-tab][data-tab=browser]').catch(() => {});
  await win.waitForTimeout(800);
  const bstate = await win.evaluate(() => api.browser.state());
  assert.match(bstate.url, /\/login$/);
  step('agent browser'); await win.screenshot({ path: `${shots}/31-agent-browser.png` });
  const typed = await app.evaluate(async ({ webContents }) => { const wc = webContents.getAllWebContents().find((w) => /\/login$/.test(w.getURL())); return wc && wc.executeJavaScript('[document.querySelector("[name=user]").value, document.querySelector("[name=pw]").value]'); });
  assert.deepStrictEqual(typed, ['lulu', ''], 'only the username was typed: ' + JSON.stringify(typed));
  // Plan + parallel sub-agents, shown in the session panel
  await win.fill('#prompt', 'Fais un dossier de veille');
  await win.keyboard.press('Enter');
  await win.click('[data-action=viewer-close]').catch(() => {});
  await win.waitForSelector('.sub-block', { timeout: 15000 });
  await win.waitForTimeout(250);
  step('subagents running'); await win.screenshot({ path: `${shots}/31b-subagents.png` });
  await win.waitForFunction(() => /Synthèse/.test(S.conv.messages.at(-1).content || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 25000 });
  await win.click('[data-action=viewer-close]').catch(() => {});
  await win.waitForTimeout(400);
  const sp = await win.evaluate(() => ({ plan: [...document.querySelectorAll('.sp-plan li')].map((l) => l.className), used: [...document.querySelectorAll('.sp-used span')].map((x) => x.textContent) }));
  assert.ok(sp.plan.filter((c) => c === 'done').length >= 1 && !sp.plan.includes('in_progress'), 'plan finished in the panel: ' + JSON.stringify(sp));
  assert.ok(sp.used.includes('Sous-agents') && sp.used.includes('Recherche web'), 'used list: ' + JSON.stringify(sp.used));
  const subSteps = await win.evaluate(() => S.conv.messages.at(-1).steps.filter((s) => s.parent).length);
  assert.strictEqual(subSteps, 2, 'each sub-agent searched once');
  step('subagents done'); await win.screenshot({ path: `${shots}/31c-subagents-done.png` });
  // ── Projects: create, instructions, files, chat with project context ──
  await win.click('[data-action=mode][data-mode=projects]');
  await win.waitForSelector('.prj-empty', { timeout: 8000 });
  await win.click('.prj-empty [data-action=prj-new]');
  await win.fill('.prj-form [name=name]', 'Potager');
  await win.fill('.prj-form [name=description]', 'Mon jardin de légumes');
  await win.click('.prj-form [type=submit]');
  await win.waitForSelector('.prj-view', { timeout: 8000 });
  await win.click('[data-action=prj-edit-instr]');
  await win.fill('[name=instr]', 'Réponds comme un jardinier.');
  await win.click('[data-form=prj-instr] [type=submit]');
  await win.evaluate(async () => { S.prj.current = await api.projects.addText(S.prj.current.id, 'notes.md', '# Tomates\nArroser les tomates le soir, jamais en plein soleil.'); renderView(); });
  await win.waitForFunction(() => document.querySelector('.prj-file.indexed'), null, { timeout: 10000 });
  await win.waitForTimeout(400);
  step('project'); await win.screenshot({ path: `${shots}/33a-project.png` });
  await win.fill('#prompt', 'Quand arroser ?');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /arrosez les tomates le soir/.test(S.conv && S.conv.messages.at(-1).content || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 15000 });
  assert.ok(await win.$('.prj-chip'), 'project chip in the top bar');
  step('project chat'); await win.screenshot({ path: `${shots}/33b-project-chat.png` });
  await win.waitForTimeout(700); // conversation saved
  await win.click('.prj-chip');
  await win.waitForSelector('.prj-chat', { timeout: 8000 });
  assert.strictEqual(await win.$$eval('.prj-chat', (x) => x.length), 1, 'conversation listed in the project');

  // ── Code mode: project, session, edit card, tests, diff, editor, git, undo ──
  win.on('dialog', (d) => d.accept());
  await win.click('[data-action=mode][data-mode=code]');
  await win.waitForSelector('.cx-welcome', { timeout: 8000 });
  await win.waitForTimeout(500); step('code welcome'); await win.screenshot({ path: `${shots}/33-code-welcome.png` });
  await win.evaluate(async (p) => { await cxOpen(p); renderSidebar(); renderView(); }, proj);
  await win.waitForSelector('.cx-node', { timeout: 8000 });
  assert.ok(await win.$('.cx-start'), 'project start screen');
  await win.fill('#prompt', 'Corrige le bug dans add');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.perm-card [data-v=once]', { timeout: 15000 }); // run_tests asks (accept-edits mode)
  assert.ok(await win.$('.cx-fcard'), 'modified-file card');
  assert.match(fs.readFileSync(path.join(proj, 'src', 'math.js'), 'utf8'), /a \+ b/, 'edit applied without asking (accept edits)');
  assert.match(await win.textContent('.perm-card'), /Toujours pour ce projet/);
  await win.click('.perm-card [data-v=once]');
  await win.waitForFunction(() => /Les tests passent/.test(S.conv.messages.at(-1).content || '') && !document.querySelector('.msg.assistant.pending'), null, { timeout: 25000 });
  await win.waitForSelector('.cx-turn', { timeout: 5000 });
  await win.waitForFunction(() => S.cx.tests && S.cx.tests.summary && S.cx.tests.summary.ok, null, { timeout: 8000 });
  const sum = await win.evaluate(() => S.cx.tests.summary);
  assert.strictEqual(sum.passed, 2, 'tests summary: ' + JSON.stringify(sum));
  if (gitOk) await win.waitForFunction(() => S.cx.git && S.cx.git.files && Object.keys(S.cx.git.files).some((f) => /math\.js$/.test(f)), null, { timeout: 8000 });
  await win.waitForTimeout(300);
  step('code session'); await win.screenshot({ path: `${shots}/34-code-session.png` });
  await win.click('.cx-fcard');
  await win.waitForSelector('.cx-diff .dl.ins', { timeout: 8000 });
  assert.match(await win.textContent('.cx-diff .dl.ins'), /a \+ b/);
  await win.waitForTimeout(500); step('code diff'); await win.screenshot({ path: `${shots}/35-code-diff.png` });
  await win.click('[data-action=cx-vtab][data-tab=file]');
  await win.waitForSelector('#cx-ta');
  await win.focus('#cx-ta'); await win.keyboard.press('Control+End'); await win.keyboard.type('\n// édité à la main\n');
  await win.keyboard.press('Control+s');
  await win.waitForFunction(() => S.viewer && !S.viewer.dirty, null, { timeout: 5000 });
  assert.match(fs.readFileSync(path.join(proj, 'src', 'math.js'), 'utf8'), /édité à la main/, 'editor saved');
  await win.waitForTimeout(500); step('code editor'); await win.screenshot({ path: `${shots}/36-code-editor.png` });
  // terminal
  await win.click('[data-action=viewer-close]');
  await win.click('[data-action=cx-term-tab][data-tab=terminal]');
  await win.fill('#cx-cmd', 'node -e "console.log(40+2)"');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /\b42\b/.test(document.querySelector('#cx-out')?.textContent || ''), null, { timeout: 10000 });
  step('code terminal'); await win.screenshot({ path: `${shots}/37-code-terminal.png` });
  // undo the agent turn → file back to its original content
  await win.click('[data-action=cx-revert]');
  await win.waitForFunction(() => document.querySelector('.cx-turn.reverted'), null, { timeout: 8000 });
  assert.match(fs.readFileSync(path.join(proj, 'src', 'math.js'), 'utf8'), /a - b/, 'turn undone');
  if (gitOk) {
    await win.waitForFunction(() => !Object.keys((S.cx.git || {}).files || {}).length, null, { timeout: 8000 });
    // commit flow: change a file, commit from the panel
    fs.writeFileSync(path.join(proj, 'NOTES.md'), '# Notes\n');
    await win.waitForSelector('.cx-commit', { timeout: 8000 });
    await win.fill('.cx-commit input', 'Ajoute des notes');
    await win.click('.cx-commit [type=submit]');
    await win.waitForSelector('.cx-clean', { timeout: 8000 });
    const log = require('child_process').execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: proj }).toString().trim();
    assert.strictEqual(log, 'Ajoute des notes');
  }
  const codeRecents = await win.evaluate(() => S.convs.filter((c) => c.codeRoot).length);
  assert.strictEqual(codeRecents, 1, 'code session saved with its project');
  await win.click('[data-action=home]');
  await win.waitForTimeout(300);

  // MCP: a local stdio server, its tools become agent tools
  await win.evaluate((p) => api.mcp.add({ name: 'echo', command: 'node', args: [p] }), path.join(__dirname, 'fixtures', 'mcp-echo.js'));
  await win.keyboard.press('Control+,');
  await win.click('.st-tab[data-tab=agent]');
  await win.waitForSelector('.mcp-st.st-ready', { timeout: 10000 });
  step('agent settings'); await win.screenshot({ path: `${shots}/32-agent-settings.png` });
  await win.evaluate(() => document.querySelector('[data-input="search.engine"]').scrollIntoView({ block: 'start' }));
  await win.waitForTimeout(200);
  await win.screenshot({ path: `${shots}/32b-search-settings.png` });
  await win.click('[data-action=close-settings]');
  await win.fill('#prompt', 'Additionne 2 et 40 avec l’outil echo');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /Résultat :[\s\S]*42/.test(document.querySelector('.msg.assistant:last-child .md')?.textContent || ''), null, { timeout: 15000 });
  step('mcp call');

  // ── Accessibility: keyboard, names, menus, reduced motion, automated audit (axe) ──
  await win.click('[data-action=new-chat]');
  await win.waitForTimeout(300);
  const a11y = await win.evaluate(() => ({
    recents: [...document.querySelectorAll('.recent')].every((r) => r.tabIndex === 0 && r.getAttribute('role') === 'button'),
    unnamed: [...document.querySelectorAll('button')].filter((b) => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).map((b) => b.outerHTML.slice(0, 80)),
    live: !!document.querySelector('#sr-live[aria-live=polite]'),
  }));
  assert.ok(a11y.recents, 'recents reachable with the keyboard');
  assert.deepStrictEqual(a11y.unnamed, [], 'every icon button has a name');
  assert.ok(a11y.live);
  await win.focus('.model-pill'); await win.keyboard.press('Enter');
  await win.waitForSelector('#popover-root .popover');
  await win.waitForFunction(() => document.querySelector('#popover-root').contains(document.activeElement), null, { timeout: 3000 });
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('#popover-root .popover') && document.activeElement && document.activeElement.classList.contains('model-pill'), null, { timeout: 3000 });
  await win.evaluate(() => applySetting('reduceMotion', true));
  assert.ok(await win.evaluate(() => document.documentElement.classList.contains('reduce-motion') && matchMedia('(prefers-reduced-motion: reduce)').matches));
  await win.evaluate(() => applySetting('reduceMotion', false));
  await win.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
  const axe = await win.evaluate(async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, rules: { 'color-contrast': { enabled: false } } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes[0] && v.nodes[0].html.slice(0, 120) })); });
  console.log('  axe:', JSON.stringify(axe));
  assert.deepStrictEqual(axe.filter((v) => v.impact === 'critical' || v.impact === 'serious'), [], 'no serious accessibility violations');
  step('accessibility');
  const rt = await win.evaluate(() => api.runtime.status());
  assert.ok(rt.isolated && rt.pid && rt.restarts === 0, 'tool commands ran in the separate runtime process: ' + JSON.stringify(rt));
  await win.evaluate(() => openSettings('system'));
  await win.waitForFunction(() => S.rt && document.querySelector('[data-key="telemetry.crashReports"]'), null, { timeout: 5000 });
  assert.strictEqual(await win.evaluate(() => !!(S.settings.telemetry || {}).crashReports), false, 'no crash reports by default');
  await win.screenshot({ path: `${shots}/38-system.png` });
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
