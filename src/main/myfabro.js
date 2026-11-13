// "Mon Fabro": what Fabro remembers about the user of this account, and the story of their work with it.
//
//  · Memory entries: title + content + kind + first seen / last touched + source conversations + pinned. They live in
//    the existing `memories` table of the account's fabro.db (extra columns added here), so the chat's memory
//    (S.memories → system prompt) keeps working unchanged: `text` is the entry's content.
//  · Profile: a short living description of the user. Every line keeps where it came from. Built ONLY from what the
//    user said in Fabro, what they did in Fabro (projects), and the TITLES of chats synced by the ChatGPT / Claude /
//    Gemini mods. Sensitive traits (health, religion, politics, sexuality, origin) are never stored from the model,
//    and age only when the user stated it in so many words.
//  · Timeline, forgotten projects, skill suggestions: computed from the database, no model involved.
//  · observe(): the after-turn background job (called through brain.memories). One small model call per finished
//    turn-batch, background priority in the governor, skipped on battery / thermal or memory pressure, postponed
//    while the user is generating.
// Everything stays in the account folder (paths.dataDir()); nothing is sent anywhere.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const db = require('./db');
const store = require('./store');

const KINDS = ['project', 'preference', 'fact', 'habit', 'person', 'tool'];
const FIELDS = ['name', 'work', 'studies', 'projects', 'habits', 'tools', 'languages', 'age'];
const SYNC_MODS = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };
const LANG = { fr: 'French', en: 'English', es: 'Spanish', de: 'German' };
const DAY = 864e5;
const now = () => Date.now();
const uid = (p) => p + now().toString(36) + Math.random().toString(36).slice(2, 6);

// ───────────────────────────── privacy filters ─────────────────────────────
// Matched on what the MODEL proposes (entries and profile lines). Conservative on purpose: a false positive only
// means Fabro does not remember something; the user can still write it themselves.
// \b and \w are ASCII-only in JS: rebuild each pattern with Unicode-aware word boundaries (é, ü, ñ…).
const U = (re) => new RegExp(re.source.replace(/\\b/g, '(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))').replace(/\\w/g, '[\\p{L}\\p{N}_]'), re.flags.replace('u', '') + 'u');
const SENSITIVE = [
  ['health', /\b(sant[ée]|health|malad\w*|disease|illness|sick|diagnos\w*|m[ée]dic\w*|medica\w*|th[ée]rap\w*|d[ée]pres\w*|anxi\w*|cancer|diab[eéè]t\w*|handicap\w*|disabilit\w*|pregnan\w*|enceinte|mental|psych\w*|adhd|tdah|autis\w*|allerg\w*|h[oô]pital|hospital\w*|sympt[oô]m\w*|ill(ness)?|krank\w*|enfermedad\w*)\b/i],
  ['religion', /\b(relig\w*|church|[ée]glise|mosqu\w*|synagog\w*|muslim|musulman\w*|christian\w*|chr[ée]tien\w*|catholi\w*|protestant\w*|jewish|juif|juive|islam\w*|bouddh\w*|buddhis\w*|hindu\w*|ath[ée]\w*|pray\w*|pri[eè]re|ramadan|kirche)\b/i],
  ['politics', /\b(politi\w*|vot(e|es|ed|er|ing|é|ait)|[ée]lection\w*|elector\w*|left-wing|right-wing|de gauche|de droite|conservat\w*|socialis\w*|communis\w*|republican|democrat\w*|fascis\w*|militant\w*|syndicat\w*|union member)\b/i],
  ['sexuality', /\b(sexu\w*|gay|lesbi\w*|bisex\w*|homosex\w*|h[ée]t[ée]ro\w*|queer|transgen\w*|transgenre|lgbt\w*|asexu\w*|orientation)\b/i],
  ['origin', /\b(ethni\w*|racial|race|immigr\w*|nationalit\w*|origine?s?\s+(ethnique|ethnic|[ée]trang\w*)|born in|n[ée]e? (à|en|au)|black people|personnes? noires?|arab\w*|african\w*|africain\w*|asiatique|maghr[ée]b\w*|latino|hispanic|caste)\b/i],
  ['secret', /\b(password|mot de passe|passwort|contraseña|api[ -]?key|token|secret|iban|carte bancaire|credit card)\b|\bsk-[a-z0-9]/i],
];
const AGE = /\b(\d{1,3}\s*(ans|an|years?(\s*old)?|y\.?o\.?|años|jahre)|[âa]ge[ds]?|aged|born (in|on)|n[ée]e? en \d{4}|birthday|anniversaire)\b/i;
const AGE_STATED = /\b(j['’]ai|i['’]?m|i am|tengo|ich bin)\s+\d{1,3}\s*(ans|years?(\s*old)?|años|jahre)?\b|\b(my age is|mon [âa]ge est)\b/i;
for (const x of SENSITIVE) x[1] = U(x[1]);
const AGE_U = U(AGE), AGE_STATED_U = U(AGE_STATED);
function sensitiveKind(text) { for (const [k, re] of SENSITIVE) if (re.test(text)) return k; return null; }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const STOP = new Set(('le la les un une des du de d l au aux et ou en est sont se sa son ses ce cet cette ces qui que quoi quand comment pour par sur sous dans avec sans pas ne plus il elle ils elles on nous vous je tu me te mon ma mes ton ta tes leur leurs y a faire fais fait peux veux aide moi stp svp merci bonjour salut nouveau nouvelle nouvelle conversation untitled sans titre ' +
  'the a an and or of to in on at for with by is are was were be been it its this that these those what when where how why who which as from not no do does did can i you he she we they my your our their me make help please new chat about ' +
  'el los las una y o del al con por para es que como lo su der die das ein eine und oder von zu im mit fur ist').split(/\s+/));
