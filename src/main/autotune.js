// Auto-tuning: when a model's settings are left on default, pick the fastest safe llama-server parameters for
// this model + this hardware + this engine build.
//  1. capabilities: `llama-server --help` is parsed once per engine build (cached next to the build), so only
//     flags that exist are ever passed — an engine update can never break launching
//  2. planning (pure): threads, GPU layers, context, KV cache type, batch sizes, prompt cache size, polling
//  3. measuring: a short, cancellable micro-benchmark (a few dozen tokens) on 2–3 candidate configs, run once
//     per model / hardware / engine version when the machine is idle, never while someone is generating.
//     The winner becomes that model's "auto" profile. Explicit values in modelProfiles always win.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const governor = require('./governor');

// ───────────────────────────── 1. capabilities ─────────────────────────────
// Flags passed by Fabro, each with its aliases (old and new spellings).
const ALIASES = {
  '-m': ['--model'], '-c': ['--ctx-size'], '-ngl': ['--gpu-layers', '--n-gpu-layers'], '-t': ['--threads'], '-tb': ['--threads-batch'],
  '-b': ['--batch-size'], '-ub': ['--ubatch-size'], '-np': ['--parallel'], '-fa': ['--flash-attn'], '-ctk': ['--cache-type-k'], '-ctv': ['--cache-type-v'],
  '-cram': ['--cache-ram'], '-cmoe': ['--cpu-moe'], '--cpu-moe': ['-cmoe'], '-mm': ['--mmproj'], '--mmproj': ['-mm'],
};
// What every build Fabro ever shipped understood (used when --help can't be read): keeps the old behaviour.
const LEGACY = ['-m', '--host', '--port', '-c', '--jinja', '-np', '-ngl', '--cache-reuse', '--cpu-moe', '-fa', '-ctk', '-ctv', '-t', '--poll', '--mmproj', '-b', '-ub', '--embedding', '--reranking'];

function parseHelp(text) {
  const flags = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s{0,8}((?:-{1,2}[A-Za-z][\w-]*(?:,\s*)?)+)/.exec(line);
    if (!m) continue;
    for (const f of m[1].split(/,\s*/)) if (f) flags.add(f.trim());
  }
  const faLine = lines.find((l) => /(^|\s)(-fa|--flash-attn)\b/.test(l)) || '';
  return {
    flags,
    faValue: /\[on\|off\|auto\]|on\|off|'auto'/.test(faLine), // -fa takes a value (on/off/auto) since mid-2025; before it was a switch
    nglWords: /'auto', or 'all'|auto.*all/.test(lines.find((l) => /--gpu-layers/.test(l)) || ''),
    count: flags.size,
  };
}
const has = (caps, flag) => {
  if (!caps) return LEGACY.includes(flag);
  if (caps.flags.has(flag)) return true;
  return (ALIASES[flag] || []).some((a) => caps.flags.has(a));
};
// args: array of [flag, ...values]. Drops what this build doesn't know, adapts -fa to the old switch form.
function filterArgs(pairs, caps) {
  const out = [], dropped = [];
  for (const [flag, ...vals] of pairs) {
    if (!has(caps, flag)) { dropped.push(flag); continue; }
    if (flag === '-fa' && caps && !caps.faValue) { if (vals[0] === 'on') out.push('-fa'); else dropped.push('-fa ' + vals[0]); continue; }
    out.push(flag, ...vals.map(String));
  }
  return { args: out, dropped };
}

const capsMem = new Map();
// meta: the engine's current.json ({ bin, dir, tag }). Async, cached in memory and on disk next to the build.
async function capabilities(meta, env) {
  if (!meta || !meta.bin) return null;
  const key = `${meta.bin}|${meta.tag}`;
  if (capsMem.has(key)) return capsMem.get(key);
  const p = (async () => {
    const file = path.join(meta.dir || path.dirname(meta.bin), 'fabro-caps.json');
    try {
      const st = await fsp.stat(meta.bin);
      const j = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (j.tag === meta.tag && j.mtime === st.mtimeMs && j.flags && j.flags.length > 20) return { flags: new Set(j.flags), faValue: j.faValue, nglWords: j.nglWords, count: j.flags.length };
    } catch {}
    const text = await new Promise((resolve) => execFile(meta.bin, ['--help'], { cwd: path.dirname(meta.bin), env, timeout: 20000, windowsHide: true, maxBuffer: 8 << 20 },
      (err, out, errOut) => resolve(String(out || '') + String(errOut || ''))));
    const caps = parseHelp(text);
    if (caps.count < 20) return null; // could not read the help: legacy flags only
    try { const st = await fsp.stat(meta.bin); await fsp.writeFile(file, JSON.stringify({ tag: meta.tag, mtime: st.mtimeMs, flags: [...caps.flags], faValue: caps.faValue, nglWords: caps.nglWords })); } catch {}
    return caps;
  })().catch(() => null);
  capsMem.set(key, p);
  const v = await p;
  if (!v) capsMem.delete(key); // try again next launch
  return v;
}

