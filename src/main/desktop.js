// Desktop integration: tray icon (close → tray), global AI hotkey and the quick bar.
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, nativeImage, nativeTheme, Notification, desktopCapturer } = require('electron');
const path = require('path');
const store = require('./store');

const isMac = process.platform === 'darwin';
const asset = (f) => path.join(__dirname, '..', 'assets', f);

let getMain = () => null;
let tray = null;
let quick = null;
let quitting = false;
let mainState = { convId: null, title: '' };   // reported by the main renderer
let hotkeyStatus = { ok: true, registered: [] };

const L = {
  en: { engUpdT: 'Engine updated', engUpdB: 'llama.cpp {v} is installed. Nothing to restart.', open: 'Open Fabro', newChat: 'New chat', quick: 'Quick bar', quit: 'Quit Fabro', hintT: 'Fabro is still running', hintB: 'It stays in the tray so your models stay ready. Right-click the icon to quit.' },
  fr: { engUpdT: 'Moteur mis à jour', engUpdB: 'llama.cpp {v} est installé. Rien à redémarrer.', open: 'Ouvrir Fabro', newChat: 'Nouvelle conversation', quick: 'Barre rapide', quit: 'Quitter Fabro', hintT: 'Fabro tourne toujours', hintB: 'Il reste dans la zone de notification pour garder vos modèles prêts. Clic droit sur l’icône pour quitter.' },
  es: { engUpdT: 'Motor actualizado', engUpdB: 'llama.cpp {v} instalado. No hace falta reiniciar.', open: 'Abrir Fabro', newChat: 'Nuevo chat', quick: 'Barra rápida', quit: 'Salir de Fabro', hintT: 'Fabro sigue en marcha', hintB: 'Se queda en la bandeja para tener tus modelos listos. Clic derecho en el icono para salir.' },
  de: { engUpdT: 'Engine aktualisiert', engUpdB: 'llama.cpp {v} ist installiert. Kein Neustart nötig.', open: 'Fabro öffnen', newChat: 'Neuer Chat', quick: 'Schnellleiste', quit: 'Fabro beenden', hintT: 'Fabro läuft weiter', hintB: 'Es bleibt im Infobereich, damit deine Modelle bereit sind. Rechtsklick auf das Symbol zum Beenden.' },
};
function lang() {
  const s = store.getSettings().language;
  const l = s && s !== 'auto' ? s : (app.getPreferredSystemLanguages()[0] || app.getLocale() || 'en');
  return L[String(l).slice(0, 2)] ? String(l).slice(0, 2) : 'en';
}
const tr = (k) => L[lang()][k];

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: isMac ? undefined : asset('icon.png'), silent: true });
  n.on('click', () => showMain());
  n.show();
}

// ───────────────────────────── main window ─────────────────────────────
function showMain() {
  const w = getMain(); if (!w) return;
  if (w.isMinimized()) w.restore();
  w.show(); w.focus();
}
function attachMain(w) {
  w.on('close', (e) => {
    if (quitting || !store.getSettings().closeToTray) return;
    e.preventDefault();
    w.hide();
    if (!store.getSettings().trayHintShown) {
      store.setSettings({ trayHintShown: true });
      notify(tr('hintT'), tr('hintB'));
    }
  });
}

