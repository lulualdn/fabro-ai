// Fabro Overlay (mod, off by default). The model puts things on the desktop:
//   · widgets: rounded cards placed where it wants, that stay on the desktop (saved, back at the next start);
//   · full-screen elements: drawn over the whole screen (a message, an animation, a guide), not saved.
// One transparent window above everything. It lets the mouse through, except over an interactive element and over
// the Fabro mark (top right, half transparent) that closes the overlay.
// An element can look at the screen: every N seconds Fabro sends a picture of the screen and the element's question
// to the model, and gives the answer to the element (fabro.onAI). An element can also ask the model itself (fabro.ask).
// Tools for the model: overlay_show, overlay_remove, overlay_list.
const path = require('path'); const fs = require('fs');

let fabro = null; let win = null; let ready = false; let hidden = false;
let elements = []; const timers = new Map(); const busy = new Set();
const FILE = 'elements.json';
const clampN = (v, d, a, b) => Math.max(a, Math.min(b, Number.isFinite(Number(v)) ? Number(v) : d));

function display() { const { screen } = fabro.electron; return screen.getPrimaryDisplay(); }
async function theme() {
  const vars = {}; let mark = '';
  try { mark = (fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'icons.js'), 'utf8').match(/FABRO_MARK = '([^']+)'/) || [])[1] || ''; } catch {}
  try {
    const w = fabro.mainWindow();
    const got = await w.webContents.executeJavaScript(`(() => { const cs = getComputedStyle(document.documentElement); const o = {}; for (const k of ['bg','panel','elev','border','border-strong','text','text-2','muted','accent','accent-ink','accent-soft','ok','warn','err','logo','font-ui','font-display','font-mono']) o[k] = cs.getPropertyValue('--' + k).trim(); return o; })()`);
    for (const [k, v] of Object.entries(got || {})) if (v) vars[k] = v;
  } catch {}
  return { vars, mark };
}
const send = (d) => { if (win && !win.isDestroyed() && ready) win.webContents.send('overlay:ev', d); };
async function push() { send({ type: 'state', theme: await theme(), elements: hidden ? [] : elements }); }
const save = () => { try { fabro.writeJSON(FILE, elements.filter((e) => e.kind === 'widget')); } catch {} };

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  const { BrowserWindow } = fabro.electron; const b = display().bounds; ready = false;
  win = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, transparent: true, frame: false, resizable: false, movable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, alwaysOnTop: true, show: false, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.setAlwaysOnTop(true, 'screen-saver');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'overlay.html'));
  win.on('closed', () => { win = null; ready = false; });
  return win;
}
function refresh() {
  const any = elements.length && !hidden;
  if (!any) { if (win && !win.isDestroyed()) win.hide(); stopWatch(); return; }
  ensureWindow(); if (ready) { push(); win.showInactive(); }
  startWatch();
}

// ── looking at the screen ──
async function screenshot() {
  const { desktopCapturer } = fabro.electron; const d = display(); const k = Math.min(1, 1280 / d.size.width);
  const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * k), height: Math.round(d.size.height * k) } });
  const s = src.find((x) => String(x.display_id) === String(d.id)) || src[0];
  if (!s || s.thumbnail.isEmpty()) throw new Error('The screen could not be captured.');
  return 'data:image/jpeg;base64,' + s.thumbnail.toJPEG(70).toString('base64');
}
async function askModel(text, withScreen) {
  const chat = fabro.core('chat'); const model = fabro.store.getSettings().selectedModel;
  if (!model) throw new Error('No model selected.');
  let content = text;
  if (withScreen) {
    // the overlay itself must not be in the picture
    const shown = win && !win.isDestroyed() && win.isVisible(); if (shown) win.setOpacity(0);
    try { await new Promise((r) => setTimeout(r, 60)); content = [{ type: 'text', text }, { type: 'image_url', image_url: { url: await screenshot() } }]; } finally { if (shown && win && !win.isDestroyed()) win.setOpacity(1); }
  }
  return chat.quick(model, [{ role: 'system', content: 'You are Fabro, answering for a small widget on the user\'s desktop. Answer in a few words or one short sentence, in the user\'s language, no Markdown.' }, { role: 'user', content }], { maxTokens: 160, vision: !!withScreen });
}
function stopWatch() { for (const t of timers.values()) clearInterval(t); timers.clear(); }
function startWatch() {
  stopWatch();
  for (const el of elements) {
    if (!el.watch) continue;
    timers.set(el.id, setInterval(async () => {
      if (busy.size || hidden) return; // one question at a time: the engine has one slot
      busy.add(el.id);
      try { send({ type: 'ai', id: el.id, text: await askModel(el.watch.prompt, true) }); } catch (e) { fabro.log('watch', el.id, e.message); } finally { busy.delete(el.id); }
    }, el.watch.every * 1000));
  }
}

