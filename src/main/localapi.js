// Local OpenAI-compatible API: lets bots, scripts or game NPCs use Fabro's models.
//   GET  /v1/models
//   POST /v1/chat/completions  (stream or not) → built-in engine or any connected provider
const http = require('http');
const store = require('./store');
const models = require('./models');
const engine = require('./engine');
const providers = require('./providers');
const chat = require('./chat');

let server = null, status = { running: false, port: null, error: null, requests: 0 };
let notify = () => {};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.:_-]+/g, '-').replace(/^-+|-+$/g, '');
async function catalog() {
  const local = (await models.installed()).local.map((m) => ({ id: slug(m.name), object: 'model', owned_by: 'fabro', _ref: { backend: 'local', id: m.id }, _name: m.name }));
  const prov = providers.chatModels().map((m) => ({ id: `${m.provider}/${m.ref.model}`, object: 'model', owned_by: m.providerName, _ref: m.ref, _name: m.label }));
  return [...local, ...prov];
}
async function resolve(id) {
  const list = await catalog();
  if (!id || id === 'default' || id === 'fabro') {
    const sel = store.getSettings().selectedModel;
    return list.find((m) => JSON.stringify(m._ref) === JSON.stringify(sel)) || list[0] || null;
  }
  return list.find((m) => m.id === id) || list.find((m) => m._name === id) || list.find((m) => m.id.endsWith('/' + id)) || null;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const oaiErr = (res, code, message, type = 'invalid_request_error') => json(res, code, { error: { message, type } });

async function handle(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const cfg = store.getSettings().localApi || {};
  if (cfg.key && req.headers.authorization !== `Bearer ${cfg.key}`) return oaiErr(res, 401, 'Invalid API key', 'authentication_error');
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    return json(res, 200, { object: 'list', data: (await catalog()).map(({ _ref, _name, ...m }) => m) });
  }
  if (req.method === 'GET' && url.pathname === '/') return json(res, 200, { name: 'Fabro local API', openai_compatible: true, endpoints: ['/v1/models', '/v1/chat/completions'] });
  if (req.method !== 'POST' || !/^\/(v1\/)?chat\/completions$/.test(url.pathname)) return oaiErr(res, 404, 'Not found');

  let body = '';
  for await (const c of req) { body += c; if (body.length > 64 << 20) return oaiErr(res, 413, 'Request too large'); }
  let j; try { j = JSON.parse(body); } catch { return oaiErr(res, 400, 'Invalid JSON'); }
  const target = await resolve(j.model);
  if (!target) return oaiErr(res, 404, `Model not found: ${j.model}`);
  status.requests++; notify();

  // Built-in engine: proxy the request as-is (keeps tools, grammar, logprobs…).
  if (target._ref.backend === 'local') {
    const m = await models.getLocal(target._ref.id);
    let inst;
    try { inst = await engine.ensure(m); } catch (e) { return oaiErr(res, 503, e.message, 'engine_error'); }
    engine.acquire(inst);
    try {
      const up = await fetch(`http://127.0.0.1:${inst.port}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...j, model: m.name, cache_prompt: true }) });
      res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
      const reader = up.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
      res.end();
    } catch (e) { if (!res.headersSent) oaiErr(res, 502, e.message); else res.end(); }
    finally { engine.release(inst); }
    return;
  }

  // Providers: go through Fabro's adapters and answer in OpenAI format.
  const id = 'chatcmpl-' + Date.now().toString(36);
  const created = Math.floor(Date.now() / 1000);
  const stream = !!j.stream;
  if (stream) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  let text = '', reasoning = '';
  const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: target.id, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  await new Promise((done) => {
    chat.send({ reqId: id, model: target._ref, messages: j.messages || [], params: { temperature: j.temperature, topP: j.top_p, maxTokens: j.max_tokens || j.max_completion_tokens || 0 }, meta: { modelLabel: `API · ${target._name}` } }, (ev) => {
      if (ev.type === 'token') { text += ev.text; if (stream) chunk({ content: ev.text }); }
      if (ev.type === 'reasoning') { reasoning += ev.text; if (stream) chunk({ reasoning_content: ev.text }); }
      if (ev.type === 'done') {
        const usage = { prompt_tokens: ev.stats.promptTokens || 0, completion_tokens: ev.stats.completionTokens || 0, total_tokens: (ev.stats.promptTokens || 0) + (ev.stats.completionTokens || 0) };
        if (stream) { chunk({}, 'stop'); res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: target.id, choices: [], usage })}\n\n`); res.end('data: [DONE]\n\n'); }
        else json(res, 200, { id, object: 'chat.completion', created, model: target.id, choices: [{ index: 0, message: { role: 'assistant', content: text, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: 'stop' }], usage });
        done();
      }
      if (ev.type === 'error') {
        if (stream) { res.write(`data: ${JSON.stringify({ error: { message: ev.message, code: ev.code } })}\n\n`); res.end(); }
        else oaiErr(res, 502, ev.message, ev.code || 'provider_error');
        done();
      }
    });
    req.on('close', () => { if (!res.writableEnded) chat.abort(id); });
  });
}

async function apply() {
  const cfg = store.getSettings().localApi || {};
  if (server) { await new Promise((r) => server.close(() => r())); server = null; }
  status = { running: false, port: cfg.port || 11500, error: null, requests: status.requests };
  if (!cfg.enabled) { notify(); return status; }
  const port = cfg.port || 11500;
  const host = cfg.lan ? '0.0.0.0' : '127.0.0.1';
  await new Promise((resolve) => {
    server = http.createServer((req, res) => handle(req, res).catch((e) => { try { oaiErr(res, 500, e.message, 'server_error'); } catch {} }));
    server.on('error', (e) => { status = { ...status, running: false, error: e.code === 'EADDRINUSE' ? 'PORT_IN_USE' : e.message }; server = null; resolve(); });
    server.listen(port, host, () => { status = { ...status, running: true, port, host, error: null }; resolve(); });
  });
  notify();
  return status;
}

function init(emit) { notify = () => emit({ ...status }); return apply(); }
const getStatus = () => ({ ...status });

module.exports = { init, apply, getStatus, catalog };
