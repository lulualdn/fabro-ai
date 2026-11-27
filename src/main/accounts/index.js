// Local accounts (profiles) on one computer: up to 4, nothing in common, no server, no e-mail.
// See docs/v02/accounts.md for what is per account and what is shared, and what the password protects.
//
// Switching is a controlled relaunch: every per-account module (settings, database, scheduled tasks, MCP
// servers, Anywhere, mods and their web sessions…) starts clean on the new account, so nothing of one account
// can stay in memory for the next one. The picker runs before any of them is started.
const { app, BrowserWindow, ipcMain, nativeTheme, dialog, nativeImage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paths = require('../paths');
const registry = require('./registry');
const password = require('./password');
const vault = require('./vault');
const share = require('./models-share');
const migrate = require('./migrate');

let state = { phase: 'boot', fallback: false, error: null, current: null };
let picker = null, resolveOpen = null;
const log = (m) => { try { console.log(m); } catch {} };
const isMac = process.platform === 'darwin';

// ───────────────────────────── open an account ─────────────────────────────
function open(acc, dk = null) {
  const dir = registry.dirOf(acc.id);
  fs.mkdirSync(dir, { recursive: true });
  paths.setDataDir(dir, { id: acc.id, legacyPartitions: !!acc.legacyPartitions, outDir: acc.outDir || null });
  vault.setKey(dk);
  const reg = registry.get(); reg.lastActive = acc.id; reg.switchTo = null; registry.save();
  state = { ...state, phase: 'open', current: acc.id };
  if (resolveOpen) { const r = resolveOpen; resolveOpen = null; r(acc); }
  return acc;
}
const current = () => (state.current ? registry.find(state.current) : null);

function prettyUser() {
  try { const u = require('os').userInfo().username || ''; return u.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim(); } catch { return ''; }
}

// ───────────────────────────── create / delete ─────────────────────────────
async function create({ name, icon, color, password: pw } = {}) {
  const reg = registry.get();
  if (state.fallback) throw new Error('ACCOUNTS_UNAVAILABLE');
  if (reg.accounts.length >= registry.MAX) throw new Error('ACCOUNT_LIMIT');
  const n = registry.cleanName(name); if (!n) throw new Error('NAME_REQUIRED');
  const id = registry.newId();
  const acc = { id, name: n, icon: registry.ICONS.includes(icon) ? icon : 'initial', color: registry.COLORS.includes(color) ? color : registry.COLORS[reg.accounts.length % registry.COLORS.length],
    createdAt: Date.now(), password: null, keyWrap: null, legacyPartitions: false, outDir: registry.outDirFor(n, id) };
  if (pw) { acc.password = await password.hash(pw); acc.keyWrap = (await vault.wrapNew(pw)).wrap; }
  const dir = registry.dirOf(id);
  fs.mkdirSync(dir, { recursive: true });
  // the new person starts fresh: their name, the app's language if one was chosen, the welcome tour
  const lang = (() => { try { const l = require('../store').getSettings().language; return l && l !== 'auto' ? l : undefined; } catch { return undefined; } })();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ userName: n, ...(lang ? { language: lang } : {}), devModeReleased: true }, null, 2));
  share.setList(id, []);
  reg.accounts.push(acc); registry.save();
  return registry.publicView(acc);
}

// Everything of an account goes: its folder, its web sessions, the models nobody else uses.
// Never called for the open account (that one is deleted on the next start, before it opens).
async function deleteNow(id) {
  const reg = registry.get(); const acc = registry.find(id); if (!acc) return { ok: true };
  let freed = 0;
  try {
    const orphans = [...share.read(id)].filter((m) => !share.usersOf(m, id).length);
    if (orphans.length) freed = await require('../models').purge(orphans);
  } catch (e) { log('accounts: model cleanup ' + e.message); }
  const errors = [];
  try { await fsp.rm(registry.dirOf(id), { recursive: true, force: true, maxRetries: 3 }); } catch (e) { errors.push(e.message); }
  // Chromium keeps each persist: partition in <userData>/Partitions/<name>
  try {
    const pdir = paths.inShared('Partitions');
    for (const e of fs.existsSync(pdir) ? fs.readdirSync(pdir) : []) {
      const l = e.toLowerCase();
      const mine = acc.legacyPartitions ? (l.startsWith('mod-') || l === 'fabro-browser') : l.startsWith(`a-${id}-`);
      if (mine) await fsp.rm(path.join(pdir, e), { recursive: true, force: true, maxRetries: 3 }).catch((er) => errors.push(er.message));
    }
  } catch {}
  share.forget(id);
  reg.accounts = reg.accounts.filter((a) => a.id !== id);
  delete reg.attempts[id];
  if (reg.lastActive === id) reg.lastActive = reg.accounts[0] ? reg.accounts[0].id : null;
  // a folder Windows kept locked is finished on the next start
  reg.pendingDelete = (reg.pendingDelete || []).filter((x) => x !== id);
  if (errors.length && fs.existsSync(registry.dirOf(id))) reg.pendingDirs = [...new Set([...(reg.pendingDirs || []), id])];
  registry.save();
  return { ok: true, freed };
}

