// Embedded web apps for mods: a real website (with its own persistent sign-in) shown in the chat area,
// plus hidden pages to read data from it. Mods use this through fabro.web (see mods.js).
const { WebContentsView, BrowserWindow, session } = require('electron');

// A plain desktop Chrome user agent: some sign-in pages refuse "Electron" browsers.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const views = new Map(); // id -> { view, bounds, visible, partition }
let host = null, emit = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function init(win, emitter) { host = win; emit = emitter; }

function prepareSession(partition) {
  const ses = session.fromPartition(partition);
  if (!ses.__fabroReady) {
    ses.__fabroReady = true;
    ses.setUserAgent(UA);
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications', 'media'].includes(perm)));
  }
  return ses;
}

function get(id, partition) {
  let v = views.get(id);
  if (v && !v.view.webContents.isDestroyed()) return v;
  prepareSession(partition);
  const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true } });
  view.setBackgroundColor('#00000000');
  try { view.setBorderRadius(22); } catch {} // matches the chat area's rounded corners
  host.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  wc.setUserAgent(UA);
  // Links that open a new window stay inside the same view (sign-in popups included).
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { partition, sandbox: true } } };
    return { action: 'deny' };
  });
  const pub = (type, extra) => emit('mods:web', { id, type, url: wc.getURL(), title: wc.getTitle(), ...extra });
  wc.on('did-navigate', () => pub('navigate'));
  wc.on('did-navigate-in-page', () => pub('navigate'));
  wc.on('page-title-updated', () => pub('title'));
  wc.on('did-stop-loading', () => pub('loaded'));
  wc.on('page-favicon-updated', (_e, icons) => pub('favicon', { icons }));
  v = { view, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false, partition };
  views.set(id, v);
  return v;
}

function setBounds(id, b) {
  const v = views.get(id); if (!v) return;
  const z = host && !host.isDestroyed() ? host.webContents.getZoomFactor() : 1;
  v.bounds = { x: Math.round((b.x + 1) * z), y: Math.round((b.y + 1) * z), width: Math.max(0, Math.round((b.width - 2) * z)), height: Math.max(0, Math.round((b.height - 2) * z)) };
  v.visible = !!b.visible && v.bounds.width > 20 && v.bounds.height > 20;
  v.view.setBounds(v.bounds); v.view.setVisible(v.visible);
  if (v.visible) { try { host.contentView.addChildView(v.view); } catch {} } // keep it on top of other views
}
function hideAll() { for (const v of views.values()) { v.visible = false; v.view.setVisible(false); } }
async function load(id, partition, url) { const v = get(id, partition); await v.view.webContents.loadURL(url).catch(() => {}); return v.view.webContents.getURL(); }
const wcOf = (id) => { const v = views.get(id); return v && !v.view.webContents.isDestroyed() ? v.view.webContents : null; };
async function exec(id, js) { const wc = wcOf(id); return wc ? wc.executeJavaScript(js, true) : null; }
function url(id) { const wc = wcOf(id); return wc ? wc.getURL() : ''; }

async function waitFor(wc, js, timeout = 15000, every = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await wc.executeJavaScript(js, true); if (r) return r; } catch {}
    await wait(every);
  }
  return null;
}

// Press Enter in the site's message box once the page is ready.
//   mode 'prefilled': the site put the text there itself (from the URL); if the box is empty, the site
//                     already sent it, so nothing is typed again.
//   mode 'type':      Fabro types the text first.
async function submit(id, { text, selector, mode = 'type', timeout = 25000 }) {
  const wc = wcOf(id); if (!wc) return { ok: false, reason: 'no view' };
  const sel = JSON.stringify(selector);
  const box = await waitFor(wc, `(() => { const e = document.querySelector(${sel}); return !!(e && e.getBoundingClientRect().width); })()`, timeout);
  if (!box) return { ok: false, reason: 'no message box' };
  const read = () => wc.executeJavaScript(`(() => { const e = document.querySelector(${sel}); if (!e) return ''; return String(e.value ?? e.innerText ?? '').trim(); })()`, true).catch(() => '');
  // the site may fill the box a moment after its message box appears
  let cur = await read();
  if (mode === 'prefilled') { const t0 = Date.now(); while (!cur && Date.now() - t0 < 2500) { await wait(200); cur = await read(); } if (!cur) return { ok: true, sent: 'by-site' }; }
  await wc.executeJavaScript(`(() => { const e = document.querySelector(${sel}); if (e) { e.focus(); if (e.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } } })()`, true).catch(() => {});
  wc.focus();
  if (mode === 'type' && text && !cur) { wc.insertText(text); await wait(300); }
  await wait(200);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  return { ok: true, sent: 'enter' };
}

// Read data from a page in a hidden window (same sign-in as the visible view).
async function scrape({ partition, url: u, script, ready, timeout = 25000 }) {
  prepareSession(partition);
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition, sandbox: true, contextIsolation: true, offscreen: false, backgroundThrottling: false } });
  try {
    w.webContents.setUserAgent(UA);
    w.webContents.setAudioMuted(true);
    await w.loadURL(u).catch(() => {});
    if (ready) await waitFor(w.webContents, ready, timeout, 400);
    await wait(600);
    return await w.webContents.executeJavaScript(script, true);
  } finally { try { w.destroy(); } catch {} }
}

async function cookies(partition, filter) { return session.fromPartition(partition).cookies.get(filter || {}).catch(() => []); }
async function clear(partition) { const ses = session.fromPartition(partition); await ses.clearStorageData().catch(() => {}); await ses.clearCache().catch(() => {}); }

module.exports = { init, get, load, setBounds, hideAll, exec, url, submit, scrape, cookies, clear, waitFor, wcOf, UA };
