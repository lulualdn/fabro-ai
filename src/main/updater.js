// App auto-update through GitHub Releases (electron-updater).
const { app } = require('electron');

let au = null;
let send = () => {};
let info = {};

// GitHub release notes arrive as HTML (string) or, for multi-version jumps, an array.
function notesOf(i) {
  const n = i && i.releaseNotes;
  if (!n) return '';
  if (Array.isArray(n)) return n.map((x) => `<h4>v${x.version}</h4>${x.note || ''}`).join('');
  return String(n);
}

function init(emit) {
  send = (s) => emit('updater:status', { ...info, ...s });
  if (!app.isPackaged) return;
  ({ autoUpdater: au } = require('electron-updater'));
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.on('checking-for-update', () => send({ state: 'checking' }));
  au.on('update-available', (i) => { info = { version: i.version, notes: notesOf(i), date: i.releaseDate || '' }; send({ state: 'downloading', progress: 0 }); });
  au.on('update-not-available', () => { info = {}; send({ state: 'latest' }); });
  au.on('download-progress', (p) => send({ state: 'downloading', progress: p.percent / 100 }));
  au.on('update-downloaded', (i) => { info = { version: i.version, notes: notesOf(i) || info.notes, date: i.releaseDate || info.date }; send({ state: 'ready' }); });
  au.on('error', (e) => send({ state: 'error', error: String(e && e.message || e) }));
}

async function check() {
  if (!au) { send({ state: 'dev' }); return { state: 'dev' }; }
  try { await au.checkForUpdates(); } catch (e) { send({ state: 'error', error: e.message }); }
  return { state: 'checking' };
}

function install() { if (au) setImmediate(() => au.quitAndInstall(false, true)); }

module.exports = { init, check, install };
