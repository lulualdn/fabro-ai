// Slow storage: is a model library on an internal SSD, or on an HDD / USB / SD card / network share?
// A model read from a slow disk loads slowly and — when it does not fit in RAM/VRAM and is memory-mapped —
// keeps reading from the disk while it answers. When the active model sits on slow storage, Fabro suggests
// (once, discreetly, the user can refuse) moving it to a faster internal disk with room, or a small fast model.
// All detection is async (child processes with timeouts), cached per folder for the session.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const run = (cmd, args, timeout = 8000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 2 << 20 }, (err, out) => resolve(err ? null : String(out)));
});
const SLOW = new Set(['hdd', 'usb', 'network', 'sd']);
const SLOW_MBPS = 150; // measured sequential read below this = slow (SATA SSD ≈ 500, NVMe ≥ 1500, HDD ≈ 80-160, USB 2 ≈ 30)

// ───────────────────────────── detection per platform ─────────────────────────────
async function detectWin(dir) {
  const abs = path.resolve(dir);
  if (/^\\\\/.test(abs)) return { kind: 'network', how: 'unc' };
  const letter = (/^([A-Za-z]):/.exec(abs) || [])[1];
  if (!letter) return { kind: 'unknown' };
  const ps = `$ErrorActionPreference='SilentlyContinue';$l='${letter.toUpperCase()}';` +
    `$ld=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($l):'";` +
    `$p=Get-Partition -DriveLetter $l;$d=$null;$pd=$null;if($p){$d=Get-Disk -Number $p.DiskNumber;$pd=Get-PhysicalDisk|Where-Object {$_.DeviceId -eq [string]$p.DiskNumber}};` +
    `[pscustomobject]@{DriveType=$ld.DriveType;Bus=[string]$d.BusType;Media=[string]$pd.MediaType;PdBus=[string]$pd.BusType;Removable=$d.IsRemovable;Model=[string]$d.FriendlyName}|ConvertTo-Json -Compress`;
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], 15000);
  let j = null; try { j = JSON.parse(out); } catch { return { kind: 'unknown' }; }
  return classifyWin(j);
}
// Pure: Win32_LogicalDisk.DriveType 2=removable 3=local 4=network; MSFT_PhysicalDisk.MediaType HDD/SSD/SCM/Unspecified.
function classifyWin(j) {
  if (!j) return { kind: 'unknown' };
  const bus = String(j.Bus || j.PdBus || '').toUpperCase();
  const media = String(j.Media || '').toUpperCase();
  const model = j.Model || '';
  if (j.DriveType === 4) return { kind: 'network', how: 'drivetype', model };
  if (bus === 'USB' || bus === '7') return { kind: 'usb', how: 'bus', model };
  if (bus === 'SD' || bus === 'MMC' || /SD|MMC/.test(model) && j.DriveType === 2) return { kind: 'sd', how: 'bus', model };
  if (media === 'HDD' || media === '3') return { kind: 'hdd', how: 'mediatype', model };
  if (media === 'SSD' || media === '4' || media === 'SCM' || bus === 'NVME' || bus === '17') return { kind: 'ssd', how: media ? 'mediatype' : 'bus', model };
  if (j.DriveType === 2 || j.Removable) return { kind: 'usb', how: 'removable', model };
  return { kind: 'unknown', model };
}
async function detectMac(dir) {
  const df = await run('df', ['-P', dir]);
  const line = df && df.trim().split('\n').pop();
  if (!line) return { kind: 'unknown' };
  const dev = line.split(/\s+/)[0];
  const mount = line.split(/\s+/).slice(5).join(' ');
  if (/^\/\/|^[\w.-]+:\//.test(dev)) return { kind: 'network', how: 'df' };
  const info = await run('diskutil', ['info', mount || dev], 10000);
  return classifyMac(info || '');
}
function classifyMac(info) {
  const g = (k) => ((new RegExp(`^\\s*${k}:\\s*(.+)$`, 'mi').exec(info) || [])[1] || '').trim();
  const proto = g('Protocol'), ssd = g('Solid State'), internal = g('Device Location') || g('Internal'), removable = g('Removable Media');
  if (/SMB|AFP|NFS|WebDAV/i.test(g('File System Personality') + g('Type \\(Bundle\\)'))) return { kind: 'network', how: 'diskutil' };
  if (/USB|Thunderbolt/i.test(proto) && !/Internal|Yes/i.test(internal)) return { kind: /Thunderbolt/i.test(proto) && /Yes/i.test(ssd) ? 'external-ssd' : 'usb', how: 'diskutil' };
  if (/Secure Digital|SD/i.test(proto)) return { kind: 'sd', how: 'diskutil' };
  if (/^No/i.test(ssd)) return { kind: 'hdd', how: 'diskutil' };
  if (/^Yes/i.test(ssd)) return { kind: /Removable|Yes/i.test(removable) && !/Fixed|No/i.test(removable) ? 'usb' : 'ssd', how: 'diskutil' };
  return { kind: 'unknown' };
}
async function detectLinux(dir) {
  const mounts = await fsp.readFile('/proc/mounts', 'utf8').catch(() => '');
  const real = await fsp.realpath(dir).catch(() => dir);
  // longest mount point containing the folder
  let best = null;
  for (const l of mounts.split('\n')) {
    const [src, mp, type] = l.split(' ');
    if (!mp) continue;
    const m = mp.replace(/\\040/g, ' ');
    if ((real === m || real.startsWith(m.endsWith('/') ? m : m + '/')) && (!best || m.length > best.mp.length)) best = { src, mp: m, type };
  }
  if (!best) return { kind: 'unknown' };
  if (/^(nfs4?|cifs|smb3?|sshfs|fuse\.sshfs|9p|davfs)$/.test(best.type)) return { kind: 'network', how: 'fstype' };
  const m = /^\/dev\/(.+)$/.exec(best.src);
  if (!m) return { kind: 'unknown', how: best.type };
  const part = path.basename(await fsp.realpath(best.src).catch(() => best.src));
  // partition → parent block device
  let devName = part;
  const sysPart = await fsp.realpath(`/sys/class/block/${part}`).catch(() => null);
  if (sysPart && (await fsp.stat(path.join(sysPart, 'partition')).catch(() => null))) devName = path.basename(path.dirname(sysPart));
  const sys = await fsp.realpath(`/sys/block/${devName}`).catch(() => '');
  const rd = (f) => fsp.readFile(`/sys/block/${devName}/${f}`, 'utf8').then((x) => x.trim()).catch(() => null);
  const [rot, rem] = await Promise.all([rd('queue/rotational'), rd('removable')]);
  return classifyLinux({ devName, sys, rot, rem });
}
function classifyLinux({ devName, sys = '', rot, rem }) {
  if (/^mmcblk/.test(devName)) return { kind: 'sd', how: 'sysfs' };
  if (/\/usb\d*\//.test(sys)) return { kind: 'usb', how: 'sysfs' };
  if (rot === '1') return { kind: 'hdd', how: 'sysfs' };
  if (rem === '1') return { kind: 'usb', how: 'sysfs' };
  if (rot === '0') return { kind: /^(loop|dm-|md)/.test(devName) ? 'unknown' : 'ssd', how: 'sysfs' };
  return { kind: 'unknown' };
}

// Quick sequential read (64 MB from the middle of a model file) → MB/s. The page cache may make this look faster
// than the disk is, never slower, so it can only clear a disk, not wrongly accuse it.
async function measureRead(file, bytes = 64 << 20) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const st = await fh.stat();
    if (st.size < 8 << 20) return null;
    const n = Math.min(bytes, st.size);
    const start = Math.max(0, Math.floor(st.size / 2) - n / 2);
    const buf = Buffer.allocUnsafe(4 << 20);
    const t0 = process.hrtime.bigint();
    let read = 0;
    while (read < n) { const r = await fh.read(buf, 0, Math.min(buf.length, n - read), start + read); if (!r.bytesRead) break; read += r.bytesRead; }
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    return s > 0 ? Math.round(read / 2 ** 20 / s) : null;
  } catch { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}

const cache = new Map(); // folder → Promise<{ kind, how, mbps? }>
function classify(dir, { sampleFile } = {}) {
  const key = path.resolve(dir);
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    let r = { kind: 'unknown' };
    try {
      if (process.platform === 'win32') r = await detectWin(key);
      else if (process.platform === 'darwin') r = await detectMac(key);
      else r = await detectLinux(key);
    } catch { r = { kind: 'unknown' }; }
    if (r.kind === 'unknown' && sampleFile) {
      const mbps = await measureRead(sampleFile);
      if (mbps != null) r = { kind: mbps < SLOW_MBPS ? 'slow' : 'fast', how: 'measured', mbps };
    }
    r.slow = SLOW.has(r.kind) || r.kind === 'slow';
    return r;
  })();
  cache.set(key, p);
  return p;
}

