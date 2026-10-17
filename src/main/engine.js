// Built-in inference engine: llama.cpp `llama-server`, downloaded for the
// user's hardware (CUDA / Vulkan / Metal / CPU) and kept up to date.
const { app, powerMonitor } = require('electron');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const net = require('net');
const { spawn, execFile } = require('child_process');
const extractZip = require('extract-zip');
const system = require('./system');
const { downloadFile } = require('./download');
const store = require('./store');
const memory = require('./memory');

// Errors carry a stable code the UI turns into a readable card with actions.
class EngineError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail || ''; }
}
const isNetErr = (e) => /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(String(e && (e.cause && e.cause.code || e.message)));

const root = () => path.join(app.getPath('userData'), 'engine');
const metaFile = () => path.join(root(), 'current.json');
const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let emit = () => {};
const state = { status: 'idle', version: null, variant: null, model: null, port: null, progress: null, error: null };
function set(p) { Object.assign(state, p); emit({ ...state }); }

const starting = new Map();
let logTail = [], busy = false;

async function readMeta() {
  try { const m = JSON.parse(await fsp.readFile(metaFile(), 'utf8')); return fs.existsSync(m.bin) ? m : null; }
  catch { return null; }
}

const GH = { 'User-Agent': 'Fabro', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

// 1) GitHub API: recent releases with their asset lists (drafts skipped).
async function apiReleases() {
  const r = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', { headers: GH });
  const body = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(body)) {
    const why = body && body.message ? body.message : `HTTP ${r.status}`;
    throw new EngineError(/rate limit/i.test(why) ? 'RATE_LIMIT' : 'GITHUB', `GitHub API: ${why}`);
  }
  return body.filter((x) => !x.draft);
}

