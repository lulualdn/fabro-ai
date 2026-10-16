// Offline test of the providers layer + chat adapters against fake OpenAI / Anthropic / Ollama servers.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const http = require('http'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-prov-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } };
  return orig.call(this, req, ...r);
};
const store = require('../src/main/store'); const providers = require('../src/main/providers'); const chat = require('../src/main/chat');

const sse = (res, events) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const e of events) res.write(e); res.end(); };
const seen = {};
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    seen[req.url] = { headers: req.headers, body: body && JSON.parse(body) };
    if (req.url === '/oai/v1/models') {
      if (req.headers.authorization !== 'Bearer sk-good') { res.writeHead(401); return res.end(JSON.stringify({ error: { message: 'Incorrect API key' } })); }
      return res.end(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }] }));
    }
    if (req.url === '/oai/v1/chat/completions') return sse(res, ['data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n', 'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":2}}\n\n', 'data: [DONE]\n\n']);
    if (req.url === '/ant/v1/models?limit=100') return res.end(JSON.stringify({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }));
    if (req.url === '/ant/v1/messages') return sse(res, ['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"think"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n']);
    if (req.url === '/oll/api/tags') return res.end(JSON.stringify({ models: [{ name: 'gemma4:e4b', size: 5e9, details: { parameter_size: '8B', quantization_level: 'Q4_K_M', families: ['gemma'] } }, { name: 'nomic-embed-text', size: 1 }] }));
    res.writeHead(404); res.end('{}');
  });
});
const run = (payload) => new Promise((resolve) => { const ev = []; chat.send(payload, (e) => { ev.push(e); if (e.type === 'done' || e.type === 'error') resolve(ev); }); });

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const B = `http://127.0.0.1:${srv.address().port}`;
  store.init();
  // legacy migration
  await store.setSettings({ selectedModel: { backend: 'ollama', name: 'llama3' }, ollamaUrl: `${B}/oll` });
  await providers.migrate();
  let s = store.getSettings();
  assert.deepStrictEqual(s.selectedModel, { backend: 'provider', provider: 'ollama', model: 'llama3' });
  assert.ok(s.providers.enabled && s.providers.list[0].baseUrl === `${B}/oll/v1`);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(store.getSettings().providers.list[0].models.map((m) => m.id), ['gemma4:e4b'], 'ollama models listed, embeddings filtered');

  // bad key rejected with PROVIDER_AUTH
  await assert.rejects(providers.add({ kind: 'custom', baseUrl: `${B}/oai/v1`, apiKey: 'sk-bad', name: 'Fake' }), (e) => e.code === 'PROVIDER_AUTH');
  let v = await providers.add({ kind: 'custom', baseUrl: `${B}/oai/v1`, apiKey: 'sk-good', name: 'Fake' });
  const fake = v.list.find((p) => p.name === 'Fake');
  assert.deepStrictEqual(fake.models.map((m) => m.id), ['gpt-x']);
  assert.ok(fake.hasKey && !JSON.stringify(store.getSettings()).includes('sk-good'), 'key not in settings');
  assert.ok(fs.readFileSync(path.join(tmp, 'secrets.json'), 'utf8').includes('plain:'));

  let ev = await run({ reqId: 'a', model: { backend: 'provider', provider: fake.id, model: 'gpt-x' }, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], params: { temperature: 0.5, topP: 0.9, maxTokens: 100 } });
  assert.strictEqual(ev.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Hello');
  assert.strictEqual(ev.find((e) => e.type === 'reasoning').text, 'hmm');
  const done = ev.find((e) => e.type === 'done');
  assert.strictEqual(done.stats.promptTokens, 11); assert.strictEqual(done.stats.completionTokens, 2);
  assert.strictEqual(seen['/oai/v1/chat/completions'].headers.authorization, 'Bearer sk-good');

  // Anthropic adapter (point preset at fake server)
  v = await providers.add({ kind: 'anthropic', apiKey: 'ak', baseUrl: `${B}/ant/v1` });
  const ant = v.list.find((p) => p.kind === 'anthropic');
  assert.deepStrictEqual(ant.models.map((m) => m.name), ['Claude X']);
  ev = await run({ reqId: 'b', model: { backend: 'provider', provider: ant.id, model: 'claude-x' }, messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: [{ type: 'text', text: 'img?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }], params: { temperature: 1.5, maxTokens: 0, reasoning: 'low' } });
  assert.strictEqual(ev.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Bonjour');
  const sent = seen['/ant/v1/messages'];
  assert.strictEqual(sent.headers['x-api-key'], 'ak'); assert.strictEqual(sent.body.system, 'be nice');
  assert.strictEqual(sent.body.messages[0].content[1].source.data, 'AAAA');
  assert.ok(sent.body.thinking && sent.body.thinking.budget_tokens === 2048 && sent.body.temperature === undefined);
  assert.strictEqual(ev.find((e) => e.type === 'done').stats.promptTokens, 20);

  // disabled provider → PROVIDER_OFF ; unreachable → PROVIDER_DOWN
  await providers.update(fake.id, { enabled: false });
  ev = await run({ reqId: 'c', model: { backend: 'provider', provider: fake.id, model: 'gpt-x' }, messages: [{ role: 'user', content: 'x' }] });
  assert.strictEqual(ev.pop().code, 'PROVIDER_OFF');
  assert.strictEqual(providers.chatModels().some((m) => m.provider === fake.id), false);
  const det = await providers.detect();
  assert.ok('ollama' in det && 'lmstudio' in det);
  await providers.remove(ant.id);
  assert.ok(!fs.readFileSync(path.join(tmp, 'secrets.json'), 'utf8').includes(ant.id));
  console.log('providers-test: all passed');
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
