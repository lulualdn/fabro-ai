// Models: the files are shared on disk (<userData>/models, index.json), each account has its own list of the
// models it uses (accounts/<id>/models.json). A file is deleted only when no account lists it any more.
// Without an open account (plain-node tests, migration fallback) nothing is filtered.
const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const registry = require('./registry');

const listFile = (id) => path.join(registry.dirOf(id), 'models.json');
const cache = new Map(); // account id → Set of model ids
function read(id) {
  if (cache.has(id)) return cache.get(id);
  let s; try { s = new Set(JSON.parse(fs.readFileSync(listFile(id), 'utf8')).ids || []); } catch { s = new Set(); }
  cache.set(id, s); return s;
}
function write(id) {
  const f = listFile(id); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify({ ids: [...read(id)] })); fs.renameSync(f + '.tmp', f);
}
const me = () => paths.accountId();
const active = () => !!me();
const others = () => registry.get().accounts.map((a) => a.id).filter((id) => id !== me());

// filter for models.listLocal(): null = no filtering
const mine = () => (active() ? read(me()) : null);
function add(modelId, ids = [me()]) { for (const id of ids.filter(Boolean)) { const s = read(id); if (!s.has(modelId)) { s.add(modelId); write(id); } } }
function drop(modelId, id = me()) { if (!id) return; const s = read(id); if (s.delete(modelId)) write(id); }
const usersOf = (modelId, except = me()) => registry.get().accounts.map((a) => a.id).filter((id) => id !== except && read(id).has(modelId));
const setList = (id, ids) => { cache.set(id, new Set(ids)); write(id); };
const forget = (id) => cache.delete(id);

// Models other accounts use that I don't: only what is needed to offer them (never whose they are).
function othersHave(index) {
  if (!active()) return [];
  const m = mine(), theirs = new Set(others().flatMap((id) => [...read(id)]));
  return index.filter((x) => theirs.has(x.id) && !m.has(x.id)).map((x) => ({ id: x.id, name: x.name, sizeBytes: x.sizeBytes || 0 }));
}

module.exports = { mine, add, drop, usersOf, othersHave, setList, forget, active, read };
