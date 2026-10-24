// Mods: full modding of Fabro. A mod is a folder with a mod.json and up to three parts:
//   main      Node code run in the main process (full access to Electron and to Fabro's internal modules)
//   renderer  scripts run inside the app window (full access to the UI: every global, plus the `fabro` API)
//   quick     scripts run inside the quick bar window
//   styles    CSS added to the app window
// Built-in mods live in src/mods, the user's in <userData>/mods. See MODDING.md.
const { app, dialog, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const web = require('./webapps');
const browserImport = require('./browser-import');

const BUILTIN = path.join(__dirname, '..', 'mods');
const userDir = () => path.join(app.getPath('userData'), 'mods');
const dataRoot = () => path.join(app.getPath('userData'), 'mod-data');
const ms = () => store.getSettings().mods || {};
const active = new Map(); // id -> { exports, fabro, handlers, cleanups }
let getWin = () => null, getQuick = () => null;

function readManifest(dir, builtin) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
    if (!m.id || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(m.id)) return null;
    return { ...m, dir, builtin };
  } catch { return null; }
}
function scan() {
  const out = new Map();
  const add = (root, builtin) => {
    let names = []; try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch {}
    for (const n of names) { const m = readManifest(path.join(root, n), builtin); if (m && !(builtin === false && out.has(m.id) && out.get(m.id).builtin)) out.set(m.id, m); }
  };
  add(BUILTIN, true); add(userDir(), false);
  return out;
}
const isEnabled = (id) => !!(ms().enabled || {})[id];

// Paths a mod may load: inside its own folder; built-in mods may also use the shared folder next to them.
function resolveFile(m, rel) {
  const p = path.resolve(m.dir, rel);
  const roots = [m.dir + path.sep]; if (m.builtin) roots.push(BUILTIN + path.sep);
  if (!roots.some((r) => p.startsWith(r))) throw new Error(`${m.id}: ${rel} is outside the mod`);
  return p;
}
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function emitTo(wc, ch, data) { try { if (wc && !wc.isDestroyed()) wc.send(ch, data); } catch {} }
function emit(id, type, data) {
  const w = getWin(), q = getQuick();
  emitTo(w && w.webContents, 'mods:event', { mod: id, type, data });
  emitTo(q && q.webContents, 'mods:event', { mod: id, type, data });
}

function fabroFor(m) {
  const handlers = new Map(); const cleanups = [];
  const dataDir = path.join(dataRoot(), m.id);
  const partition = 'persist:mod-' + m.id;
  const vid = (k) => m.id + (k ? ':' + k : '');
  const api = {
    id: m.id, manifest: m, dir: m.dir, dataDir, partition,
    electron: require('electron'),
    core: (name) => require('./' + String(name).replace(/[^a-zA-Z0-9_/-]/g, '')), // Fabro's internal modules
    store,
    mainWindow: () => getWin(),
    quickWindow: () => getQuick(),
    handle: (method, fn) => handlers.set(method, fn),
    emit: (type, data) => emit(m.id, type, data),
    onCleanup: (fn) => cleanups.push(fn),
    log: (...a) => console.log(`[mod:${m.id}]`, ...a),
    settings: {
      get: () => ((ms().data || {})[m.id]) || {},
      set: async (patch) => { await store.setSettings({ mods: { data: { [m.id]: { ...(((ms().data || {})[m.id]) || {}), ...patch } } } }); return api.settings.get(); },
    },
    readJSON: (file, def) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { return def; } },
    writeJSON: (file, v) => { fs.mkdirSync(dataDir, { recursive: true }); const f = path.join(dataDir, file); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); },
    web: {
      UA: web.UA,
      load: (url, key) => web.load(vid(key), partition, url),
      url: (key) => web.url(vid(key)),
      exec: (js, key) => web.exec(vid(key), js),
      submit: (o, key) => web.submit(vid(key), o),
      waitFor: (js, timeout, key) => { const wc = web.wcOf(vid(key)); return wc ? web.waitFor(wc, js, timeout) : null; },
      contents: (key) => web.wcOf(vid(key)),
      ensure: (key) => web.get(vid(key), partition).view.webContents,
      scrape: (o) => web.scrape({ partition, ...o }),
      cookies: (filter) => web.cookies(partition, filter),
      clear: () => web.clear(partition),
      browsers: () => browserImport.list(),                                  // the user's installed browsers
      importCookies: (o) => browserImport.importInto(require('electron').session.fromPartition(partition), o), // { browser, profile, domains }
      openExternal: (url) => { if (/^https?:/.test(String(url || ''))) require('electron').shell.openExternal(url); }, // the user's real default browser
    },
  };
  return { api, handlers, cleanups };
}