// ───────────────────────────── 2. planning (pure) ─────────────────────────────
// Which options did the user set by hand? modelProfiles values always count; global engine settings only when
// they differ from the shipped defaults.
const ENGINE_DEFAULTS = { ctx: 8192, gpuLayers: -1, threads: 0, flashAttn: 'auto', kvType: 'f16', cpuMoe: 'auto' };
function explicitKeys(globalEngine = {}, profile = {}) {
  const e = {};
  for (const k of Object.keys(ENGINE_DEFAULTS)) {
    const pv = profile[k];
    if (pv !== undefined && pv !== null && pv !== '' && !(k === 'gpuLayers' && pv === -1) && !(k === 'threads' && pv === 0)) e[k] = true;
    else if (globalEngine[k] !== undefined && globalEngine[k] !== ENGINE_DEFAULTS[k]) e[k] = true;
  }
  return e;
}

// Returns { opts, plan, args (pairs, before capability filtering), why[], summary, refused }
// ctx: { specs, topo, budget, caps, mode ('eco'|'balanced'|'performance'), explicit, bench (cached winner), planFn }
function tune(model, o, ctx) {
  const { specs, topo, caps, mode = 'balanced', explicit = {}, bench = null, planFn } = ctx;
  const why = [];
  const role = o.role || 'chat';
  const faOk = has(caps, '-fa') && (!caps || caps.faValue);
  let opts = { ...o, kvOk: faOk && !explicit.kvType && role === 'chat' };
  const fit = governor.fitPlan(planFn, model, opts, specs, ctx.budget, { explicit });
  opts = fit.opts; const plan = fit.plan;
  if (fit.steps.length) why.push(...fit.steps.map((s) => `to fit in memory: ${s}`));
  if (ctx.budget.why && ctx.budget.why.length) why.push(...ctx.budget.why);
  const gpuFull = plan.mode === 'gpu' || plan.mode === 'moe' || (specs.unified && plan.ngl > 0);

  // threads
  let threads = o.threads > 0 ? o.threads : 0, batchThreads = 0;
  if (!explicit.threads) {
    const t = governor.threadsFor(topo, { gpuFull, mode });
    threads = t.threads; batchThreads = t.batchThreads; why.push(`${threads} threads (${t.why})`);
  }
  if (bench && bench.threads && !explicit.threads && mode !== 'eco') { threads = bench.threads; why.push(`${threads} threads measured fastest`); }

  // polling: busy-waiting threads burn a core each between steps; useless when the GPU does the work
  let poll = null;
  if (mode === 'eco' || gpuFull) poll = 0;
  if (bench && bench.poll !== undefined && mode !== 'eco') poll = bench.poll;

  // batch sizes: smaller compute buffers on CPU-only machines with little memory
  let batch = null, ubatch = null;
  if (plan.mode === 'cpu' && (specs.ramGB || 8) <= 8) { batch = 512; ubatch = 256; why.push('smaller batches (little memory)'); }
  if (bench && bench.ubatch) ubatch = bench.ubatch;

  // prompt cache kept in RAM by llama-server (default up to 8 GB!): bounded by what is really left
  let cacheRam = null;
  if (has(caps, '-cram') && role === 'chat') {
    const left = Math.max(0, (ctx.budget.ramGB || 0) - (specs.unified ? plan.vramGB : plan.ramGB));
    cacheRam = Math.round(Math.max(256, Math.min(4096, left * 0.25 * 1024)));
    why.push(`prompt cache limited to ${cacheRam} MB`);
  }

  const pairs = [['-m', model.path], ['--host', '127.0.0.1'], ['--port', '{port}'], ['-c', plan.ctx], ['-np', 1], ['-ngl', plan.ngl]];
  if (role === 'embed' || role === 'rerank') {
    pairs.push(['-b', 2048], ['-ub', 2048], [role === 'embed' ? '--embedding' : '--reranking']);
  } else {
    pairs.push(['--jinja'], ['--cache-reuse', 256]);
    if (plan.cpuMoe) pairs.push(['--cpu-moe']);
    if (faOk || !caps) pairs.push(['-fa', o.flashAttn || 'auto']);
    const kv = opts.kvType || 'f16';
    if (kv !== 'f16') pairs.push(['-ctk', kv], ['-ctv', kv]);
    if (cacheRam != null) pairs.push(['-cram', cacheRam]);
    if (batch) pairs.push(['-b', batch]);
    if (ubatch) pairs.push(['-ub', ubatch]);
    if (model.mmproj) pairs.push(['--mmproj', model.mmproj]);
  }
  if (threads > 0) pairs.push(['-t', threads]);
  if (batchThreads > 0 && batchThreads !== threads && has(caps, '-tb')) pairs.push(['-tb', batchThreads]);
  if (poll !== null) pairs.push(['--poll', poll]);

  const layers = plan.ngl > 900 ? `${plan.layers}/${plan.layers}` : `${plan.ngl}/${plan.layers}`;
  const summary = {
    auto: !explicit.gpuLayers || !explicit.threads,
    layersOnGpu: layers, mode: plan.mode, threads, ctx: plan.ctx, kvType: opts.kvType || 'f16', poll, cacheRamMB: cacheRam,
    tokPerSec: bench ? bench.tokPerSec : null, measured: !!bench,
    text: `${plan.mode === 'cpu' ? 'CPU only' : `${layers} layers on GPU`}, ${threads || 'default'} threads${bench && bench.tokPerSec ? `, ${bench.tokPerSec} tok/s` : ''}`,
  };
  return { opts, plan, pairs, why, summary, refused: fit.refused, fits: fit.fits };
}
function materialize(pairs, port, caps) {
  const p = pairs.map(([f, ...v]) => [f, ...v.map((x) => (x === '{port}' ? String(port) : x))]);
  return filterArgs(p, caps);
}