const words = (s) => (norm(s).match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w));
function overlap(a, b) { const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); }
const contains = (hay, needle) => { const n = norm(needle).replace(/^["'«“]+|["'»”.]+$/g, ''); return n.length >= 3 && norm(hay).includes(n); };

// ───────────────────────────── state file ─────────────────────────────
const file = () => paths.inData('myfabro.json');
let state = null;
function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { state = {}; }
  state.profile ||= []; state.dismissed ||= { forgotten: [], skills: [] }; state.dismissed.forgotten ||= []; state.dismissed.skills ||= [];
  state.syncedSeen ||= {}; state.welcome ||= {};
  return state;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!state) return;
  try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file() + '.tmp', JSON.stringify(state, null, 1)); fs.renameSync(file() + '.tmp', file()); } catch {}
}
function reset() { state = null; schemaOk = false; } // tests / account switch

const settings = () => store.getSettings() || {};
const memOn = () => (settings().memory || {}).enabled !== false;          // use the memory in answers
const learnOn = () => { const m = settings().memory || {}; return m.enabled !== false && m.auto !== false; }; // keep learning

// ───────────────────────────── schema (memories table) ─────────────────────────────
let schemaOk = false;
function raw() {
  const d = db.init();
  if (!schemaOk) {
    for (const col of ['title TEXT', 'pinned INTEGER DEFAULT 0', 'sources TEXT', 'origin TEXT', 'ref TEXT']) { try { d.exec(`ALTER TABLE memories ADD COLUMN ${col}`); } catch { /* already there */ } }
    schemaOk = true;
  }
  return d;
}
const autoTitle = (text) => { const w = String(text || '').replace(/\s+/g, ' ').trim().split(' '); return w.slice(0, 6).join(' ').replace(/[.,;:]$/, '') + (w.length > 6 ? '…' : ''); };
function rowToEntry(r) {
  let sources = []; try { sources = JSON.parse(r.sources || '[]'); } catch {}
  if (!sources.length && r.source && r.source !== 'user') sources = [r.source];
  return { id: r.id, title: r.title || autoTitle(r.text), content: r.text, kind: KINDS.includes(r.kind) ? r.kind : 'fact', pinned: !!r.pinned,
    created: r.created, updated: r.updated, sources, origin: r.origin || (r.source === 'user' ? 'you' : 'fabro'), ref: r.ref || null };
}

// ───────────────────────────── entries ─────────────────────────────
function list() { return raw().prepare('SELECT * FROM memories ORDER BY pinned DESC, updated DESC').all().map(rowToEntry); }
function get(id) { const r = raw().prepare('SELECT * FROM memories WHERE id = ?').get(id); return r ? rowToEntry(r) : null; }

// Same thing already known? Same ref, same title, or most of the words in common within the same kind.
function findSimilar(e, all = list()) {
  if (e.ref) { const r = all.find((x) => x.ref === e.ref); if (r) return r; }
  const t = norm(e.title);
  return all.find((x) => (t && norm(x.title) === t) || norm(x.content) === norm(e.content))
    || all.find((x) => x.kind === e.kind && overlap(x.title + ' ' + x.content, e.title + ' ' + e.content) >= 0.7);
}

