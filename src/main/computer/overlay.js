// What the user sees while Fabro uses the computer: a soft glowing frame around the screen being
// controlled, a status pill, and a ripple where Fabro clicks. Click-through, never focused, and
// hidden from screenshots (content protection), so it never gets in the AI's way.
const { BrowserWindow, screen } = require('electron');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;user-select:none}
.frame{position:fixed;inset:0;border-radius:10px;box-shadow:inset 0 0 0 3px rgba(255,94,66,.85),inset 0 0 26px 6px rgba(255,94,66,.35);animation:breathe 2.4s ease-in-out infinite;transition:box-shadow .3s}
body.paused .frame{box-shadow:inset 0 0 0 3px rgba(120,130,150,.8),inset 0 0 22px 4px rgba(120,130,150,.3);animation:none}
@keyframes breathe{50%{box-shadow:inset 0 0 0 3px rgba(255,94,66,.6),inset 0 0 40px 10px rgba(255,94,66,.25)}}
.pill{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:9px 16px 9px 12px;border-radius:999px;
 background:rgba(22,24,32,.86);color:#fff;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,.35);backdrop-filter:blur(8px);max-width:70vw;white-space:nowrap}
.pill .dot{width:22px;height:22px;flex:none;animation:spin 3.2s linear infinite}
body.paused .pill .dot{animation:none;opacity:.6}
@keyframes spin{to{transform:rotate(360deg)}}
.pill b{font-weight:600}.pill .st{opacity:.92;overflow:hidden;text-overflow:ellipsis;max-width:46vw}.pill kbd{font:inherit;font-size:11px;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.16);margin:0 2px}
.pill .hint{opacity:.6;font-size:12px}
.rip{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2.5px solid #ff5e42;pointer-events:none;animation:rip .55s ease-out forwards}
.rip.r{border-color:#4d8dff}
@keyframes rip{from{transform:scale(.25);opacity:1}to{transform:scale(1.25);opacity:0}}
</style></head><body><div class="frame"></div>
<div class="pill"><svg class="dot" viewBox="0 0 24 24"><g fill="#ff5e42"><ellipse cx="12" cy="6.2" rx="2.6" ry="5.4"/><ellipse cx="12" cy="6.2" rx="2.6" ry="5.4" transform="rotate(120 12 12)"/><ellipse cx="12" cy="6.2" rx="2.6" ry="5.4" transform="rotate(240 12 12)"/></g><circle cx="12" cy="12" r="2.2" fill="#fff"/></svg>
<b id="t"></b><span class="st" id="s"></span><span class="hint" id="h"></span></div>
<script>
window.set = (o) => { if (o.title != null) document.getElementById('t').textContent = o.title; if (o.status != null) document.getElementById('s').textContent = o.status ? '· ' + o.status : '';
  if (o.hint != null) document.getElementById('h').innerHTML = o.hint; document.body.classList.toggle('paused', !!o.paused); };
window.rip = (x, y, right) => { const d = document.createElement('div'); d.className = 'rip' + (right ? ' r' : ''); d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); };
</script></body></html>`;

const T = {
  en: { title: 'Fabro is using your computer', paused: 'You have control', hint: 'Move the mouse to take over · <kbd>Esc</kbd> stops', pausedHint: 'Fabro stopped. Send a message to continue.' },
  fr: { title: 'Fabro utilise votre ordinateur', paused: 'Vous avez la main', hint: 'Bougez la souris pour reprendre la main · <kbd>Échap</kbd> arrête', pausedHint: 'Fabro s’est arrêté. Envoyez un message pour continuer.' },
  es: { title: 'Fabro está usando tu ordenador', paused: 'Tienes el control', hint: 'Mueve el ratón para tomar el control · <kbd>Esc</kbd> detiene', pausedHint: 'Fabro se detuvo. Envía un mensaje para continuar.' },
  de: { title: 'Fabro benutzt deinen Computer', paused: 'Du hast die Kontrolle', hint: 'Maus bewegen, um zu übernehmen · <kbd>Esc</kbd> stoppt', pausedHint: 'Fabro hat angehalten. Schreib eine Nachricht, um weiterzumachen.' },
};

let win = null, ready = null, mon = null, lang = 'en';
const tr = () => T[lang] || T.en;

// physical monitor rect → the Electron display (DIP) it is on
function dipRect(m) {
  if (process.platform === 'win32' && screen.screenToDipRect) return screen.screenToDipRect(null, { x: m.x, y: m.y, width: m.w, height: m.h });
  return { x: m.x, y: m.y, width: m.w, height: m.h };
}
function ensure(m) {
  const r = dipRect(m);
  if (win && !win.isDestroyed()) {
    if (!mon || mon.x !== m.x || mon.y !== m.y || mon.w !== m.w || mon.h !== m.h) win.setBounds(r);
    mon = m; return ready;
  }
  mon = m;
  win = new BrowserWindow({ ...r, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000', title: 'Fabro Computer Use',
    webPreferences: { sandbox: true, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  ready = win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE)).then(() => win && win.setBounds(r));
  win.on('closed', () => { win = null; ready = null; mon = null; });
  return ready;
}
const js = (code) => { if (win && !win.isDestroyed()) win.webContents.executeJavaScript(code, true).catch(() => {}); };

module.exports = {
  async show(m, language) {
    lang = String(language || 'en').slice(0, 2);
    await ensure(m);
    js(`set(${JSON.stringify({ title: tr().title, status: '', hint: tr().hint, paused: false })})`);
    if (win && !win.isVisible()) win.showInactive();
  },
  status(text) { js(`set(${JSON.stringify({ status: String(text || '').slice(0, 90) })})`); },
  paused() { js(`set(${JSON.stringify({ title: tr().paused, status: '', hint: tr().pausedHint, paused: true })})`); },
  // a click at physical screen point x,y
  ripple(x, y, right) {
    if (!win || win.isDestroyed() || !mon) return;
    let p = { x, y };
    if (process.platform === 'win32' && screen.screenToDipPoint) p = screen.screenToDipPoint({ x, y });
    const b = win.getBounds();
    js(`rip(${Math.round(p.x - b.x)}, ${Math.round(p.y - b.y)}, ${!!right})`);
  },
  // Linux has no capture exclusion: step aside while the screen is captured
  async aside(fn) {
    // (recent macOS versions capture "protected" windows too)
    const hide = win && !win.isDestroyed() && win.isVisible() && process.platform !== 'win32';
    if (hide) { win.hide(); await new Promise((r) => setTimeout(r, 90)); }
    try { return await fn(); } finally { if (hide && win && !win.isDestroyed()) win.showInactive(); }
  },
  hide() { if (win && !win.isDestroyed()) win.hide(); },
  destroy() { if (win && !win.isDestroyed()) win.destroy(); win = null; },
  isOwn(hwnd) {
    if (process.platform === 'darwin') { try { return !!win && !win.isDestroyed() && String(win.getMediaSourceId().split(':')[1]) === String(hwnd); } catch { return false; } }
    try { const h = win && !win.isDestroyed() && win.getNativeWindowHandle(); return !!h && String(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0)) === String(hwnd); } catch { return false; }
  },
};