// ── tools ──
function place(a, prev) {
  const wa = display().workArea; const w = clampN(a.w, prev ? prev.w : 280, 120, wa.width); const h = clampN(a.h, prev ? prev.h : 180, 60, wa.height); const m = 24;
  const anchors = { 'top-left': [m, m], 'top-right': [wa.width - w - m, m + 48], 'bottom-left': [m, wa.height - h - m], 'bottom-right': [wa.width - w - m, wa.height - h - m], center: [(wa.width - w) / 2, (wa.height - h) / 2], top: [(wa.width - w) / 2, m], bottom: [(wa.width - w) / 2, wa.height - h - m] };
  const [ax, ay] = anchors[a.anchor] || (prev ? [prev.x, prev.y] : anchors['top-right']);
  return { w, h, x: Math.round(clampN(a.x, ax, 0, wa.width - 40) + (a.x == null ? 0 : 0)), y: Math.round(clampN(a.y, ay, 0, wa.height - 30)) };
}
function registerTools() {
  const agent = fabro.core('agent');
  const base = { category: 'overlay', mod: 'overlay', topLevelOnly: true, keywords: ['widget', 'overlay', 'bureau', 'desktop', 'écran', 'screen', 'plein écran', 'fullscreen', 'affiche sur', 'horloge', 'clock', 'rappel'] };
  agent.register({ ...base, name: 'overlay_show', risk: 'write',
    description: 'Put something on the user\'s desktop, above every window (Fabro Overlay). kind "widget": a rounded card that stays on the desktop (clock, to-do, timer, monitor, note…). kind "fullscreen": drawn over the whole screen with a transparent background (a big message, an animation, arrows that guide the user); keep it light and remove it when it is no longer useful. You write the content: html, css, js run alone in a frame, without network; use the CSS variables --panel, --elev, --border, --text, --muted, --accent, --ok, --err and the fonts given. Inside js: fabro.ask("question") → Promise of the model\'s short answer; fabro.onAI((text) => …) receives the answer each time the element looks at the screen. interactive false = the mouse goes through it. watch_every (seconds, 20 minimum) + watch_prompt: the element looks at the screen at that pace and the answer to watch_prompt goes to fabro.onAI; only when the user asked for something that watches the screen. Calling it again with the same id replaces the element.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Short name, to change or remove it later' }, kind: { type: 'string', enum: ['widget', 'fullscreen'] }, title: { type: 'string' },
      html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' },
      anchor: { type: 'string', enum: ['top-left', 'top', 'top-right', 'center', 'bottom-left', 'bottom', 'bottom-right'], description: 'Where the widget goes (default top-right)' },
      x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number', description: 'Width in px (default 280)' }, h: { type: 'number', description: 'Height in px (default 180)' },
      bare: { type: 'boolean', description: 'true: no card around the widget (your HTML draws everything; keep rounded corners)' },
      interactive: { type: 'boolean', description: 'Default: true for a widget, false for fullscreen' },
      watch_every: { type: 'number' }, watch_prompt: { type: 'string' },
    }, required: ['kind', 'html'] },
    summarize: (a) => String(a.title || a.id || a.kind || ''),
    async run(a) {
      const kind = a.kind === 'fullscreen' ? 'fullscreen' : 'widget';
      const id = String(a.id || a.title || kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || kind;
      const prev = elements.find((e) => e.id === id);
      const el = { id, kind, title: String(a.title || '').slice(0, 60), html: String(a.html || '').slice(0, 60000), css: String(a.css || '').slice(0, 30000), js: String(a.js || '').slice(0, 60000),
        bare: !!a.bare, interactive: a.interactive != null ? !!a.interactive : kind === 'widget', ...(kind === 'widget' ? place(a, prev) : {}) };
      if (a.watch_every && a.watch_prompt) el.watch = { every: clampN(a.watch_every, 60, 20, 3600), prompt: String(a.watch_prompt).slice(0, 1000) };
      elements = elements.filter((e) => e.id !== id).concat(el); hidden = false; save(); refresh();
      return { content: `${prev ? 'Replaced' : 'Shown'} on the desktop: ${kind} "${id}"${kind === 'widget' ? ` at ${el.x},${el.y} (${el.w}×${el.h})` : ''}${el.watch ? `, looks at the screen every ${el.watch.every} s` : ''}. The user closes the overlay with the Fabro mark, top right. Remove it with overlay_remove {"id":"${id}"}.` };
    } });
  agent.register({ ...base, name: 'overlay_remove', risk: 'write', description: 'Remove one element of the desktop overlay by id, or all of them with {"all": true}.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, all: { type: 'boolean' } } }, summarize: (a) => (a.all ? 'all' : String(a.id || '')),
    async run(a) { const n = elements.length; elements = a.all ? [] : elements.filter((e) => e.id !== String(a.id || '')); save(); refresh(); return { content: n === elements.length ? `Nothing named "${a.id}". On the desktop: ${elements.map((e) => e.id).join(', ') || 'nothing'}.` : `Removed. Left on the desktop: ${elements.map((e) => e.id).join(', ') || 'nothing'}.` }; } });
  agent.register({ ...base, name: 'overlay_list', risk: 'read', description: 'List what is on the desktop overlay (id, kind, place, whether it looks at the screen).', parameters: { type: 'object', properties: {} },
    async run() { return { content: elements.length ? elements.map((e) => `${e.id} · ${e.kind}${e.kind === 'widget' ? ` · ${e.x},${e.y} ${e.w}×${e.h}` : ''}${e.watch ? ` · looks at the screen every ${e.watch.every} s` : ''}${hidden ? ' · hidden (overlay closed by the user)' : ''}`).join('\n') : 'Nothing on the desktop.' }; } });
}