async function activate(m) {
  if (active.has(m.id)) return;
  const rec = fabroFor(m);
  active.set(m.id, { ...rec, exports: null });
  if (!m.main) return;
  try {
    const file = resolveFile(m, m.main);
    delete require.cache[require.resolve(file)];
    const ex = require(file);
    active.get(m.id).exports = ex;
    if (ex && typeof ex.activate === 'function') await ex.activate(rec.api);
  } catch (e) { console.error(`[mod:${m.id}] activate failed`, e); active.get(m.id).error = String(e && e.message || e); }
}
async function deactivate(id) {
  const a = active.get(id); if (!a) return;
  try { if (a.exports && a.exports.deactivate) await a.exports.deactivate(); } catch (e) { console.error(e); }
  for (const fn of a.cleanups) { try { fn(); } catch {} }
  active.delete(id);
}

// Renderer code for a window kind ('main' or 'quick'), wrapped so each mod gets its own `fabro` handle.
function rendererBundle(kind) {
  const mods = scan(); const parts = []; const css = [];
  for (const m of mods.values()) {
    if (!isEnabled(m.id)) continue;
    for (const rel of list(kind === 'quick' ? m.quick : m.renderer)) {
      try {
        const code = fs.readFileSync(resolveFile(m, rel), 'utf8');
        parts.push(`try { (function (fabro) {\n${code}\n})(window.fabro.forMod(${JSON.stringify(m.id)})); } catch (e) { console.error('[mod:${m.id}]', e); }\n//# sourceURL=fabro-mod://${m.id}/${rel.replace(/^\.\.\//, '')}`);
      } catch (e) { console.error(`[mod:${m.id}] ${rel}`, e.message); }
    }
    if (kind === 'main') for (const rel of list(m.styles)) { try { css.push(fs.readFileSync(resolveFile(m, rel), 'utf8')); } catch {} }
  }
  return { js: parts, css: css.join('\n') };
}
async function inject(wc, kind) {
  const b = rendererBundle(kind);
  if (b.css) await wc.insertCSS(b.css).catch(() => {});
  for (const js of b.js) await wc.executeJavaScript(js, true).catch((e) => console.error('mod inject', e));
  await wc.executeJavaScript('window.fabro && window.fabro._loaded && window.fabro._loaded()', true).catch(() => {});
  const pending = ms().pendingSetup || [];
  if (kind === 'main' && pending.length) {
    await store.setSettings({ mods: { pendingSetup: [] } });
    setTimeout(() => pending.forEach((id) => emit(id, 'setup', {})), 400);
  }
}

function view() {
  const mods = scan();
  return [...mods.values()].map((m) => ({
    id: m.id, name: m.name || m.id, version: m.version || '', description: m.description || '', author: m.author || '',
    builtin: m.builtin, enabled: isEnabled(m.id), setup: !!m.setup, commands: m.commands || [], homepage: m.homepage || '',
    icon: m.icon ? (() => { try { const f = resolveFile(m, m.icon); const ext = path.extname(f).slice(1).replace('svg', 'svg+xml'); return `data:image/${ext};base64,${fs.readFileSync(f).toString('base64')}`; } catch { return ''; } })()
      : (() => { try { return JSON.parse(fs.readFileSync(path.join(dataRoot(), m.id, 'icon.json'), 'utf8')).icon || ''; } catch { return ''; } })(), // the site's own icon, once seen
    error: (active.get(m.id) || {}).error || '',
    status: (({ connected, lastSync, lastCount, lastNamed, lastVia, lastError }) => ({ connected, lastSync, lastCount, lastNamed, lastVia, lastError }))(((ms().data || {})[m.id]) || {}),
  })).sort((a, b) => (b.builtin - a.builtin) || a.name.localeCompare(b.name));
}

