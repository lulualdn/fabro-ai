const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, dialog } = require('electron');
const path = require('path');
const store = require('./store');
const system = require('./system');
const engine = require('./engine');
const models = require('./models');
const chat = require('./chat');
const updater = require('./updater');
const providers = require('./providers');
const desktop = require('./desktop');
const usage = require('./usage');
const monitor = require('./monitor');
const localapi = require('./localapi');

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); if (ch === 'chat:event') desktop.forward(ch, data); };
const isMac = process.platform === 'darwin';

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => desktop.showMain());

function overlayColors(dark) {
  if (store.getSettings().devMode) return { color: dark ? '#3a2a12' : '#f6d48a', symbolColor: dark ? '#f6d48a' : '#3a2a12', height: 28 };
  return { color: dark ? '#12161d' : '#f6f5f1', symbolColor: dark ? '#c9cfd6' : '#3b3934', height: 44 };
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 760, minHeight: 520, show: false,
    title: 'Fabro',
    backgroundColor: dark ? '#12161d' : '#f6f5f1',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 24, y: 25 } } : { titleBarOverlay: overlayColors(dark) }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true,
      backgroundThrottling: false, // keeps streaming while hidden in the tray (quick bar answers)
    },
  });
  desktop.attachMain(win);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Developer mode: F12 / Ctrl+Shift+I devtools, Ctrl+R reload.
  win.webContents.on('before-input-event', (e, input) => {
    if (!store.getSettings().devMode || input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (k === 'f12' || ((input.control || input.meta) && input.shift && k === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    if ((input.control || input.meta) && !input.shift && k === 'r') { win.webContents.reload(); e.preventDefault(); }
  });
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

  h('app:info', () => ({
    version: app.getVersion(), platform: process.platform, packaged: app.isPackaged,
    locale: app.getLocale(), systemLanguages: app.getPreferredSystemLanguages(),
    userName: (() => { try { return require('os').userInfo().username; } catch { return ''; } })(),
    lanIp: (() => { try { return Object.values(require('os').networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address || ''; } catch { return ''; } })(),
  }));
  h('settings:get', () => store.getSettings());
  h('settings:set', (patch) => store.setSettings(patch));
  h('system:specs', () => system.getSpecs());

  h('conv:list', () => store.listConversations());
  h('conv:get', (id) => store.getConversation(id));
  h('conv:save', (c) => store.saveConversation(c));
  h('conv:delete', (id) => store.deleteConversation(id));
  h('conv:patch', (id, patch) => store.patchConversation(id, patch));

  h('models:catalog', () => models.catalog());
  h('models:installed', () => models.installed());
  h('models:search', (q) => models.search(q));
  h('models:files', (repo) => models.repoFiles(repo));
  h('models:download', (o) => models.download(o));
  h('models:cancel', (id) => models.cancel(id));
  h('models:pause', (id) => models.pause(id));
  h('models:resume', (id) => models.resume(id));
  h('models:delete', async (id) => { await engine.stop(id); return models.remove(id); });
  h('models:rename', (id, name) => models.rename(id, name));
  h('models:verify', (id) => models.verify(id));
  h('models:move', (id, lib) => models.move(id, lib, () => engine.stop(id)));
  h('models:plans', () => models.plans((m) => engine.optionsFor(m)));
  h('models:libraries', () => models.librariesView());
  h('models:addLibrary', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : models.addLibrary(r.filePaths[0]);
  });
  h('models:removeLibrary', (id) => models.removeLibrary(id));
  h('models:defaultLibrary', (id) => models.setDefaultLibrary(id));
  h('models:scanImports', async (pick) => {
    let folder = null;
    if (pick) { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return null; folder = r.filePaths[0]; }
    return models.scanImports(folder);
  });
  h('models:import', (list) => models.importModels(list));
  h('models:profile', async (id, patch) => { await store.setSettings({ modelProfiles: { [id]: patch } }); return store.getSettings().modelProfiles[id]; });

  h('engine:status', () => engine.getStatus());
  h('engine:update', () => engine.checkUpdate());
  h('engine:reinstall', () => engine.install());
  h('engine:stop', (id) => engine.stop(id));
  h('engine:load', async (id) => { const m = await models.getLocal(id); if (!m) throw new Error('Model not found'); await engine.ensure(m); return true; });
  h('engine:rollback', () => engine.rollback('manual'));
  h('engine:logs', () => engine.logs());
  h('engine:energy', () => engine.setEnergy());
  h('monitor:sample', () => monitor.sample(engine.getStatus().loaded || []));
  h('usage:summary', (days) => usage.summary(days || 30));
  h('usage:conv', (id) => usage.forConv(id));
  h('usage:clear', () => usage.clear());
  h('localapi:status', () => localapi.getStatus());
  h('localapi:apply', () => localapi.apply());
  h('localapi:models', async () => (await localapi.catalog()).map(({ _ref, ...m }) => m));
  h('engine:diagnostics', async () => ({ app: app.getVersion(), platform: `${process.platform} ${process.arch}`, electron: process.versions.electron, ...(await engine.diagnostics()) }));

  h('providers:view', () => providers.view());
  h('providers:detect', () => providers.detect());
  h('providers:add', (o) => providers.add(o));
  h('providers:update', (id, patch) => providers.update(id, patch));
  h('providers:remove', (id) => providers.remove(id));
  h('providers:refresh', (id) => providers.refresh(id));
  h('providers:enable', (on) => providers.setEnabled(on));
  h('providers:models', () => providers.chatModels());

  h('chat:send', (payload) => { chat.send(payload, (ev) => send('chat:event', ev)); return true; });
  h('chat:abort', (id) => chat.abort(id));

  h('updater:check', () => updater.check());
  h('updater:install', () => updater.install());

  // Extension modes (projects / agent / code) — wired in a later version.
  h('modes:install', async (mode) => ({ ok: false, mode, reason: 'coming_soon' }));

  h('shell:open', (url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  h('shell:reveal', (p) => { if (typeof p === 'string' && require('fs').existsSync(p)) shell.showItemInFolder(p); });
  h('window:devtools', () => { if (win) win.webContents.toggleDevTools(); });
  h('window:theme', (dark) => { if (!isMac && win) try { win.setTitleBarOverlay(overlayColors(dark)); } catch {} });
  h('window:buttons', (visible) => { if (isMac && win) win.setWindowButtonVisibility(!!visible); });
}

app.whenReady().then(async () => {
  store.init();
  await providers.migrate();
  if (!isMac) Menu.setApplicationMenu(null);
  registerIpc();
  models.init((p) => send('models:progress', p));
  await engine.init((s) => send('engine:status', s));
  localapi.init((st) => send('localapi:status', st)).catch(() => {});
  setTimeout(() => engine.preloadAll(async () => (await models.installed()).local).catch(() => {}), 2500);
  updater.init(send);
  createWindow();
  desktop.init(() => win, (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a)));
  if (process.argv.includes('--hidden')) win.once('ready-to-show', () => win.hide());
  system.getSpecs(); // warm cache

  if (store.getSettings().autoUpdate) {
    const engineUpdate = () => engine.checkUpdate().then((r) => {
      if (r && r.updated) desktop.notify(desktop.tr('engUpdT'), desktop.tr('engUpdB').replace('{v}', r.version));
    }).catch(() => {});
    setTimeout(() => { updater.check(); engineUpdate(); }, 10000);
    setInterval(engineUpdate, 6 * 3600 * 1000);
  }
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('activate', () => { if (win) desktop.showMain(); else createWindow(); });
app.on('before-quit', () => { engine.stop(); });
app.on('will-quit', () => { engine.stop(); });
