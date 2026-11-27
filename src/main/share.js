// Share a conversation or an artifact by link (fabro.ufstudios.eu/s/<id>).
// What leaves the computer is a snapshot made here, and only when the user clicks "Create link":
//   conversation → the visible messages (text only: no attached files, pictures or local paths), step names, sources;
//   artifact     → its last version.
// The site keeps it (Netlify Blobs, site/netlify/functions/share.mjs). Each link comes with a secret token kept
// here only, needed to remove it. Links made from this computer are listed in <data>/shares.json.
const fs = require('fs');
const path = require('path');

const SITE = process.env.FABRO_SITE || 'https://fabro.ufstudios.eu';
const file = () => path.join(require('./paths').dataDir(), 'shares.json');
const load = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; } };
const save = (l) => { fs.writeFileSync(file() + '.tmp', JSON.stringify(l, null, 1)); fs.renameSync(file() + '.tmp', file()); };

const HOME = require('os').homedir();
// local paths and the user's home folder never leave the computer
const scrub = (s) => String(s || '').split(HOME).join('~').replace(/[A-Za-z]:\\[^\s"'`)<>]+/g, '[fichier]');

async function snapshotConv(id) {
  const A = require('../anywhere/core.js');
  const c = await require('./store').getConversation(String(id));
  if (!c) throw new Error('Conversation not found');
  const msgs = A.pathOf(c).filter((n) => !n.pending && (n.content || (n.attachments || []).length)).slice(-200).map((n) => {
    const steps = (n.steps || []).filter((s) => !s.parent).slice(0, 60);
    const sources = []; for (const s of steps) for (const x of (s.view && s.view.sources) || []) if (x && /^https?:/.test(x.url || '') && !sources.some((y) => y.url === x.url)) sources.push({ url: x.url, title: String(x.title || '').slice(0, 200) });
    return {
      role: n.role === 'assistant' ? 'assistant' : 'user',
      content: scrub(String(n.content || '').slice(0, 60000)),
      files: (n.attachments || []).map((a) => String(a.name || '').slice(0, 120)).filter(Boolean),
      model: n.role === 'assistant' ? String(n.model || '').slice(0, 80) : undefined,
      steps: steps.map((s) => s.name).filter(Boolean),
      sources: sources.slice(0, 20),
      artifacts: steps.filter((s) => s.view && s.view.kind === 'artifact').map((s) => ({ title: String(s.view.title || '').slice(0, 160), type: s.view.type || '' })),
    };
  });
  return { kind: 'conv', title: String(c.title || '').slice(0, 160), created: c.createdAt || Date.now(), messages: msgs };
}
function snapshotArtifact(id) {
  const a = require('./db').getArtifact(String(id));
  if (!a) throw new Error('Artifact not found');
  const last = (a.versions || [])[a.versions.length - 1] || {};
  const content = String(last.content || '');
  if (content.length > 2_000_000) throw new Error('Artifact too large to share (2 MB max)');
  return { kind: 'artifact', title: String(a.title || '').slice(0, 160), type: String(a.type || ''), lang: String(a.lang || ''), content, created: Date.now() };
}

async function create({ kind, id }) {
  const snap = kind === 'artifact' ? snapshotArtifact(id) : await snapshotConv(id);
  const { net, app } = require('electron');
  const r = await net.fetch(SITE + '/api/share', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fabro-version': app.getVersion() }, body: JSON.stringify(snap) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(j.error || `HTTP ${r.status}`);
  const entry = { id: j.id, token: j.token, kind, ref: String(id), title: snap.title, at: Date.now(), url: `${SITE}/s/${j.id}` };
  save([entry, ...load().filter((x) => !(x.kind === kind && x.ref === String(id)))].slice(0, 500));
  return { url: entry.url, id: entry.id };
}
async function remove(shareId) {
  const l = load(); const e = l.find((x) => x.id === shareId); if (!e) return false;
  const { net } = require('electron');
  const r = await net.fetch(`${SITE}/api/share?id=${encodeURIComponent(e.id)}`, { method: 'DELETE', headers: { 'x-share-token': e.token } });
  if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
  save(l.filter((x) => x.id !== shareId)); return true;
}
// links already made for this conversation or artifact (the token stays here)
const list = (kind, ref) => load().filter((x) => (!kind || x.kind === kind) && (!ref || x.ref === String(ref))).map(({ token, ...x }) => x);

function register(h) {
  h('share:create', (o) => create(o || {}));
  h('share:remove', (id) => remove(String(id || '')));
  h('share:list', (kind, ref) => list(kind, ref));
}
module.exports = { register, create, remove, list, _test: { snapshotConv, snapshotArtifact, scrub } };