// Adds or updates. origin: 'fabro' (model), 'did' (computed from what the user did), 'you' (typed by the user).
function upsert({ title, content, kind = 'fact', convId = null, origin = 'fabro', ref = null, pinned }) {
  content = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  title = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || autoTitle(content);
  if (!content) return null;
  if (!KINDS.includes(kind)) kind = 'fact';
  const d = raw(); const t = now();
  const dup = findSimilar({ title, content, kind, ref });
  if (dup) {
    const sources = convId && !dup.sources.includes(convId) ? [...dup.sources, convId].slice(-12) : dup.sources;
    // the user's words and pinned entries are never rewritten by Fabro; it only notes it saw them again
    const keep = dup.pinned || dup.origin === 'you';
    const nextContent = keep || content.length < dup.content.length * 0.6 ? dup.content : content;
    d.prepare('UPDATE memories SET text = ?, title = ?, updated = ?, sources = ?, kind = ?, pinned = ? WHERE id = ?')
      .run(nextContent, keep ? dup.title : title, t, JSON.stringify(sources), keep ? dup.kind : kind, pinned == null ? (dup.pinned ? 1 : 0) : pinned ? 1 : 0, dup.id);
    return { id: dup.id, updated: true };
  }
  const id = uid('mem-');
  d.prepare('INSERT INTO memories (id, text, created, updated, source, kind, title, pinned, sources, origin, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, content, t, t, origin === 'you' ? 'user' : (convId || ''), kind, title, pinned ? 1 : 0, JSON.stringify(convId ? [convId] : []), origin, ref);
  return { id, added: true };
}
function add(o) { return upsert({ ...o, origin: 'you' }); }
function edit(id, patch = {}) {
  const e = get(id); if (!e) return null;
  const n = { ...e, ...patch };
  raw().prepare('UPDATE memories SET text = ?, title = ?, kind = ?, pinned = ?, origin = ?, updated = ? WHERE id = ?')
    .run(String(n.content).trim().slice(0, 500), String(n.title).trim().slice(0, 80) || autoTitle(n.content), KINDS.includes(n.kind) ? n.kind : 'fact', n.pinned ? 1 : 0,
      'content' in patch || 'title' in patch ? 'you' : e.origin, now(), id);
  return get(id);
}
function pin(id, on) { return edit(id, { pinned: !!on }); }
function remove(id) { raw().prepare('DELETE FROM memories WHERE id = ?').run(id); return true; }
function forgetAll() {
  raw().prepare('DELETE FROM memories').run();
  const s = load(); s.profile = []; s.syncedSeen = {}; s.welcome = {}; s.forgottenAt = now(); flush();
  return true;
}

// ───────────────────────────── profile ─────────────────────────────
// line = { id, field, text, source: { type: 'said'|'did'|'synced'|'you', convId?, mod?, title?, quote? }, at, corrected? }
function profile() { const s = load(); return { lines: s.profile.slice(), text: s.profile.map((l) => l.text).join('\n') }; }
function addProfileLine(line) {
  const s = load();
  const text = String(line.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const field = FIELDS.includes(line.field) ? line.field : 'habits';
  // one line per single-valued field (the newest statement wins), otherwise update a near-identical line
  const single = ['name', 'work', 'studies', 'age'].includes(field);
  const same = s.profile.find((l) => (single && l.field === field) || norm(l.text) === norm(text) || overlap(l.text, text) >= 0.8);
  if (same) {
    if (same.source.type === 'you' && line.source.type !== 'you') return same; // never overwrite what the user wrote
    Object.assign(same, { text, field, source: line.source, at: now() });
    save(); return same;
  }
  const l = { id: uid('pl-'), field, text, source: line.source, at: now() };
  s.profile.push(l); s.profile = s.profile.slice(-40); save();
  return l;
}
function editProfileLine(id, text) {
  const s = load(); const l = s.profile.find((x) => x.id === id); if (!l) return null;
  if (!String(text || '').trim()) return removeProfileLine(id);
  l.text = String(text).replace(/\s+/g, ' ').trim().slice(0, 200); l.corrected = true; l.source = { ...l.source, type: 'you', was: l.source.type }; l.at = now(); save();
  return profile();
}
function removeProfileLine(id) { const s = load(); s.profile = s.profile.filter((x) => x.id !== id); save(); return profile(); }
// The whole profile as plain text: unchanged lines keep their provenance, new lines are "written by you".
function setProfileText(text) {
  const s = load();
  const lines = String(text || '').split('\n').map((x) => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean).slice(0, 40);
  const old = s.profile.slice();
  s.profile = lines.map((t) => {
    const o = old.find((l) => l.text === t) || old.find((l) => norm(l.text) === norm(t));
    if (o) { old.splice(old.indexOf(o), 1); return o; }
    return { id: uid('pl-'), field: 'habits', text: t.slice(0, 200), source: { type: 'you' }, at: now() };
  });
  save();
  return profile();
}

// ───────────────────────────── synced chats (mods) ─────────────────────────────
// Titles only. Each mod keeps its list in <data>/mod-data/<mod>/chats.json.
function syncedChats() {
  const out = [];
  for (const [mod, name] of Object.entries(SYNC_MODS)) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(paths.dataDir(), 'mod-data', mod, 'chats.json'), 'utf8')); } catch {}
    for (const c of Array.isArray(list) ? list : []) {
      const title = String((c && c.title) || '').trim();
      if (!title || /^(untitled|new chat|sans titre|nouvelle conversation)$/i.test(title)) continue;
      out.push({ mod, site: name, id: String(c.id || ''), title: title.slice(0, 120), at: c.updatedAt || 0 });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

// ───────────────────────────── things the user did (no model) ─────────────────────────────
// One "project" entry per Fabro project, kept up to date with its name and description.
function syncComputed() {
  if (!learnOn()) return 0;
  let n = 0;
  for (const p of db.listProjects()) {
    const content = p.description ? `${p.name}: ${p.description}` : p.name;
    const known = list().find((e) => e.ref === 'project:' + p.id);
    if (known && (known.origin === 'you' || known.pinned || known.content === content)) continue;
    const r = upsert({ title: p.name, content, kind: 'project', origin: 'did', ref: 'project:' + p.id });
    if (r && r.added) n++;
  }
  return n;
}

// ───────────────────────────── the background job ─────────────────────────────
const busy = new Set();
let lastPressure = 0, pendingTimer = null, governorHooked = false;
function hookGovernor() {
  if (governorHooked) return; governorHooked = true;
  try { require('./governor').on('pressure', () => { lastPressure = now(); }); } catch {}
}
// Why the job should not run right now (null = go).
function holdReason() {
  try {
    const g = require('./governor');
    const env = g.env || {};
    if (env.battery || env.thermal === 'serious' || env.thermal === 'critical') return 'battery';
    if (now() - lastPressure < 5 * 60e3) return 'pressure';
    const q = g.queueState ? g.queueState() : { active: [], waiting: [] };
    if ([...q.active, ...q.waiting].some((j) => j.priority === 'user' || j.priority === 'sub')) return 'busy';
  } catch {}
  return null;
}

function parseObserve(text) {
  const s = String(text || '');
  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) { try { const o = JSON.parse(obj[0]); if (o && typeof o === 'object' && !Array.isArray(o)) return { entries: Array.isArray(o.entries) ? o.entries : [], profile: Array.isArray(o.profile) ? o.profile : [] }; } catch {} }
  const arr = s.match(/\[[\s\S]*\]/); // older/smaller models answer with a plain list of facts
  if (arr) { try { const a = JSON.parse(arr[0]); if (Array.isArray(a)) return { entries: a.map((x) => (typeof x === 'string' ? { kind: 'fact', content: x, legacy: true } : x)).filter(Boolean), profile: [] }; } catch {} }
  return { entries: [], profile: [] };
}

