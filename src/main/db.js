// SQLite storage (node:sqlite, bundled with Electron): conversations with full-text
// search, memories and artifacts. Old JSON conversations are imported on first run.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let db = null;
const file = () => path.join(app.getPath('userData'), 'fabro.db');

function init() {
  if (db) return db;
  db = new DatabaseSync(file());
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, created INTEGER, updated INTEGER,
      pinned INTEGER DEFAULT 0, agent INTEGER DEFAULT 0, project TEXT, has_artifact INTEGER DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conv_updated ON conversations(updated DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS conv_fts USING fts5(conv_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, text TEXT NOT NULL, created INTEGER, updated INTEGER, source TEXT, kind TEXT DEFAULT 'fact'
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY, conv_id TEXT, type TEXT, title TEXT, created INTEGER, updated INTEGER, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS art_updated ON artifacts(updated DESC);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, created INTEGER, updated INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_files (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, path TEXT, size INTEGER, added INTEGER, status TEXT, chunks INTEGER DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, file_id TEXT, idx INTEGER, text TEXT, vec BLOB, model TEXT);
    CREATE INDEX IF NOT EXISTS chunks_project ON chunks(project_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(text, content='chunks', content_rowid='id', tokenize = 'unicode61 remove_diacritics 2');
  `);
  try { db.exec('ALTER TABLE conversations ADD COLUMN code_root TEXT'); } catch { /* already there */ }
  migrateJson();
  return db;
}

const q = (sql) => init().prepare(sql);
const now = () => Date.now();

// ───────────────────────────── conversations ─────────────────────────────
function textOf(c) {
  const nodes = c.nodes || c.messages || [];
  return nodes.map((m) => [m.content || '', ...(m.attachments || []).filter((a) => a.kind === 'text').map((a) => a.name)].join('\n')).join('\n').slice(0, 200000);
}
function hasArtifact(c) { return (c.nodes || c.messages || []).some((m) => m.role === 'assistant' && (/```|<artifact/.test(m.content || '') || (m.artifacts || []).length)); }

function saveConversation(c) {
  if (c.ephemeral) return true;
  const t = now();
  c.updatedAt = t;
  const data = JSON.stringify(c);
  init().exec('BEGIN');
  try {
    q(`INSERT INTO conversations (id, title, created, updated, pinned, agent, project, has_artifact, code_root, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated=excluded.updated, pinned=excluded.pinned, agent=excluded.agent,
         project=excluded.project, has_artifact=excluded.has_artifact, code_root=excluded.code_root, data=excluded.data`)
      .run(c.id, c.title || '', c.createdAt || t, t, c.pinned ? 1 : 0, c.agent ? 1 : 0, c.project || null, hasArtifact(c) ? 1 : 0, (c.code && c.code.root) || null, data);
    q('DELETE FROM conv_fts WHERE conv_id = ?').run(c.id);
    q('INSERT INTO conv_fts (conv_id, title, body) VALUES (?, ?, ?)').run(c.id, c.title || '', textOf(c));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}
function getConversation(id) {
  const r = q('SELECT data, pinned FROM conversations WHERE id = ?').get(id);
  if (!r) throw new Error('Conversation not found');
  const c = JSON.parse(r.data); c.pinned = !!r.pinned; return c;
}
function listConversations({ project } = {}) {
  const rows = project
    ? q('SELECT id, title, updated, pinned, agent, has_artifact, project, code_root FROM conversations WHERE project = ? ORDER BY updated DESC').all(project)
    : q('SELECT id, title, updated, pinned, agent, has_artifact, project, code_root FROM conversations ORDER BY updated DESC').all();
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated, pinned: !!r.pinned, agent: !!r.agent, hasArtifact: !!r.has_artifact, project: r.project || null, codeRoot: r.code_root || null }));
}
function patchConversation(id, patch) {
  const c = getConversation(id);
  Object.assign(c, patch);
  const keepTime = c.updatedAt;
  saveConversation(c);
  if (!('title' in patch)) q('UPDATE conversations SET updated = ? WHERE id = ?').run(keepTime || now(), id); // pin/rename don't bump
  return true;
}
function deleteConversation(id) {
  q('DELETE FROM conversations WHERE id = ?').run(id);
  q('DELETE FROM conv_fts WHERE conv_id = ?').run(id);
  return true;
}
// Full-text search with highlighted snippets.
function searchConversations(text, limit = 30) {
  const terms = String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 8).map((w) => `"${w.replace(/"/g, '""')}"*`);
  if (!terms.length) return [];
  try {
    return q(`SELECT f.conv_id AS id, c.title, c.updated, c.pinned, c.agent, c.has_artifact,
              snippet(conv_fts, 2, '[[', ']]', '…', 14) AS snip
              FROM conv_fts f JOIN conversations c ON c.id = f.conv_id
              WHERE conv_fts MATCH ? ORDER BY bm25(conv_fts, 0, 5.0, 1.0) LIMIT ?`).all(terms.join(' AND '), limit)
      .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated, pinned: !!r.pinned, agent: !!r.agent, hasArtifact: !!r.has_artifact, snippet: r.snip }));
  } catch { return []; }
}

