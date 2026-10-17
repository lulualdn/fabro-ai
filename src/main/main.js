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
const db = require('./db');
const brain = require('./brain');
const exporter = require('./export');
const agent = require('./agent');
require('./agent/files'); require('./agent/shell'); require('./agent/documents'); require('./agent/plan'); require('./agent/layout'); require('./agent/extras');
const browser = require('./agent/browser');
const skills = require('./agent/skills');
const python = require('./agent/python');
const mcp = require('./agent/mcp');
const searxng = require('./searxng');
const tools = require('./tools');
const code = require('./code');
const rag = require('./rag');
const voice = require('./voice');
const images = require('./images');
const crash = require('./crash');
const runtime = require('./runtime');
const anywhere = require('./anywhere');
const S = () => store.getSettings();
exporter.registerScheme();
// Fabro Anywhere: let phones on the same network reach the computer directly (real local addresses
// instead of obfuscated .local names in WebRTC candidates).
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let win = null;
const agentReqs = new Map(); // desktop requests that used tools → notify paired phones when they finish in the background
const send = (ch, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
  if (ch === 'chat:event') {
    desktop.forward(ch, data);
    if (data.type === 'tool_start' && !data.parent) agentReqs.set(data.reqId, (agentReqs.get(data.reqId) || 0) + 1);
    if ((data.type === 'done' || data.type === 'error') && agentReqs.has(data.reqId)) {
      const n = agentReqs.get(data.reqId); agentReqs.delete(data.reqId);
      if (n >= 2 && data.type === 'done' && win && !win.isDestroyed() && (!win.isVisible() || !win.isFocused())) {
        win.webContents.executeJavaScript('S.conv ? JSON.stringify({ id: S.conv.id, title: S.conv.title }) : null', true)
          .then((j) => { const c = j ? JSON.parse(j) : {}; anywhere.desktopAgentDone({ title: c.title || 'Fabro', convId: c.id }); }).catch(() => {});
      }
    }
  }
};
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
  // Microphone for dictation / voice mode (the app's own page only); nothing else.
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb, details) => cb(wc === win.webContents && (perm === 'media' && (!details.mediaTypes || details.mediaTypes.every((t) => t === 'audio')) || perm === 'clipboard-sanitized-write')));
  win.webContents.session.setPermissionCheckHandler((wc, perm) => perm === 'media' || perm === 'clipboard-sanitized-write');
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

  h('conv:list', (o) => db.listConversations(o || {}));
  h('conv:get', (id) => db.getConversation(id));
  h('conv:save', (c) => db.saveConversation(anywhere.mergeOnSave(c)));
  h('conv:delete', (id) => { anywhere.tombstone(id); return db.deleteConversation(id); });
  h('conv:patch', (id, patch) => db.patchConversation(id, patch));
  h('conv:search', (text) => db.searchConversations(text));

  h('memory:list', () => db.listMemories());
  h('memory:add', (text) => db.addMemory(text, 'user', 'fact'));
  h('memory:update', (id, text) => db.updateMemory(id, text));
  h('memory:delete', (id) => db.deleteMemory(id));
  h('memory:clear', () => db.clearMemories());
  h('artifacts:list', () => db.listArtifacts());
  h('artifacts:get', (id) => db.getArtifact(id));
  h('artifacts:save', async (a) => { const saved = db.saveArtifact(a); if (saved && saved.pdf && saved.pdf.file) { try { await require('./agent/layout').buildPdf(db.getArtifact(saved.id), null); } catch (e) { console.error('pdf rebuild', e); } } return saved; });
  h('artifacts:delete', (id) => db.deleteArtifact(id));
  h('export:save', (o) => exporter.save(win, o));
  h('art:preview', (html) => exporter.setPreview(html));
  h('brain:title', (o) => brain.title(o));
  h('brain:memories', (o) => brain.memories(o));
  h('brain:style', (o) => brain.style(o));

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
  h('chat:answer', (reqId, callId, value) => chat.answer(reqId, callId, value));

  h('agent:tools', () => agent.list());
  h('agent:policy', async (name, value) => { await agent.setPolicy(name, value); return agent.list(); });
  h('agent:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const cur = (store.getSettings().agent || {}).folders || [];
    await store.setSettings({ agent: { folders: [...new Set([...cur, r.filePaths[0]])] } });
    return store.getSettings().agent.folders;
  });
  h('agent:removeFolder', async (f) => { await store.setSettings({ agent: { folders: ((store.getSettings().agent || {}).folders || []).filter((x) => x !== f) } }); return store.getSettings().agent.folders; });
  h('browser:bounds', (b) => browser.setBounds(b));
  h('browser:control', (action, arg) => browser.control(action, arg));
  h('browser:state', () => browser.state());
  h('deps:status', async () => ({ ...python.deps(), searxng: searxng.status(), git: (await code.deps()).git }));
  h('deps:install', async (dep) => {
    const prog = (p) => send('deps:progress', { dep, p });
    if (dep === 'python') return python.install(prog);
    if (dep === 'searxng') { const r = await searxng.install(prog); await store.setSettings({ search: { searxngDeclined: false } }); searxng.start(S().lang).catch(() => {}); return r; }
    if (dep === 'git') return code.install(prog);
    if (dep === 'images') return images.install(prog);
    if (dep === 'voice') return voice.install(prog);
    throw new Error('Unknown dependency');
  });
  h('deps:remove', (dep) => { if (dep === 'searxng') return searxng.remove(); throw new Error('Unknown dependency'); });
  // Tool runtime + crash reports
  h('runtime:status', () => runtime.status());
  h('crash:list', () => crash.list().map(({ stack, ...r }) => r));
  h('crash:folder', () => { require('fs').mkdirSync(crash.dir(), { recursive: true }); shell.openPath(crash.dir()); });
  h('crash:report', (file) => { const r = crash.list().find((x) => x.file === file); if (r) shell.openExternal(crash.issueUrl(r)); });

  // Images
  h('images:status', () => images.status());
  h('images:install', (preset) => images.install((p) => send('deps:progress', { dep: 'images', p }), preset));

  // Voice
  // Fabro Anywhere (phones)
  h('anywhere:status', () => anywhere.status());
  h('anywhere:pairStart', () => anywhere.pairStart());
  h('anywhere:pairStop', () => anywhere.pairStop());
  h('anywhere:revoke', (id) => anywhere.revoke(id));
  h('anywhere:rename', (id, name) => anywhere.rename(id, name));
  h('anywhere:configure', (patch) => anywhere.configure(patch || {}));
  const asks = new Map();
  h('anywhere:reply', (id, value) => { const r = asks.get(id); if (r) { asks.delete(id); r(value); } return true; });
  anywhere.init({
    emit: (ch, d) => send(ch, d),
    ask: (name) => new Promise((resolve) => {
      if (!win || win.isDestroyed()) return resolve(null);
      const id = Math.random().toString(36).slice(2);
      asks.set(id, resolve);
      win.webContents.send('anywhere:ask', { id, name });
      setTimeout(() => { if (asks.delete(id)) resolve(null); }, 2000);
    }),
  });

  h('voice:status', () => voice.status());
  h('voice:install', () => voice.install((p) => send('deps:progress', { dep: 'voice', p }), { lang: S().language && S().language !== 'auto' ? S().language : app.getLocale().slice(0, 2) }));
  h('voice:stt', (wav, o) => voice.stt(wav, o));
  h('voice:tts', (text, o) => voice.tts(text, o));
  h('voice:setVoice', (id) => voice.setVoice(id, (p) => send('deps:progress', { dep: 'voice', p })));
  h('voice:setWhisper', (size) => voice.setWhisper(size, (p) => send('deps:progress', { dep: 'voice', p })));

  // Projects
  h('projects:list', () => db.listProjects());
  h('projects:get', (id) => db.getProject(id));
  h('projects:save', (p) => db.saveProject({ ...p, id: p.id || 'prj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }));
  h('projects:delete', (id) => rag.removeProject(id));
  h('projects:addFiles', async (id, paths) => {
    if (!paths || !paths.length) {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'txt', 'md', 'csv', 'json', 'html', 'htm', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'lua', 'luau', 'css', 'xml', 'yml', 'yaml', 'toml', 'sql', 'tex', 'srt'] }, { name: '*', extensions: ['*'] }] });
      if (r.canceled) return db.getProject(id);
      paths = r.filePaths;
    }
    return rag.addFiles(id, paths);
  });
  h('projects:addText', (id, name, text) => rag.addText(id, name, text));
  h('projects:removeFile', (id, fileId) => rag.removeFile(id, fileId));
  h('projects:search', (id, q) => rag.search(id, q, 8));
  h('projects:ragStatus', () => rag.status());
  h('projects:reindex', (id) => rag.embedProject(id));

  // Code mode
  h('code:open', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const i = await code.info(r.filePaths[0]); code.watch(i.root); return i;
  });
  h('code:info', async (root) => { const i = await code.info(root); code.watch(root); return i; });
  h('code:close', () => { code.watch(null); return true; });
  h('code:recent', () => code.recent());
  h('code:tree', (root, rel) => code.tree(root, rel));
  h('code:status', (root) => code.status(root));
  h('code:read', (root, rel) => code.readFile(root, rel));
  h('code:write', (root, rel, content) => code.writeFile(root, rel, content));
  h('code:diff', (convId, root, rel) => code.fileDiff(convId, root, rel));
  h('code:changes', (convId) => code.sessionChanges(convId));
  h('code:revert', (convId, turnId) => code.revert(convId, turnId));
  h('code:git', (root, action, arg) => code.gitAction(root, action, arg));
  h('code:branches', (root) => code.branches(root));
  h('code:log', (root) => code.log(root));
  h('code:run', (root, command, kind) => code.run(root, command, kind));
  h('code:kill', (id) => code.kill(id));
  h('code:project', (root, patch) => code.setProject(root, patch));
  h('code:preview', (root, rel) => code.previewUrl(root, rel));
  h('search:test', async (q) => tools.webSearch(q || 'Fabro AI', {}));
  h('mcp:view', () => mcp.view());
  h('mcp:add', (cfg) => mcp.add(cfg));
  h('mcp:remove', (id) => mcp.remove(id));
  h('mcp:toggle', (id, on) => mcp.toggle(id, on));
  h('mcp:signin', (id) => mcp.signIn(id));
  h('mcp:reconnect', async (id) => { const c = ((store.getSettings().mcp || {}).servers || []).find((x) => x.id === id); return c ? mcp.connect(c) : mcp.view(); });
  h('mcp:claudeConfig', () => mcp.readClaudeConfig());
  h('mcp:importClaude', (names) => mcp.importClaude(names));
  h('skills:list', () => skills.scan());
  h('skills:toggle', (name, on) => skills.setEnabled(name, on));
  h('skills:create', (o) => skills.create(o.name, o.description, o.body));
  h('skills:openFolder', () => { const d = skills.dirs()[0]; require('fs').mkdirSync(d, { recursive: true }); shell.openPath(d); });

  h('updater:check', () => updater.check());
  h('updater:install', () => updater.install());

  // Extension modes (projects / agent / code) — wired in a later version.
  h('modes:install', async (mode) => ({ ok: false, mode, reason: 'coming_soon' }));

  h('shell:open', (url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  h('shell:openPath', (p) => { if (typeof p === 'string' && require('fs').existsSync(p) && !/\.(exe|bat|cmd|ps1|sh|msi|com|scr|vbs|js|lnk)$/i.test(p)) return shell.openPath(p); });
  h('shell:reveal', (p) => { if (typeof p === 'string' && require('fs').existsSync(p)) shell.showItemInFolder(p); });
  h('window:devtools', () => { if (win) win.webContents.toggleDevTools(); });
  h('window:theme', (dark) => { if (!isMac && win) try { win.setTitleBarOverlay(overlayColors(dark)); } catch {} });
  h('window:buttons', (visible) => { if (isMac && win) win.setWindowButtonVisibility(!!visible); });
}

app.whenReady().then(async () => {
  store.init();
  crash.init(() => win);
  searxng.configure({ deps: process.env.FABRO_DEPS || path.join(app.getPath('userData'), 'deps'), python: async (prog) => { await python.install((p) => prog(p * 0.3)); return python.pyPath(); } });
  // 0.1.9: SearXNG becomes the default search engine (DuckDuckGo stays the fallback).
  if (!(S().search || {}).v2) await store.setSettings({ search: { engine: (S().search || {}).engine === 'duckduckgo' ? 'searxng' : (S().search || {}).engine, v2: true } });
  try { db.init(); } catch (e) { console.error('db init failed', e); }
  exporter.handleProtocol();
  await providers.migrate();
  if (!isMac) Menu.setApplicationMenu(null);
  registerIpc();
  models.init((p) => send('models:progress', p));
  // First model chosen in the Windows installer: start its download once, into the chosen disk.
  const fm = S().firstModel;
  if (fm && fm.catalogId) {
    (async () => {
      const inst = await models.installed();
      if (!inst.local.length && !inst.downloads.length) await models.download({ repo: fm.repo, catalogId: fm.catalogId, library: fm.library && fm.library.id !== 'default' ? fm.library.id : undefined });
      await store.setSettings({ firstModel: null });
    })().catch((e) => console.error('first model', e));
  }
  await engine.init((s) => send('engine:status', s));
  localapi.init((st) => send('localapi:status', st)).catch(() => {});
  setTimeout(() => engine.preloadAll(async () => (await models.installed()).local).catch(() => {}), 2500);
  updater.init(send);
  createWindow();
  browser.init(win, send);
  mcp.init(send);
  code.init(send);
  rag.init(send);
  voice.init(async (prog) => { await python.install(prog); return python.pyPath(); });
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
app.on('before-quit', () => { engine.stop(); searxng.stop(); voice.stop(); runtime.stop(); });
app.on('will-quit', () => { engine.stop(); mcp.stopAll(); db.close(); });
