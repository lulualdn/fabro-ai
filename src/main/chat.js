// Streams a chat completion from the active backend:
//  - 'local'    → Fabro's built-in llama.cpp engine (OpenAI-compatible SSE)
//  - 'provider' → an external provider (OpenAI-compatible or Anthropic Messages API)
const store = require('./store');
const engine = require('./engine');
const models = require('./models');
const providers = require('./providers');
const usage = require('./usage');

const active = new Map();

async function resolveBackend(ref, emit) {
  const s = store.getSettings();
  if (!ref) throw Object.assign(new Error('NO_MODEL'), { code: 'NO_MODEL' });
  if (ref.backend === 'provider') return { ...providers.target(ref), kind: 'provider' };
  if (ref.backend === 'ollama') throw Object.assign(new Error('NO_MODEL'), { code: 'NO_MODEL' }); // pre-0.1.5 ref, migrated at boot
  const m = await models.getLocal(ref.id);
  if (!m) throw Object.assign(new Error('NO_MODEL'), { code: 'NO_MODEL' });
  emit({ type: 'status', status: 'loading' });
  const inst = await engine.ensure(m);
  const prof = (s.modelProfiles || {})[m.id] || {};
  return { kind: 'local', protocol: 'openai', base: `http://127.0.0.1:${inst.port}/v1`, headers: { 'Content-Type': 'application/json' }, model: m.name, inst, gen: prof.gen || null };
}

// SSE line reader shared by both protocols.
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', event = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      onData(j, event);
    }
  }
}

// ───────────────────────────── OpenAI-compatible ─────────────────────────────
async function streamOpenAI(be, messages, params, out, signal, acc) {
  const body = { model: be.model, messages, stream: true, stream_options: { include_usage: true } };
  const cloudOpenAI = be.kind === 'provider' && be.provider.kind === 'openai';
  if (!cloudOpenAI) { body.temperature = params.temperature; body.top_p = params.topP; }
  if (params.maxTokens > 0) body[cloudOpenAI ? 'max_completion_tokens' : 'max_tokens'] = params.maxTokens;
  if (be.kind === 'local') body.cache_prompt = true;
  if (params.reasoning && be.kind === 'provider' && ['openai', 'xai', 'openrouter', 'groq'].includes(be.provider.kind)) body.reasoning_effort = params.reasoning;
  let res;
  try { res = await fetch(`${be.base}/chat/completions`, { method: 'POST', headers: be.headers, body: JSON.stringify(body), signal }); }
  catch (e) { if (signal.aborted) throw e; throw be.netErr ? be.netErr(e) : e; }
  if (!res.ok) {
    // Some servers reject stream_options; retry once without it.
    if (res.status === 400 && body.stream_options) {
      const txt = await res.text();
      if (/stream_options/i.test(txt)) { delete body.stream_options; res = await fetch(`${be.base}/chat/completions`, { method: 'POST', headers: be.headers, body: JSON.stringify(body), signal }); }
      else throw be.httpErr ? await be.httpErr(new Response(txt, { status: 400 })) : new Error(txt.slice(0, 300));
    }
    if (!res.ok) throw be.httpErr ? await be.httpErr(res) : new Error(`HTTP ${res.status}`);
  }
  await readSSE(res, (j) => {
    if (j.usage) acc.usage = { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens };
    if (j.timings) acc.timings = j.timings;
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    const d = j.choices && j.choices[0] && j.choices[0].delta;
    if (!d) return;
    const r = d.reasoning_content || d.reasoning;
    if (r) acc.push('reasoning', r);
    if (d.content) acc.push('token', d.content);
  });
}

// ───────────────────────────── Anthropic Messages API ─────────────────────────────
function toAnthropic(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const conv = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    let content = m.content;
    if (Array.isArray(content)) {
      content = content.map((c) => {
        if (c.type === 'text') return { type: 'text', text: c.text };
        const url = c.image_url && c.image_url.url || '';
        const mm = /^data:([^;]+);base64,(.*)$/.exec(url);
        return mm ? { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } } : { type: 'text', text: url };
      });
    }
    const last = conv[conv.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string' && typeof content === 'string') last.content += '\n\n' + content;
    else conv.push({ role: m.role, content: content || ' ' });
  }
  return { system, messages: conv };
}