async function setEnabled(id, on, { setup = false } = {}) {
  const m = scan().get(id); if (!m) throw new Error('Unknown mod');
  await store.setSettings({ mods: { enabled: { [id]: !!on }, ...(setup && on ? { pendingSetup: [...new Set([...(ms().pendingSetup || []), id])] } : {}) } });
  if (on) await activate(m); else await deactivate(id);
  const w = getWin(); if (w && !w.isDestroyed()) w.webContents.reload(); // renderer parts reload with the window
  const q = getQuick(); if (q && !q.isDestroyed()) q.webContents.reload();
  return view();
}

async function installFrom(src) {
  const os = require('os');
  let dir = src, tmp = null;
  if (/\.zip$/i.test(src)) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-mod-')); await require('extract-zip')(src, { dir: tmp }); dir = fs.existsSync(path.join(tmp, 'mod.json')) ? tmp : path.join(tmp, fs.readdirSync(tmp).find((n) => fs.existsSync(path.join(tmp, n, 'mod.json'))) || ''); }
  const m = readManifest(dir, false); if (!m) throw new Error('mod.json not found or invalid');
  if (scan().get(m.id)?.builtin) throw new Error(`"${m.id}" is the id of a built-in mod`);
  const dest = path.join(userDir(), m.id);
  await deactivate(m.id);
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(userDir(), { recursive: true });
  fs.cpSync(dir, dest, { recursive: true });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  return m.id;
}
async function uninstall(id) {
  const m = scan().get(id); if (!m) return view();
  await deactivate(id);
  await store.setSettings({ mods: { enabled: { [id]: false } } });
  if (!m.builtin) fs.rmSync(m.dir, { recursive: true, force: true });
  fs.rmSync(path.join(dataRoot(), id), { recursive: true, force: true });
  await web.clear('persist:mod-' + id); // sign-out of the embedded site
  const w = getWin(); if (w && !w.isDestroyed()) w.webContents.reload();
  return view();
}

async function call(id, method, args) {
  const a = active.get(id); if (!a) throw new Error(`Mod "${id}" is not enabled`);
  const fn = a.handlers.get(method); if (!fn) throw new Error(`Mod "${id}" has no "${method}"`);
  return fn(...(args || []));
}

function init({ win, quick }) {
  getWin = win; getQuick = quick;
  web.init(win(), (ch, d) => { const w = getWin(); emitTo(w && w.webContents, ch, d); });
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));
  h('mods:list', () => view());
  h('mods:ready', (e, kind) => inject(e.sender, kind === 'quick' ? 'quick' : 'main'));
  h('mods:enable', (_e, id, on, opts) => setEnabled(id, on, opts || {}));
  h('mods:uninstall', (_e, id) => uninstall(id));
  h('mods:call', (_e, id, method, args) => call(id, method, args));
  h('mods:openFolder', () => { fs.mkdirSync(userDir(), { recursive: true }); shell.openPath(userDir()); });
  h('mods:addFrom', async (_e, kind) => {
    const r = await dialog.showOpenDialog(win(), kind === 'zip' ? { properties: ['openFile'], filters: [{ name: 'Fabro mod', extensions: ['zip'] }] } : { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const id = await installFrom(r.filePaths[0]);
    return { id, list: view() };
  });
  h('mods:browsers', () => browserImport.list());
  h('mods:importCookies', (_e, id, o) => call(id, 'importCookies', [o]));
  h('mods:webBounds', (_e, key, b) => web.setBounds(key, b));
  h('mods:webHide', () => web.hideAll());
  h('mods:commands', () => view().filter((m) => m.enabled).flatMap((m) => (m.commands || []).map((c) => ({ ...c, mod: m.id }))));
  // Main parts of enabled mods start with the app.
  for (const m of scan().values()) if (isEnabled(m.id)) activate(m);
  app.on('will-quit', () => { for (const id of [...active.keys()]) deactivate(id); });
}

module.exports = { init, view, scan, call, emit };
