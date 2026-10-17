// Model catalog, recommendations, Hugging Face GGUF search/download, Ollama listing.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');
const system = require('./system');
const { downloadFile } = require('./download');
const memory = require('./memory');
const crypto = require('crypto');
const os = require('os');

// Curated starting points. Sizes are Q4 estimates; exact sizes are resolved on download.
const CATALOG = [
  { id: 'qwen3.5-0.8b', name: 'Qwen3.5 0.8B', by: 'Qwen', repo: 'ggml-org/Qwen3.5-0.8B-GGUF', params: '0.8B', sizeGB: 0.6, tags: ['chat', 'fast'] },
  { id: 'gemma-4-e2b', name: 'Gemma 4 E2B', by: 'Google', repo: 'unsloth/gemma-4-E2B-it-GGUF', params: 'E2B', sizeGB: 3.1, tags: ['chat', 'vision', 'fast'] },
  { id: 'qwen3.5-4b', name: 'Qwen3.5 4B', by: 'Qwen', repo: 'unsloth/Qwen3.5-4B-GGUF', params: '4B', sizeGB: 2.7, tags: ['chat', 'vision', 'reasoning'] },
  { id: 'gemma-4-e4b', name: 'Gemma 4 E4B', by: 'Google', repo: 'unsloth/gemma-4-E4B-it-GGUF', params: 'E4B', sizeGB: 5.0, tags: ['chat', 'vision'] },
  { id: 'qwen3.5-9b', name: 'Qwen3.5 9B', by: 'Qwen', repo: 'unsloth/Qwen3.5-9B-GGUF', params: '9B', sizeGB: 5.7, tags: ['chat', 'vision', 'reasoning'] },
  { id: 'gemma-4-12b', name: 'Gemma 4 12B', by: 'Google', repo: 'unsloth/gemma-4-12b-it-GGUF', params: '12B', sizeGB: 7.5, tags: ['chat', 'vision'] },
  { id: 'gpt-oss-20b', name: 'gpt-oss 20B', by: 'OpenAI', repo: 'ggml-org/gpt-oss-20b-GGUF', quant: 'MXFP4', params: '20B · MoE', sizeGB: 12.1, moe: true, tags: ['chat', 'reasoning', 'tools'] },
  { id: 'gemma-4-26b-a4b', name: 'Gemma 4 26B A4B', by: 'Google', repo: 'unsloth/gemma-4-26B-A4B-it-GGUF', params: '26B · MoE', sizeGB: 16.0, moe: true, tags: ['chat', 'vision', 'tools'] },
  { id: 'qwen3.8-27b', name: 'Qwen3.8 27B', by: 'Qwen', repo: 'unsloth/Qwen3.8-27B-GGUF', params: '27B', sizeGB: 16.5, tags: ['chat', 'reasoning', 'tools'] },
  { id: 'embeddinggemma-300m', name: 'EmbeddingGemma 300M', by: 'Google', repo: 'ggml-org/embeddinggemma-300M-GGUF', quant: 'Q8_0', params: '300M', sizeGB: 0.33, tags: ['embedding'], role: 'embed' },
  { id: 'qwen3-reranker-0.6b', name: 'Qwen3 Reranker 0.6B', by: 'Qwen', repo: 'ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF', quant: 'Q8_0', params: '0.6B', sizeGB: 0.64, tags: ['rerank'], role: 'rerank' },
  { id: 'qwen2.5-coder-7b', name: 'Qwen2.5 Coder 7B', by: 'Qwen', repo: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF', params: '7B', sizeGB: 4.7, tags: ['code', 'tools'] },
  { id: 'qwen3-coder-30b', name: 'Qwen3 Coder 30B A3B', by: 'Qwen', repo: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', params: '30B · MoE', sizeGB: 18.6, moe: true, tags: ['code', 'tools'] },
  { id: 'qwen3.6-35b-a3b', name: 'Qwen3.6 35B A3B', by: 'Qwen', repo: 'unsloth/Qwen3.6-35B-A3B-GGUF', params: '35B · MoE', sizeGB: 21.0, moe: true, tags: ['chat', 'vision', 'reasoning', 'tools'] },
  { id: 'gemma-4-31b', name: 'Gemma 4 31B', by: 'Google', repo: 'unsloth/gemma-4-31B-it-GGUF', params: '31B', sizeGB: 19.0, tags: ['chat', 'vision'] },
];

const QUANT_RE = /(IQ\d_[A-Z]+|Q\d_K_[SMLX]{1,2}|Q\d_K|Q\d_\d|Q\d_0|MXFP4(?:_MOE)?|BF16|F16|F32|TQ\d_\d)/i;
const QUANT_PREF = ['Q4_K_M', 'MXFP4', 'MXFP4_MOE', 'Q4_K_XL', 'Q4_K_S', 'IQ4_XS', 'Q4_0', 'Q5_K_M', 'Q6_K', 'Q8_0'];

const modelsDir = () => path.join(app.getPath('userData'), 'models');
const indexFile = () => path.join(modelsDir(), 'index.json');
let emit = () => {};
const downloads = new Map();

// ---- Fit estimation -----------------------------------------------------
// great / good / ok = runs · needs-gpu = fits in RAM but far too slow without a GPU · too-big = does not fit
const CPU_MAX_DENSE_GB = 5.5;   // dense models above this are unusable on CPU only
const BLOCKED = new Set(['needs-gpu', 'too-big']);
function fitFor(sizeGB, specs, moe = false) {
  const need = sizeGB * 1.12 + 0.8; // weights + KV cache/context overhead
  const { gpuBudgetGB: g, ramBudgetGB: r } = specs;
  if (g && need <= g) return 'great';                          // fully on GPU
  if (g && need <= g + r) return moe ? 'good' : 'ok';          // GPU + RAM offload
  if (!g) {
    if (need > r) return 'too-big';
    if (!moe && sizeGB > CPU_MAX_DENSE_GB) return 'needs-gpu';
    return sizeGB <= 3.5 || moe ? 'good' : 'ok';               // CPU only
  }
  return 'too-big';
}

const DEFAULT_MODEL = 'gemma-4-e4b';
async function catalog() {
  const specs = await system.getSpecs();
  const installed = await listLocal();
  const items = CATALOG.map((m) => ({
    ...m,
    fit: fitFor(m.sizeGB, specs, m.moe),
    blocked: BLOCKED.has(fitFor(m.sizeGB, specs, m.moe)),
    installed: installed.some((x) => x.repo === m.repo),
  }));
  const rank = { great: 3, good: 2, ok: 1, 'too-big': 0 };
  const general = items.filter((m) => m.tags.includes('chat'));
  rank['needs-gpu'] = -1;
  const usable = general.filter((m) => !m.blocked);
  const best = [...usable].sort((a, b) => rank[b.fit] - rank[a.fit] || b.sizeGB - a.sizeGB)
    .find((m) => m.fit === 'great' || m.fit === 'good') || usable[0] || null;
  // Gemma 4 E4B is Fabro's default model whenever this computer can run it.
  const def = usable.find((m) => m.id === DEFAULT_MODEL && m.fit !== 'too-big');
  return { items, recommended: (def || best || {}).id || null, specs };
}

// ---- Hugging Face -------------------------------------------------------
const hfHeaders = () => { const t = store.getSettings().hfToken; return t ? { Authorization: `Bearer ${t}` } : {}; };

async function hf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Fabro', ...hfHeaders() } });
  if (!r.ok) throw new Error(`Hugging Face ${r.status}`);
  return r.json();
}

async function search(q) {
  const u = new URL('https://huggingface.co/api/models');
  u.searchParams.set('search', q);
  u.searchParams.set('filter', 'gguf');
  u.searchParams.set('sort', 'downloads');
  u.searchParams.set('direction', '-1');
  u.searchParams.set('limit', '24');
  const list = await hf(u.toString());
  return list.map((m) => ({ repo: m.id, downloads: m.downloads, likes: m.likes, updated: m.lastModified }));
}

// Group a repo's GGUF files into downloadable variants (handles split files + mmproj).
async function repoFiles(repo) {
  const specs = await system.getSpecs();
  const tree = await hf(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`);
  const files = tree.filter((f) => f.type === 'file' && /\.gguf$/i.test(f.path));
  const mmprojs = files.filter((f) => /mmproj/i.test(f.path));
  const weights = files.filter((f) => !/mmproj/i.test(f.path));
  const groups = new Map();
  for (const f of weights) {
    const base = f.path.replace(/-\d{5}-of-\d{5}\.gguf$/i, '.gguf');
    const g = groups.get(base) || { file: base, parts: [], size: 0, sha: {} };
    g.parts.push(f.path);
    if (f.lfs && f.lfs.oid) g.sha[f.path] = f.lfs.oid;
    g.size += (f.lfs && f.lfs.size) || f.size || 0;
    groups.set(base, g);
  }
  const mm = mmprojs.sort((a, b) => (/f16/i.test(b.path) - /f16/i.test(a.path)) || a.size - b.size)[0];
  const mmSha = mm && mm.lfs && mm.lfs.oid;
  const out = [...groups.values()].map((g) => {
    g.parts.sort();
    const q = (path.basename(g.file).match(QUANT_RE) || [])[1] || '';
    const sizeGB = g.size / 2 ** 30;
    const fit = fitFor(sizeGB, specs, /\bA\d+B\b|MoE/i.test(repo));
    if (mm && mmSha) g.sha[mm.path] = mmSha;
    return { ...g, quant: q.toUpperCase(), sizeGB: +sizeGB.toFixed(2), mmproj: mm ? mm.path : null, mmprojSize: mm ? ((mm.lfs && mm.lfs.size) || mm.size || 0) : 0, fit, blocked: BLOCKED.has(fit) };
  });
  const pi = (q) => { const i = QUANT_PREF.indexOf(q); return i < 0 ? 99 : i; };
  out.sort((a, b) => a.sizeGB - b.sizeGB);
  // preferred = best quant that this machine can run (else best quant overall)
  const byQuant = [...out].sort((a, b) => pi(a.quant) - pi(b.quant));
  const best = byQuant.find((f) => !f.blocked) || byQuant[0];
  return { repo, files: out, preferred: best && best.file };
}

async function readIndex() { try { return JSON.parse(await fsp.readFile(indexFile(), 'utf8')); } catch { return []; } }
async function writeIndex(list) {
  await fsp.mkdir(modelsDir(), { recursive: true }); await store.writeJSON(indexFile(), list);
  // For the Windows uninstaller ("also delete my data"): Fabro-made model folders outside the app data.
  try {
    const ud = app.getPath('userData');
    const dirs = [...new Set(list.filter((m) => !m.imported && m.path).map((m) => path.dirname(m.path)))].filter((d) => path.relative(ud, d).startsWith('..') && /__/.test(path.basename(d)));
    await fsp.writeFile(path.join(ud, 'uninstall-paths.txt'), dirs.join('\r\n') + (dirs.length ? '\r\n' : ''), 'utf8');
  } catch {}
}

async function listLocal() {
  return (await readIndex()).filter((m) => fs.existsSync(m.path));
}

function prettyName(repo, quant) {
  const base = repo.split('/')[1].replace(/-GGUF$/i, '').replace(/[-_]/g, ' ');
  return quant ? `${base} · ${quant}` : base;
}

// ───────────────────────────── libraries (storage per model) ─────────────────────────────
function libraries() {
  const s = store.getSettings();
  const extra = (s.libraries || []).filter((l) => l && l.id && l.path);
  return [{ id: 'default', name: 'Fabro', path: modelsDir(), builtin: true }, ...extra];
}
const libById = (id) => libraries().find((l) => l.id === id) || libraries()[0];
function freeBytes(p) { try { const st = fs.statfsSync(p); return st.bavail * st.bsize; } catch { return null; } }
async function librariesView() {
  const idx = await listLocal();
  const def = store.getSettings().defaultLibrary || 'default';
  return libraries().map((l) => {
    fs.mkdirSync(l.path, { recursive: true });
    const models = idx.filter((m) => (m.library || 'default') === l.id && !m.imported);
    return { ...l, isDefault: l.id === def, free: freeBytes(l.path), used: models.reduce((n, m) => n + (m.sizeBytes || 0), 0), count: models.length };
  });
}
async function addLibrary(dir) {
  const real = path.resolve(dir);
  if (libraries().some((l) => path.resolve(l.path) === real)) return librariesView();
  fs.mkdirSync(real, { recursive: true });
  const id = 'lib-' + Date.now().toString(36);
  const name = path.basename(real) || real;
  await store.setSettings({ libraries: [...(store.getSettings().libraries || []), { id, name, path: real }] });
  return librariesView();
}
async function removeLibrary(id) {
  if (id === 'default') return librariesView();
  if ((await listLocal()).some((m) => m.library === id && !m.imported)) throw new Error('LIBRARY_NOT_EMPTY');
  const s = store.getSettings();
  await store.setSettings({ libraries: (s.libraries || []).filter((l) => l.id !== id), ...(s.defaultLibrary === id ? { defaultLibrary: 'default' } : {}) });
  return librariesView();
}
async function setDefaultLibrary(id) { await store.setSettings({ defaultLibrary: libById(id).id }); return librariesView(); }

// ───────────────────────────── integrity ─────────────────────────────
function sha256(file, onProgress) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    let n = 0, last = 0;
    const total = (() => { try { return fs.statSync(file).size; } catch { return 0; } })();
    fs.createReadStream(file, { highWaterMark: 4 << 20 })
      .on('data', (c) => { h.update(c); n += c.length; const now = Date.now(); if (onProgress && now - last > 250) { last = now; onProgress(n, total); } })
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

async function verify(id) {
  const idx = await readIndex();
  const m = idx.find((x) => x.id === id);
  if (!m) throw new Error('Model not found');
  let expected = m.sha256 || {};
  if (!Object.keys(expected).length && m.repo && !m.imported) {
    try { const info = await repoFiles(m.repo); const v = info.files.find((f) => f.file === m.file); if (v) expected = Object.fromEntries(Object.entries(v.sha).map(([k, h]) => [path.basename(k), h])); } catch {}
  }
  if (!Object.keys(expected).length && m.source === 'ollama') expected = { [path.basename(m.path)]: path.basename(m.path).replace(/^sha256-/, '') };
  const files = [...(m.parts || [m.path]), m.mmproj].filter(Boolean);
  const total = files.reduce((n, f) => { try { return n + fs.statSync(f).size; } catch { return n; } }, 0);
  let done = 0;
  const result = { id, ok: true, checked: 0, unknown: 0, bad: [] };
  for (const f of files) {
    if (!fs.existsSync(f)) { result.ok = false; result.bad.push(path.basename(f) + ' (missing)'); continue; }
    const want = expected[path.basename(f)];
    if (!want) { result.unknown++; done += fs.statSync(f).size; continue; }
    const got = await sha256(f, (n) => emit({ id, kind: 'verify', status: 'verifying', received: done + n, total }));
    done += fs.statSync(f).size;
    result.checked++;
    if (got !== want) { result.ok = false; result.bad.push(path.basename(f)); }
  }
  m.verifiedAt = Date.now(); m.verifyOk = result.ok;
  if (Object.keys(expected).length) m.sha256 = expected;
  await writeIndex(idx);
  emit({ id, kind: 'verify', status: 'verified', result });
  return result;
}

// ───────────────────────────── downloads: queue, pause, speed limit ─────────────────────────────
const dlFile = () => path.join(modelsDir(), 'downloads.json');
const publicDl = (d) => { const { ctrl, plan, pauseFlag, ...x } = d; return x; };
function persistDownloads() {
  const keep = [...downloads.values()].filter((d) => ['queued', 'downloading', 'paused'].includes(d.status)).map((d) => ({ ...publicDl(d), status: d.status === 'downloading' ? 'paused' : d.status, plan: d.plan }));
  try { fs.writeFileSync(dlFile(), JSON.stringify(keep)); } catch {}
}
function dlSettings() { const s = store.getSettings().downloads || {}; return { maxConcurrent: Math.max(1, s.maxConcurrent || 1), limitMBps: Math.max(0, Number(s.limitMBps) || 0) }; }
function report(d, extra = {}) { Object.assign(d, extra); emit(publicDl(d)); }

// Start (or queue) a download. Resolves to the download id immediately.
async function download({ repo, file, catalogId, library }) {
  const info = await repoFiles(repo);
  const v = info.files.find((f) => f.file === (file || info.preferred));
  if (!v) throw new Error('File not found in repository');
  if (v.blocked) { const e = new Error(v.fit === 'needs-gpu' ? 'NEEDS_GPU' : 'TOO_BIG'); throw e; }
  const id = `${repo}/${v.file}`;
  if (downloads.has(id)) { const d = downloads.get(id); if (d.status === 'paused') resume(id); return id; }
  const lib = libById(library || store.getSettings().defaultLibrary || 'default');
  const need = v.size + (v.mmprojSize || 0);
  const free = freeBytes(lib.path);
  if (free != null && free < need * 1.02) { const e = new Error('NO_SPACE'); e.detail = `${(need / 2 ** 30).toFixed(1)} GB needed, ${(free / 2 ** 30).toFixed(1)} GB free`; throw e; }
  const d = { id, repo, file: v.file, received: 0, total: need, status: 'queued', catalogId, library: lib.id, libraryName: lib.name,
    plan: { parts: v.parts, mmproj: v.mmproj, sha: v.sha, quant: v.quant, size: v.size } };
  downloads.set(id, d);
  report(d);
  persistDownloads();
  pump();
  return id;
}

function pump() {
  const { maxConcurrent } = dlSettings();
  const active = [...downloads.values()].filter((d) => d.status === 'downloading' || d.status === 'verifying').length;
  const next = [...downloads.values()].filter((d) => d.status === 'queued');
  for (let i = 0; i < Math.min(next.length, maxConcurrent - active); i++) run(next[i]);
}

async function run(d) {
  const { repo, plan: v } = d;
  const lib = libById(d.library);
  const dir = path.join(lib.path, repo.replace('/', '__'));
  const urlOf = (p) => `https://huggingface.co/${repo}/resolve/main/${p.split('/').map(encodeURIComponent).join('/')}?download=true`;
  d.ctrl = new AbortController(); d.pauseFlag = false;
  report(d, { status: 'downloading', error: null });
  persistDownloads();
  try {
    let doneBytes = 0;
    const t0 = Date.now();
    let speedBase = null;
    const all = [...v.parts];
    if (v.mmproj) all.push(v.mmproj);
    const paths = [];
    for (const p of all) {
      const dest = path.join(dir, path.basename(p));
      paths.push(dest);
      if (fs.existsSync(dest)) { try { doneBytes += fs.statSync(dest).size; } catch {} continue; }
      await downloadFile(urlOf(p), dest, {
        signal: d.ctrl.signal, headers: hfHeaders(),
        limit: () => { const { limitMBps } = dlSettings(); const n = [...downloads.values()].filter((x) => x.status === 'downloading').length || 1; return limitMBps ? (limitMBps * 1e6) / n : 0; },
        onProgress: (n) => {
          const received = doneBytes + n;
          if (!speedBase) speedBase = { t: Date.now(), n: received };
          const secs = Math.max(1, (Date.now() - speedBase.t) / 1000);
          report(d, { received, total: Math.max(d.total, received), speed: (received - speedBase.n) / secs });
        },
      });
      const sha = v.sha && v.sha[p];
      if (sha) {
        report(d, { status: 'verifying' });
        const got = await sha256(dest, (n, total) => report(d, { verifyProgress: total ? n / total : 0 }));
        if (got !== sha) { await fsp.rm(dest, { force: true }); throw Object.assign(new Error('INTEGRITY'), { detail: `${path.basename(p)}: sha256 mismatch` }); }
        report(d, { status: 'downloading' });
      }
      try { doneBytes += fs.statSync(dest).size; } catch {}
    }
    const shape = memory.shapeOf(paths[0]);
    const entry = {
      id: d.id, repo, file: d.file, quant: v.quant || (shape && shape.fileType) || '', catalogId: d.catalogId || null,
      name: (CATALOG.find((c) => c.id === d.catalogId) || {}).name || prettyName(repo, v.quant),
      role: (CATALOG.find((c) => c.id === d.catalogId) || {}).role || roleOf(repo, shape),
      path: paths[0], parts: paths.slice(0, v.parts.length), mmproj: v.mmproj ? paths[paths.length - 1] : null,
      sizeBytes: v.size, vision: !!v.mmproj, addedAt: Date.now(), library: lib.id, source: 'hf',
      sha256: Object.fromEntries(Object.entries(v.sha || {}).map(([k, h]) => [path.basename(k), h])), verifiedAt: Date.now(), verifyOk: true,
      arch: shape && shape.arch, moe: shape && shape.moe, ctxTrain: shape && shape.ctxTrain,
    };
    const idx = (await readIndex()).filter((m) => m.id !== d.id);
    idx.push(entry);
    await writeIndex(idx);
    downloads.delete(d.id);
    report(d, { status: 'done', received: d.total, model: entry, elapsed: Date.now() - t0 });
  } catch (e) {
    if (d.ctrl.signal.aborted && d.pauseFlag) { report(d, { status: 'paused', speed: 0 }); }
    else if (d.ctrl.signal.aborted) { downloads.delete(d.id); report(d, { status: 'cancelled' }); }
    else { downloads.delete(d.id); report(d, { status: 'error', error: e.message === 'INTEGRITY' ? 'INTEGRITY' : e.message, detail: e.detail || '' }); }
  } finally {
    persistDownloads();
    pump();
  }
}

function pause(id) {
  const d = downloads.get(id); if (!d) return false;
  if (d.status === 'downloading') { d.pauseFlag = true; d.ctrl.abort(); }
  else if (d.status === 'queued') report(d, { status: 'paused' });
  persistDownloads();
  return true;
}
function resume(id) {
  const d = downloads.get(id); if (!d || d.status !== 'paused') return false;
  report(d, { status: 'queued' }); persistDownloads(); pump(); return true;
}
async function cancel(id) {
  const d = downloads.get(id); if (!d) return true;
  if (d.status === 'downloading') d.ctrl.abort();
  downloads.delete(id);
  report(d, { status: 'cancelled' });
  const dir = path.join(libById(d.library).path, d.repo.replace('/', '__'));
  for (const p of [...(d.plan.parts || []), d.plan.mmproj].filter(Boolean)) await fsp.rm(path.join(dir, path.basename(p)) + '.part', { force: true }).catch(() => {});
  persistDownloads();
  return true;
}

// ───────────────────────────── move between disks ─────────────────────────────
async function copyWithProgress(src, dest, onBytes) {
  await new Promise((resolve, reject) => {
    const r = fs.createReadStream(src, { highWaterMark: 8 << 20 });
    const w = fs.createWriteStream(dest + '.moving');
    r.on('data', (c) => onBytes(c.length));
    r.on('error', reject); w.on('error', reject);
    w.on('finish', resolve);
    r.pipe(w);
  });
  await fsp.rename(dest + '.moving', dest);
}

async function move(id, libraryId, beforeMove) {
  const idx = await readIndex();
  const m = idx.find((x) => x.id === id);
  if (!m) throw new Error('Model not found');
  if (m.imported) throw new Error('IMPORTED');
  const lib = libById(libraryId);
  if ((m.library || 'default') === lib.id) return m;
  const files = [...(m.parts || [m.path]), m.mmproj].filter(Boolean);
  const total = files.reduce((n, f) => { try { return n + fs.statSync(f).size; } catch { return n; } }, 0);
  const free = freeBytes(lib.path);
  if (free != null && free < total * 1.02) { const e = new Error('NO_SPACE'); e.detail = `${(total / 2 ** 30).toFixed(1)} GB needed`; throw e; }
  if (beforeMove) await beforeMove(m);
  const dir = path.join(lib.path, (m.repo || 'imported').replace('/', '__'));
  await fsp.mkdir(dir, { recursive: true });
  let done = 0;
  const map = {};
  emit({ id, kind: 'move', status: 'moving', received: 0, total });
  for (const f of files) {
    const dest = path.join(dir, path.basename(f));
    map[f] = dest;
    try { await fsp.rename(f, dest); done += fs.statSync(dest).size; emit({ id, kind: 'move', status: 'moving', received: done, total }); continue; } catch { /* other disk */ }
    await copyWithProgress(f, dest, (n) => { done += n; emit({ id, kind: 'move', status: 'moving', received: done, total }); });
    if (fs.statSync(dest).size !== fs.statSync(f).size) throw new Error('Copy size mismatch');
    await fsp.rm(f, { force: true });
  }
  const oldDir = path.dirname(m.path);
  m.path = map[m.path]; if (m.parts) m.parts = m.parts.map((p) => map[p]); if (m.mmproj) m.mmproj = map[m.mmproj];
  m.library = lib.id;
  await writeIndex(idx);
  try { if (!(await fsp.readdir(oldDir)).length) await fsp.rmdir(oldDir); } catch {}
  emit({ id, kind: 'move', status: 'moved', library: lib.id });
  return m;
}

// ───────────────────────────── import (no copy) ─────────────────────────────
const isGguf = (f) => { try { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.toString('ascii') === 'GGUF'; } catch { return false; } };
const home = () => os.homedir();

function ollamaRoots() {
  return [process.env.OLLAMA_MODELS, path.join(home(), '.ollama', 'models'), process.platform === 'linux' ? '/usr/share/ollama/.ollama/models' : null].filter(Boolean);
}
async function scanOllama() {
  const out = [];
  for (const rootDir of ollamaRoots()) {
    const man = path.join(rootDir, 'manifests');
    if (!fs.existsSync(man)) continue;
    const walk = async (d, depth = 0) => {
      for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(d, e.name);
        if (e.isDirectory() && depth < 5) await walk(full, depth + 1);
        else if (e.isFile()) {
          try {
            const j = JSON.parse(await fsp.readFile(full, 'utf8'));
            const blob = (mt) => { const l = (j.layers || []).find((x) => x.mediaType === mt); return l ? path.join(rootDir, 'blobs', l.digest.replace(':', '-')) : null; };
            const model = blob('application/vnd.ollama.image.model');
            if (!model || !fs.existsSync(model) || !isGguf(model)) continue;
            const rel = path.relative(man, full).split(path.sep);
            const name = `${rel[rel.length - 2]}:${rel[rel.length - 1]}`;
            const proj = blob('application/vnd.ollama.image.projector');
            out.push({ path: model, mmproj: proj && fs.existsSync(proj) ? proj : null, name, sizeBytes: fs.statSync(model).size, source: 'ollama' });
          } catch { /* not a manifest */ }
        }
      }
    };
    await walk(man);
  }
  return out;
}
async function scanDir(dir, source, depth = 5) {
  const out = [];
  const walk = async (d, lvl) => {
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    const ggufs = entries.filter((e) => e.isFile() && /\.gguf$/i.test(e.name));
    const mm = ggufs.find((e) => /mmproj/i.test(e.name));
    for (const e of ggufs) {
      if (/mmproj/i.test(e.name)) continue;
      if (/-0000[2-9]-of-|-000[1-9]\d-of-/i.test(e.name)) continue; // later split parts
      const full = path.join(d, e.name);
      out.push({ path: full, mmproj: mm ? path.join(d, mm.name) : null, name: e.name.replace(/\.gguf$/i, '').replace(/-00001-of-\d+$/i, ''), sizeBytes: fs.statSync(full).size, source });
    }
    if (lvl < depth) for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) await walk(path.join(d, e.name), lvl + 1);
  };
  if (fs.existsSync(dir)) await walk(dir, 0);
  return out;
}
async function scanImports(folder) {
  const idx = await readIndex();
  const known = new Set(idx.map((m) => path.resolve(m.path)));
  const lists = folder ? [await scanDir(folder, 'folder')] : await Promise.all([
    scanOllama(),
    scanDir(path.join(home(), '.lmstudio', 'models'), 'lmstudio'),
    scanDir(path.join(home(), '.cache', 'lm-studio', 'models'), 'lmstudio'),
  ]);
  const seen = new Set();
  return lists.flat().filter((c) => { const k = path.resolve(c.path); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((c) => ({ ...c, already: known.has(path.resolve(c.path)) }));
}
async function importModels(list) {
  const idx = await readIndex();
  const added = [];
  for (const c of list) {
    if (!c || !c.path || !fs.existsSync(c.path) || !isGguf(c.path)) continue;
    if (idx.some((m) => path.resolve(m.path) === path.resolve(c.path))) continue;
    const shape = memory.shapeOf(c.path) || {};
    const id = 'import:' + crypto.createHash('sha1').update(path.resolve(c.path)).digest('hex').slice(0, 16);
    const parts = /-00001-of-(\d+)\.gguf$/i.test(c.path)
      ? Array.from({ length: +c.path.match(/-of-(\d+)\.gguf$/i)[1] }, (_, i) => c.path.replace(/-00001-of-/, `-${String(i + 1).padStart(5, '0')}-of-`)) : [c.path];
    const entry = {
      id, name: c.name || shape.name || path.basename(c.path), file: path.basename(c.path), quant: shape.fileType || '', path: c.path, parts,
      mmproj: c.mmproj || null, vision: !!c.mmproj, sizeBytes: parts.reduce((n, p) => { try { return n + fs.statSync(p).size; } catch { return n; } }, 0),
      addedAt: Date.now(), imported: true, source: c.source || 'folder', arch: shape.arch, moe: shape.moe, ctxTrain: shape.ctxTrain,
      role: roleOf(c.name || path.basename(c.path), shape),
    };
    idx.push(entry); added.push(entry);
  }
  await writeIndex(idx);
  return added;
}

// ───────────────────────────── remove / list ─────────────────────────────
async function remove(id) {
  const idx = await readIndex();
  const m = idx.find((x) => x.id === id);
  if (m && !m.imported) {
    const keep = idx.filter((x) => x.id !== id);
    const stillUsed = new Set(keep.flatMap((x) => [...(x.parts || [x.path]), x.mmproj]));
    for (const f of [...(m.parts || [m.path]), m.mmproj].filter(Boolean)) if (!stillUsed.has(f)) await fsp.rm(f, { force: true });
    try { const dir = path.dirname(m.path); if (!(await fsp.readdir(dir)).length) await fsp.rmdir(dir); } catch {}
  }
  await writeIndex(idx.filter((x) => x.id !== id));
  const s = store.getSettings();
  if (s.modelProfiles && s.modelProfiles[id]) await store.setSettings({ modelProfiles: { [id]: null } });
  return true;
}

async function rename(id, name) {
  const idx = await readIndex(); const m = idx.find((x) => x.id === id);
  if (m && name && name.trim()) { m.name = name.trim().slice(0, 80); await writeIndex(idx); }
  return true;
}

// Embedding / reranker models are not chat models.
function roleOf(name, shape) {
  const n = String(name || '').toLowerCase(); const a = String((shape && shape.arch) || '').toLowerCase();
  if (/rerank/.test(n)) return 'rerank';
  if (/embed|bge-|e5-|gte-|nomic|minilm|jina-emb/.test(n) || /^(bert|nomic-bert|jina-bert|gemma-embedding|t5encoder)/.test(a)) return 'embed';
  return null;
}
async function getLocal(id) { return (await listLocal()).find((m) => m.id === id) || null; }

async function installed() {
  return { local: await listLocal(), downloads: [...downloads.values()].map(publicDl) };
}

// Memory plan for each local model with its current profile (for the UI).
async function plans(engineOptions) {
  const specs = await system.getSpecs();
  const out = {};
  for (const m of await listLocal()) { try { out[m.id] = memory.plan(m, engineOptions(m), specs); } catch {} }
  return out;
}

function init(emitter) {
  emit = emitter;
  fs.mkdirSync(modelsDir(), { recursive: true });
  try {
    for (const d of JSON.parse(fs.readFileSync(dlFile(), 'utf8'))) downloads.set(d.id, { ...d, status: 'paused', speed: 0 });
  } catch { /* none */ }
}

module.exports = {
  BLOCKED, init, catalog, search, repoFiles, download, pause, resume, cancel, remove, rename, installed, getLocal, CATALOG,
  librariesView, addLibrary, removeLibrary, setDefaultLibrary, verify, move, scanImports, importModels, plans,
};