// ───────────────────────────── memories ─────────────────────────────
const listMemories = () => q('SELECT id, text, created, updated, source, kind FROM memories ORDER BY updated DESC').all().map((r) => ({ ...r }));
function addMemory(text, source = '', kind = 'fact') {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!clean) return null;
  const dup = q('SELECT id FROM memories WHERE lower(text) = lower(?)').get(clean);
  if (dup) { q('UPDATE memories SET updated = ? WHERE id = ?').run(now(), dup.id); return dup.id; }
  const id = 'mem-' + now().toString(36) + Math.random().toString(36).slice(2, 6);
  q('INSERT INTO memories (id, text, created, updated, source, kind) VALUES (?, ?, ?, ?, ?, ?)').run(id, clean, now(), now(), source, kind);
  return id;
}
function updateMemory(id, text) { q('UPDATE memories SET text = ?, updated = ? WHERE id = ?').run(String(text).trim().slice(0, 500), now(), id); return true; }
function deleteMemory(id) { q('DELETE FROM memories WHERE id = ?').run(id); return true; }
function clearMemories() { q('DELETE FROM memories').run(); return true; }

// ───────────────────────────── artifacts ─────────────────────────────
// data = { id, type, title, versions: [{ content, at, by: 'ai'|'user', msgId }], style }
function saveArtifact(a) {
  const t = now();
  q(`INSERT INTO artifacts (id, conv_id, type, title, created, updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET type=excluded.type, title=excluded.title, updated=excluded.updated, data=excluded.data`)
    .run(a.id, a.convId || null, a.type, a.title || '', a.created || t, t, JSON.stringify({ ...a, updated: t }));
  return getArtifact(a.id);
}
function getArtifact(id) { const r = q('SELECT data FROM artifacts WHERE id = ?').get(id); return r ? JSON.parse(r.data) : null; }
function listArtifacts() {
  return q('SELECT id, conv_id, type, title, created, updated, data FROM artifacts ORDER BY updated DESC').all().map((r) => {
    const d = JSON.parse(r.data); const last = (d.versions || [])[d.versions.length - 1] || {};
    return { id: r.id, convId: r.conv_id, type: r.type, title: r.title, lang: d.lang || '', created: r.created, updated: r.updated, versions: (d.versions || []).length, preview: String(last.content || '').slice(0, 400), qa: d.qa || null };
  });
}
function deleteArtifact(id) { q('DELETE FROM artifacts WHERE id = ?').run(id); return true; }

// ───────────────────────────── migration ─────────────────────────────
function migrateJson() {
  const done = db.prepare("SELECT v FROM meta WHERE k = 'json_imported'").get();
  if (done) return;
  const dir = path.join(app.getPath('userData'), 'conversations');
  let n = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try { const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); const keep = c.updatedAt; saveConversation(c); db.prepare('UPDATE conversations SET updated = ? WHERE id = ?').run(keep || now(), c.id); n++; } catch { /* skip corrupt */ }
    }
  }
  db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('json_imported', ?)").run(String(n));
}