// ───────────────────────────── 3. benchmark ─────────────────────────────
let fileP = null;
const cacheFile = () => { try { return require('./paths').inShared('autotune.json'); } catch { return path.join(os.tmpdir(), 'fabro-autotune.json'); } };
async function readCache() { try { return JSON.parse(await fsp.readFile(cacheFile(), 'utf8')); } catch { return {}; } }
let cacheMem = null;
async function cache() { if (!cacheMem) cacheMem = await readCache(); return cacheMem; }
async function saveCache() { try { await fsp.writeFile(cacheFile(), JSON.stringify(cacheMem || {}, null, 1)); } catch {} }
function hwSig(specs) { return [specs.platform, specs.arch, specs.cpu && specs.cpu.model, specs.cpu && specs.cpu.threads, specs.ramGB, (specs.gpus || []).map((g) => g.name + ':' + g.vramGB).join('+'), specs.accel].join('|'); }
async function benchKey(model, specs, topo, meta) {
  let size = model.sizeBytes || 0, mtime = 0;
  try { const st = await fsp.stat(model.path); size = st.size; mtime = Math.round(st.mtimeMs); } catch {}
  return `${path.basename(model.path)}:${size}:${mtime}|${hwSig(specs)}|${meta ? meta.tag + ':' + meta.variant : ''}`;
}
async function cachedBench(model, specs, topo, meta) { const c = await cache(); return c[await benchKey(model, specs, topo, meta)] || null; }

// Candidate configs around the planned one (2-3 of them).
function candidates(base, topo, gpuFull) {
  const t = base.threads || 1;
  const list = [{ name: 'planned', threads: t, poll: base.poll }];
  if (gpuFull) {
    list.push({ name: 'poll', threads: t, poll: 50 });
    if ((topo.perf || 1) > t) list.push({ name: 'more-threads', threads: Math.min(topo.perf, t + 2), poll: base.poll });
  } else {
    if (t >= 4) list.push({ name: 'fewer-threads', threads: t - (t >= 8 ? 2 : 1), poll: base.poll });
    list.push({ name: 'no-poll', threads: t, poll: 0 });
  }
  return list.slice(0, 3);
}

