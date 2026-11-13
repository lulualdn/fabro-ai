// One-time move of a pre-accounts install into account #1: copy → verify → switch → remove the old copies.
// The state is written to accounts.json at each step, so an interrupted move resumes on the next start:
//   copying  → the old location is still the real one: the copy is redone from scratch
//   switched → the account folder is the real one: only the removal of the old copies is retried
// If the copy or the check fails, Fabro keeps using the old location (fallback) and says so; nothing is lost.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const paths = require('../paths');
const registry = require('./registry');
const share = require('./models-share');

// What belongs to the person (relative to userData). Everything else there is machine-wide and stays.
const FILES = ['settings.json', 'settings.json.bak', 'fabro.db', 'fabro.db-wal', 'fabro.db-shm', 'secrets.json', 'anywhere.json', 'tasks.json', 'usage.json', 'kit-icons.json', 'kit-photos.json'];
const DIRS = ['conversations', 'projects', 'checkpoints', 'skills', 'mods', 'mod-data', 'webimg', 'thumbs', 'office', path.join('computer', 'shots')];
const ITEMS = [...FILES, ...DIRS];
// machine-wide keys of the old settings file go to machine.json (see store.js)
const { SHARED_KEYS } = require('../store');

const src = (rel) => paths.inShared(rel);
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const hasLegacy = () => ITEMS.some((r) => exists(src(r))) || exists(src(path.join('models', 'index.json')));

async function sha(file) {
  return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex'))); });
}
async function walk(p, out = []) {
  const st = await fsp.lstat(p);
  if (st.isDirectory()) for (const e of await fsp.readdir(p)) await walk(path.join(p, e), out);
  else if (st.isFile()) out.push(p);
  return out;
}
// every file of the source is in the copy, same size, same content
async function verify(from, to) {
  for (const f of await walk(from)) {
    const g = path.join(to, path.relative(from, f));
    const [a, b] = await Promise.all([fsp.stat(f), fsp.stat(g)]);
    if (a.size !== b.size) throw new Error(`size differs: ${path.relative(paths.sharedDir(), f)}`);
    if (await sha(f) !== await sha(g)) throw new Error(`content differs: ${path.relative(paths.sharedDir(), f)}`);
  }
}

function prettyUser() {
  try { const u = require('os').userInfo().username || ''; return u.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim(); } catch { return ''; }
}
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

// Returns { ok: true, account } or { ok: false, error } (fallback: keep the old location).
async function run(log = () => {}) {
  const reg = registry.get();
  const id = (reg.migration && reg.migration.id) || registry.newId();
  const to = registry.dirOf(id);
  reg.migration = { id, state: 'copying', at: Date.now() }; registry.save();
  try {
    await fsp.rm(to, { recursive: true, force: true });
    await fsp.mkdir(to, { recursive: true });
    for (const rel of ITEMS) {
      const s = src(rel); if (!exists(s)) continue;
      const d = path.join(to, rel);
      await fsp.mkdir(path.dirname(d), { recursive: true });
      await fsp.cp(s, d, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true });
      await verify(s, d);
    }
    // machine-wide settings: machine.json (kept if it is already there)
    const old = readJSON(src('settings.json')) || readJSON(src('settings.json.bak')) || {};
    if (!exists(src('machine.json'))) fs.writeFileSync(src('machine.json'), JSON.stringify(Object.fromEntries(Object.entries(old).filter(([k]) => SHARED_KEYS.includes(k))), null, 2));
    // every model already installed is in account #1's list
    const index = readJSON(src(path.join('models', 'index.json'))) || [];
    share.setList(id, index.map((m) => m && m.id).filter(Boolean));
    const name = registry.cleanName(old.userName) || prettyUser() || 'Fabro';
    const account = { id, name, icon: 'initial', color: 'coral', createdAt: Date.now(), password: null, legacyPartitions: true, outDir: null };
    // the switch: from here on the account folder is the real one
    reg.accounts = [account]; reg.lastActive = id; reg.migration = { id, state: 'switched', at: Date.now() };
    registry.save();
    log(`accounts: moved the existing data into account ${id}`);
  } catch (e) {
    reg.migration = { id, state: 'failed', error: String(e && e.message || e), at: Date.now() }; registry.save();
    await fsp.rm(to, { recursive: true, force: true }).catch(() => {});
    log('accounts: migration failed, keeping the old location: ' + e.message);
    return { ok: false, error: reg.migration.error };
  }
  await cleanup(log);
  return { ok: true, account: registry.find(id) };
}

// Remove the old copies (after the switch). A file Windows keeps locked stays for the next start.
async function cleanup(log = () => {}) {
  const reg = registry.get();
  if (!reg.migration || reg.migration.state !== 'switched') return true;
  const left = [];
  for (const rel of ITEMS) {
    const s = src(rel); if (!exists(s)) continue;
    // never remove an old copy whose account copy is missing
    if (!exists(path.join(registry.dirOf(reg.migration.id), rel))) { left.push(rel); continue; }
    try { await fsp.rm(s, { recursive: true, force: true }); } catch (e) { left.push(rel); }
  }
  try { const c = src('computer'); if (exists(c) && !(await fsp.readdir(c)).length) await fsp.rmdir(c); } catch {}
  if (left.length) { reg.migration.left = left; registry.save(); log('accounts: old copies kept for now: ' + left.join(', ')); return false; }
  reg.migration = null; registry.save();
  return true;
}

// After the move, the Windows installer may write a fresh settings.json at the top again (reinstall): its
// machine-wide choices (model disk, first model) are taken into machine.json, the file is set aside.
function absorbSeed() {
  const f = src('settings.json'); if (!exists(f)) return false;
  const seed = readJSON(f) || {};
  const m = readJSON(src('machine.json')) || {};
  if (Array.isArray(seed.libraries)) { const have = new Set((m.libraries || []).map((l) => l.id)); m.libraries = [...(m.libraries || []), ...seed.libraries.filter((l) => l && !have.has(l.id))]; }
  if (seed.defaultLibrary) m.defaultLibrary = seed.defaultLibrary;
  if (seed.firstModel) m.firstModel = seed.firstModel;
  fs.writeFileSync(src('machine.json'), JSON.stringify(m, null, 2));
  try { fs.renameSync(f, f + '.absorbed'); } catch { try { fs.rmSync(f, { force: true }); } catch {} }
  return true;
}

module.exports = { run, cleanup, absorbSeed, hasLegacy, ITEMS };