// Checks what the model proposed against what the user actually said / synced. Pure: used by tests.
function vet(proposal, { userTexts = [], synced = [] }) {
  const said = userTexts.join('\n');
  const where = (ev) => {
    if (!ev) return null;
    if (contains(said, ev)) return { type: 'said' };
    const s = synced.find((c) => contains(c.title, ev)); if (s) return { type: 'synced', mod: s.mod, site: s.site, title: s.title };
    return null;
  };
  const entries = [], profileLines = [], refused = [];
  for (const e of proposal.entries || []) {
    if (!e || typeof e !== 'object') continue;
    const content = String(e.content || e.text || '').trim(); const title = String(e.title || '').trim();
    if (content.length < 6 || content.length > 400) continue;
    const k = sensitiveKind(title + ' ' + content); if (k) { refused.push({ kind: k, text: content }); continue; }
    if (AGE_U.test(content + ' ' + title)) { refused.push({ kind: 'age', text: content }); continue; } // age goes to the profile, stated only
    let src = where(e.evidence);
    if (!src && e.legacy && overlap(content, said) >= 0.34) src = { type: 'said' }; // a plain fact: must share words with what was said
    if (!src) { refused.push({ kind: 'unsupported', text: content }); continue; }
    entries.push({ title, content, kind: KINDS.includes(e.kind) ? e.kind : 'fact', source: src });
  }
  for (const p of proposal.profile || []) {
    if (!p || typeof p !== 'object') continue;
    const text = String(p.text || '').trim(); const field = String(p.field || '').toLowerCase();
    if (text.length < 3 || text.length > 200 || !FIELDS.includes(field)) continue;
    const k = sensitiveKind(text); if (k) { refused.push({ kind: k, text }); continue; }
    const src = where(p.evidence);
    if (!src) { refused.push({ kind: 'unsupported', text }); continue; }
    if (field === 'age' || AGE_U.test(text)) {
      // never inferred: only "I'm 34" / "j'ai 34 ans" said by the user, in Fabro
      if (!(src.type === 'said' && AGE_STATED_U.test(norm(p.evidence)) && contains(said, p.evidence))) { refused.push({ kind: 'age', text }); continue; }
    }
    if (field === 'name' && src.type === 'synced') { refused.push({ kind: 'unsupported', text }); continue; }
    profileLines.push({ field, text, source: { ...src, quote: String(p.evidence).slice(0, 120) } });
  }
  return { entries, profile: profileLines, refused };
}

function observePrompt({ lang, known, prof, synced }) {
  return `You keep a small, honest memory about the user of a personal assistant that runs on their own computer.
Read the user's messages (and, if given, titles of chats they had on other AI sites). Reply ONLY with JSON:
{"entries":[{"kind":"project|preference|fact|habit|person|tool","title":"2-6 words","content":"one short sentence","evidence":"exact words copied from the user's text"}],
 "profile":[{"field":"name|work|studies|projects|habits|tools|languages|age","text":"short line about the user","evidence":"exact words copied"}]}
Rules:
- Only things the user clearly said or clearly does repeatedly (a new project, a stated preference, a tool they use, a recurring task). Nothing one-off.
- "evidence" must be copied word for word from the user's messages or from a chat title.
- Never guess. Age only if the user wrote it ("I'm 34"). Never write anything about health, religion, politics, sexuality, ethnic or national origin, money, passwords or secrets, even if hinted.
- Skip what is already known. Write in ${LANG[lang] || "the user's language"}. Empty lists when there is nothing new: {"entries":[],"profile":[]}
Already known: ${known || '(nothing)'}
Profile: ${prof || '(empty)'}${synced ? `\nTitles of the user's chats on other AI sites (titles only):\n${synced}` : ''}`;
}