// ───────────────────────────── tray ─────────────────────────────
function trayImage() {
  if (isMac) { const img = nativeImage.createFromPath(asset('trayTemplate.png')); img.setTemplateImage(true); return img; }
  return nativeImage.createFromPath(asset(process.platform === 'win32' ? 'icon.ico' : 'tray.png'));
}
function buildTrayMenu() {
  if (!tray) return;
  const hk = store.getSettings().hotkey || {};
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tr('open'), click: showMain },
    { label: tr('newChat'), click: () => { showMain(); send('app:command', { cmd: 'new-chat' }); } },
    { label: tr('quick'), accelerator: hk.enabled ? hk.accelerator : undefined, click: () => toggleQuick(true) },
    { type: 'separator' },
    { label: tr('quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}
function initTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Fabro');
  buildTrayMenu();
  tray.on(isMac ? 'right-click' : 'click', showMain);
  tray.on('double-click', showMain);
}

function send(ch, data) { const w = getMain(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); }

// ───────────────────────────── quick bar ─────────────────────────────
const QW = 760, QH = 104;
function createQuick() {
  quick = new BrowserWindow({
    width: QW, height: QH, show: false, frame: false, transparent: true, resizable: false, movable: true,
    skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
    hasShadow: false, backgroundColor: '#00000000', title: 'Fabro',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  quick.setAlwaysOnTop(true, 'pop-up-menu');
  quick.loadFile(path.join(__dirname, '..', 'renderer', 'quick.html'));
  quick.on('blur', () => { if (quick && !quick.webContents.isDevToolsOpened()) quick.hide(); });
  quick.on('closed', () => { quick = null; });
}
function placeQuick() {
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  quick.setBounds({ x: Math.round(wa.x + (wa.width - QW) / 2), y: Math.round(wa.y + wa.height * 0.26), width: QW, height: QH });
}
function quickState() {
  const th = store.getSettings().theme;
  const dark = th === 'dark' || (th !== 'light' && nativeTheme.shouldUseDarkColors);
  return { ...mainState, target: store.getSettings().quickTarget || 'current', dark };
}
// A screenshot of the screen under the cursor, taken before the bar appears (so the bar isn't in it).
async function screenShot() {
  if (store.getSettings().quickScreenshot === false) return null;
  try {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = Math.min(1, 1920 / (d.size.width * d.scaleFactor));
    const size = { width: Math.round(d.size.width * d.scaleFactor * scale), height: Math.round(d.size.height * d.scaleFactor * scale) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    return { kind: 'image', name: 'screenshot.jpg', type: 'image/jpeg', data: 'data:image/jpeg;base64,' + src.thumbnail.toJPEG(85).toString('base64') };
  } catch { return null; }
}
let opening = false;
async function toggleQuick(forceShow) {
  if (!quick) {
    createQuick();
    // First open: wait for the page so the state isn't lost.
    quick.webContents.once('did-finish-load', () => toggleQuick(true));
    return;
  }
  if (quick.webContents.isLoading() || opening) return;
  if (quick.isVisible() && !forceShow) { quick.hide(); return; }
  opening = true;
  const shot = await screenShot();
  opening = false;
  placeQuick();
  quick.webContents.send('quick:show', { ...quickState(), screenshot: shot });
  quick.show(); quick.focus();
}
function resizeQuick(h) {
  if (!quick) return;
  const b = quick.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const height = Math.max(QH, Math.min(Math.round(h), wa.y + wa.height - b.y - 16));
  quick.setBounds({ ...b, height });
}

// ───────────────────────────── hotkey ─────────────────────────────
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = store.getSettings().hotkey || {};
  const registered = [], failed = [];
  if (hk.enabled) {
    const accs = [hk.accelerator];
    if (hk.copilotKey && process.platform === 'win32') accs.push('Super+Shift+F23'); // the Copilot key sends Win+Shift+F23
    for (const a of accs.filter(Boolean)) {
      try { (globalShortcut.register(a, () => toggleQuick()) ? registered : failed).push(a); } catch { failed.push(a); }
    }
  }
  hotkeyStatus = { ok: !failed.includes(hk.accelerator), registered, failed };
  buildTrayMenu();
  return hotkeyStatus;
}

function init(getMainWindow, ipc) {
  getMain = getMainWindow;
  initTray();
  registerHotkeys();
  app.on('before-quit', () => { quitting = true; });
  // Pre-create the quick bar so the hotkey opens it instantly.
  setTimeout(() => { if (!quick) createQuick(); }, 4000);
  app.on('will-quit', () => globalShortcut.unregisterAll());

  ipc('quick:submit', ({ text, target, attachments }) => {
    if ((!text || !String(text).trim()) && !(attachments || []).length) return false;
    // "/claude …" and other mod commands open the main window, where the command runs
    const cmd = String(text || '').trim().match(/^\/([a-z0-9_-]+)/i);
    if (cmd) {
      let cmds = []; try { cmds = require('./mods').view().filter((m) => m.enabled).flatMap((m) => m.commands || []); } catch {}
      if (cmds.some((c) => c.name.toLowerCase() === cmd[1].toLowerCase())) {
        if (quick) quick.hide(); showMain(); send('quick:command', { text: String(text).trim() });
        return { command: true };
      }
    }
    send('quick:run', { text: String(text || '').trim(), target: target === 'new' || !mainState.convId ? 'new' : 'current', attachments: attachments || [] });
    store.setSettings({ quickTarget: target === 'new' ? 'new' : 'current' });
    return true;
  });
  ipc('quick:started', (info) => { if (quick) quick.webContents.send('quick:started', info); });
  ipc('quick:report', (state) => { mainState = { convId: state && state.convId || null, title: state && state.title || '' }; });
  ipc('quick:hide', () => { if (quick) quick.hide(); });
  ipc('quick:resize', (h) => resizeQuick(h));
  ipc('quick:open', () => { if (quick) quick.hide(); showMain(); });
  ipc('quick:toggle', () => toggleQuick(true));
  ipc('hotkey:apply', () => registerHotkeys());
  ipc('login:get', () => { try { return app.getLoginItemSettings().openAtLogin; } catch { return false; } });
  ipc('login:set', (on) => { try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); } catch {} return !!on; });
  ipc('hotkey:status', () => hotkeyStatus);
  ipc('app:notify', ({ title, body, onlyIfHidden }) => {
    const w = getMain();
    if (onlyIfHidden && w && w.isVisible() && w.isFocused()) return false;
    notify(title, body); return true;
  });
  ipc('app:quit', () => { quitting = true; app.quit(); });
}

// chat events also stream into the quick bar
function forward(ch, data) { if (quick && !quick.isDestroyed()) quick.webContents.send(ch, data); }

module.exports = { init, attachMain, showMain, forward, notify, getQuick: () => quick, tr: (k) => tr(k), isQuitting: () => quitting, setQuitting: () => { quitting = true; } };
