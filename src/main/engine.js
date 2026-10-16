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

const GH = { 'User-Agent': 'Fabro', Accept: 'application/vnd.github+json' };

// 1) GitHub API: recent releases with their asset lists (drafts skipped).
async function apiReleases() {
  const r = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', { headers: GH });
  const body = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(body)) {
    const why = body && body.message ? body.message : `HTTP ${r.status}`;
    throw new Error(`GitHub API: ${why}`);
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

// Best (release, build) for this machine, skipping some variants if asked.
async function pickBuild(skip = []) {
  const specs = await system.getSpecs();
  const cands = candidates(specs).filter((c) => !skip.includes(c.variant));
  const notes = [];
  try {
    const releases = await apiReleases();
    for (const rel of releases) {
      for (const c of cands) {
        const asset = (rel.assets || []).find((x) => c.re.test(x.name));
        if (asset) {
          const extra = c.cudart ? rel.assets.find((x) => /^cudart-/.test(x.name) && x.name.includes(`cuda-${(asset.name.match(/cuda-([\d.]+)-/) || [])[1]}-`)) : null;
          return { tag: rel.tag_name, pick: c, asset, extra };
        }
      }
    }
    notes.push(`${releases.length} releases via API`);
  } catch (e) { notes.push(e.message); }

  try {
    const tags = await feedTags();
    for (const tag of tags) {
      for (const c of cands) {
        for (const name of c.names(tag)) {
          const asset = await probe(tag, name);
          if (!asset) continue;
          let extra = null;
          if (c.cudart) extra = await probe(tag, `cudart-llama-bin-win-cuda-${(name.match(/cuda-([\d.]+)-/) || [])[1]}-x64.zip`);
          return { tag, pick: c, asset, extra };
        }
      }
    }
    notes.push(`${tags.length} tags via feed`);
  } catch (e) { notes.push(e.message); }

  throw new Error(`No compatible engine build for this computer (${specs.platform} ${specs.arch}, ${specs.accel}; ${notes.join('; ')})`);
}

// Ordered list of builds to try, best first. `re` matches API asset names,
// `names(tag)` spells the file names to probe when the API is unavailable.
const CUDA13 = ['13.3', '13.4', '13.2', '13.1', '13.0', '13.5', '13.6'];
function candidates(specs) {
  const { platform: p, arch: a, accel } = specs;
  const ext = '\\.(zip|tar\\.gz)$';
  const both = (base) => [`${base}.zip`, `${base}.tar.gz`];
  if (p === 'win32') {
    if (a === 'arm64') return [
      { re: /bin-win-cpu-arm64\.zip$/, variant: 'cpu', names: (t) => [`llama-${t}-bin-win-cpu-arm64.zip`] },
      { re: /bin-win-cpu-x64\.zip$/, variant: 'cpu', names: (t) => [`llama-${t}-bin-win-cpu-x64.zip`] }];
    const l = [];
    if (accel === 'cuda') {
      // CUDA 12 first (works with older drivers), then CUDA 13+
      l.push({ re: /bin-win-cuda-12[\d.]*-x64\.zip$/, variant: 'cuda', cudart: true, names: (t) => [`llama-${t}-bin-win-cuda-12.4-x64.zip`] });
      l.push({ re: /bin-win-cuda-1[3-9][\d.]*-x64\.zip$/, variant: 'cuda', cudart: true, names: (t) => CUDA13.map((v) => `llama-${t}-bin-win-cuda-${v}-x64.zip`) });
    }
    if (accel !== 'cpu') l.push({ re: /bin-win-vulkan-x64\.zip$/, variant: 'vulkan', names: (t) => [`llama-${t}-bin-win-vulkan-x64.zip`] });
    l.push({ re: /bin-win-cpu-x64\.zip$/, variant: 'cpu', names: (t) => [`llama-${t}-bin-win-cpu-x64.zip`] });
    return l;
  }
  if (p === 'darwin') {
    return a === 'arm64'
      ? [{ re: new RegExp('bin-macos-arm64' + ext), variant: 'metal', names: (t) => both(`llama-${t}-bin-macos-arm64`) }]
      : [{ re: new RegExp('bin-macos-x64' + ext), variant: 'cpu', names: (t) => both(`llama-${t}-bin-macos-x64`) }];
  }
  const arch = a === 'arm64' ? 'arm64' : 'x64';
  const l = [];
  if (accel !== 'cpu') l.push({ re: new RegExp(`bin-ubuntu-vulkan-${arch}${ext}`), variant: 'vulkan', names: (t) => both(`llama-${t}-bin-ubuntu-vulkan-${arch}`) });
  l.push({ re: new RegExp(`bin-ubuntu-${arch}${ext}`), variant: 'cpu', names: (t) => both(`llama-${t}-bin-ubuntu-${arch}`) });
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

async function install({ skip = [] } = {}) {
  busy = true;
  set({ status: 'installing', progress: 0, error: null });
  try {
    const { tag, pick, asset, extra } = await pickBuild(skip);

    const dir = path.join(root(), `${tag}-${pick.variant}`);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const files = [asset];
    if (extra) files.push(extra); // CUDA runtime DLLs ship separately

    const known = files.reduce((s, f) => s + (f.size || 0), 0);
    let done = 0;
    for (const f of files) {
      const tmp = path.join(root(), f.name);
      await downloadFile(f.browser_download_url, tmp, {
        onProgress: (n, t) => set({ progress: Math.min(1, (done + n) / (known || (done + (t || n)) || 1)) }),
      });
      try { done += (await fsp.stat(tmp)).size; } catch { done += f.size || 0; }
      await extract(tmp, dir);
      await fsp.rm(tmp, { force: true });
    }
    const bin = await findBinary(dir);
    if (!bin) throw new Error('llama-server not found in engine package');
    if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);

    const meta = { tag, variant: pick.variant, dir, bin, installedAt: Date.now() };
    await fsp.writeFile(metaFile(), JSON.stringify(meta, null, 2));
    // Clean older builds.
    for (const e of await fsp.readdir(root(), { withFileTypes: true })) {
      if (e.isDirectory() && path.join(root(), e.name) !== dir) await fsp.rm(path.join(root(), e.name), { recursive: true, force: true }).catch(() => {});
    }
    set({ status: running ? 'ready' : 'idle', version: meta.tag, variant: meta.variant, progress: null });
    return meta;
  } catch (e) {
    set({ status: 'error', error: e.message, progress: null });
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
  const env = { ...process.env };
  if (process.platform === 'win32') env.PATH = [binDir, meta.dir, env.PATH].join(';');
  else if (process.platform === 'linux') env.LD_LIBRARY_PATH = [binDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');

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
    if (exited) throw new Error(logTail.slice(-8).join('\n') || 'Engine exited');
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
  throw new Error('Engine start timed out');
}

// Make sure the given model is loaded and serving. Returns { port }.
async function ensure(model, opts) {
  const key = JSON.stringify([model.path, opts.ctx, opts.gpuLayers, opts.threads]);
  if (running && running.key === key && proc) return running;
  if (starting && starting.key === key) return starting.promise;
  const promise = (async () => {
    await stop();
    let meta = await ensureInstalled();
    try { return await launch(meta, model, opts, key); }
    catch (e1) {
      // 1) same build, CPU only  2) next-best build
      if (opts.gpuLayers !== 0 && meta.variant !== 'cpu') {
        try { return await launch(meta, model, { ...opts, gpuLayers: 0 }, key); } catch { /* fall through */ }
        meta = await install({ skip: [meta.variant] });
        return launch(meta, model, opts, key);
      }
      set({ status: 'error', error: e1.message });
      throw e1;
    }
  })();
  starting = { key, promise };
  try { return await promise; } finally { starting = null; }
}

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
  const { tag } = await pickBuild();
  if (tag === meta.tag) return { updated: false, version: meta.tag };
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

module.exports = { init, ensure, stop, install, checkUpdate, getStatus };