// model: the user's selected model ref. Returns the ids added/updated (the chat shows "N memories saved").
async function observe({ model, convId, userTexts = [], lang, title } = {}, opts = {}) {
  if (!learnOn() || !model) return [];
  hookGovernor();
  const hold = holdReason();
  if (hold) {
    // postponed (never while the user generates); dropped when on battery / under memory pressure
    if (hold === 'busy' && (opts.tries || 0) < 3) {
      clearTimeout(pendingTimer);
      return new Promise((resolve) => { pendingTimer = setTimeout(() => observe({ model, convId, userTexts, lang, title }, { ...opts, tries: (opts.tries || 0) + 1 }).then(resolve, () => resolve([])), opts.retryMs || 20000); });
    }
    return [];
  }
  const key = convId || 'none';
  if (busy.has(key)) return [];
  busy.add(key);
  try {
    syncComputed();
    const s = load();
    const allSynced = syncedChats();
    const freshSynced = allSynced.filter((c) => !s.syncedSeen[c.mod + ':' + c.id]).slice(0, 25);
    const texts = userTexts.map((x) => String(x || '').slice(0, 1500)).filter(Boolean);
    if (!texts.length && !freshSynced.length) return [];
    const known = list().slice(0, 40).map((e) => `${e.title}`).join('; ');
    const prof = s.profile.map((l) => l.text).join('; ');
    const chat = opts.chat || require('./chat');
    const out = await chat.quick(model, [
      { role: 'system', content: observePrompt({ lang, known, prof, synced: freshSynced.map((c) => `- ${c.title}`).join('\n') }) },
      { role: 'user', content: `User messages${title ? ` (conversation "${String(title).slice(0, 80)}")` : ''}:\n${texts.map((x) => `- ${x}`).join('\n') || '(none)'}` },
    ], { maxTokens: 500 });
    for (const c of freshSynced) s.syncedSeen[c.mod + ':' + c.id] = 1;
    const v = vet(parseObserve(out), { userTexts: texts, synced: freshSynced });
    const ids = [];
    for (const e of v.entries.slice(0, 4)) { const r = upsert({ ...e, convId: e.source.type === 'said' ? convId : null, origin: 'fabro' }); if (r) ids.push(r.id); }
    for (const p of v.profile.slice(0, 4)) addProfileLine({ ...p, source: { ...p.source, convId: p.source.type === 'said' ? convId : undefined } });
    save();
    return ids;
  } finally { busy.delete(key); }
}

// ───────────────────────────── for the system prompt ─────────────────────────────
// Compact text: profile + the most relevant entries, within budgetTokens (≈ 4 characters per token).
function forPrompt({ budgetTokens = 350, query = '' } = {}) {
  if (!memOn()) return '';
  const budget = Math.max(40, budgetTokens) * 4;
  const prof = load().profile.map((l) => `- ${l.text}`);
  const q = words(query);
  const score = (e) => (e.pinned ? 100 : 0) + (q.length ? overlap(q.join(' '), e.title + ' ' + e.content) * 10 : 0) + Math.max(0, 3 - (now() - e.updated) / (30 * DAY));
  const entries = list().map((e) => [score(e), e]).sort((a, b) => b[0] - a[0]).map(([, e]) => `- ${e.title}: ${e.content}`);
  let out = 'What you know about the user (kept on this computer):';
  const push = (lines, head) => {
    if (!lines.length) return;
    let block = head ? `\n${head}` : '';
    for (const l of lines) { if ((out + block + '\n' + l).length > budget) break; block += '\n' + l; }
    if (block.trim() && block.trim() !== head) out += block;
  };
  push(prof, 'Profile:');
  push(entries, 'Notes:');
  return out.includes('\n') ? out : '';
}

