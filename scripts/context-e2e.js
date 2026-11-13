// End-to-end: smart context in the real app, with a tiny window (FABRO_CTX_TEST) and a fake model.
//  - the <digest> line never shows on screen, and is kept on the message
//  - past ~65 % a background summary is made; the next request starts with it and offers context_read
//  - the gauge says the beginning is summarised
// Usage: xvfb-run -a node scripts/context-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-ctx-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-ctx-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'light', onboarded: true, hotkey: { enabled: false } }));
const step = (s) => console.log('✓ ' + s);
const seen = { compressCalls: 0, summarisedRequest: null, toolsWhenSummarised: [] };
const filler = (n) => Array.from({ length: n }, (_, i) => `élément${i}`).join(' ');

const sse = (res, text) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  // stream in small pieces so the tag is split across chunks
  for (let i = 0; i < text.length; i += 7) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 7) } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
};
const srv = http.createServer((req, res) => {
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-ctx' }] }));
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = JSON.parse(b);
    const sys = String((body.messages[0] || {}).content || '');
    if (/You name conversations/.test(sys)) return sse(res, 'Liste longue');
    if (/honest memory|short memory/.test(sys)) return sse(res, '{"entries":[],"profile":[]}');
    if (/You compress the older part/.test(sys)) { seen.compressCalls++; return sse(res, 'DECISION: COMPRESS\nSUMMARY:\nLulu demande des listes numérotées (1 à 3) ; chaque réponse liste des éléments dans le fichier notes/liste.md.'); }
    const users = body.messages.filter((m) => m.role === 'user');
    const firstUser = String(users[0] && (typeof users[0].content === 'string' ? users[0].content : users[0].content[0].text) || '');
    if (/summarised by Fabro/.test(firstUser)) { seen.summarisedRequest = firstUser; seen.toolsWhenSummarised = (body.tools || []).map((t) => t.function.name); return sse(res, 'VU-RESUME. Je continue.<digest>a confirmé avoir le résumé</digest>'); }
    return sse(res, `Voici la liste demandée : ${filler(120)}.\n<digest>liste de 120 éléments, notes/liste.md</digest>`);
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1', FABRO_CTX_TEST: '3000' } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERR', e.message); });
  await win.waitForSelector('#sb-lists', { timeout: 30000 });
  await win.evaluate(async (u) => { await api.providers.enable(true); await api.providers.add({ kind: 'custom', name: 'Fake', baseUrl: u }); await refreshModels(); const m = allModels().find((x) => x.provider === 'Fake'); await saveSettings({ selectedModel: m.ref }); }, base);
  const ask = async (text) => {
    await win.fill('#prompt', text); await win.keyboard.press('Enter');
    await win.waitForFunction(() => !S.streaming, null, { timeout: 30000 });
    await win.waitForTimeout(300);
  };

  await ask('Liste numéro 1 ' + filler(150));
  const last = await win.evaluate(() => { const m = S.conv.messages.at(-1); return { content: m.content, digest: m.digest, shown: document.querySelector('.msg.assistant:last-child').textContent }; });
  assert.ok(!/digest/i.test(last.content) && !/digest/i.test(last.shown), 'tag hidden: ' + last.content.slice(-80));
  assert.ok(/notes\/liste\.md/.test(last.digest || ''), 'digest kept on the message: ' + last.digest);
  step('<digest> hidden from the screen, kept on the message');

  await ask('Liste numéro 2 ' + filler(150));
  await ask('Liste numéro 3 ' + filler(150));
  // background summary after an answer past ~65 %
  await win.waitForFunction(() => { const g = window.CtxGauge && S.conv && CtxGauge.get(S.conv.id); return g && g.covered > 0; }, null, { timeout: 20000 });
  assert.ok(seen.compressCalls >= 1);
  await win.screenshot({ path: `${shots}/1-summarised.png` });
  assert.ok(await win.$('#composer .ctx-ring .ctx-sum'), 'gauge marks the summary');
  step('background summary past ~65 %, gauge updated');

  await ask('Continue');
  assert.ok(seen.summarisedRequest && /notes\/liste\.md/.test(seen.summarisedRequest), 'next request starts with the summary (identifiers kept)');
  assert.ok(seen.toolsWhenSummarised.includes('context_read') && seen.toolsWhenSummarised.includes('context_list'), 'context tools offered: ' + seen.toolsWhenSummarised.join(','));
  const msgs = await win.evaluate(() => S.conv.messages.length);
  assert.ok(msgs >= 8, 'originals kept in the conversation');
  step('next request uses the summary, offers context_list / context_read, originals kept');
  await win.screenshot({ path: `${shots}/2-after.png` });

  assert.deepStrictEqual(errors, []);
  await app.close();
  console.log('context-e2e: all passed → ' + shots);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); console.log(JSON.stringify({ ...seen, summarisedRequest: seen.summarisedRequest && seen.summarisedRequest.slice(0, 200) })); process.exit(1); });
