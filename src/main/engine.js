// Built-in inference engine: llama.cpp `llama-server`, downloaded for the
// user's hardware (CUDA / Vulkan / Metal / CPU) and kept up to date.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const net = require('net');
const { spawn, execFile } = require('child_process');
const extractZip = require('extract-zip');
const system = require('./system');
const { downloadFile } = require('./download');
const store = require('./store');

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

let proc = null, running = null, starting = null, logTail = [], busy = false;

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
    const releases = await apiReleases();
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
    const tags = await feedTags();
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
        const meta = await installOne(b);
        await fsp.writeFile(metaFile(), JSON.stringify(meta, null, 2));
        for (const e of await fsp.readdir(root(), { withFileTypes: true })) {
          if (e.isDirectory() && path.join(root(), e.name) !== meta.dir) await fsp.rm(path.join(root(), e.name), { recursive: true, force: true }).catch(() => {});
        }
        set({ status: running ? 'ready' : 'idle', version: meta.tag, variant: meta.variant, progress: null, error: null, errorCode: null });
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

async function launch(meta, model, o, key) {
  const port = await freePort();
  const ngl = o.gpuLayers < 0 ? 999 : o.gpuLayers;
  const args = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port),
    '-c', String(o.ctx || 8192), '-ngl', String(ngl), '--jinja', '-np', '1'];
  if (o.threads > 0) args.push('-t', String(o.threads));
  if (model.mmproj && fs.existsSync(model.mmproj)) args.push('--mmproj', model.mmproj);

  const binDir = path.dirname(meta.bin);
  const env = binEnv(meta.bin, meta.dir);
  if (!fs.existsSync(model.path)) throw new EngineError('MODEL_FILE', 'The model file is missing (moved or deleted?)', model.path);

  set({ status: 'loading', model: model.name, error: null });
  logTail = [];
  const p = spawn(meta.bin, args, { cwd: binDir, env, windowsHide: true });
  proc = p;
  const onData = (d) => String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) { logTail.push(l); if (logTail.length > 120) logTail.shift(); } });
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  let exited = false;
  p.on('error', (e) => { exited = true; logTail.push(String(e)); });
  p.on('exit', () => {
    exited = true;
    if (proc === p) { proc = null; running = null; if (state.status === 'ready') set({ status: 'idle', model: null, port: null }); }
  });

  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (exited) {
      const log = logTail.join('\n');
      if (/out of memory|failed to allocate|cudaMalloc|ErrorOutOfDeviceMemory|unable to allocate/i.test(log)) throw new EngineError('OUT_OF_MEMORY', 'Not enough memory to load this model', logTail.slice(-8).join('\n'));
      if (/failed to (load|read) model|invalid magic|gguf/i.test(log)) throw new EngineError('MODEL_FILE', 'The model file could not be read', logTail.slice(-8).join('\n'));
      throw new EngineError('START_FAILED', 'The engine stopped while loading the model', logTail.slice(-8).join('\n') || 'Engine exited');
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) {
        running = { key, port, model };
        set({ status: 'ready', port, model: model.name, version: meta.tag, variant: meta.variant });
        return running;
      }
    } catch { /* not up yet */ }
    await sleep(350);
  }
  p.kill();
  throw new EngineError('TIMEOUT', 'Loading the model took too long', logTail.slice(-8).join('\n'));
}

// Make sure the given model is loaded and serving. Returns { port }.
async function ensure(model, opts) {
  const key = JSON.stringify([model.path, opts.ctx, opts.gpuLayers, opts.threads, opts.variant]);
  if (running && running.key === key && proc) return running;
  if (starting && starting.key === key) return starting.promise;
  const promise = (async () => {
    await stop();
    let meta = await ensureInstalled();
    if (opts.variant === 'cpu' && meta.variant !== 'cpu') meta = await install();
    const gpu = meta.variant !== 'cpu' && opts.gpuLayers !== 0;
    try { return await launch(meta, model, opts, key); }
    catch (e1) {
      if (['MODEL_FILE'].includes(e1.code)) { fail(e1); throw e1; }
      // Out of GPU memory: offload fewer layers, then smaller context.
      if (e1.code === 'OUT_OF_MEMORY' && gpu) {
        for (const ngl of [24, 12, 0]) {
          try { return await launch(meta, model, { ...opts, gpuLayers: ngl }, key); } catch (e) { if (e.code !== 'OUT_OF_MEMORY') break; }
        }
        if ((opts.ctx || 8192) > 4096) { try { return await launch(meta, model, { ...opts, gpuLayers: 0, ctx: 4096 }, key); } catch {} }
        fail(e1); throw e1;
      }
      // GPU build misbehaves: same build on CPU, then the next build.
      if (gpu) {
        try { return await launch(meta, model, { ...opts, gpuLayers: 0 }, key); } catch { /* next build */ }
        try { meta = await install({ skip: [meta.build || meta.variant] }); return await launch(meta, model, opts, key); }
        catch (e2) { fail(e2); throw e2; }
      }
      fail(e1); throw e1;
    }
  })();
  starting = { key, promise };
  try { return await promise; } finally { starting = null; }
}
function fail(e) { set({ status: 'error', error: e.message, errorCode: e.code || 'UNKNOWN', errorDetail: e.detail || '' }); }

async function stop() {
  const p = proc;
  if (!p) return;
  proc = null; running = null;
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000);
    p.once('exit', () => { clearTimeout(t); resolve(); });
    try { p.kill(); } catch { resolve(); }
  });
  set({ status: 'idle', model: null, port: null });
}

// Auto-update the engine when idle.
async function checkUpdate() {
  if (busy || proc) return { updated: false, reason: 'busy' };
  const meta = await readMeta();
  if (!meta) return { updated: false, reason: 'not-installed' };
  const builds = await pickBuilds();
  const same = builds.find((b) => b.pick.id === meta.build) || builds[0];
  if (!same || same.tag === meta.tag) return { updated: false, version: meta.tag };
  const m = await install();
  return { updated: true, version: m.tag };
}

async function init(emitter) {
  emit = emitter;
  await fsp.mkdir(root(), { recursive: true });
  const meta = await readMeta();
  if (meta) set({ version: meta.tag, variant: meta.variant });
}

const getStatus = () => ({ ...state, log: logTail.slice(-40) });
const diagnostics = async () => ({ state: { ...state }, log: logTail.slice(-60), meta: await readMeta(), specs: await system.getSpecs() });

module.exports = { init, ensure, stop, install, checkUpdate, getStatus, diagnostics, EngineError };