// One measurement on a running server: warm-up, then a fixed prompt and ~48 generated tokens.
async function measure(port, signal) {
  const url = `http://127.0.0.1:${port}/completion`;
  const prompt = 'Write a short, friendly paragraph about why the sky looks blue during the day and red at sunset. '.repeat(3);
  const body = (n) => JSON.stringify({ prompt, n_predict: n, temperature: 0, cache_prompt: false, ignore_eos: true, stream: false });
  const post = async (n) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(n), signal }); if (!r.ok) throw new Error('bench HTTP ' + r.status); return r.json(); };
  await post(4);
  const j = await post(48);
  const t = j.timings || {};
  return { tokPerSec: +(t.predicted_per_second || 0).toFixed(1), promptPerSec: +(t.prompt_per_second || 0).toFixed(1) };
}

const state = { running: null, last: null, timer: null };
// engine: { benchLaunch(model, overrides) → { port, stop() }, models() → recently used local models, idleModel() }
let engineApi = null;
function init(api) {
  engineApi = api;
  governor.on('demand', () => { if (state.running) state.running.abort(); });
}
// Schedules a check two minutes after the last generation; nothing polls while idle.
function scheduleIdleCheck(ms = 120000) {
  if (!engineApi || governor.limits().autotune === false || process.env.FABRO_E2E) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => maybeBench().catch(() => {}), ms);
  if (state.timer.unref) state.timer.unref();
}
async function maybeBench() {
  if (state.running || !engineApi) return null;
  if (!governor.isIdle(90000) || governor.env.battery) return scheduleIdleCheck(), null;
  const target = await engineApi.benchTarget();
  if (!target) return null;
  return run(target.model, { reason: 'idle' });
}
// Runs the benchmark for one model now (cancellable). Returns the stored result.
async function run(model, { reason = 'manual' } = {}) {
  if (state.running) return { busy: true };
  const ctrl = new AbortController();
  state.running = { model: model.id, abort: () => ctrl.abort(), started: Date.now(), reason };
  const results = [];
  try {
    const info = await engineApi.benchInfo(model); // { specs, topo, meta, base: tune summary, gpuFull }
    const cands = candidates(info.base, info.topo, info.gpuFull);
    for (const c of cands) {
      if (ctrl.signal.aborted) break;
      let srv = null;
      try {
        srv = await engineApi.benchLaunch(model, { threads: c.threads, poll: c.poll, ctx: Math.min(info.base.ctx || 4096, 4096) }, ctrl.signal);
        const m = await measure(srv.port, ctrl.signal);
        results.push({ ...c, ...m });
      } catch (e) { if (ctrl.signal.aborted) break; results.push({ ...c, error: String(e.message || e) }); }
      finally { if (srv) await srv.stop().catch(() => {}); }
    }
    if (ctrl.signal.aborted) { state.last = { model: model.id, aborted: true, at: Date.now() }; return state.last; }
    const ok = results.filter((r) => r.tokPerSec > 0);
    if (!ok.length) { state.last = { model: model.id, failed: true, results, at: Date.now() }; return state.last; }
    const planned = ok.find((r) => r.name === 'planned');
    let best = ok.reduce((a, b) => (b.tokPerSec > a.tokPerSec ? b : a));
    if (planned && best !== planned && best.tokPerSec < planned.tokPerSec * 1.03) best = planned; // keep the plan unless clearly faster
    const entry = { threads: best.threads, poll: best.poll, tokPerSec: best.tokPerSec, promptPerSec: best.promptPerSec, chose: best.name, results, at: Date.now() };
    const c = await cache(); c[await benchKey(model, info.specs, info.topo, info.meta)] = entry; await saveCache();
    state.last = { model: model.id, ...entry };
    return state.last;
  } finally {
    state.running = null;
    if (engineApi && engineApi.afterBench) engineApi.afterBench(model).catch(() => {});
  }
}
const status = () => ({ running: state.running && { model: state.running.model, since: state.running.started, reason: state.running.reason }, last: state.last });
const cancel = () => { if (state.running) state.running.abort(); return true; };

module.exports = { parseHelp, filterArgs, capabilities, has, explicitKeys, tune, materialize, candidates, cachedBench, benchKey, init, scheduleIdleCheck, maybeBench, run, status, cancel, LEGACY, ENGINE_DEFAULTS, _measure: measure };
