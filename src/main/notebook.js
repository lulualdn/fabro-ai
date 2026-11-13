// The AI's own notebook ("stance notes"): short, durable observations about HOW this user wants to be
// worked with ("wants me autonomous, don't ask before acting", "answers in French, short", "always deploy
// with X"). Facts about the world or the user's life belong to the memory (db.js), not here.
// The model writes notes with the note_to_self tool; the smart system prompt recalls them; the user sees,
// edits and deletes them in the settings (IPC notebook:*). Per account: paths.dataDir()/notebook.json.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paths = require('./paths');

const MAX_NOTES = 40;
const MAX_LEN = 220;
const file = () => paths.inData('notebook.json');

let cache = null; let cacheDir = null; let loading = null;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Kinds, autonomy first: they are what makes a small model stop asking and start acting.
const KINDS = ['autonomy', 'communication', 'workflow', 'other'];
function classify(text) {
  const t = String(text).toLowerCase();
  if (/autonom|initiative|ask (me|before|permission|questions?)|asking|don'?t ask|without asking|confirm|just do|act (first|directly)|demande[rs]? (pas|avant|la permission|confirmation)|sans (me )?demander|pose (pas|moins) de questions?|questions?|agis|fonce|directement|d'office/.test(t)) return 'autonomy';
  if (/language|langue|fran[cç]ais|english|anglais|short|court|concis|long|detail|d[ée]tail|tone|ton|tutoie|vouvoie|format|markdown|emoji|bullet|liste|style|explain|explique|answer|r[ée]pon/.test(t)) return 'communication';
  if (/always|never|toujours|jamais|deploy|d[ée]ploie|commit|test|build|folder|dossier|save|enregistre|use |utilise|prefer|pr[ée]f[èe]re|workflow|m[ée]thode|before|avant|after|apr[èe]s/.test(t)) return 'workflow';
  return 'other';
}

// Never store secrets.
const SECRET = /(password|passwd|mot de passe|mdp|passphrase|api[_ -]?key|secret|token|bearer\s+[a-z0-9]|private key|cl[ée] priv[ée]e|\bsk-[a-z0-9]{8,}|\bghp_[a-z0-9]{10,}|\bxox[abp]-|\bAKIA[0-9A-Z]{12,}|\b(?:\d[ -]?){13,19}\b|\bcvv\b|\biban\b|code (pin|secret)|one-time code)/i;
// A note can never switch off the app's confirmations for destructive or irreversible actions.
const UNSAFE = /((without|no|never|skip|don'?t)\s+(asking|ask|confirm\w*|confirmation)|sans (demander|confirmation|confirmer)|ne (demande|confirme) (jamais|pas))[^.]{0,80}(delet|remov|supprim|effac|pay|buy|achat|ach[eè]t|purchas|send|envoi|envoy|publi|post|transfer|virement|format|rm -rf|wipe)|(delet|remov|supprim|effac|pay|buy|ach[eè]t|purchas|send|envoi|envoy|publi|transfer|virement)[^.]{0,80}(without|sans) (asking|ask|confirm|demander|confirmation)/i;

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function sim(a, b) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2)); const B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

async function load() {
  const dir = paths.dataDir();
  if (cache && cacheDir === dir) return cache;
  if (loading && cacheDir === dir) return loading;
  cacheDir = dir;
  loading = fsp.readFile(file(), 'utf8').then((s) => { const j = JSON.parse(s); return Array.isArray(j.notes) ? j.notes : []; }).catch(() => [])
    .then((notes) => { cache = notes; loading = null; return cache; });
  return loading;
}
// Synchronous view for the prompt builder (load() is awaited once per run before building).
const cached = () => (cache && cacheDir === paths.dataDir() ? cache : []);