// ───────────────────────────── timeline (computed) ─────────────────────────────
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function streaks(days) {
  const ks = [...days].sort(); let best = 0, run = 0, prev = null, bestEnd = null;
  for (const k of ks) {
    const d = new Date(k + 'T12:00');
    run = prev && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1; prev = d;
    if (run > best) { best = run; bestEnd = k; }
  }
  // current streak: ending today or yesterday
  let cur = 0; const today = new Date(dayKey(now()) + 'T12:00');
  for (let i = 0; i < 4000; i++) { const k = dayKey(today - i * DAY); if (days.has(k)) cur++; else if (i > 0 || cur) break; }
  return { best, bestEnd, current: cur, activeDays: days.size };
}
function timeline() {
  const d = raw();
  const convs = d.prepare('SELECT id, title, created, updated, agent, project, has_artifact, code_root FROM conversations ORDER BY created ASC').all();
  const projects = d.prepare('SELECT id, name, created, updated, data FROM projects ORDER BY created ASC').all();
  const arts = d.prepare('SELECT id, conv_id, type, title, created FROM artifacts ORDER BY created ASC').all();
  const items = [];
  const days = new Set();
  for (const c of convs) { if (c.created) days.add(dayKey(c.created)); if (c.updated) days.add(dayKey(c.updated)); }
  for (const a of arts) if (a.created) days.add(dayKey(a.created));
  const first = (arr, pred = () => true) => arr.find(pred);
  const c0 = first(convs); if (c0) items.push({ kind: 'first-chat', at: c0.created, title: c0.title || '', convId: c0.id });
  const p0 = first(projects); if (p0) items.push({ kind: 'first-project', at: p0.created, title: p0.name || '', projectId: p0.id });
  const a0 = first(arts); if (a0) items.push({ kind: 'first-artifact', at: a0.created, title: a0.title || '', artifactId: a0.id, convId: a0.conv_id });
  const g0 = first(convs, (c) => c.agent); if (g0) items.push({ kind: 'first-agent', at: g0.created, title: g0.title || '', convId: g0.id });
  const k0 = first(convs, (c) => c.code_root); if (k0) items.push({ kind: 'first-code', at: k0.created, title: path.basename(k0.code_root || ''), convId: k0.id });
  const projs = projects.map((p) => {
    let data = {}; try { data = JSON.parse(p.data); } catch {}
    const pc = convs.filter((c) => c.project === p.id);
    const ids = new Set(pc.map((c) => c.id));
    const made = arts.filter((a) => ids.has(a.conv_id)).map((a) => ({ id: a.id, title: a.title, type: a.type }));
    const last = Math.max(p.updated || 0, ...pc.map((c) => c.updated || 0));
    return { id: p.id, name: p.name, description: data.description || '', created: p.created, last, chats: pc.length, made };
  });
  for (const p of projs) if (!p0 || p.id !== p0.id) items.push({ kind: 'project', at: p.created, title: p.name, projectId: p.id, chats: p.chats, made: p.made.length, last: p.last });
  // the 100th, 500th… conversation
  for (const n of [10, 100, 500, 1000]) if (convs[n - 1]) items.push({ kind: 'nth-chat', at: convs[n - 1].created, n, title: convs[n - 1].title || '', convId: convs[n - 1].id });
  const st = streaks(days);
  if (st.best >= 3) items.push({ kind: 'streak', at: new Date(st.bestEnd + 'T12:00').getTime(), n: st.best });
  let models = [];
  try { models = require('./usage').summary(1).models.filter((m) => !/background/i.test(m.name)).slice(0, 3).map((m) => ({ name: m.name, requests: m.requests || 0, last: m.last || null })); } catch {}
  items.sort((a, b) => a.at - b.at);
  return { since: c0 ? c0.created : null, counts: { conversations: convs.length, projects: projects.length, artifacts: arts.length }, streak: st, models, projects: projs.slice().reverse(), items };
}

// ───────────────────────────── forgotten projects (computed) ─────────────────────────────
function lastPath(c) {
  const nodes = c.nodes || c.messages || [];
  if (c.nodes && c.leafId) {
    const by = new Map(c.nodes.map((n) => [n.id, n])); const out = []; let n = by.get(c.leafId);
    while (n && out.length < 2000) { out.unshift(n); n = n.parentId ? by.get(n.parentId) : null; }
    if (out.length) return out;
  }
  return nodes;
}
function unfinishedSigns(c) {
  const msgs = lastPath(c).filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  const signs = [];
  if (!msgs.length) return signs;
  const last = msgs[msgs.length - 1];
  if (last.role === 'user' || (last.role === 'assistant' && (last.error || !String(last.content || '').trim()))) signs.push('unanswered');
  const plan = [...msgs].reverse().find((m) => Array.isArray(m.plan) && m.plan.length);
  if (plan) { const left = plan.plan.filter((s) => s && s.status !== 'done' && s.status !== 'skipped').length; if (left) signs.push('plan:' + left); }
  const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
  const txt = String((lastA && lastA.content) || '');
  const open = (txt.match(/^\s*[-*] \[ \]/gm) || []).length;
  if (open) signs.push('todo:' + open);
  else if (/\b(next steps?|prochaines? [ée]tapes?|to ?do|reste [àa] faire|still to do|n[äa]chste schritte|pr[óo]ximos pasos)\b/i.test(txt.slice(-1500))) signs.push('next');
  return signs;
}
function forgotten({ minDays = 10, maxDays = 180, limit = 3, at = now() } = {}) {
  const d = raw(); const s = load();
  const gone = new Set(s.dismissed.forgotten);
  const from = at - maxDays * DAY, to = at - minDays * DAY;
  const out = [];
  // projects: the latest conversation of each quiet project
  const projs = d.prepare('SELECT p.id, p.name, MAX(p.updated, COALESCE((SELECT MAX(updated) FROM conversations c WHERE c.project = p.id), 0)) AS updated FROM projects p').all();
  for (const p of projs) {
    if (gone.has('project:' + p.id) || !(p.updated >= from && p.updated <= to)) continue;
    const c = d.prepare('SELECT id, data FROM conversations WHERE project = ? ORDER BY updated DESC LIMIT 1').get(p.id);
    let signs = [];
    if (c) { try { signs = unfinishedSigns(JSON.parse(c.data)); } catch {} }
    if (!signs.length) continue;
    out.push({ key: 'project:' + p.id, kind: 'project', name: p.name, projectId: p.id, convId: c && c.id, last: p.updated, days: Math.floor((at - p.updated) / DAY), signs });
  }
  // long threads outside projects
  const rows = d.prepare('SELECT id, title, updated, data FROM conversations WHERE project IS NULL AND updated BETWEEN ? AND ? ORDER BY updated DESC LIMIT 60').all(from, to);
  for (const r of rows) {
    if (gone.has('conv:' + r.id)) continue;
    let c; try { c = JSON.parse(r.data); } catch { continue; }
    const n = lastPath(c).filter((m) => m.role === 'user' || m.role === 'assistant').length;
    if (n < 6) continue;
    const signs = unfinishedSigns(c);
    if (!signs.length) continue;
    out.push({ key: 'conv:' + r.id, kind: 'conversation', name: r.title || '', convId: r.id, last: r.updated, days: Math.floor((at - r.updated) / DAY), signs, messages: n });
  }
  const weight = (x) => x.signs.reduce((a, sg) => a + (sg === 'unanswered' ? 3 : sg.startsWith('plan') ? 3 : 2), 0) + (x.kind === 'project' ? 2 : 0);
  return out.sort((a, b) => weight(b) - weight(a) || b.last - a.last).slice(0, limit);
}
// One gentle line for the welcome screen: at most once every 3 days, never twice for the same thing.
function welcome() {
  const s = load();
  if (!learnOn() || now() - (s.welcome.at || 0) < 3 * DAY) return null;
  const f = forgotten({ limit: 3 }).find((x) => !(s.welcome.shown || []).includes(x.key));
  if (!f) return null;
  s.welcome = { at: now(), shown: [...(s.welcome.shown || []), f.key].slice(-30) }; save();
  return f;
}

