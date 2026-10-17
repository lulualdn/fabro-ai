// Projects knowledge: files are copied into the project, split into chunks, indexed in SQLite FTS5
// (always) and embedded with a local embedding model (when installed) for semantic search; an optional
// local reranker sorts the best passages. Hybrid search = BM25 + vectors fused (RRF), then rerank.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const db = require('./db');
const store = require('./store');
const engine = require('./engine');
const models = require('./models');

let emit = () => {};
const pdir = (pid) => path.join(app.getPath('userData'), 'projects', pid, 'files');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ───────────────────────────── text extraction ─────────────────────────────
const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|lua|luau|html?|css|scss|xml|ya?ml|toml|ini|cfg|conf|sh|bat|ps1|c|h|cpp|hpp|cs|java|kt|go|rs|php|rb|sql|swift|log|vue|svelte|tex|rst|srt|vtt)$/i;
async function extract(file) {
  if (/\.pdf$/i.test(file)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(await fsp.readFile(file)), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 2000); i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      let line = '', out = '', lastY = null;
      for (const it of c.items) { const y = it.transform && it.transform[5]; if (lastY != null && Math.abs(y - lastY) > 2) { out += line.trim() + '\n'; line = ''; } line += it.str + (it.hasEOL ? '\n' : ''); lastY = y; }
      out += line;
      pages.push(`[page ${i}]\n${out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()}`);
    }
    await doc.destroy();
    return pages.join('\n\n');
  }
  if (/\.docx$/i.test(file)) return require('./agent/files').docxText(file);
  if (/\.(xlsx|pptx|odt)$/i.test(file)) return officeText(file);
  if (/\.html?$/i.test(file)) return require('./tools').htmlToText(await fsp.readFile(file, 'utf8')).text;
  const buf = await fsp.readFile(file);
  if (!TEXT_EXT.test(file) && buf.subarray(0, 8000).includes(0)) throw Object.assign(new Error('Unsupported file type'), { code: 'UNSUPPORTED' });
  return buf.toString('utf8');
}
async function officeText(file) {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-office-'));
  try {
    await require('extract-zip')(file, { dir: tmp });
    const xmls = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/(sharedStrings|slide\d+|sheet\d+|content)\.xml$/.test(e.name)) xmls.push(f); } };
    walk(tmp);
    return xmls.sort().map((f) => fs.readFileSync(f, 'utf8').replace(/<\/(a:p|text:p|si|row)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ')).join('\n').replace(/\n\s*\n+/g, '\n');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Chunks of ~1200 chars with overlap, cut at paragraph / sentence boundaries.
function chunk(text, size = 1200, overlap = 180) {
  const t = String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) {
      const win = t.slice(i + size * 0.6, end);
      const cut = Math.max(win.lastIndexOf('\n\n'), win.lastIndexOf('. '), win.lastIndexOf('\n'));
      if (cut > 0) end = i + Math.floor(size * 0.6) + cut + 1;
    }
    const piece = t.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

// ───────────────────────────── local models ─────────────────────────────
async function modelFor(role) {
  const pref = (store.getSettings().rag || {})[role === 'embed' ? 'embedModel' : 'rerankModel'];
  const list = (await models.installed()).local.filter((m) => m.role === role);
  return list.find((m) => m.id === pref) || list[0] || null;
}
async function server(role) {
  const m = await modelFor(role);
  if (!m) return null;
  const inst = await engine.ensure(m, { role, ctx: role === 'embed' ? 2048 : 4096, preload: 'demand', idleMinutes: 10 });
  return { m, base: `http://127.0.0.1:${inst.port}`, inst };
}
async function embed(texts, kind = 'doc') {
  const s = await server('embed');
  if (!s) return null;
  // EmbeddingGemma / Qwen3-Embedding expect task prefixes.
  const g = /gemma/i.test(s.m.name), qw = /qwen/i.test(s.m.name);
  const input = texts.map((t) => (g ? (kind === 'query' ? `task: search result | query: ${t}` : `title: none | text: ${t}`) : qw && kind === 'query' ? `Instruct: Given a question, retrieve passages that answer it\nQuery: ${t}` : t));
  const out = [];
  engine.acquire(s.inst);
  try {
    for (let i = 0; i < input.length; i += 16) {
      const r = await fetch(`${s.base}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: input.slice(i, i + 16), model: s.m.name }) });
      if (!r.ok) throw new Error(`Embedding server ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      for (const d of j.data.sort((a, b) => a.index - b.index)) out.push(normalize(d.embedding));
    }
  } finally { engine.release(s.inst); }
  return { model: s.m.id, vecs: out };
}
function normalize(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }
async function rerank(query, docs) {
  const s = await server('rerank');
  if (!s || !docs.length) return null;
  engine.acquire(s.inst);
  try {
    const r = await fetch(`${s.base}/v1/rerank`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, documents: docs, top_n: docs.length }) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.results || []).map((x) => ({ index: x.index, score: x.relevance_score }));
  } catch { return null; } finally { engine.release(s.inst); }
}

// ───────────────────────────── indexing ─────────────────────────────
const queue = [];
let busy = false;
async function addFiles(pid, paths) {
  fs.mkdirSync(pdir(pid), { recursive: true });
  const added = [];
  for (const src of paths) {
    try {
      const st = fs.statSync(src);
      if (!st.isFile() || st.size > 200 << 20) continue;
      const id = 'pf-' + uid();
      let name = path.basename(src); let dest = path.join(pdir(pid), name);
      if (fs.existsSync(dest)) { name = name.replace(/(\.[^.]+)?$/, ` (${id.slice(-4)})$1`); dest = path.join(pdir(pid), name); }
      await fsp.copyFile(src, dest);
      db.addProjectFile({ id, projectId: pid, name, path: dest, size: st.size });
      added.push(id); queue.push({ pid, id, path: dest });
    } catch {}
  }
  pump();
  return db.getProject(pid);
}
async function addText(pid, name, text) {
  fs.mkdirSync(pdir(pid), { recursive: true });
  const id = 'pf-' + uid(); const dest = path.join(pdir(pid), name.replace(/[\\/:*?"<>|]/g, '_'));
  await fsp.writeFile(dest, text, 'utf8');
  db.addProjectFile({ id, projectId: pid, name: path.basename(dest), path: dest, size: Buffer.byteLength(text) });
  queue.push({ pid, id, path: dest }); pump();
  return db.getProject(pid);
}
async function pump() {
  if (busy) return; busy = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        db.setProjectFile(job.id, { status: 'reading' }); emit('projects:file', { pid: job.pid, id: job.id, status: 'reading' });
        const text = await extract(job.path);
        const parts = chunk(text);
        db.addChunks(job.pid, job.id, parts.map((t, i) => ({ idx: i, text: t })));
        db.setProjectFile(job.id, { status: 'indexed', chunks: parts.length });
        emit('projects:file', { pid: job.pid, id: job.id, status: 'indexed', chunks: parts.length });
        await embedProject(job.pid).catch(() => {});
      } catch (e) {
        db.setProjectFile(job.id, { status: 'error', error: e.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : String(e.message).slice(0, 200) });
        emit('projects:file', { pid: job.pid, id: job.id, status: 'error', error: e.message });
      }
    }
  } finally { busy = false; }
}
// Embed every chunk of the project that has no vector for the current embedding model.
async function embedProject(pid) {
  const m = await modelFor('embed');
  if (!m) return { semantic: false };
  const todo = db.chunksWithoutVec(pid, m.id);
  for (let i = 0; i < todo.length; i += 64) {
    const slice = todo.slice(i, i + 64);
    const r = await embed(slice.map((c) => c.text), 'doc');
    if (!r) break;
    db.setChunkVecs(slice.map((c, k) => ({ id: c.id, vec: r.vecs[k], model: r.model })));
    emit('projects:embed', { pid, done: Math.min(todo.length, i + 64), total: todo.length });
  }
  return { semantic: true, embedded: todo.length };
}

// ───────────────────────────── search ─────────────────────────────
async function search(pid, query, k = 6) {
  const files = Object.fromEntries(db.listProjectFiles(pid).map((f) => [f.id, f.name]));
  const lex = db.ftsChunks(pid, query, 40);
  let sem = [], semantic = false;
  const m = await modelFor('embed').catch(() => null);
  if (m) {
    try {
      const rows = db.vecChunks(pid, m.id);
      if (rows.length) {
        const q = await embed([query], 'query');
        const qv = q.vecs[0];
        sem = rows.map((r) => { let d = 0; for (let i = 0; i < qv.length; i++) d += qv[i] * r.vec[i]; return { ...r, vec: undefined, score: d }; })
          .sort((a, b) => b.score - a.score).slice(0, 40);
        semantic = true;
      }
    } catch {}
  }
  // Reciprocal rank fusion
  const fused = new Map();
  const add = (list, w) => list.forEach((r, i) => { const cur = fused.get(r.id) || { ...r, rrf: 0 }; cur.rrf += w / (60 + i); fused.set(r.id, cur); });
  add(lex, semantic ? 0.6 : 1); add(sem, 1);
  let top = [...fused.values()].sort((a, b) => b.rrf - a.rrf).slice(0, Math.max(k * 3, 12));
  let reranked = false;
  if (top.length > k) {
    const rr = await rerank(query, top.map((t) => t.text)).catch(() => null);
    if (rr && rr.length) { top = rr.sort((a, b) => b.score - a.score).map((x) => top[x.index]).filter(Boolean); reranked = true; }
  }
  return { semantic, reranked, results: top.slice(0, k).map((r) => ({ file: files[r.file_id] || '?', fileId: r.file_id, idx: r.idx, text: r.text })) };
}

// What to give the model: the whole project when it is small, else the best passages for the question.
async function context(pid, query) {
  const p = db.getProject(pid);
  if (!p) return null;
  const total = db.projectChars(pid);
  let files = '';
  if (total && total < 24000) {
    const byFile = {};
    for (const r of db.projectText(pid)) (byFile[r.name] ||= []).push(r.text);
    files = Object.entries(byFile).map(([n, parts]) => `<file name="${n}">\n${dedupe(parts)}\n</file>`).join('\n');
  } else if (total && query) {
    const s = await search(pid, query, 6);
    files = s.results.map((r, i) => `<excerpt n="${i + 1}" file="${r.file}">\n${r.text}\n</excerpt>`).join('\n');
  }
  return { project: p, files, full: total < 24000 };
}
// Overlapping chunks → original text (good enough for display to the model).
function dedupe(parts) { let out = ''; for (const p of parts) { const ov = overlapLen(out, p); out += (out ? (ov ? '' : '\n') : '') + p.slice(ov); } return out; }
function overlapLen(a, b) { for (let n = Math.min(300, a.length, b.length); n > 20; n--) if (a.endsWith(b.slice(0, n))) return n; return 0; }

async function status() {
  const e = await modelFor('embed'), r = await modelFor('rerank');
  return { embed: e && { id: e.id, name: e.name }, rerank: r && { id: r.id, name: r.name } };
}
function removeFile(pid, id) { const f = db.listProjectFiles(pid).find((x) => x.id === id); if (f) { try { fs.rmSync(f.path, { force: true }); } catch {} db.deleteProjectFile(id); } return db.getProject(pid); }
function removeProject(pid) { db.deleteProject(pid); try { fs.rmSync(path.join(app.getPath('userData'), 'projects', pid), { recursive: true, force: true }); } catch {} return true; }
async function reindexAll() { for (const p of db.listProjects()) await embedProject(p.id).catch(() => {}); }
function init(emitter) { emit = emitter; }

module.exports = { init, extract, chunk, addFiles, addText, search, context, status, removeFile, removeProject, embedProject, reindexAll };
