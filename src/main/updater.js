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
  // Windows: updates go through Fabro's own installer (custom UI, settings kept), not the NSIS screens.
  au.autoDownload = !WIN;
  au.autoInstallOnAppQuit = !WIN;
  au.on('checking-for-update', () => send({ state: 'checking' }));
  au.on('update-available', (i) => { info = { version: i.version, notes: notesOf(i), date: i.releaseDate || '' }; send(WIN ? { state: 'ready' } : { state: 'downloading', progress: 0 }); });
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

const WIN = process.platform === 'win32';
const INSTALLER = 'https://github.com/lulualdn/fabro-ai/releases/latest/download/Fabro-Installer.exe';

// Downloads Fabro's installer, starts it in update mode (it shows its own progress, installs over the
// current folder keeping every setting, then relaunches Fabro) and quits.
async function installCustom() {
  const fs = require('fs'); const path = require('path'); const os = require('os'); const { net } = require('electron');
  send({ state: 'launching' });
  const r = await net.fetch(INSTALLER, { redirect: 'follow' });
  if (!r.ok) throw new Error('installer ' + r.status);
  const file = path.join(os.tmpdir(), 'Fabro-Installer.exe');
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  require('child_process').spawn(file, ['--update'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.exit(0), 400);
}

function install() {
  if (!au) return;
  if (WIN) return installCustom().catch((e) => { send({ state: 'error', error: e.message }); });
  setImmediate(() => au.quitAndInstall(true, true));
}

module.exports = { init, check, install };