// ───────────────────────────── skills worth creating (computed) ─────────────────────────────
const TASKS = [
  ['translate', /\b(tradu\w*|translat\w*|traduc\w*|[üu]bersetz\w*)\b/i],
  ['summarize', /\b(r[ée]sum\w*|resum\w*|summar\w*|synth[eè]s\w*|tl;?dr)\b/i],
  ['email', /\b(e-?mails?|mails?|courriels?|lettres?|letters?|reply to|r[ée]pon(dre|se) [àa])\b/i],
  ['fix-code', /\b(bugs?|debug\w*|fix\w*|corrig\w*|erreurs?|errors?|crash\w*|marche pas|doesn'?t work)\b/i],
  ['roblox', /\b(roblox|luau?|studio)\b/i],
  ['slides', /\b(slides?|diapos?|diaporama|pr[ée]sentations?|powerpoint|deck)\b/i],
  ['study', /\b(r[ée]vis\w*|exercices?|exercises?|cours|quiz\w*|homework|devoirs?|examens?|exams?|bac)\b/i],
  ['announce', /\b(annonces?|announcements?|discord|tweets?|posts? (linkedin|instagram))\b/i],
  ['website', /\b(sites? web|website|landing|page web|html|css)\b/i],
  ['cv', /\b(cv|curriculum|lettre de motivation|cover letter|resume)\b/i],
  ['recipe', /\b(recettes?|recipes?|cuisine|cook\w*)\b/i],
  ['plan', /\b(planning|planifi\w*|itin[ée]raire|itinerary|schedule|emploi du temps|organis\w*)\b/i],
  ['report', /\b(rapports?|reports?|compte[- ]rendu|minutes)\b/i],
  ['data', /\b(excel|tableur|spreadsheet|csv|graphiques?|charts?|donn[ée]es)\b/i],
];
function skillSuggestions({ minCount = 3, limit = 4, lang = 'en' } = {}) {
  const d = raw(); const s = load();
  let rows = [];
  try { rows = d.prepare('SELECT f.conv_id AS id, f.title AS title, substr(f.body, 1, 300) AS head, c.updated AS updated FROM conv_fts f JOIN conversations c ON c.id = f.conv_id ORDER BY c.updated DESC LIMIT 400').all(); } catch {}
  const groups = new Map();
  const put = (key, r, label) => { const g = groups.get(key) || { key, label, convs: [] }; if (!g.convs.some((x) => x.id === r.id)) g.convs.push({ id: r.id, title: r.title || '' }); groups.set(key, g); };
  for (const r of rows) {
    const text = `${r.title || ''} ${r.head || ''}`;
    let hit = false;
    for (const [key, re] of TASKS) if (re.test(text)) { put('task:' + key, r, key); hit = true; }
    if (!hit) for (const w of new Set(words(r.title || '').filter((x) => x.length >= 5))) put('word:' + w, r, w);
  }
  // artifacts made again and again (same type)
  try { for (const a of d.prepare("SELECT type, COUNT(*) AS n, GROUP_CONCAT(title, '|') AS titles FROM artifacts GROUP BY type HAVING n >= ?").all(minCount)) groups.set('art:' + a.type, { key: 'art:' + a.type, label: a.type, convs: String(a.titles || '').split('|').slice(0, 6).map((t) => ({ title: t })), count: a.n }); } catch {}
  let have = [];
  try { have = require('./agent/skills').list().map((x) => norm(x.name + ' ' + (x.description || ''))); } catch {}
  const dismissed = new Set(s.dismissed.skills);
  const memories = list();
  const out = [];
  for (const g of groups.values()) {
    const count = g.count || g.convs.length;
    if (count < minCount || dismissed.has(g.key)) continue;
    const label = g.label;
    if (have.some((h) => h.includes(norm(label)))) continue;
    const titles = g.convs.map((c) => c.title).filter(Boolean).slice(0, 5);
    const kindOf = g.key.split(':')[0];
    const related = memories.filter((e) => overlap(label + ' ' + titles.join(' '), e.title + ' ' + e.content) >= 0.34).slice(0, 5);
    out.push({ key: g.key, type: kindOf, label, count, examples: titles, memory: related.map((e) => ({ title: e.title, content: e.content })), prompt: skillPrompt({ label, kind: kindOf, titles, memory: related, lang }) });
  }
  return out.sort((a, b) => (b.type === 'task') - (a.type === 'task') || b.count - a.count).slice(0, limit);
}
function skillPrompt({ label, kind, titles, memory, lang }) {
  const fr = lang === 'fr';
  const what = kind === 'art' ? (fr ? `les « ${label} » que je te fais faire` : `the "${label}" pieces I ask you to make`) : kind === 'task' ? (fr ? `ce genre de tâche (${label})` : `this kind of task (${label})`) : (fr ? `ce que je fais autour de « ${label} »` : `what I do around "${label}"`);
  const ex = titles.map((x) => `- ${x}`).join('\n');
  const mem = (memory || []).map((e) => `- ${e.title}: ${e.content}`).join('\n');
  return fr
    ? `Crée un skill pour ${what}, d’après ce que tu sais de ma façon de faire.\n\nCe que j’ai déjà fait avec toi :\n${ex}${mem ? `\n\nCe dont tu te souviens :\n${mem}` : ''}\n\nÉcris des instructions courtes et concrètes : quand l’utiliser, les étapes, le style que j’attends. Puis enregistre-le avec l’outil save_skill (nom court en minuscules avec des tirets).`
    : `Create a skill for ${what}, based on what you know about how I do it.\n\nWhat I already did with you:\n${ex}${mem ? `\n\nWhat you remember:\n${mem}` : ''}\n\nWrite short, concrete instructions: when to use it, the steps, the style I expect. Then save it with the save_skill tool (short lowercase name with dashes).`;
}

function dismiss(kind, key) {
  const s = load(); const l = kind === 'skill' ? s.dismissed.skills : s.dismissed.forgotten;
  if (!l.includes(key)) l.push(key);
  save(); return true;
}

function status() {
  const s = load(); const st = settings().memory || {};
  return { learn: learnOn(), use: memOn(), auto: st.auto !== false, entries: raw().prepare('SELECT COUNT(*) AS n FROM memories').get().n, profile: s.profile.length, synced: syncedChats().length, forgottenAt: s.forgottenAt || null };
}

// ───────────────────────────── save_skill tool (the model writes the skill the user asked for) ─────────────────────────────
function registerTool() {
  try {
    const agent = require('./agent');
    if (agent.get && agent.get('save_skill')) return;
    agent.register({
      name: 'save_skill', category: 'skills', risk: 'write',
      description: 'Save a skill (reusable instructions) in the user\'s skills folder. Use it when the user asks you to create a skill. name: short, lowercase, dashes; description: one line saying when to use it; body: the instructions in Markdown.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, body: { type: 'string' } }, required: ['name', 'description', 'body'] },
      summarize: (a) => a.name,
      async run(a) {
        const sk = require('./agent/skills');
        sk.create(a.name, a.description, a.body);
        const saved = (sk.scan() || []).find((x) => x.name === String(a.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''));
        return { content: `Skill "${saved ? saved.name : a.name}" saved${saved ? ` in ${saved.dir}` : ''}. It is now listed in Settings › Advanced › Skills.`, view: { kind: 'skill', name: saved ? saved.name : a.name } };
      },
    });
  } catch { /* agent runtime absent (tests) */ }
}

function init(ipcMain) {
  registerTool();
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));
  h('myfabro:status', () => status());
  h('myfabro:list', () => { syncComputed(); return list(); });
  h('myfabro:add', (o) => add(o || {}));
  h('myfabro:edit', (id, patch) => edit(id, patch));
  h('myfabro:pin', (id, on) => pin(id, on));
  h('myfabro:remove', (id) => remove(id));
  h('myfabro:forgetAll', () => forgetAll());
  h('myfabro:profile', () => profile());
  h('myfabro:setProfile', (text) => setProfileText(text));
  h('myfabro:editLine', (id, text) => editProfileLine(id, text));
  h('myfabro:removeLine', (id) => removeProfileLine(id));
  h('myfabro:timeline', () => timeline());
  h('myfabro:forgotten', () => forgotten());
  h('myfabro:skills', (lang) => skillSuggestions({ lang }));
  h('myfabro:dismiss', (kind, key) => dismiss(kind, key));
  h('myfabro:welcome', () => welcome());
  h('myfabro:synced', () => syncedChats().slice(0, 50).map((c) => ({ site: c.site, title: c.title, at: c.at })));
}

module.exports = {
  init, observe, forPrompt, list, get, upsert, add, edit, pin, remove, forgetAll,
  profile, addProfileLine, editProfileLine, removeProfileLine, setProfileText,
  timeline, forgotten, welcome, skillSuggestions, dismiss, status, syncedChats, syncComputed,
  vet, parseObserve, sensitiveKind, holdReason, flush, reset, KINDS, FIELDS,
};
