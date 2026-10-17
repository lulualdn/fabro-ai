// Real-world smoke test (CI, needs internet): installs the private SearXNG through Fabro's own
// dependency installer, searches, then drives the agent browser (search → open → extract → find → tabs)
// with a scripted fake model. Run: xvfb-run -a node scripts/search-smoke.js
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http'); const assert = require('assert');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-search-'));
const deps = process.env.FABRO_DEPS || path.join(userData, 'deps');

const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
    const body = JSON.parse(b);
    const done = body.messages.filter((m) => m.role === 'tool');
    const sse = (delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`); res.end('data: [DONE]\n\n'); };
    const call = (name, args) => sse({ tool_calls: [{ index: 0, id: 'k' + done.length, function: { name, arguments: JSON.stringify(args) } }] });
    if (!body.tools) return sse({ content: 'Titre' });
    const last = done.length ? done[done.length - 1].content : '';
    if (done.length === 0) return call('browser_search', { query: 'llama.cpp github ggml-org' });
    if (done.length === 1) { const url = (last.match(/https:\/\/github\.com\/ggml-org\/llama\.cpp\S*/) || last.match(/https?:\/\/\S+/))[0]; return call('browser_open', { url }); }
    if (done.length === 2) return call('browser_extract', {});
    if (done.length === 3) return call('browser_find', { text: 'llama' });
    if (done.length === 4) return call('browser_tabs', { action: 'new', url: 'https://example.com' });
    if (done.length === 5) return call('browser_tabs', { action: 'list' });
    return sse({ content: 'OK fini' });
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1', FABRO_DEPS: deps } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => typeof S !== 'undefined' && S.settings, null, { timeout: 30000 });
  const t0 = Date.now();
  const st0 = await win.evaluate(() => api.deps.status());
  if (!st0.searxng.installed) {
    console.log('• installing SearXNG…');
    await win.evaluate(() => api.deps.install('searxng'));
    console.log(`  installed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const r = await win.evaluate(() => api.search.test('llama.cpp'));
  console.log('• search:', r.engine, r.results.length, 'results —', r.results.slice(0, 3).map((x) => x.title).join(' | '));
  assert.strictEqual(r.engine, 'searxng'); assert.ok(r.results.length >= 3, 'SearXNG returns results');

  // Agent browser driven by a scripted model
  await win.evaluate(async (b) => { await api.providers.enable(true); await api.providers.add({ kind: 'custom', baseUrl: b, name: 'Fake' }); }, base);
  const ref = await win.evaluate(async () => { const v = await api.providers.view(); return { backend: 'provider', provider: v.list[0].id, model: 'fake' }; });
  const ev = await win.evaluate((ref) => new Promise((resolve) => {
    const out = [];
    const off = api.on('chat:event', (e) => { if (e.reqId !== 'smoke') return; out.push(e); if (e.type === 'done' || e.type === 'error') resolve(out); });
    api.chat.send({ reqId: 'smoke', model: ref, messages: [{ role: 'user', content: 'go' }], params: { agentMode: true, agentPrompt: 'AGENT', tools: ['web_search'] }, meta: {} });
  }), ref);
  const ends = ev.filter((e) => e.type === 'tool_end');
  for (const e of ends) console.log(`  ${e.name}: ${e.error || JSON.stringify(e.view).slice(0, 160)}`);
  assert.ok(!ev.some((e) => e.type === 'error'), 'no error: ' + JSON.stringify(ev.find((e) => e.type === 'error')));
  assert.strictEqual(ends.length, 6); assert.ok(ends.every((e) => !e.error), 'all browser tools succeeded');
  assert.ok(ends[2].view.title, 'extracted a title');
  const bs = await win.evaluate(() => api.browser.state());
  assert.strictEqual(bs.tabs.length, 2, 'two tabs'); assert.match(bs.url, /example\.com/);
  console.log('search-smoke: all passed');
  await app.evaluate(({ app }) => app.quit()); srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
