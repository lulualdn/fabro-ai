// Streams a chat completion from the active backend (OpenAI-compatible SSE).
const store = require('./store');
const engine = require('./engine');
const models = require('./models');

const active = new Map();

async function resolveBackend(ref, emit) {
  const s = store.getSettings();
  if (!ref) throw new Error('NO_MODEL');
  if (ref.backend === 'ollama') {
    return { base: s.ollamaUrl.replace(/\/$/, ''), model: ref.name };
  }
  const m = await models.getLocal(ref.id);
  if (!m) throw new Error('NO_MODEL');
  emit({ type: 'status', status: 'loading' });
  const r = await engine.ensure(m, s.engine);
  return { base: `http://127.0.0.1:${r.port}`, model: m.name };
}

async function send({ reqId, model, messages, params = {} }, emit) {
  const ctrl = new AbortController();
  active.set(reqId, ctrl);
  const out = (ev) => emit({ reqId, ...ev });
  const t0 = Date.now();
  let tFirst = null, completionChars = 0, usage = null, timings = null;
  try {
    const be = await resolveBackend(model, out);
    out({ type: 'status', status: 'generating' });
    const body = {
      model: be.model, messages, stream: true,
      stream_options: { include_usage: true },
      temperature: params.temperature, top_p: params.topP,
      max_tokens: params.maxTokens > 0 ? params.maxTokens : undefined,
    };
    const res = await fetch(`${be.base}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.usage) usage = j.usage;
        if (j.timings) timings = j.timings;
        const d = j.choices && j.choices[0] && j.choices[0].delta;
        if (!d) continue;
        const r = d.reasoning_content || d.reasoning;
        if (r) { tFirst = tFirst || Date.now(); out({ type: 'reasoning', text: r }); }
        if (d.content) { tFirst = tFirst || Date.now(); completionChars += d.content.length; out({ type: 'token', text: d.content }); }
      }
    }
    const elapsed = (Date.now() - (tFirst || t0)) / 1000;
    const completion = (usage && usage.completion_tokens) || (timings && timings.predicted_n) || Math.round(completionChars / 4);
    const stats = {
      promptTokens: (usage && usage.prompt_tokens) || (timings && timings.prompt_n) || null,
      completionTokens: completion,
      tokPerSec: +((timings && timings.predicted_per_second) || completion / Math.max(elapsed, 0.01)).toFixed(1),
      firstTokenMs: tFirst ? tFirst - t0 : null,
      totalMs: Date.now() - t0,
    };
    out({ type: 'done', stats });
  } catch (e) {
    if (ctrl.signal.aborted) out({ type: 'done', aborted: true, stats: { totalMs: Date.now() - t0 } });
    else {
      const code = e.code || (e.message === 'NO_MODEL' ? 'NO_MODEL' : /ECONNREFUSED|fetch failed/i.test(e.message) ? 'ENGINE_DOWN' : 'UNKNOWN');
      out({ type: 'error', message: e.message, code, detail: e.detail || '' });
    }
  } finally {
    active.delete(reqId);
  }
}

function abort(reqId) { const c = active.get(reqId); if (c) c.abort(); return true; }

module.exports = { send, abort };
