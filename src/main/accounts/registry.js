// The account list (machine-wide): <userData>/accounts.json. Each account's own data is in <userData>/accounts/<id>/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('../paths');

const MAX = 4; // existing installs with 5 keep them; a 5th can't be created
const ICONS = ['initial', 'star', 'sun', 'moon', 'rocket', 'bulb', 'book', 'brush', 'globe', 'zap', 'flask', 'home'];
const COLORS = ['coral', 'amber', 'moss', 'teal', 'sky', 'rose', 'slate', 'sand'];
const file = () => paths.inShared('accounts.json');
const root = () => paths.inShared('accounts');
const dirOf = (id) => path.join(root(), String(id).replace(/[^a-z0-9]/g, ''));
const newId = () => 'a' + crypto.randomBytes(5).toString('hex');

const empty = () => ({ version: 1, accounts: [], lastActive: null, switchTo: null, migration: null, attempts: {}, pendingDelete: [] });
let reg = null;
function load() {
  try { reg = { ...empty(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch {
    // a damaged list: the copy kept beside it
    try { reg = { ...empty(), ...JSON.parse(fs.readFileSync(file() + '.bak', 'utf8')) }; } catch { reg = empty(); }
  }
  return reg;
}
const get = () => reg || load();
// Small file, rare writes (create, rename, password, switch): written synchronously and atomically, with a backup.
function save() {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const text = JSON.stringify(reg, null, 2);
  fs.writeFileSync(f + '.tmp', text, { mode: 0o600 });
  try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch {}
  fs.renameSync(f + '.tmp', f);
}
const exists = () => fs.existsSync(file());
const find = (id) => get().accounts.find((a) => a.id === id) || null;

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
function pictureOf(a) {
  if (!a.picture) return null;
  try { return 'data:image/png;base64,' + fs.readFileSync(path.join(dirOf(a.id), 'avatar.png')).toString('base64'); } catch { return null; }
}
// What anyone at the picker may see about an account: nothing more than this.
const publicView = (a) => a && ({ id: a.id, name: a.name, icon: ICONS.includes(a.icon) ? a.icon : 'initial', color: COLORS.includes(a.color) ? a.color : 'coral', picture: pictureOf(a), hasPassword: !!a.password, createdAt: a.createdAt });

// "Fabro - Emma": the account's own default folder for what the agent makes (a sibling of ~/Documents/Fabro).
function outDirFor(name, id) {
  const base = path.join(require('os').homedir(), 'Documents');
  const safe = cleanName(name).replace(/[\\/:*?"|.]+/g, ' ').trim() || id;
  let d = path.join(base, `Fabro - ${safe}`), i = 2;
  while (get().accounts.some((a) => a.outDir === d)) d = path.join(base, `Fabro - ${safe} ${i++}`);
  return d;
}

module.exports = { MAX, ICONS, COLORS, file, root, dirOf, newId, load, get, save, exists, find, publicView, cleanName, outDirFor };
