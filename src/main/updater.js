// App updates through GitHub Releases.
// macOS / Linux: electron-updater (it checks the package's sha512 from latest-*.yml).
// Windows: Fabro's own installer. Fabro downloads Fabro-Installer.exe, checks its SHA-256 against the
// Fabro-Installer.exe.sha256 published next to it (release.yml), and only then starts it with --update: the
// installer shows one progress bar, installs over the current folder keeping settings and data, and relaunches
// Fabro. If anything fails before that, the running version is untouched.
// Older versions keep working: they download the same Fabro-Installer.exe and start it with --update.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let au = null;
let send = () => {};
let info = {};
let busy = false;

// GitHub release notes arrive as HTML (string) or, for multi-version jumps, an array.
function notesOf(i) {
  const n = i && i.releaseNotes;
  if (!n) return '';
  if (Array.isArray(n)) return n.map((x) => `<h4>v${x.version}</h4>${x.note || ''}`).join('');
  return String(n);
}

const WIN = process.platform === 'win32';
const BASE = 'https://github.com/lulualdn/fabro-ai/releases/latest/download/';
const INSTALLER = BASE + 'Fabro-Installer.exe';

function init(emit) {
  send = (s) => emit('updater:status', { ...info, ...s });
  if (!app.isPackaged) return;
  ({ autoUpdater: au } = require('electron-updater'));
  // Windows: the update goes through Fabro's installer (settings kept), never the NSIS screens.
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

// Streams a download to a file and hashes it on the way. onProgress(0..1) when the size is known.
async function download(url, file, onProgress) {
  const { net } = require('electron');
  const r = await net.fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(file);
  let done = 0; let last = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done: end, value } = await reader.read(); if (end) break;
      hash.update(value); done += value.length;
      if (!out.write(value)) await new Promise((ok) => out.once('drain', ok));
      if (total && Date.now() - last > 150) { last = Date.now(); onProgress(done / total); }
    }
  } finally { await new Promise((ok) => out.end(ok)); }
  return hash.digest('hex');
}

async function expectedSum() {
  const { net } = require('electron');
  const r = await net.fetch(INSTALLER + '.sha256', { redirect: 'follow' });
  if (!r.ok) throw new Error('checksum not published');
  const sum = String(await r.text()).trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sum)) throw new Error('checksum unreadable');
  return sum;
}

async function installCustom() {
  if (busy) return; busy = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-update-'));
  const file = path.join(dir, 'Fabro-Installer.exe');
  try {
    send({ state: 'downloading', progress: 0 });
    const want = await expectedSum();
    const got = await download(INSTALLER, file, (p) => send({ state: 'downloading', progress: p }));
    if (got !== want) throw Object.assign(new Error('the downloaded installer does not match its checksum'), { code: 'CHECKSUM' });
    send({ state: 'launching' });
    require('child_process').spawn(file, ['--update'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.exit(0), 400);
  } catch (e) {
    busy = false;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    send({ state: 'error', error: e.message, code: e.code || 'DOWNLOAD' });
  }
}

function install() {
  if (!au) return;
  if (WIN) return installCustom();
  setImmediate(() => au.quitAndInstall(true, true));
}

module.exports = { init, check, install, _test: { download, expectedSum } };