let saving = Promise.resolve();
function save() {
  const data = JSON.stringify({ version: 1, notes: cache }, null, 1);
  const f = file();
  saving = saving.then(async () => { await fsp.mkdir(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; await fsp.writeFile(tmp, data); await fsp.rename(tmp, f); }).catch((e) => console.error('notebook save', e.message));
  return saving;
}

function check(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('The note is empty.');
  if (t.length > MAX_LEN) throw new Error(`Notes must be short (max ${MAX_LEN} characters). Write one short sentence.`);
  if (SECRET.test(t)) throw new Error('Notes never contain passwords, keys, codes or card numbers. Not saved.');
  if (UNSAFE.test(t)) throw new Error('A note cannot remove the confirmation the app asks before deleting, paying, sending or publishing. Not saved — the app keeps asking for those.');
  return t;
}

// add (or update the closest existing note when it says nearly the same thing)
async function add({ text, trigger = '', kind = null, by = 'ai' }) {
  await load();
  const t = check(text);
  const near = cache.map((n) => [n, sim(n.text, t)]).sort((a, b) => b[1] - a[1])[0];
  const now = new Date().toISOString().slice(0, 10);
  if (near && near[1] >= 0.75) {
    Object.assign(near[0], { text: t, updated: now, trigger: String(trigger || near[0].trigger || '').slice(0, 160), kind: kind || classify(t) });
    await save(); return { note: near[0], updated: true };
  }
  const note = { id: uid(), text: t, kind: KINDS.includes(kind) ? kind : classify(t), created: now, updated: now, trigger: String(trigger || '').slice(0, 160), by };
  cache.unshift(note);
  if (cache.length > MAX_NOTES) cache.splice(MAX_NOTES); // oldest go first
  await save();
  return { note, updated: false };
}
async function update(id, patch = {}) {
  await load();
  const n = cache.find((x) => x.id === id); if (!n) throw new Error(`No note with id ${id}`);
  if (patch.text != null) { n.text = check(patch.text); n.kind = KINDS.includes(patch.kind) ? patch.kind : classify(n.text); }
  else if (KINDS.includes(patch.kind)) n.kind = patch.kind;
  n.updated = new Date().toISOString().slice(0, 10);
  await save(); return n;
}
async function remove(id) { await load(); const i = cache.findIndex((x) => x.id === id); if (i < 0) return false; cache.splice(i, 1); await save(); return true; }
async function clear() { await load(); cache.length = 0; await save(); return true; }
async function list() { return (await load()).slice(); }

// Notes for the prompt: autonomy first, then those that share words with the request, then the newest.
function forPrompt(request = '', max = 12) {
  const notes = cached(); if (!notes.length) return [];
  const rank = { autonomy: 0, communication: 1, workflow: 2, other: 3 };
  const q = new Set(norm(request).split(' ').filter((w) => w.length > 3));
  const rel = (n) => norm(n.text).split(' ').filter((w) => q.has(w)).length;
  return notes.map((n, i) => ({ n, i, r: rel(n) }))
    .sort((a, b) => (rank[a.n.kind] ?? 3) - (rank[b.n.kind] ?? 3) || b.r - a.r || a.i - b.i)
    .slice(0, max).map((x) => x.n);
}

// ───────────────────────────── tool ─────────────────────────────
function registerTool() {
  const agent = require('./agent');
  if (agent.get('note_to_self')) return;
  agent.register({
    name: 'note_to_self', category: 'notebook', risk: 'read', categoryCore: true, noMcpWrap: true,
    description: 'Your notebook about HOW this user wants you to work. Call it when the user corrects your behaviour or states a working preference ("don\'t ask, just do it", "answer in French, short", "always test before saying done"), so you remember it in every future conversation. One short sentence per note. Not for facts about the world or the user\'s life, never for secrets. action: add (default) | update | remove (with id).',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['add', 'update', 'remove'] },
      text: { type: 'string', description: 'One short sentence, e.g. "Wants me to act on my own and not ask before each step."' },
      trigger: { type: 'string', description: 'What the user said or did that taught you this (short).' },
      id: { type: 'string', description: 'For update/remove: the note id shown in the system prompt.' },
    }, required: ['text'] },
    summarize: (a) => String(a.text || a.id || '').slice(0, 80),
    async run(a) {
      const act = a.action || 'add';
      if (act === 'remove') { const ok = await remove(String(a.id || '')); return { content: ok ? 'Note removed.' : 'No note with that id.', view: { kind: 'note', action: 'remove' } }; }
      if (act === 'update' && a.id) { const n = await update(String(a.id), { text: a.text }); return { content: `Note updated: ${n.text}`, view: { kind: 'note', action: 'update', note: n } }; }
      const r = await add({ text: a.text, trigger: a.trigger });
      return { content: `${r.updated ? 'Updated an existing note' : 'Noted'}: "${r.note.text}". It will be in your instructions from now on. Now continue with the user's request.`, view: { kind: 'note', action: r.updated ? 'update' : 'add', note: r.note } };
    },
  });
}

function init(ipcMain) {
  registerTool();
  if (!ipcMain) return;
  ipcMain.handle('notebook:list', () => list());
  ipcMain.handle('notebook:add', (_e, text) => add({ text, by: 'user', trigger: 'added by the user' }));
  ipcMain.handle('notebook:update', (_e, id, patch) => update(id, patch || {}));
  ipcMain.handle('notebook:delete', (_e, id) => remove(id));
  ipcMain.handle('notebook:clear', () => clear());
}

module.exports = { init, registerTool, load, list, add, update, remove, clear, forPrompt, cached, classify, check, MAX_NOTES, MAX_LEN, _reset: () => { cache = null; cacheDir = null; } };
