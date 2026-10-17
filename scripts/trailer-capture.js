// Captures clean English, dark-theme screens of the real app for the trailer.
// Usage: xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/trailer-capture.js <outDir>
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');

const out = process.argv[2] || 'trailer-shots'; fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-trailer-'));
const work = path.join(userData, 'Notes'); fs.mkdirSync(work);
fs.writeFileSync(path.join(work, 'meeting-notes.md'), '# Q3 notes\n- Ship voice mode\n- Beta on Windows\n');
const proj = path.join(userData, 'weather-app'); fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'weather-app', version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2));
fs.writeFileSync(path.join(proj, 'src', 'units.js'), 'function toFahrenheit(c) {\n  return c * 9 / 5;\n}\n\nmodule.exports = { toFahrenheit };\n');
fs.writeFileSync(path.join(proj, 'test.js'), "const assert = require('assert');\nconst { toFahrenheit } = require('./src/units');\nlet ok = 0, ko = 0;\nfor (const [n, f] of [['freezing', () => assert.strictEqual(toFahrenheit(0), 32)], ['boiling', () => assert.strictEqual(toFahrenheit(100), 212)]]) { try { f(); ok++; console.log('✓ ' + n); } catch (e) { ko++; console.log('✕ ' + n); } }\nconsole.log(ok + ' passed, ' + ko + ' failed');\nprocess.exit(ko ? 1 : 0);\n");
try { const cp = require('child_process'); const g = (a) => cp.execFileSync('git', a, { cwd: proj, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@a' } }); g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-q', '-m', 'init']); } catch {}
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'en', userName: 'Alex', theme: 'dark' }));

const MODEL = 'Gemma 4 E4B';
const sse = (res, chunks, gap = 30, done) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' }); let i = 0;
  const tick = setInterval(() => {
    if (i < chunks.length) return res.write(`data: ${JSON.stringify({ choices: [{ delta: chunks[i++] }] })}\n\n`);
    clearInterval(tick); res.write('data: {"choices":[],"usage":{"prompt_tokens":812,"completion_tokens":164}}\n\n'); res.end('data: [DONE]\n\n'); done && done();
  }, gap);
};
const words = (s, key = 'content') => s.match(/\S+\s*/g).map((w) => ({ [key]: w }));
const call = (res, calls, id) => sse(res, [{ tool_calls: calls.map(([name, args], i) => ({ index: i, id: `${id}-${i}`, function: { name, arguments: JSON.stringify(args) } })) }]);

const LISBON = `Here's a relaxed **3-day plan** for Lisbon:

### Day 1 — Old town
- Morning in **Alfama**, up to the Miradouro de Santa Luzia
- Lunch: grilled sardines near the river
- Sunset at **São Jorge Castle**

### Day 2 — Belém
- Jerónimos Monastery, then *pastéis de nata* at the original bakery
- Walk the waterfront to the MAAT

### Day 3 — Sintra
- Early train from Rossio (40 min)
- Pena Palace, then the Moorish Castle walls

| Day | Area | Pace |
|---|---|---|
| 1 | Alfama | Easy |
| 2 | Belém | Easy |
| 3 | Sintra | Full day |`;
const THINK = 'The user wants three days in Lisbon. Day one should stay central so they can adjust to the hills. Belém fits day two because it is flat and close by tram. Sintra needs a full day and an early train, so it goes last. I should keep each day to three stops and add a quick table.';