// ───────────────────────────── projects ─────────────────────────────
// data = { id, name, description, instructions, created, updated }
function saveProject(p) {
  const t = now();
  const d = { ...p, updated: t, created: p.created || t };
  q(`INSERT INTO projects (id, name, created, updated, data) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated=excluded.updated, data=excluded.data`).run(d.id, d.name || '', d.created, t, JSON.stringify(d));
  return getProject(d.id);
}
function getProject(id) {
  const r = q('SELECT data FROM projects WHERE id = ?').get(id);
  if (!r) return null;
  return { ...JSON.parse(r.data), files: listProjectFiles(id) };
}
function listProjects() {
  return q('SELECT id, data FROM projects ORDER BY updated DESC').all().map((r) => {
    const d = JSON.parse(r.data);
    const n = q('SELECT COUNT(*) AS n FROM project_files WHERE project_id = ?').get(r.id).n;
    const c = q('SELECT COUNT(*) AS n, MAX(updated) AS last FROM conversations WHERE project = ?').get(r.id);
    return { id: d.id, name: d.name, description: d.description || '', updated: Math.max(d.updated || 0, c.last || 0), files: n, chats: c.n };
  });
}
function deleteProject(id) {
  q('DELETE FROM projects WHERE id = ?').run(id);
  for (const f of listProjectFiles(id)) deleteProjectFile(f.id);
  q('UPDATE conversations SET project = NULL WHERE project = ?').run(id);
  return true;
}
const listProjectFiles = (pid) => q('SELECT id, name, path, size, added, status, chunks, error FROM project_files WHERE project_id = ? ORDER BY added').all(pid).map((r) => ({ ...r }));
function addProjectFile(f) { q('INSERT OR REPLACE INTO project_files (id, project_id, name, path, size, added, status, chunks, error) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)').run(f.id, f.projectId, f.name, f.path, f.size, now(), 'pending'); }
function setProjectFile(id, patch) { const cur = q('SELECT * FROM project_files WHERE id = ?').get(id); if (!cur) return; const n = { ...cur, ...patch }; q('UPDATE project_files SET status = ?, chunks = ?, error = ? WHERE id = ?').run(n.status, n.chunks || 0, n.error || null, id); }
function deleteProjectFile(id) {
  for (const r of q('SELECT id, text FROM chunks WHERE file_id = ?').all(id)) q("INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES('delete', ?, ?)").run(r.id, r.text);
  q('DELETE FROM chunks WHERE file_id = ?').run(id);
  q('DELETE FROM project_files WHERE id = ?').run(id);
}
function addChunks(pid, fileId, list) {
  init().exec('BEGIN');
  try {
    for (const c of list) {
      const r = q('INSERT INTO chunks (project_id, file_id, idx, text, vec, model) VALUES (?, ?, ?, ?, ?, ?)').run(pid, fileId, c.idx, c.text, c.vec ? Buffer.from(new Float32Array(c.vec).buffer) : null, c.model || null);
      q('INSERT INTO chunk_fts(rowid, text) VALUES (?, ?)').run(Number(r.lastInsertRowid), c.text);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function setChunkVecs(rows) { for (const r of rows) q('UPDATE chunks SET vec = ?, model = ? WHERE id = ?').run(Buffer.from(new Float32Array(r.vec).buffer), r.model, r.id); }
function chunksWithoutVec(pid, model) { return q('SELECT id, text FROM chunks WHERE project_id = ? AND (vec IS NULL OR model IS NOT ?)').all(pid, model); }
// Small words that match everything (FR / EN / ES / DE) are left out of keyword search.
const STOP = new Set(('le la les un une des du de d l au aux et ou où en est sont se sa son ses ce cet cette ces qui que quoi quand comment pour par sur sous dans avec sans pas ne plus il elle ils elles on nous vous je tu me te mon ma mes ton ta tes leur leurs y a à ' +
  'the a an and or of to in on at for with by is are was were be been it its this that these those what when where how why who which as from not no do does did can i you he she we they my your our their ' +
  'el los las una unos unas y o de del al en con por para es son que como cuando donde lo su sus ' +
  'der die das ein eine und oder von zu im in am auf mit für ist sind was wie wo wann den dem des nicht ich du er sie es wir ihr').split(/\s+/));
function ftsChunks(pid, text, limit = 30) {
  const terms = (String(text || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !STOP.has(w));
  if (!terms.length) return [];
  const qy = [...new Set(terms)].slice(0, 16).map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
  try {
    return q(`SELECT c.id, c.file_id, c.idx, c.text, bm25(chunk_fts) AS score FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
      WHERE chunk_fts MATCH ? AND c.project_id = ? ORDER BY score LIMIT ?`).all(qy, pid, limit).map((r) => ({ ...r }));
  } catch { return []; }
}
function vecChunks(pid, model) {
  return q('SELECT id, file_id, idx, text, vec FROM chunks WHERE project_id = ? AND model = ? AND vec IS NOT NULL').all(pid, model)
    .map((r) => ({ id: r.id, file_id: r.file_id, idx: r.idx, text: r.text, vec: new Float32Array(new Uint8Array(r.vec).buffer) }));
}
function projectChars(pid) { return q('SELECT COALESCE(SUM(LENGTH(text)), 0) AS n FROM chunks WHERE project_id = ?').get(pid).n; }
function projectText(pid, limit) { return q('SELECT c.text, f.name FROM chunks c JOIN project_files f ON f.id = c.file_id WHERE c.project_id = ? ORDER BY f.added, c.idx').all(pid).map((r) => ({ ...r })).slice(0, limit || 1e9); }

function close() { try { db && db.close(); } catch {} db = null; }

module.exports = {
  init, close, saveConversation, getConversation, listConversations, patchConversation, deleteConversation, searchConversations,
  listMemories, addMemory, updateMemory, deleteMemory, clearMemories, saveArtifact, getArtifact, listArtifacts, deleteArtifact,
  saveProject, getProject, listProjects, deleteProject, listProjectFiles, addProjectFile, setProjectFile, deleteProjectFile,
  addChunks, setChunkVecs, chunksWithoutVec, ftsChunks, vecChunks, projectChars, projectText,
};
