// The stop pill: while Fabro uses the computer, a small pill at the top center of the screen it controls.
// - faint (35 %) when the cursor is far, fully visible within ~150 px, so it never hides what's under it for long
// - one click stops the turn at once and releases every key and button Fabro might hold
// - hidden from Fabro's own screenshots (content protection; stepped aside on Linux by overlay.aside)
// - the AI can't click it: computer/index.js refuses any point inside it (contains())
// Also: a global shortcut (Ctrl+Alt+Échap / ⌃⌥⎋) and an entry in the tray menu do the same.
const { BrowserWindow, screen, globalShortcut } = require('electron');

const W = 420, H = 40, TOP = 10, NEAR = 150, FAR_OPACITY = 0.35;
const ACCEL = 'CommandOrControl+Alt+Escape';
const T = {
  fr: { title: 'Fabro utilise ton ordinateur', stop: 'Arrêter', key: process.platform === 'darwin' ? '⌃⌥⎋' : 'Ctrl Alt Échap' },
  en: { title: 'Fabro is using your computer', stop: 'Stop', key: process.platform === 'darwin' ? '⌃⌥⎋' : 'Ctrl Alt Esc' },
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font:13px "Segoe UI",system-ui,-apple-system,sans-serif;user-select:none;color:#f2efe9}
.p{position:absolute;inset:2px;display:flex;align-items:center;gap:10px;padding:0 6px 0 14px;border-radius:999px;background:rgba(24,22,20,.94);
 box-shadow:0 0 0 1px rgba(255,255,255,.08),0 6px 18px rgba(0,0,0,.35);opacity:${FAR_OPACITY};transition:opacity .12s linear;cursor:default}
.d{width:8px;height:8px;border-radius:50%;background:#e8603c;flex:none}
.t{flex:none;white-space:nowrap}
.s{flex:1;min-width:0;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{all:unset;display:flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;background:#e8603c;color:#fff;font-weight:600;cursor:pointer}
button:hover{background:#f0704c}
button i{width:9px;height:9px;background:#fff;border-radius:2px}
</style></head><body><div class="p" id="p"><span class="d"></span><span class="t" id="t"></span><span class="s" id="s"></span><button id="b" title=""><i></i><span id="bl"></span></button></div>
<script>
window.set = (o) => { for (const k of ['t', 's', 'bl']) if (o[k] != null) document.getElementById(k).textContent = o[k]; if (o.key != null) document.getElementById('b').title = o.key; };
window.op = (v) => { document.getElementById('p').style.opacity = v; };
document.getElementById('b').addEventListener('mousedown', (e) => { e.preventDefault(); document.title = 'stop:' + Date.now(); });
</script></body></html>`;

let win = null, ready = null, timer = null, onStop = null, lang = 'fr', rect = null, lastOp = -1;
const tr = () => T[lang] || T.en;
const js = (code) => { if (win && !win.isDestroyed()) win.webContents.executeJavaScript(code, true).catch(() => {}); };

// m: the physical monitor rect Fabro controls ({x,y,w,h})
function place(m) {
  let d = { x: m.x, y: m.y, width: m.w, height: m.h };
  if (process.platform === 'win32' && screen.screenToDipRect) d = screen.screenToDipRect(null, d);
  const b = { x: Math.round(d.x + d.width / 2 - W / 2), y: Math.round(d.y + TOP), width: W, height: H };
  rect = b;
  return b;
}
function create(b) {
  win = new BrowserWindow({ ...b, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000', title: 'Fabro Stop',
    webPreferences: { sandbox: true, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setContentProtection(true);
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  // a click in the pill sets the page title: no preload, no IPC surface
  win.webContents.on('page-title-updated', (_e, t) => { if (String(t).startsWith('stop:')) fire('pill'); });
  win.on('closed', () => { win = null; ready = null; });
  ready = win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  return ready;
}
function fire(how) { const f = onStop; if (f) { try { f(how); } catch (e) { console.error('stop pill', e); } } }

// cursor distance to the pill → opacity (polled: a click-through-free window can't see the cursor from afar)
function tick() {
  if (!win || win.isDestroyed() || !rect || !win.isVisible()) return;
  const c = screen.getCursorScreenPoint();
  const dx = Math.max(rect.x - c.x, 0, c.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - c.y, 0, c.y - (rect.y + rect.height));
  const dist = Math.hypot(dx, dy);
  const v = dist >= NEAR ? FAR_OPACITY : FAR_OPACITY + (1 - FAR_OPACITY) * (1 - dist / NEAR);
  const r = Math.round(v * 20) / 20;
  if (r !== lastOp) { lastOp = r; js(`op(${r})`); }
}

module.exports = {
  ACCEL,
  // stop(how) is called on click ('pill'), shortcut ('shortcut') or tray ('tray')
  async show(m, language, stop) {
    lang = String(language || 'fr').slice(0, 2) === 'fr' ? 'fr' : 'en';
    onStop = stop;
    const b = place(m);
    if (!win || win.isDestroyed()) await create(b); else { win.setBounds(b); await ready; }
    js(`set(${JSON.stringify({ t: tr().title, bl: tr().stop, key: tr().key })})`);
    lastOp = -1;
    if (!win.isVisible()) win.showInactive();
    if (!timer) timer = setInterval(tick, 60);
    try { if (!globalShortcut.isRegistered(ACCEL)) globalShortcut.register(ACCEL, () => fire('shortcut')); } catch {}
    try { require('../desktop').setComputerStop(() => fire('tray'), tr().stop); } catch {}
  },
  status(text) { js(`set(${JSON.stringify({ s: text ? '· ' + String(text).slice(0, 60) : '' })})`); },
  hide() {
    if (timer) { clearInterval(timer); timer = null; }
    try { globalShortcut.unregister(ACCEL); } catch {}
    try { require('../desktop').setComputerStop(null); } catch {}
    onStop = null;
    if (win && !win.isDestroyed()) win.hide();
  },
  destroy() { module.exports.hide(); if (win && !win.isDestroyed()) win.destroy(); win = null; },
  // physical screen point inside the pill (with a margin)? The AI must never click it.
  contains(x, y) {
    if (!rect || !win || win.isDestroyed() || !win.isVisible()) return false;
    let p = { x, y };
    if (process.platform === 'win32' && screen.screenToDipPoint) p = screen.screenToDipPoint({ x, y });
    const g = 8;
    return p.x >= rect.x - g && p.x <= rect.x + rect.width + g && p.y >= rect.y - g && p.y <= rect.y + rect.height + g;
  },
  isOwn(hwnd) {
    try { const h = win && !win.isDestroyed() && win.getNativeWindowHandle(); return !!h && String(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0)) === String(hwnd); } catch { return false; }
  },
  _win: () => win,
};