// ───────────────────────────── advice ─────────────────────────────
let emit = () => {};
const prefsFile = () => require('./paths').inData('storage-advice.json');
let prefs = null;
async function loadPrefs() { if (!prefs) { try { prefs = JSON.parse(await fsp.readFile(prefsFile(), 'utf8')); } catch { prefs = { refused: {} }; } } return prefs; }
async function savePrefs() { try { await fsp.writeFile(prefsFile(), JSON.stringify(prefs)); } catch {} }
const freeBytes = async (p) => { try { const st = await fsp.statfs(p); return st.bavail * st.bsize; } catch { return null; } };

// Advice for one model: null when its storage is fine or the user said no.
// { modelId, modelName, storage: { kind, how, mbps }, suggestion: 'move' | 'small-model', toLibrary?, smallModel?, needBytes, freeBytes }
async function adviceFor(model, { force = false } = {}) {
  if (!model || !model.path) return null;
  const pr = await loadPrefs();
  if (!force && (pr.refused[model.id] || pr.never)) return null;
  const st = await classify(path.dirname(model.path), { sampleFile: model.path });
  if (!st.slow) return null;
  const models = require('./models');
  const size = model.sizeBytes || (await fsp.stat(model.path).then((x) => x.size).catch(() => 0));
  // a faster library with room?
  const libs = await models.librariesView().catch(() => []);
  for (const l of libs) {
    if (l.id === (model.library || 'default')) continue;
    const s2 = await classify(l.path);
    const free = l.free != null ? l.free : await freeBytes(l.path);
    if (!s2.slow && s2.kind !== 'unknown' && free != null && free > size * 1.1 + (2 << 30)) {
      return { modelId: model.id, modelName: model.name, storage: st, suggestion: 'move', toLibrary: { id: l.id, name: l.name, path: l.path }, needBytes: size, freeBytes: free };
    }
  }
  // otherwise: a small, fast model on the fastest internal disk (Fabro's own library by default)
  const cat = await models.catalog().catch(() => ({ items: [] }));
  const small = (cat.items || []).filter((m) => m.tags.includes('chat') && !m.installed && !m.blocked && m.sizeGB <= 3.2)
    .sort((a, b) => (b.fit === 'great') - (a.fit === 'great') || b.sizeGB - a.sizeGB)[0];
  if (!small) return null;
  const def = libs.find((l) => l.id === 'default') || libs[0];
  const defStorage = def ? await classify(def.path) : { kind: 'unknown' };
  const free = def ? (def.free != null ? def.free : await freeBytes(def.path)) : null;
  const need = Math.round(small.sizeGB * 1.08 * 2 ** 30);
  return {
    modelId: model.id, modelName: model.name, storage: st, suggestion: 'small-model',
    smallModel: { id: small.id, name: small.name, repo: small.repo, sizeGB: small.sizeGB }, toLibrary: def ? { id: def.id, name: def.name, path: def.path, storage: defStorage.kind } : null,
    needBytes: need, freeBytes: free, makeRoomBytes: free != null ? Math.max(0, need + (2 << 30) - free) : null,
  };
}
async function refuse(modelId, { never = false } = {}) {
  const pr = await loadPrefs();
  if (never) pr.never = true; else pr.refused[modelId] = Date.now();
  await savePrefs();
  return true;
}
// Called when a model is loaded for chat: emits 'storage:advice' once per model per session.
const told = new Set();
async function check(model) {
  if (!model || told.has(model.id) || model.role) return null;
  told.add(model.id);
  const a = await adviceFor(model).catch(() => null);
  if (a) emit('storage:advice', a);
  return a;
}

function init(ipcMain, emitter) {
  if (emitter) emit = emitter;
  if (!ipcMain) return;
  ipcMain.handle('storage:classify', (_e, dir) => classify(dir));
  ipcMain.handle('storage:advice', async (_e, id) => { const m = await require('./models').getLocal(id); return adviceFor(m, { force: true }); });
  ipcMain.handle('storage:refuse', (_e, id, o) => refuse(id, o || {}));
}

module.exports = { init, classify, adviceFor, refuse, check, measureRead, classifyWin, classifyMac, classifyLinux, SLOW_MBPS };
