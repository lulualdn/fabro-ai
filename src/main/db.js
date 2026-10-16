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
  `);
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
    q(`INSERT INTO conversations (id, title, created, updated, pinned, agent, project, has_artifact, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated=excluded.updated, pinned=excluded.pinned, agent=excluded.agent,
         project=excluded.project, has_artifact=excluded.has_artifact, data=excluded.data`)
      .run(c.id, c.title || '', c.createdAt || t, t, c.pinned ? 1 : 0, c.agent ? 1 : 0, c.project || null, hasArtifact(c) ? 1 : 0, data);
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
    ? q('SELECT id, title, updated, pinned, agent, has_artifact, project FROM conversations WHERE project = ? ORDER BY updated DESC').all(project)
    : q('SELECT id, title, updated, pinned, agent, has_artifact, project FROM conversations ORDER BY updated DESC').all();
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated, pinned: !!r.pinned, agent: !!r.agent, hasArtifact: !!r.has_artifact, project: r.project || null }));
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
    return { id: r.id, convId: r.conv_id, type: r.type, title: r.title, created: r.created, updated: r.updated, versions: (d.versions || []).length, preview: String(last.content || '').slice(0, 400) };
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

function close() { try { db && db.close(); } catch {} db = null; }

module.exports = {
  init, close, saveConversation, getConversation, listConversations, patchConversation, deleteConversation, searchConversations,
  listMemories, addMemory, updateMemory, deleteMemory, clearMemories, saveArtifact, getArtifact, listArtifacts, deleteArtifact,
};