async function streamAnthropic(be, messages, params, out, signal, acc) {
  const { system, messages: conv } = toAnthropic(messages);
  const body = { model: be.model, max_tokens: params.maxTokens > 0 ? params.maxTokens : 8192, system: system || undefined, messages: conv, stream: true };
  if (params.reasoning) {
    const budget = { low: 2048, medium: 8192, high: 24576 }[params.reasoning] || 4096;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max(body.max_tokens, budget + 4096);
  } else body.temperature = Math.min(1, params.temperature ?? 0.7);
  let res;
  try { res = await fetch(`${be.base}/messages`, { method: 'POST', headers: be.headers, body: JSON.stringify(body), signal }); }
  catch (e) { if (signal.aborted) throw e; throw be.netErr(e); }
  if (!res.ok) throw await be.httpErr(res);
  await readSSE(res, (j) => {
    if (j.type === 'message_start' && j.message?.usage) acc.usage = { prompt: j.message.usage.input_tokens, completion: 0 };
    if (j.type === 'message_delta' && j.usage) acc.usage = { ...(acc.usage || {}), completion: j.usage.output_tokens };
    if (j.type === 'error') throw new Error(j.error?.message || 'Anthropic error');
    if (j.type !== 'content_block_delta') return;
    if (j.delta.type === 'text_delta') acc.push('token', j.delta.text);
    if (j.delta.type === 'thinking_delta') acc.push('reasoning', j.delta.thinking);
  });
}

// ───────────────────────────── main entry ─────────────────────────────
async function send({ reqId, model, messages, params = {}, meta = {} }, emit) {
  const ctrl = new AbortController();
  active.set(reqId, ctrl);
  const out = (ev) => emit({ reqId, ...ev });
  const t0 = Date.now();
  let tFirst = null, chars = 0;
  const acc = {
    usage: null, timings: null,
    push(type, text) { tFirst = tFirst || Date.now(); if (type === 'token') chars += text.length; out({ type, text }); },
  };
  let be = null;
  try {
    be = await resolveBackend(model, out);
    if (be.gen) params = { ...params, ...Object.fromEntries(Object.entries(be.gen).filter(([, v]) => v !== null && v !== '' && v !== undefined)) };
    if (be.inst) engine.acquire(be.inst);
    out({ type: 'status', status: 'generating', backend: be.kind === 'local' ? 'local' : be.provider.kind });
    if (be.protocol === 'anthropic') await streamAnthropic(be, messages, params, out, ctrl.signal, acc);
    else await streamOpenAI(be, messages, params, out, ctrl.signal, acc);
    const elapsed = (Date.now() - (tFirst || t0)) / 1000;
    const completion = (acc.usage && acc.usage.completion) || (acc.timings && acc.timings.predicted_n) || Math.round(chars / 4);
    const stats = {
      promptTokens: (acc.usage && acc.usage.prompt) || (acc.timings && acc.timings.prompt_n) || null,
      completionTokens: completion,
      tokPerSec: +((acc.timings && acc.timings.predicted_per_second) || completion / Math.max(elapsed, 0.01)).toFixed(1),
      firstTokenMs: tFirst ? tFirst - t0 : null,
      totalMs: Date.now() - t0,
      backend: be.kind === 'local' ? 'local' : be.provider.kind,
    };
    out({ type: 'done', stats });
    usage.record({ model: meta.modelLabel || (be.kind === 'local' ? be.model : `${be.provider.name} · ${be.model}`), backend: stats.backend, convId: meta.convId, prompt: stats.promptTokens || 0, completion: stats.completionTokens || 0 });
  } catch (e) {
    if (ctrl.signal.aborted) out({ type: 'done', aborted: true, stats: { totalMs: Date.now() - t0 } });
    else {
      const code = e.code || (e.message === 'NO_MODEL' ? 'NO_MODEL' : /ECONNREFUSED|fetch failed/i.test(e.message) ? 'ENGINE_DOWN' : 'UNKNOWN');
      out({ type: 'error', message: e.message, code, detail: e.detail || '' });
    }
  } finally {
    active.delete(reqId);
    if (be && be.inst) engine.release(be.inst);
  }
}

function abort(reqId) { const c = active.get(reqId); if (c) c.abort(); return true; }

module.exports = { send, abort, toAnthropic };