const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: MODEL }] }));
    if (req.url.startsWith('/search')) {
      const q = decodeURIComponent((req.url.split('q=')[1] || '').replace(/\+/g, ' '));
      const r = /vulkan|gpu/i.test(q)
        ? [{ title: 'Vulkan backend: faster prompt processing on AMD and Intel GPUs', url: 'https://github.com/ggml-org/llama.cpp/discussions/vulkan', snippet: 'Benchmarks across consumer GPUs.' }, { title: 'Running local models on a laptop GPU', url: 'https://huggingface.co/blog/local-gpu', snippet: 'What fits in 8 GB of VRAM.' }]
        : [{ title: 'llama.cpp releases', url: 'https://github.com/ggml-org/llama.cpp/releases', snippet: 'Changelog and binaries.' }, { title: 'Gemma 4 model card', url: 'https://ai.google.dev/gemma/docs', snippet: 'Sizes, context length, licence.' }, { title: 'Quantization explained', url: 'https://huggingface.co/docs/quantization', snippet: 'Q4, Q5, Q8: what you trade.' }];
      return res.end(JSON.stringify({ results: r }));
    }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
    const body = JSON.parse(b); const sys = String((body.messages[0] || {}).content || '');
    const users = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || '').join(' ')));
    const ut = users[users.length - 1] || ''; const all = users.join(' ');
    const tools = body.messages.filter((m) => m.role === 'tool');
    if (/You name conversations/.test(sys)) return sse(res, [{ content: /Lisbon/.test(all) ? 'Lisbon in 3 days' : /llama/.test(all) ? 'Local AI news' : /notes/.test(all) ? 'Q3 report' : /slides/.test(all) ? 'Launch deck' : 'Fix units bug' }]);
    if (/maintain a short memory/.test(sys)) return sse(res, [{ content: '[]' }]);
    if (/# Code session/.test(sys)) {
      if (tools.length === 0) return call(res, [['read_file', { path: 'src/units.js' }]], 'c0');
      if (tools.length === 1) return call(res, [['edit_file', { path: 'src/units.js', old_text: 'return c * 9 / 5;', new_text: 'return c * 9 / 5 + 32;' }]], 'c1');
      if (tools.length === 2) return call(res, [['run_tests', {}]], 'c2');
      return sse(res, words('Fixed: `toFahrenheit` forgot to add **32**. Both tests pass now.'));
    }
    if (/Lisbon/.test(ut)) return sse(res, [...words(THINK, 'reasoning_content'), ...words(LISBON)], 70);
    if (/llama/.test(all)) {
      if (tools.length === 0) return call(res, [['web_search', { query: 'llama.cpp latest release' }]], 's0');
      if (tools.length === 1) return call(res, [['web_search', { query: 'llama.cpp vulkan gpu speed' }]], 's1');
      if (tools.length === 2) return call(res, [['fetch_url', { url: 'https://github.com/ggml-org/llama.cpp/releases' }]], 's2');
      return sse(res, words('The latest release speeds up prompt processing on **Vulkan**, so AMD and Intel GPUs get much closer to CUDA [4]. It also adds support for **Gemma 4** [2], and the Q4 quantizations stay the best trade-off for 8 GB cards [3, 5].'));
    }
    if (/notes/.test(all)) {
      if (tools.length === 0) return call(res, [['update_plan', { steps: [{ title: 'Read the notes', status: 'in_progress' }, { title: 'Write the report', status: 'pending' }] }]], 'a0');
      if (tools.length === 1) return call(res, [['read_file', { path: path.join(work, 'meeting-notes.md') }]], 'a1');
      if (tools.length === 2) return call(res, [['create_document', { format: 'docx', title: 'Q3 Report', content: '# Q3 Report\n\nWe ship **voice mode** and open the **Windows beta**.\n\n- Voice mode\n- Windows beta', folder: work }]], 'a2');
      if (tools.length === 3) return call(res, [['update_plan', { steps: [{ title: 'Read the notes', status: 'done' }, { title: 'Write the report', status: 'done' }] }]], 'a3');
      return sse(res, words('Done. **Q3 Report.docx** is in your Notes folder, with the two priorities from the meeting.'));
    }
    if (/slides/.test(ut)) return sse(res, words('Here is the deck.\n<artifact type="slides" title="Fabro launch">\n# Fabro\nLift off, locally.\n\n---\n\n## Why local\n- Private by default\n- Works offline\n- **No servers to cool**\n\n---\n\n## Join the beta\nfabro.ufstudios.eu\n</artifact>'));
    return sse(res, words('Hello!'));
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  const W = +(process.env.TW || 1600), H = +(process.env.TH || 1000);
  await win.setViewportSize({ width: W, height: H }).catch(() => {});
  await win.waitForSelector('.greet', { timeout: 20000 });
  await win.evaluate(async (u) => { await applySetting('devMode', false); await applySetting('theme', 'dark'); await saveSettings({ search: { engine: 'ducky', duckyUrl: u } }); }, base.replace('/v1', '/search?q={q}'));
  await api(win, base);
  const shot = async (n, wait = 350) => { await win.waitForTimeout(wait); await win.screenshot({ path: path.join(out, n + '.png') }); console.log('•', n); };
  const ask = async (text) => { await win.fill('#prompt', text); await win.keyboard.press('Enter'); };
  const idle = () => win.waitForFunction(() => !S.streaming, null, { timeout: 30000 });

  await win.click('[data-action=new-chat]'); await shot('01-home', 800);
  await win.fill('#prompt', 'Plan a 3-day trip to Lisbon'); await shot('02-typing');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => S.streaming && S.streaming.msg.reasoning.length > 120, null, { timeout: 15000 }); await shot('03-thinking', 0);
  await win.waitForFunction(() => S.streaming && S.streaming.msg.content.length > 150, null, { timeout: 20000 }); await shot('04-streaming', 0);
  await idle(); await shot('05-answer', 600);

  await win.click('[data-action=new-chat]');
  await ask('What changed in llama.cpp this month?');
  await win.waitForFunction(() => S.streaming && (S.streaming.msg.steps || []).length >= 2, null, { timeout: 15000 }); await shot('06-searching', 150);
  await idle(); await shot('07-cited', 600);
  await win.click('.steps-sum summary').catch(() => {}); await shot('08-steps-open');

  await win.click('[data-action=new-chat]');
  await ask('Turn my meeting notes into a report');
  for (let i = 0; i < 4; i++) {
    const r = await Promise.race([win.waitForSelector('.perm-card [data-v=always], .perm-card [data-v=once]', { timeout: 12000 }).then(() => 'perm'), idle().then(() => 'done')]).catch(() => 'done');
    if (r !== 'perm') break;
    if (i === 0) await shot('09-agent-permission', 200);
    await win.click('.perm-card [data-v=always]').catch(() => win.click('.perm-card [data-v=once]'));
  }
  await idle(); await shot('10-agent-done', 700);

  await win.click('[data-action=new-chat]');
  await ask('Make launch slides for Fabro');
  await win.waitForSelector('.viewer .deck .slide', { timeout: 15000 }); await idle(); await shot('11-slides', 900);
  await win.click('[data-action=viewer-close]').catch(() => {});

  await win.click('[data-action=mode][data-mode=code]'); await win.waitForSelector('.cx-welcome', { timeout: 8000 });
  await win.evaluate(async (p) => { await cxOpen(p); renderSidebar(); renderView(); }, proj);
  await win.waitForSelector('.cx-node', { timeout: 8000 });
  await ask('The Fahrenheit test fails, fix it');
  for (let i = 0; i < 3; i++) {
    const r = await Promise.race([win.waitForSelector('.perm-card [data-v=once]', { timeout: 12000 }).then(() => 'perm'), idle().then(() => 'done')]).catch(() => 'done');
    if (r !== 'perm') break; await win.click('.perm-card [data-v=once]');
  }
  await idle(); await shot('12-code', 800);
  await win.click('.cx-fcard').catch(() => {}); await win.waitForSelector('.cx-diff', { timeout: 8000 }).catch(() => {}); await shot('13-diff', 600);

  await app.close(); srv.close(); console.log('done →', out);
})().catch((e) => { console.error(e); process.exit(1); });

async function api(win, base) {
  await win.evaluate(async (u) => {
    await api.providers.enable(true);
    await api.providers.add({ kind: 'custom', name: 'Local', baseUrl: u });
    await refreshModels();
    const m = allModels().find((x) => /Gemma/.test(x.label)); if (m) await saveSettings({ selectedModel: m.ref });
    renderView();
  }, base);
}