// 2) Fallback without the API (rate limits, proxies): tags from the public
//    Atom feed, then probe the predictable download URLs.
async function feedTags() {
  const r = await fetch('https://github.com/ggml-org/llama.cpp/releases.atom', { headers: { 'User-Agent': 'Fabro' } });
  if (!r.ok) throw new Error(`releases feed HTTP ${r.status}`);
  const xml = await r.text();
  return [...new Set([...xml.matchAll(/releases\/tag\/(b\d+)/g)].map((m) => m[1]))].slice(0, 6);
}
async function probe(tag, name) {
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/${name}`;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'Fabro' } });
    if (!r.ok) return null;
    return { name, browser_download_url: url, size: Number(r.headers.get('content-length') || 0) };
  } catch { return null; }
}

// All usable (release, build) pairs for this machine, best first.
// `skip` = candidate ids or variants already known not to work here.
function wantedCandidates(specs, skip) {
  const forceCpu = (store.getSettings().engine || {}).variant === 'cpu';
  return candidates(specs).filter((c) => !skip.includes(c.id) && !skip.includes(c.variant) && (!forceCpu || c.variant === 'cpu'));
}

async function pickBuilds(skip = []) {
  const specs = await system.getSpecs();
  const cands = wantedCandidates(specs, skip);
  const notes = [];
  let netDown = false, rateLimited = false;
  const out = [];
  try {
    const bad = new Set(((store.getSettings().engine || {}).badTags) || []);
    const releases = (await apiReleases()).filter((r) => !bad.has(r.tag_name));
    for (const c of cands) {
      for (const rel of releases) {
        const asset = (rel.assets || []).find((x) => c.re.test(x.name));
        if (!asset) continue;
        const v = (asset.name.match(/cuda-([\d.]+)-/) || [])[1];
        const extra = c.cudart ? (rel.assets || []).find((x) => x.name === `cudart-llama-bin-win-cuda-${v}-x64.zip`) : null;
        out.push({ tag: rel.tag_name, pick: c, asset, extra });
        break; // newest release that has this build
      }
    }
    if (out.length) return out;
    notes.push(`${releases.length} releases via API`);
  } catch (e) {
    notes.push(e.message);
    if (e.code === 'RATE_LIMIT') rateLimited = true;
    if (isNetErr(e)) netDown = true;
  }

  try {
    const badT = new Set(((store.getSettings().engine || {}).badTags) || []);
    const tags = (await feedTags()).filter((t) => !badT.has(t));
    for (const c of cands) {
      found: for (const tag of tags) {
        for (const name of c.names(tag)) {
          const asset = await probe(tag, name);
          if (!asset) continue;
          let extra = null;
          if (c.cudart) extra = await probe(tag, `cudart-llama-bin-win-cuda-${(name.match(/cuda-([\d.]+)-/) || [])[1]}-x64.zip`);
          out.push({ tag, pick: c, asset, extra });
          break found;
        }
      }
    }
    if (out.length) return out;
    notes.push(`${tags.length} tags via feed`);
  } catch (e) { notes.push(e.message); if (isNetErr(e)) netDown = true; }

  const where = `${specs.platform} ${specs.arch}, ${specs.accel}`;
  if (netDown) throw new EngineError('NETWORK', 'Cannot reach GitHub to download the engine', notes.join('; '));
  if (rateLimited) throw new EngineError('RATE_LIMIT', 'GitHub rate limit reached', notes.join('; '));
  throw new EngineError('NO_BUILD', `No compatible engine build for this computer (${where})`, notes.join('; '));
}

// Ordered list of builds to try, best first. `re` matches API asset names,
// `names(tag)` spells the file names to probe when the API is unavailable.
const CUDA13 = ['13.3', '13.4', '13.2', '13.1', '13.0', '13.5', '13.6'];
// Anchored on "llama-" so the separate cudart-llama-… DLL packs never match.
const R = (tail) => new RegExp(`^llama-[^/]*-bin-${tail}$`);
function candidates(specs) {
  const { platform: p, arch: a, accel } = specs;
  const both = (base) => [`${base}.zip`, `${base}.tar.gz`];
  if (p === 'win32') {
    if (a === 'arm64') return [
      { id: 'cpu-arm64', re: R('win-cpu-arm64\\.zip'), variant: 'cpu', names: (t) => [`llama-${t}-bin-win-cpu-arm64.zip`] },
      { id: 'cpu', re: R('win-cpu-x64\\.zip'), variant: 'cpu', names: (t) => [`llama-${t}-bin-win-cpu-x64.zip`] }];
    const l = [];
    if (accel === 'cuda') {
      // CUDA 12 first (works with older drivers), then CUDA 13+
      l.push({ id: 'cuda12', re: R('win-cuda-12[\\d.]*-x64\\.zip'), variant: 'cuda', cudart: true, names: (t) => [`llama-${t}-bin-win-cuda-12.4-x64.zip`] });
      l.push({ id: 'cuda13', re: R('win-cuda-1[3-9][\\d.]*-x64\\.zip'), variant: 'cuda', cudart: true, names: (t) => CUDA13.map((v) => `llama-${t}-bin-win-cuda-${v}-x64.zip`) });
    }
    if (accel !== 'cpu') l.push({ id: 'vulkan', re: R('win-vulkan-x64\\.zip'), variant: 'vulkan', names: (t) => [`llama-${t}-bin-win-vulkan-x64.zip`] });
    l.push({ id: 'cpu', re: R('win-cpu-x64\\.zip'), variant: 'cpu', names: (t) => [`llama-${t}-bin-win-cpu-x64.zip`] });
    return l;
  }
  if (p === 'darwin') {
    return a === 'arm64'
      ? [{ id: 'metal', re: R('macos-arm64\\.(zip|tar\\.gz)'), variant: 'metal', names: (t) => both(`llama-${t}-bin-macos-arm64`) }]
      : [{ id: 'cpu', re: R('macos-x64\\.(zip|tar\\.gz)'), variant: 'cpu', names: (t) => both(`llama-${t}-bin-macos-x64`) }];
  }
  const arch = a === 'arm64' ? 'arm64' : 'x64';
  const l = [];
  if (accel !== 'cpu') l.push({ id: 'vulkan', re: R(`ubuntu-vulkan-${arch}\\.(zip|tar\\.gz)`), variant: 'vulkan', names: (t) => both(`llama-${t}-bin-ubuntu-vulkan-${arch}`) });
  l.push({ id: 'cpu', re: R(`ubuntu-${arch}\\.(zip|tar\\.gz)`), variant: 'cpu', names: (t) => both(`llama-${t}-bin-ubuntu-${arch}`) });
  return l;
}

async function extract(file, dest) {
  if (file.endsWith('.zip')) return extractZip(file, { dir: dest });
  await new Promise((res, rej) => execFile('tar', ['-xzf', file, '-C', dest], (e) => (e ? rej(e) : res())));
}

async function findBinary(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === EXE) return full;
    if (e.isDirectory()) { const f = await findBinary(full); if (f) return f; }
  }
  return null;
}

// Runs `llama-server --version` to make sure the build actually loads here
// (missing GPU driver / DLL = broken build for this machine).
function binEnv(bin, dir) {
  const binDir = path.dirname(bin);
  const env = { ...process.env };
  if (process.platform === 'win32') env.PATH = [binDir, dir, env.PATH].join(';');
  else if (process.platform === 'linux') env.LD_LIBRARY_PATH = [binDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  return env;
}
function selfTest(bin, dir) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { cwd: path.dirname(bin), env: binEnv(bin, dir), timeout: 20000, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || ''), err }));
  });
}
async function listFiles(dir, base = dir, acc = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(full, base, acc); else acc.push(path.relative(base, full));
    if (acc.length > 40) break;
  }
  return acc;
}

async function installOne({ tag, pick, asset, extra }) {
  const dir = path.join(root(), `${tag}-${pick.id}`);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const files = [asset];
  if (extra) files.push(extra); // CUDA runtime DLLs ship separately
  const known = files.reduce((n, f) => n + (f.size || 0), 0);
  let done = 0;
  for (const f of files) {
    const tmp = path.join(root(), f.name);
    try {
      await downloadFile(f.browser_download_url, tmp, {
        onProgress: (n, t) => set({ progress: Math.min(1, (done + n) / (known || (done + (t || n)) || 1)), build: pick.id }),
      });
    } catch (e) {
      throw new EngineError(isNetErr(e) ? 'NETWORK' : 'DOWNLOAD', `Engine download failed: ${e.message}`, f.name);
    }
    try { done += (await fsp.stat(tmp)).size; } catch { done += f.size || 0; }
    try { await extract(tmp, dir); }
    catch (e) { throw new EngineError('BROKEN_BUILD', `Could not unpack ${f.name}: ${e.message}`, f.name); }
    await fsp.rm(tmp, { force: true });
  }
  const bin = await findBinary(dir);
  if (!bin) {
    const seen = await listFiles(dir).catch(() => []);
    throw new EngineError('NO_BINARY', `${EXE} not found in ${asset.name}`, seen.slice(0, 20).join(', '));
  }
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  const test = await selfTest(bin, dir);
  if (!test.ok) throw new EngineError('BROKEN_BUILD', `The ${pick.id} engine does not start on this computer`, test.out.slice(-600) || String(test.err && test.err.message));
  return { tag, variant: pick.variant, build: pick.id, dir, bin, installedAt: Date.now() };
}

// Installs the best working build, falling back build after build.
async function install({ skip = [] } = {}) {
  busy = true;
  set({ status: 'installing', progress: 0, error: null, errorCode: null });
  const tried = [];
  try {
    const builds = await pickBuilds(skip);
    let last = null;
    for (const b of builds) {
      set({ status: 'installing', progress: 0, build: b.pick.id });
      try {
        const old = await readMeta();
        const meta = await installOne(b);
        // Keep the previous working build for one-click / automatic rollback.
        if (old && old.dir !== meta.dir && fs.existsSync(old.bin)) { const { prev, ...o } = old; meta.prev = o; }
        await writeMeta(meta);
        const keep = new Set([meta.dir, meta.prev && meta.prev.dir].filter(Boolean));
        for (const e of await fsp.readdir(root(), { withFileTypes: true })) {
          if (e.isDirectory() && !keep.has(path.join(root(), e.name))) await fsp.rm(path.join(root(), e.name), { recursive: true, force: true }).catch(() => {});
        }
        set({ status: instances.size ? 'ready' : 'idle', version: meta.tag, variant: meta.variant, prevVersion: meta.prev ? meta.prev.tag : null, progress: null, error: null, errorCode: null });
        return meta;
      } catch (e) {
        last = e; tried.push(`${b.pick.id}: ${e.code || ''} ${e.message}`);
        if (e.code === 'NETWORK') break; // no point trying other builds offline
      }
    }
    const err = last || new EngineError('NO_BUILD', 'No engine build could be installed');
    err.detail = [err.detail, ...tried].filter(Boolean).join('\n');
    throw err;
  } catch (e) {
    set({ status: 'error', error: e.message, errorCode: e.code || 'UNKNOWN', errorDetail: e.detail || '', progress: null });
    throw e;
  } finally { busy = false; }
}

async function ensureInstalled() { return (await readMeta()) || install(); }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// ───────────────────────────── options ─────────────────────────────
// Effective options = global engine settings ⊕ the model's own profile.
function optionsFor(model) {
  const s = store.getSettings();
  const prof = (s.modelProfiles || {})[model.id] || {};
  const o = { ...DEFAULT_OPTS, ...(s.engine || {}) };
  for (const k of Object.keys(DEFAULT_OPTS)) if (prof[k] !== undefined && prof[k] !== null && prof[k] !== '') o[k] = prof[k];
  o.preload = prof.preload || 'demand';
  o.idleMinutes = prof.idleMinutes ?? (s.engine || {}).idleMinutes ?? DEFAULT_OPTS.idleMinutes;
  return o;
}
const DEFAULT_OPTS = { ctx: 8192, gpuLayers: -1, threads: 0, flashAttn: 'auto', kvType: 'f16', cpuMoe: 'auto', idleMinutes: 30 };

function energyMode() {
  const e = (store.getSettings().engine || {}).energy || 'auto';
  if (e !== 'auto') return e;
  try { return powerMonitor.isOnBatteryPower() ? 'eco' : 'balanced'; } catch { return 'balanced'; }
}
const PRIORITY = () => ({ performance: os.constants.priority.PRIORITY_ABOVE_NORMAL, balanced: os.constants.priority.PRIORITY_NORMAL, eco: os.constants.priority.PRIORITY_BELOW_NORMAL });
function applyPriority(inst) { try { if (inst.proc && inst.proc.pid) os.setPriority(inst.proc.pid, PRIORITY()[energyMode()]); } catch {} }

function argsFor(model, o, pl, port) {
  // Embedding / reranking servers (Projects semantic search): small, batch-friendly, no chat template.
  if (o.role === 'embed' || o.role === 'rerank') {
    const a = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(pl.ctx), '-ngl', String(pl.ngl), '-b', '2048', '-ub', '2048', '-np', '1', o.role === 'embed' ? '--embedding' : '--reranking'];
    if (energyMode() === 'eco') a.push('--poll', '0');
    return a;
  }
  const args = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(pl.ctx), '--jinja', '-np', '1',
    '-ngl', String(pl.ngl), '--cache-reuse', '256'];
  if (pl.cpuMoe) args.push('--cpu-moe');
  const fa = o.flashAttn || 'auto';
  args.push('-fa', fa);
  if (o.kvType && o.kvType !== 'f16') args.push('-ctk', o.kvType, '-ctv', o.kvType);
  const mode = energyMode();
  const physical = Math.max(1, Math.round(os.cpus().length / 2));
  const threads = o.threads > 0 ? o.threads : mode === 'eco' ? Math.max(2, Math.floor(physical / 2)) : 0;
  if (threads > 0) args.push('-t', String(threads));
  if (mode === 'eco') args.push('--poll', '0');
  if (model.mmproj && fs.existsSync(model.mmproj)) args.push('--mmproj', model.mmproj);
  return args;
}

// ───────────────────────────── instances ─────────────────────────────
// key → { key, model, opts, plan, port, proc, status, lastUsed, busy, startedAt }
const instances = new Map();
const keyFor = (model, o) => JSON.stringify([model.path, o.ctx, o.gpuLayers, o.threads, o.flashAttn, o.kvType, o.cpuMoe, o.variant, o.role || 'chat']);

function loadedList() {
  return [...instances.values()].map((i) => ({
    id: i.model.id, name: i.model.name, port: i.port, status: i.status, mode: i.plan && i.plan.mode,
    vramGB: i.plan && i.plan.vramGB, ramGB: i.plan && i.plan.ramGB, lastUsed: i.lastUsed, busy: i.busy, pinned: i.opts.preload === 'always', pid: i.proc && i.proc.pid,
  }));
}
function publish(extra = {}) {
  const ready = [...instances.values()].filter((i) => i.status === 'ready').sort((a, b) => b.lastUsed - a.lastUsed);
  const loading = [...instances.values()].find((i) => i.status === 'loading');
  const base = loading ? { status: 'loading', model: loading.model.name }
    : ready.length ? { status: 'ready', model: ready[0].model.name, port: ready[0].port }
    : state.status === 'error' || state.status === 'installing' ? {} : { status: 'idle', model: null, port: null };
  set({ ...base, ...extra, loaded: loadedList(), energy: energyMode() });
}

async function launch(meta, model, o, key, pl) {
  const port = await freePort();
  const args = argsFor(model, o, pl, port);
  const binDir = path.dirname(meta.bin);
  const env = binEnv(meta.bin, meta.dir);
  if (!fs.existsSync(model.path)) throw new EngineError('MODEL_FILE', 'The model file is missing (moved or deleted?)', model.path);

  const inst = { key, model, opts: o, plan: pl, port, proc: null, status: 'loading', lastUsed: Date.now(), busy: 0, startedAt: Date.now(), log: [] };
  instances.set(key, inst);
  publish({ error: null, errorCode: null });
  const p = spawn(meta.bin, args, { cwd: binDir, env, windowsHide: true });
  inst.proc = p;
  applyPriority(inst);
  const onData = (d) => String(d).split(/\r?\n/).forEach((l) => {
    if (!l.trim()) return;
    inst.log.push(l); if (inst.log.length > 200) inst.log.shift();
    logTail.push(`[${model.name}] ${l}`); if (logTail.length > 400) logTail.shift();
  });
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  let exited = false;
  p.on('error', (e) => { exited = true; inst.log.push(String(e)); });
  p.on('exit', () => {
    exited = true;
    if (instances.get(key) === inst && inst.status === 'ready') { instances.delete(key); publish(); }
  });

  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    if (exited) {
      instances.delete(key);
      const log = inst.log.join('\n');
      const tailTxt = inst.log.slice(-10).join('\n');
      if (/out of memory|failed to allocate|cudaMalloc|ErrorOutOfDeviceMemory|unable to allocate|insufficient memory/i.test(log)) throw new EngineError('OUT_OF_MEMORY', 'Not enough memory to load this model', tailTxt);
      if (/failed to (load|read) model|invalid magic|unknown model architecture/i.test(log)) throw new EngineError(/unknown model architecture/i.test(log) ? 'ARCH' : 'MODEL_FILE', 'The engine can\'t read this model', tailTxt);
      if (/invalid argument|unknown argument|error: unrecognized/i.test(log)) throw new EngineError('BAD_ARGS', 'The engine rejected an option', tailTxt);
      throw new EngineError('START_FAILED', 'The engine stopped while loading the model', tailTxt || 'Engine exited');
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) {
        inst.status = 'ready'; inst.lastUsed = Date.now();
        publish({ version: meta.tag, variant: meta.variant, error: null, errorCode: null });
        return inst;
      }
    } catch { /* not up yet */ }
    await sleep(300);
  }
  try { p.kill(); } catch {}
  instances.delete(key);
  throw new EngineError('TIMEOUT', 'Loading the model took too long', inst.log.slice(-8).join('\n'));
}

async function stopInstance(inst) {
  instances.delete(inst.key);
  const p = inst.proc;
  if (p && p.exitCode === null) {
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      try { p.kill(); } catch { resolve(); }
    });
  }
  publish();
}

// Free memory for `need` by unloading least-recently-used idle models.
async function makeRoom(pl, keepKey) {
  const specs = await system.getSpecs();
  const multi = (store.getSettings().engine || {}).multiModel !== false;
  const others = [...instances.values()].filter((i) => i.key !== keepKey);
  if (!multi) { for (const i of others) await stopInstance(i); return; }
  const used = () => [...instances.values()].filter((i) => i.key !== keepKey).reduce((a, i) => ({ v: a.v + (i.plan?.vramGB || 0), r: a.r + (i.plan?.ramGB || 0) }), { v: 0, r: 0 });
  const over = () => {
    const u = used();
    if (specs.unified) return u.v + pl.vramGB > specs.gpuBudgetGB;
    return u.v + pl.vramGB > (specs.gpuBudgetGB || 0) + 0.01 && pl.vramGB > 0 || u.r + pl.ramGB > specs.ramGB * 0.8;
  };
  const victims = others.filter((i) => i.busy === 0).sort((a, b) => (a.opts.preload === 'always') - (b.opts.preload === 'always') || a.lastUsed - b.lastUsed);
  while (over() && victims.length) await stopInstance(victims.shift());
}

// Make sure the model is loaded and serving. Returns { port, key }.
async function ensure(model, overrides = {}) {
  const o = { ...optionsFor(model), ...overrides };
  const key = keyFor(model, o);
  const have = instances.get(key);
  if (have && have.status === 'ready' && have.proc && have.proc.exitCode === null) { have.lastUsed = Date.now(); return have; }
  if (starting.has(key)) return starting.get(key);
  // Same model with other options → replace it.
  for (const i of [...instances.values()]) if (i.model.path === model.path && i.key !== key && i.busy === 0) await stopInstance(i);

  const promise = (async () => {
    const specs = await system.getSpecs();
    let meta = await ensureInstalled();
    if (o.variant === 'cpu' && meta.variant !== 'cpu') meta = await install();
    const cpuOnly = meta.variant === 'cpu';
    const pl = memory.plan(model, o, cpuOnly ? { ...specs, accel: 'cpu', gpuBudgetGB: 0 } : specs);
    await makeRoom(pl, key);
    const gpu = !cpuOnly && pl.ngl !== 0;
    try {
      const inst = await launch(meta, model, o, key, pl);
      if (!meta.verified) { meta.verified = true; await writeMeta(meta); }
      return inst;
    } catch (e1) {
      if (['MODEL_FILE', 'ARCH'].includes(e1.code)) { fail(e1); throw e1; }
      if (e1.code === 'BAD_ARGS') { // older/newer engine without an option: retry with the safest set
        try { return await launch(meta, model, { ...o, flashAttn: 'auto', kvType: 'f16' }, key, { ...pl, cpuMoe: false }); } catch {}
      }
      // Out of memory: offload fewer layers, then a smaller context.
      if (e1.code === 'OUT_OF_MEMORY' && gpu) {
        const steps = [Math.floor(pl.layers * 0.6), Math.floor(pl.layers * 0.3), 0].filter((n) => n < (pl.ngl > 900 ? pl.layers + 1 : pl.ngl));
        for (const ngl of steps) {
          try { return await launch(meta, model, o, key, { ...pl, ngl, cpuMoe: false, mode: ngl ? 'split' : 'cpu' }); } catch (e) { if (e.code !== 'OUT_OF_MEMORY') break; }
        }
        if (pl.ctx > 4096) { try { return await launch(meta, model, o, key, { ...pl, ngl: 0, ctx: 4096, cpuMoe: false, mode: 'cpu' }); } catch {} }
        fail(e1); throw e1;
      }
      // A freshly updated build that never loaded a model: roll back to the previous one.
      if (!meta.verified && meta.prev && fs.existsSync(meta.prev.bin)) {
        try {
          const back = await rollback(`auto: ${e1.code}`);
          const inst = await launch(back, model, o, key, pl);
          return inst;
        } catch { /* keep going */ }
      }
      // GPU build misbehaves: same build on CPU, then the next build.
      if (gpu) {
        try { return await launch(meta, model, o, key, { ...pl, ngl: 0, cpuMoe: false, mode: 'cpu' }); } catch { /* next build */ }
        try { meta = await install({ skip: [meta.build || meta.variant] }); return await launch(meta, model, o, key, memory.plan(model, o, meta.variant === 'cpu' ? { ...specs, accel: 'cpu', gpuBudgetGB: 0 } : specs)); }
        catch (e2) { fail(e2); throw e2; }
      }
      fail(e1); throw e1;
    }
  })();
  starting.set(key, promise);
  try { return await promise; } finally { starting.delete(key); }
}
function fail(e) { set({ status: 'error', error: e.message, errorCode: e.code || 'UNKNOWN', errorDetail: e.detail || '', loaded: loadedList() }); }

// Request accounting: busy models are never evicted, and idle timers start after the answer.
function acquire(inst) { inst.busy++; inst.lastUsed = Date.now(); }
function release(inst) { inst.busy = Math.max(0, inst.busy - 1); inst.lastUsed = Date.now(); publish(); }

async function stop(id) {
  const list = [...instances.values()].filter((i) => !id || i.model.id === id);
  await Promise.all(list.map(stopInstance));
  if (!id) publish({ status: 'idle' });
}

// Unload idle models after their timeout (0 = never). Preload "always" models are kept.
function idleSweep() {
  const now = Date.now();
  for (const i of instances.values()) {
    if (i.status !== 'ready' || i.busy || i.opts.preload === 'always') continue;
    const m = Number(i.opts.idleMinutes);
    if (m > 0 && now - i.lastUsed > m * 60000) stopInstance(i);
  }
}

// Load "at startup" / "always in memory" models once the app is up.
async function preloadAll(listLocal) {
  const s = store.getSettings();
  const profiles = s.modelProfiles || {};
  const ids = Object.keys(profiles).filter((id) => ['startup', 'always'].includes(profiles[id].preload));
  if (!ids.length || !(await readMeta())) return;
  for (const m of (await listLocal()).filter((x) => ids.includes(x.id))) {
    try { await ensure(m); } catch { /* reported via status */ }
  }
}

// ───────────────────────────── rollback & updates ─────────────────────────────
async function writeMeta(meta) { await fsp.writeFile(metaFile(), JSON.stringify(meta, null, 2)); }

async function rollback(reason = 'manual') {
  const meta = await readMeta();
  if (!meta || !meta.prev || !fs.existsSync(meta.prev.bin)) throw new EngineError('NO_ROLLBACK', 'No previous engine version to go back to');
  await stop();
  const bad = new Set(((store.getSettings().engine || {}).badTags) || []);
  bad.add(meta.tag);
  await store.setSettings({ engine: { badTags: [...bad].slice(-10) } });
  const back = { ...meta.prev, verified: true, prev: null, rolledBackFrom: meta.tag, rollbackReason: reason };
  await writeMeta(back);
  await fsp.rm(meta.dir, { recursive: true, force: true }).catch(() => {});
  set({ version: back.tag, variant: back.variant, error: null, errorCode: null, prevVersion: null });
  return back;
}

// Auto-update the engine when nothing is loaded.
async function checkUpdate() {
  if (busy || instances.size) return { updated: false, reason: 'busy' };
  const meta = await readMeta();
  if (!meta) return { updated: false, reason: 'not-installed' };
  const builds = await pickBuilds();
  const same = builds.find((b) => b.pick.id === meta.build) || builds[0];
  if (!same || same.tag === meta.tag) return { updated: false, version: meta.tag };
  const m = await install();
  return { updated: true, version: m.tag, from: meta.tag };
}

async function init(emitter) {
  emit = emitter;
  await fsp.mkdir(root(), { recursive: true });
  const meta = await readMeta();
  if (meta) set({ version: meta.tag, variant: meta.variant, prevVersion: meta.prev ? meta.prev.tag : null });
  setInterval(idleSweep, 30000).unref();
  try {
    powerMonitor.on('on-battery', () => { for (const i of instances.values()) applyPriority(i); publish(); });
    powerMonitor.on('on-ac', () => { for (const i of instances.values()) applyPriority(i); publish(); });
  } catch {}
}

function setEnergy() { for (const i of instances.values()) applyPriority(i); publish(); }

const getStatus = () => ({ ...state, loaded: loadedList(), energy: energyMode(), log: logTail.slice(-60) });
const diagnostics = async () => ({ state: { ...state }, loaded: loadedList(), log: logTail.slice(-80), meta: await readMeta(), specs: await system.getSpecs() });
const logs = () => logTail.slice();
function find(id) { return [...instances.values()].find((i) => i.model.id === id && i.status === 'ready') || null; }

module.exports = { init, ensure, acquire, release, stop, install, checkUpdate, rollback, getStatus, diagnostics, logs, preloadAll, setEnergy, optionsFor, find, EngineError };