// ───────────────────────────── passwords ─────────────────────────────
async function check(acc, pw) {
  const reg = registry.get();
  const att = reg.attempts[acc.id];
  const wait = password.waitMs(att);
  if (wait) return { ok: false, wait };
  if (await password.verify(pw, acc.password)) { if (att) { delete reg.attempts[acc.id]; registry.save(); } return { ok: true }; }
  reg.attempts[acc.id] = password.fail(att); registry.save();
  return { ok: false, wrong: true, wait: password.waitMs(reg.attempts[acc.id]), left: Math.max(0, password.FREE - reg.attempts[acc.id].fails) };
}

async function setPassword({ current: cur, next } = {}) {
  const acc = current(); if (!acc) throw new Error('NO_ACCOUNT');
  if (acc.password) { const r = await check(acc, cur || ''); if (!r.ok) return r; }
  const dir = registry.dirOf(acc.id);
  if (!next) { // remove: secrets go back to the OS protection only
    vault.resealDir(dir, null); acc.password = null; acc.keyWrap = null; vault.setKey(null);
  } else if (!acc.password || !vault.getKey()) { // first password: a data key is made and the secrets are sealed with it
    const { dk, wrap } = await vault.wrapNew(next);
    vault.setKey(dk); vault.resealDir(dir, dk);
    acc.password = await password.hash(next); acc.keyWrap = wrap;
  } else { // change: same data key, wrapped with the new password
    acc.keyWrap = await vault.rewrap(vault.getKey(), next); acc.password = await password.hash(next);
  }
  registry.save();
  try { require('../providers').reloadSecrets(); } catch {}
  try { require('../anywhere').reload(); } catch {}
  return { ok: true, hasPassword: !!acc.password };
}

// ───────────────────────────── switching ─────────────────────────────
function relaunch() {
  // tests launch Fabro again themselves
  if (!process.env.FABRO_E2E) app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden' && !String(a).startsWith('fabro://')) });
  try { require('../desktop').setQuitting(); } catch {}
  setTimeout(() => app.quit(), 50);
  return { ok: true, restarting: true };
}
function switchTo(id) {
  const acc = registry.find(id); if (!acc) throw new Error('ACCOUNT_NOT_FOUND');
  if (id === state.current) return { ok: true, same: true };
  const reg = registry.get(); reg.switchTo = id; registry.save();
  return relaunch();
}
function lock() { const reg = registry.get(); reg.switchTo = null; reg.lockNext = true; registry.save(); return relaunch(); }

