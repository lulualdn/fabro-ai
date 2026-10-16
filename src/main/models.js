// Model catalog, recommendations, Hugging Face GGUF search/download, Ollama listing.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');
const system = require('./system');
const { downloadFile } = require('./download');

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
  return { items, recommended: best && best.id, specs };
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
    const g = groups.get(base) || { file: base, parts: [], size: 0 };
    g.parts.push(f.path);
    g.size += (f.lfs && f.lfs.size) || f.size || 0;
    groups.set(base, g);
  }
  const mm = mmprojs.sort((a, b) => (/f16/i.test(b.path) - /f16/i.test(a.path)) || a.size - b.size)[0];
  const out = [...groups.values()].map((g) => {
    g.parts.sort();
    const q = (path.basename(g.file).match(QUANT_RE) || [])[1] || '';
    const sizeGB = g.size / 2 ** 30;
    const fit = fitFor(sizeGB, specs, /\bA\d+B\b|MoE/i.test(repo));
    return { ...g, quant: q.toUpperCase(), sizeGB: +sizeGB.toFixed(2), mmproj: mm ? mm.path : null, fit, blocked: BLOCKED.has(fit) };
  });
  const pi = (q) => { const i = QUANT_PREF.indexOf(q); return i < 0 ? 99 : i; };
  out.sort((a, b) => a.sizeGB - b.sizeGB);
  // preferred = best quant that this machine can run (else best quant overall)
  const byQuant = [...out].sort((a, b) => pi(a.quant) - pi(b.quant));
  const best = byQuant.find((f) => !f.blocked) || byQuant[0];
  return { repo, files: out, preferred: best && best.file };
}

async function readIndex() { try { return JSON.parse(await fsp.readFile(indexFile(), 'utf8')); } catch { return []; } }
async function writeIndex(list) { await fsp.mkdir(modelsDir(), { recursive: true }); await store.writeJSON(indexFile(), list); }

async function listLocal() {
  return (await readIndex()).filter((m) => fs.existsSync(m.path));
}

function prettyName(repo, quant) {
  const base = repo.split('/')[1].replace(/-GGUF$/i, '').replace(/[-_]/g, ' ');
  return quant ? `${base} · ${quant}` : base;
}

// Start a download. Resolves to the download id immediately.
async function download({ repo, file, catalogId }) {
  const info = await repoFiles(repo);
  const v = info.files.find((f) => f.file === (file || info.preferred));
  if (!v) throw new Error('File not found in repository');
  if (v.blocked) { const e = new Error(v.fit === 'needs-gpu' ? 'NEEDS_GPU' : 'TOO_BIG'); throw e; }
  const id = `${repo}/${v.file}`;
  if (downloads.has(id)) return id;
  const ctrl = new AbortController();
  const dl = { id, repo, file: v.file, received: 0, total: v.size, status: 'downloading', catalogId };
  downloads.set(id, { ...dl, ctrl });
  const dir = path.join(modelsDir(), repo.replace('/', '__'));
  const urlOf = (p) => `https://huggingface.co/${repo}/resolve/main/${p.split('/').map(encodeURIComponent).join('/')}?download=true`;
  const report = (p) => emit({ ...dl, ...p });

  (async () => {
    try {
      let doneBytes = 0;
      const t0 = Date.now();
      const all = [...v.parts];
      if (v.mmproj) all.push(v.mmproj);
      const paths = [];
      for (const p of all) {
        const dest = path.join(dir, path.basename(p));
        paths.push(dest);
        if (fs.existsSync(dest)) continue;
        await downloadFile(urlOf(p), dest, {
          signal: ctrl.signal, headers: hfHeaders(),
          onProgress: (n) => {
            const received = doneBytes + n;
            const total = Math.max(v.size, received);
            report({ received, total, speed: received / Math.max(1, (Date.now() - t0) / 1000) });
          },
        });
        try { doneBytes += (await fsp.stat(dest)).size; } catch {}
      }
      const entry = {
        id, repo, file: v.file, quant: v.quant, catalogId: catalogId || null,
        name: (CATALOG.find((c) => c.id === catalogId) || {}).name ? `${CATALOG.find((c) => c.id === catalogId).name}` : prettyName(repo, v.quant),
        path: paths[0], mmproj: v.mmproj ? paths[paths.length - 1] : null,
        sizeBytes: v.size, vision: !!v.mmproj, addedAt: Date.now(),
      };
      const idx = (await readIndex()).filter((m) => m.id !== id);
      idx.push(entry);
      await writeIndex(idx);
      report({ status: 'done', received: v.size, total: v.size, model: entry });
    } catch (e) {
      report({ status: ctrl.signal.aborted ? 'cancelled' : 'error', error: e.message });
    } finally { downloads.delete(id); }
  })();
  return id;
}

function cancel(id) { const d = downloads.get(id); if (d) d.ctrl.abort(); return true; }

async function remove(id) {
  const idx = await readIndex();
  const m = idx.find((x) => x.id === id);
  if (m) {
    const dir = path.dirname(m.path);
    const keep = idx.filter((x) => x.id !== id);
    const stillUsed = new Set(keep.flatMap((x) => [x.path, x.mmproj]));
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      const full = path.join(dir, f);
      const base = path.basename(m.file).replace(/\.gguf$/i, '');
      if ((f.startsWith(base) || full === m.mmproj) && !stillUsed.has(full)) await fsp.rm(full, { force: true });
    }
    await writeIndex(keep);
  }
  return true;
}

async function getLocal(id) { return (await listLocal()).find((m) => m.id === id) || null; }

// ---- Ollama --------------------------------------------------------------
async function ollama() {
  const base = store.getSettings().ollamaUrl.replace(/\/$/, '');
  try {
    const ctrl = AbortSignal.timeout(1500);
    const r = await fetch(`${base}/api/tags`, { signal: ctrl });
    if (!r.ok) return { available: false, models: [] };
    const j = await r.json();
    return {
      available: true,
      models: (j.models || []).map((m) => ({
        name: m.name, sizeBytes: m.size,
        params: m.details && m.details.parameter_size, quant: m.details && m.details.quantization_level,
      })),
    };
  } catch { return { available: false, models: [] }; }
}

async function installed() {
  return { local: await listLocal(), ollama: await ollama(), downloads: [...downloads.values()].map(({ ctrl, ...d }) => d) };
}

function init(emitter) { emit = emitter; fs.mkdirSync(modelsDir(), { recursive: true }); }

module.exports = { BLOCKED, init, catalog, search, repoFiles, download, cancel, remove, installed, getLocal, CATALOG };
