const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu } = require('electron');
const path = require('path');
const store = require('./store');
const system = require('./system');
const engine = require('./engine');
const models = require('./models');
const chat = require('./chat');
const updater = require('./updater');

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const isMac = process.platform === 'darwin';

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

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
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Developer mode: F12 / Ctrl+Shift+I devtools, Ctrl+R reload.
  win.webContents.on('before-input-event', (e, input) => {
    if (!store.getSettings().devMode || input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (k === 'f12' || ((input.control || input.meta) && input.shift && k === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    if ((input.control || input.meta) && !input.shift && k === 'r') { win.webContents.reload(); e.preventDefault(); }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

  h('app:info', () => ({
    version: app.getVersion(), platform: process.platform, packaged: app.isPackaged,
    locale: app.getLocale(), systemLanguages: app.getPreferredSystemLanguages(),
    userName: (() => { try { return require('os').userInfo().username; } catch { return ''; } })(),
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
  h('models:delete', (id) => models.remove(id));

  h('engine:status', () => engine.getStatus());
  h('engine:update', () => engine.checkUpdate());
  h('engine:reinstall', () => engine.install());
  h('engine:stop', () => engine.stop());

  h('chat:send', (payload) => { chat.send(payload, (ev) => send('chat:event', ev)); return true; });
  h('chat:abort', (id) => chat.abort(id));

  h('updater:check', () => updater.check());
  h('updater:install', () => updater.install());

  // Extension modes (projects / agent / code) — wired in a later version.
  h('modes:install', async (mode) => ({ ok: false, mode, reason: 'coming_soon' }));

  h('shell:open', (url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  h('window:devtools', () => { if (win) win.webContents.toggleDevTools(); });
  h('window:theme', (dark) => { if (!isMac && win) try { win.setTitleBarOverlay(overlayColors(dark)); } catch {} });
  h('window:buttons', (visible) => { if (isMac && win) win.setWindowButtonVisibility(!!visible); });
}

app.whenReady().then(async () => {
  store.init();
  if (!isMac) Menu.setApplicationMenu(null);
  registerIpc();
  models.init((p) => send('models:progress', p));
  await engine.init((s) => send('engine:status', s));
  updater.init(send);
  createWindow();
  system.getSpecs(); // warm cache

  if (store.getSettings().autoUpdate) {
    setTimeout(() => {
      updater.check();
      engine.checkUpdate().catch(() => {});
    }, 10000);
    setInterval(() => engine.checkUpdate().catch(() => {}), 6 * 3600 * 1000);
  }
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('before-quit', () => { engine.stop(); });
