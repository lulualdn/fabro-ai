// Engines arena (first round): for one local model, try llama.cpp alone, + n-gram speculative decoding, + MTP
// (when the GGUF has MTP heads), measure each on this machine and keep the fastest that answers the same.
// - Flag names moved several times in llama.cpp (--spec-type mtp → draft-mtp, --draft-max → --spec-draft-n-max):
//   they are read from this build's `llama-server --help`, never assumed.
// - Measures: time to first token (prompt), tokens/s, on 3 short prompts (prose, code edit, JSON), temperature 0.
// - Quality: at temperature 0 speculative decoding must give the same text as llama.cpp alone; a variant that
//   answers differently, or breaks a tool call that worked without it, is eliminated.
// - A winner is kept per model + engine build: after an engine update the arena runs again.
// - DFlash 2, Strata, ik_llama.cpp, MLX, LiteRT-LM: not here yet (notes in docs/v1/ENGINES.md).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let mem = null;
const file = () => { try { return require('./paths').inShared('arena.json'); } catch { return path.join(require('os').tmpdir(), 'fabro-arena.json'); } };
function cache() { if (!mem) { try { mem = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { mem = {}; } } return mem; }
function save() { try { fs.writeFileSync(file(), JSON.stringify(mem || {}, null, 1)); } catch {} }
const keyOf = (model, tag) => `${model.path}|${tag || ''}`;

// ── what this llama.cpp build supports ──
const helpCache = new Map();
function helpText(bin) {
  if (helpCache.has(bin)) return helpCache.get(bin);
  const p = new Promise((resolve) => execFile(bin, ['--help'], { timeout: 20000, windowsHide: true, cwd: path.dirname(bin), maxBuffer: 4 << 20 }, (e, so, se) => resolve(String(so || '') + String(se || ''))));
  helpCache.set(bin, p); return p;
}
function specOptions(text) {
  const t = String(text || '');
  const line = t.split(/\r?\n/).filter((l) => /--spec-type/.test(l)).join(' ') + ' ' + (t.match(/--spec-type[\s\S]{0,600}/) || [''])[0];
  const types = new Set((line.match(/\b(draft-mtp|mtp|ngram-mod|ngram-simple|ngram-map-k4v|ngram-map-k|ngram-cache)\b/g) || []));
  const draftFlag = /--spec-draft-n-max\b/.test(t) ? '--spec-draft-n-max' : /--draft-max\b/.test(t) ? '--draft-max' : /--draft\b/.test(t) ? '--draft' : null;
  return { types, draftFlag, specType: /--spec-type\b/.test(t) };
}
// MTP needs extra heads in the GGUF (e.g. "<arch>.nextn_predict_layers" > 0)
function hasMtp(modelPath) {
  try {
    const { kv } = require('./gguf').readMeta(modelPath);
    return Object.keys(kv).some((k) => (/nextn_predict_layers|mtp/.test(k)) && Number(kv[k]) > 0);
  } catch { return false; }
}
function variants(model, opt) {
  const out = [{ id: 'base', label: 'llama.cpp', pairs: [] }];
  if (!opt.specType || !opt.draftFlag) return out;
  const ng = ['ngram-mod', 'ngram-simple', 'ngram-map-k'].find((x) => opt.types.has(x));
  if (ng) out.push({ id: 'ngram', label: `n-gram (${ng})`, pairs: [['--spec-type', ng], [opt.draftFlag, 16]] });
  const mtp = opt.types.has('draft-mtp') ? 'draft-mtp' : opt.types.has('mtp') ? 'mtp' : null;
  if (mtp && hasMtp(model.path)) out.push({ id: 'mtp', label: 'MTP', pairs: [['--spec-type', mtp], [opt.draftFlag, 3]] });
  return out;
}

// ── used by engine.argsFor: extra argv for a launch ──
// o.spec = 'none' | variant id (arena runs); otherwise the stored winner, unless turned off in settings
function pairsFor(model, o, tag) {
  if (o && o.spec === 'none') return [];
  if (o && o.spec && o._specPairs) return o._specPairs;
  if (o && (o._bench || o.role)) return [];
  try { if ((require('./store').getSettings().engine || {}).speculative === false) return []; } catch {}
  const w = cache()[keyOf(model, tag)];
  return w && w.winner && w.winner !== 'base' && Array.isArray(w.pairs) ? w.pairs : [];
}

// ── measuring ──
const PROMPTS = [
  { id: 'prose', prompt: 'Explique en un paragraphe pourquoi le ciel est bleu le jour et rouge au coucher du soleil.' },
  { id: 'code', prompt: 'Rename the variable `total` to `sum` everywhere in this code and return the whole code:\n```js\nfunction add(list) {\n  let total = 0;\n  for (const x of list) {\n    total = total + x;\n  }\n  console.log("total", total);\n  return total;\n}\nfunction avg(list) {\n  let total = 0;\n  for (const x of list) total += x;\n  return total / list.length;\n}\n```' },
  { id: 'json', prompt: 'Return a JSON array of 6 objects {"city","country","population"} for the largest cities of Europe. JSON only.' },
];
async function post(port, p, body, signal) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function measure(port, signal) {
  const runs = [];
  await post(port, '/v1/chat/completions', { messages: [{ role: 'user', content: 'Hi' }], max_tokens: 4, temperature: 0 }, signal); // warm-up
  for (const t of PROMPTS) {
    const t0 = Date.now();
    const j = await post(port, '/v1/chat/completions', { messages: [{ role: 'user', content: t.prompt }], max_tokens: 160, temperature: 0, seed: 1, cache_prompt: false }, signal);
    const tm = j.timings || {};
    const text = ((j.choices || [])[0] || {}).message ? j.choices[0].message.content || '' : '';
    const n = tm.predicted_n || (j.usage && j.usage.completion_tokens) || 0;
    runs.push({ id: t.id, text, tokPerSec: +(tm.predicted_per_second || (n / Math.max(0.001, (Date.now() - t0) / 1000))).toFixed(1),
      ttftMs: Math.round((tm.prompt_ms || 0) + (tm.predicted_ms && n ? tm.predicted_ms / n : 0)), draftAccepted: tm.draft_n_accepted, drafted: tm.draft_n });
  }
  // one tool call: does the reply still parse?
  let toolOk = false;
  try {
    const j = await post(port, '/v1/chat/completions', { messages: [{ role: 'user', content: 'Quel temps fait-il à Lyon ? Utilise l’outil.' }], max_tokens: 120, temperature: 0,
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'Weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }] }, signal);
    const c = (((j.choices || [])[0] || {}).message || {}).tool_calls || [];
    toolOk = c.length > 0 && /lyon/i.test(JSON.parse(c[0].function.arguments || '{}').city || '');
  } catch {}
  const avg = (k) => +(runs.reduce((a, r) => a + (r[k] || 0), 0) / runs.length).toFixed(1);
  return { runs, tokPerSec: avg('tokPerSec'), ttftMs: Math.round(avg('ttftMs')), toolOk };
}
const same = (a, b) => { const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300); return n(a) === n(b); };

let running = null;
// engine: { benchLaunch(model, cand, signal) → { port, stop }, meta() → { bin, tag } }
async function run(model, engine, { onStep } = {}) {
  if (running) return { busy: true };
  const ctrl = new AbortController(); running = { model: model.id, abort: () => ctrl.abort() };
  const step = (s) => { if (onStep) try { onStep(s); } catch {} };
  try {
    const meta = await engine.meta();
    const opt = specOptions(await helpText(meta.bin));
    const vs = variants(model, opt);
    const results = [];
    for (const v of vs) {
      if (ctrl.signal.aborted) break;
      step({ variant: v.id, label: v.label, phase: 'start' });
      let srv = null;
      try {
        srv = await engine.benchLaunch(model, { ctx: 4096, spec: v.id === 'base' ? 'none' : v.id, _specPairs: v.pairs }, ctrl.signal);
        const m = await measure(srv.port, ctrl.signal);
        results.push({ id: v.id, label: v.label, pairs: v.pairs, ...m });
        step({ variant: v.id, label: v.label, phase: 'done', tokPerSec: m.tokPerSec, ttftMs: m.ttftMs, toolOk: m.toolOk });
      } catch (e) { results.push({ id: v.id, label: v.label, error: String(e.message || e).slice(0, 300) }); step({ variant: v.id, phase: 'error', error: String(e.message || e) }); }
      finally { if (srv) await srv.stop().catch(() => {}); }
    }
    const base = results.find((r) => r.id === 'base' && !r.error);
    for (const r of results) {
      if (r.error || r.id === 'base' || !base) continue;
      const diff = r.runs.filter((x, i) => !same(x.text, base.runs[i].text)).map((x) => x.id);
      if (diff.length) r.out = `answers differ (${diff.join(', ')})`;
      else if (base.toolOk && !r.toolOk) r.out = 'tool call broken';
    }
    const ok = results.filter((r) => !r.error && !r.out);
    let win = base || ok[0] || null;
    for (const r of ok) if (win && r.tokPerSec > win.tokPerSec * 1.05) win = r; // must be clearly faster
    const entry = { winner: win ? win.id : null, pairs: win ? win.pairs : [], tag: meta.tag, at: Date.now(),
      results: results.map(({ runs, ...r }) => ({ ...r, runs: runs && runs.map(({ text, ...x }) => x) })), helpFound: { types: [...opt.types], draftFlag: opt.draftFlag } };
    cache()[keyOf(model, meta.tag)] = entry; save();
    return entry;
  } finally { running = null; }
}
const status = () => (running ? { running: running.model } : { running: null });
const cancel = () => { if (running) running.abort(); };
const resultFor = (model, tag) => cache()[keyOf(model, tag)] || null;

module.exports = { specOptions, hasMtp, variants, pairsFor, measure, run, status, cancel, resultFor, _same: same };

// IPC: run the arena on the selected local model; steps go to the window as 'arena:step'
function register(h, send) {
  const pick = async () => {
    const sel = require('./store').getSettings().selectedModel;
    if (!sel || sel.backend !== 'local') throw new Error('Choose a local model first.');
    const m = (await require('./models').installed()).local.find((x) => x.id === sel.id);
    if (!m) throw new Error('Model not found.');
    return m;
  };
  h('arena:run', async () => {
    const m = await pick(); const engine = require('./engine');
    return run(m, engine.benchApi, { onStep: (s) => send('arena:step', { model: m.name, ...s }) });
  });
  h('arena:result', async () => { const m = await pick().catch(() => null); if (!m) return null; const meta = await require('./engine').readMeta().catch(() => null); return { model: m.name, ...(resultFor(m, meta && meta.tag) || {}) }; });
  h('arena:cancel', () => cancel());
}
module.exports.register = register;