// ───────────────────────────── picker window ─────────────────────────────
function showPicker(preselect, direct) {
  const dark = nativeTheme.shouldUseDarkColors;
  picker = new BrowserWindow({
    width: 980, height: 680, minWidth: 560, minHeight: 480, show: false, title: 'Fabro',
    backgroundColor: dark ? '#12161d' : '#f6f5f1', titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 24, y: 25 } } : { titleBarOverlay: { color: dark ? '#12161d' : '#f6f5f1', symbolColor: dark ? '#c9cfd6' : '#3b3934', height: 44 } }),
    webPreferences: { preload: path.join(__dirname, '..', '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  picker.loadFile(path.join(__dirname, '..', '..', 'renderer', 'accounts.html'), { query: preselect ? { pick: preselect, direct: direct ? '1' : '0' } : {} });
  picker.once('ready-to-show', () => picker && picker.show());
  picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  picker.webContents.on('will-navigate', (e) => e.preventDefault());
  picker.on('closed', () => { const was = picker; picker = null; if (was && state.phase !== 'open') app.quit(); });
}
// Called by main.js once the main window exists: the picker goes when the app is on screen.
function handoff(win) {
  if (!picker) return;
  const p = picker; const close = () => { if (!p.isDestroyed()) p.destroy(); };
  win.once('ready-to-show', () => setTimeout(close, 80));
  setTimeout(close, 15000);
}
const pickerWindow = () => picker;

// ───────────────────────────── boot ─────────────────────────────
// Resolves once an account is open (or in fallback mode, the old location). Must run before store.init().
async function boot({ hidden = false } = {}) {
  register();
  const reg = registry.load();
  // finish what an earlier run left: removal of old copies, accounts deleted from inside themselves
  if (reg.migration && reg.migration.state === 'switched') await migrate.cleanup(log).catch(() => {});
  for (const id of [...(reg.pendingDelete || [])]) await deleteNow(id).catch((e) => log('accounts: delete ' + e.message));
  for (const id of [...(reg.pendingDirs || [])]) { try { await fsp.rm(registry.dirOf(id), { recursive: true, force: true }); reg.pendingDirs = reg.pendingDirs.filter((x) => x !== id); registry.save(); } catch {} }

  if (!reg.accounts.length) {
    if (migrate.hasLegacy()) {
      const r = await migrate.run(log);
      if (!r.ok) { state = { phase: 'open', fallback: true, error: r.error, current: null }; return null; } // keep using the old location
    } else {
      // fresh install (or every account was deleted): one account, no password, no picker
      const a = await create({ name: prettyUser() || 'Fabro' });
      registry.get().lastActive = a.id; registry.save();
    }
  } else if (!reg.migration) migrate.absorbSeed();

  const list = registry.get().accounts;
  const target = reg.switchTo ? registry.find(reg.switchTo) : null;
  const last = registry.find(reg.lastActive) || list[0];
  const forcePick = !!reg.lockNext;
  if (reg.lockNext || reg.switchTo) { reg.lockNext = false; reg.switchTo = null; registry.save(); }
  if (!forcePick) {
    if (target && !target.password) return open(target);
    if (list.length === 1 && !list[0].password) return open(list[0]);
    // started hidden at login: nobody is looking at a picker; open the last account if it has no password
    if (hidden && last && !last.password) return open(last);
  }
  state.phase = 'pick';
  const opened = new Promise((r) => { resolveOpen = r; });
  showPicker((target || last || {}).id, !!target);
  return opened;
}

// ───────────────────────────── IPC ─────────────────────────────
function inPicker(e) { return picker && e && e.sender === picker.webContents; }
let registered = false;
function register() {
  if (registered) return; registered = true;
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));
  const list = () => registry.get().accounts.map(registry.publicView);
  // the picker speaks the language last chosen on this computer (else the system's)
  const lastLang = () => { const a = registry.find(registry.get().lastActive); if (!a) return null; try { const l = JSON.parse(fs.readFileSync(path.join(registry.dirOf(a.id), 'settings.json'), 'utf8')).language; return l && l !== 'auto' ? l : null; } catch { return null; } };
  h('accounts:status', () => ({ phase: state.phase, fallback: state.fallback, error: state.error, max: registry.MAX, count: registry.get().accounts.length, icons: registry.ICONS, colors: registry.COLORS }));
  h('accounts:list', () => ({ accounts: list(), current: state.current, max: registry.MAX, icons: registry.ICONS, colors: registry.COLORS, langs: [lastLang(), ...app.getPreferredSystemLanguages()].filter(Boolean), locale: app.getLocale(), fallback: state.fallback }));
  h('accounts:current', () => { const a = current(); return a ? { ...registry.publicView(a), outDir: paths.outputDir() } : null; });
  h('accounts:create', (_e, o) => create(o || {}));

  // picker only
  h('accounts:open', (e, id) => { const a = registry.find(id); if (!inPicker(e) || state.phase !== 'pick' || !a) throw new Error('NOT_ALLOWED'); if (a.password) return { ok: false, needPassword: true }; open(a); return { ok: true }; });
  h('accounts:unlock', async (e, id, pw) => {
    const a = registry.find(id); if (!inPicker(e) || state.phase !== 'pick' || !a) throw new Error('NOT_ALLOWED');
    if (!a.password) { open(a); return { ok: true }; }
    const r = await check(a, String(pw || '')); if (!r.ok) return r;
    const dk = a.keyWrap ? await vault.unwrap(a.keyWrap, String(pw)) : null;
    open(a, dk); return { ok: true };
  });
  // forgotten password: the account and everything in it is deleted (typed name as confirmation)
  h('accounts:forget', async (e, id, typed) => {
    const a = registry.find(id); if (!inPicker(e) || state.phase !== 'pick' || !a) throw new Error('NOT_ALLOWED');
    if (registry.cleanName(typed).toLowerCase() !== a.name.toLowerCase()) return { ok: false, confirm: true };
    const r = await deleteNow(id);
    if (!registry.get().accounts.length) { const n = await create({ name: prettyUser() || 'Fabro' }); return { ...r, created: n }; }
    return r;
  });
  h('accounts:quit', (e) => { if (inPicker(e)) app.quit(); });

  // the open account only
  const need = () => { const a = current(); if (!a) throw new Error('NO_ACCOUNT'); return a; };
  h('accounts:update', async (_e, patch = {}) => {
    const a = need(); const old = a.name;
    if (patch.name != null) { const n = registry.cleanName(patch.name); if (!n) throw new Error('NAME_REQUIRED'); a.name = n; }
    if (patch.icon && registry.ICONS.includes(patch.icon)) a.icon = patch.icon;
    if (patch.color && registry.COLORS.includes(patch.color)) a.color = patch.color;
    registry.save();
    try { const store = require('../store'); const u = (store.getSettings().userName || '').trim(); if (a.name !== old && (!u || u === old)) await store.setSettings({ userName: a.name }); } catch {}
    return registry.publicView(a);
  });
  h('accounts:pickPicture', async (e) => {
    const a = need();
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return registry.publicView(a);
    const img = nativeImage.createFromPath(r.filePaths[0]); if (img.isEmpty()) throw new Error('BAD_IMAGE');
    const { width: w, height: hh } = img.getSize(); const s = Math.min(w, hh);
    const sq = img.crop({ x: Math.floor((w - s) / 2), y: Math.floor((hh - s) / 2), width: s, height: s }).resize({ width: 192, height: 192, quality: 'best' });
    fs.writeFileSync(path.join(registry.dirOf(a.id), 'avatar.png'), sq.toPNG());
    a.picture = true; registry.save(); return registry.publicView(a);
  });
  h('accounts:clearPicture', () => { const a = need(); a.picture = false; try { fs.rmSync(path.join(registry.dirOf(a.id), 'avatar.png'), { force: true }); } catch {} registry.save(); return registry.publicView(a); });
  h('accounts:setPassword', (_e, o) => setPassword(o || {}));
  h('accounts:switch', (_e, id) => { need(); return switchTo(id); });
  h('accounts:lock', () => { const a = need(); if (!a.password && registry.get().accounts.length < 2) return { ok: false }; return lock(); });
  // delete my own account: confirmed with its name (and its password if it has one), done on the next start
  h('accounts:delete', async (_e, o = {}) => {
    const a = need();
    if (registry.cleanName(o.confirm).toLowerCase() !== a.name.toLowerCase()) return { ok: false, confirm: true };
    if (a.password) { const r = await check(a, o.password || ''); if (!r.ok) return r; }
    const reg = registry.get(); reg.pendingDelete = [...new Set([...(reg.pendingDelete || []), a.id])]; reg.switchTo = null; reg.lockNext = false; registry.save();
    return relaunch();
  });
  h('accounts:counts', async () => {
    const a = need(); const dir = registry.dirOf(a.id);
    const c = (() => { try { return require('../db').counts(); } catch { return {}; } })();
    let tasks = 0; try { tasks = require('../tasks').list().length; } catch {}
    let bytes = 0; const walk = async (p) => { for (const e of await fsp.readdir(p, { withFileTypes: true }).catch(() => [])) { const f = path.join(p, e.name); if (e.isDirectory()) await walk(f); else bytes += (await fsp.stat(f).catch(() => ({ size: 0 }))).size; } };
    await walk(dir);
    return { ...c, tasks, models: share.mine() ? share.mine().size : 0, bytes };
  });
  // models: mine, the ones other accounts have (name + size only), link / unlink
  h('accounts:models', () => require('../models').sharing());
  h('accounts:linkModel', async (_e, id) => { need(); const m = await require('../models').link(id); emitModels(); return m; });
  h('accounts:unlinkModel', async (_e, id) => { need(); try { await require('../engine').stop(id); } catch {} const r = await require('../models').remove(id); emitModels(); return r; });
}
let emitter = () => {};
const emitModels = () => emitter('accounts:event', { type: 'models' });
const setEmitter = (fn) => { emitter = fn || (() => {}); };

module.exports = { boot, handoff, pickerWindow, isOpen: () => state.phase === 'open', current, status: () => state, setEmitter, _test: { create, deleteNow, setPassword, open, check, switchTo, lock, state: () => state, reset: () => { state = { phase: 'boot', fallback: false, error: null, current: null }; registered = false; } } };
