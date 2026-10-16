// App auto-update through GitHub Releases (electron-updater).
const { app } = require('electron');

let au = null;
let send = () => {};

function init(emit) {
  send = (s) => emit('updater:status', s);
  if (!app.isPackaged) return;
  ({ autoUpdater: au } = require('electron-updater'));
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.on('checking-for-update', () => send({ state: 'checking' }));
  au.on('update-available', (i) => send({ state: 'downloading', version: i.version, progress: 0 }));
  au.on('update-not-available', () => send({ state: 'latest' }));
  au.on('download-progress', (p) => send({ state: 'downloading', progress: p.percent / 100 }));
  au.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
  au.on('error', (e) => send({ state: 'error', error: String(e && e.message || e) }));
}

async function check() {
  if (!au) { send({ state: 'dev' }); return { state: 'dev' }; }
  try { await au.checkForUpdates(); } catch (e) { send({ state: 'error', error: e.message }); }
  return { state: 'checking' };
}

function install() { if (au) au.quitAndInstall(); }

module.exports = { init, check, install };