async function activate(api) {
  fabro = api; const { ipcMain } = fabro.electron;
  const mine = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
  const on = (ch, fn) => { const h = (e, ...a) => { if (mine(e)) fn(...a); }; ipcMain.on(ch, h); fabro.onCleanup(() => ipcMain.removeListener(ch, h)); };
  on('overlay:ready', () => { ready = true; if (elements.length && !hidden) { push(); win.showInactive(); } });
  on('overlay:hover', (v) => { if (!win || win.isDestroyed()) return; win.setIgnoreMouseEvents(!v, { forward: true }); try { win.setFocusable(!!v); } catch {} });
  on('overlay:close', () => { hidden = true; elements = elements.filter((e) => e.kind === 'widget'); refresh(); }); // widgets come back at the next overlay_show or start
  on('overlay:remove', (id) => { elements = elements.filter((e) => e.id !== id); save(); refresh(); });
  on('overlay:move', (id, x, y) => { const el = elements.find((e) => e.id === id); if (el) { el.x = x; el.y = y; save(); } });
  ipcMain.handle('overlay:ask', async (e, id, text) => { if (!mine(e)) throw new Error('Not allowed'); if (busy.size > 2) throw new Error('Busy'); busy.add('ask:' + id); try { return await askModel(text, false); } finally { busy.delete('ask:' + id); } });
  fabro.onCleanup(() => ipcMain.removeHandler('overlay:ask'));
  fabro.onCleanup(() => { stopWatch(); try { fabro.core('agent').unregisterWhere((t) => t.mod === 'overlay'); } catch {} if (win && !win.isDestroyed()) win.destroy(); win = null; });
  registerTools();
  elements = (fabro.readJSON(FILE, []) || []).filter((e) => e && e.id && e.kind === 'widget');
  if (elements.length) refresh();
}
module.exports = { activate, deactivate() {}, _state: () => ({ elements, hidden, win }) };
