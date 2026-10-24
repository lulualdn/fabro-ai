// Fabro Anywhere — the full desktop interface on a paired phone. The phone loads the same renderer files as
// the desktop window (sent over the encrypted session), runs them in a sandboxed frame, and every `api.*` call
// comes back here and runs the very handler the desktop window would have used. Events the desktop window
// receives are mirrored to the phones that opened the full interface.
//
// Paired phones are the owner's own devices (they already run the agent on this computer), so the API is the
// desktop's, minus what only makes sense in front of the computer: window controls, the quick bar, pairing,
// dialogs, opening things in the computer's apps. Calls from a phone run in a marked async context, and those
// computer-only functions refuse in that context instead of popping up on an empty desk.
const { app, ipcMain, dialog, shell } = require('electron');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const handlers = new Map();          // ipc channel → handler(event, ...args)
const remoteCtx = new AsyncLocalStorage();
const subs = new Map();             // deviceId → { buf: [], timer }
const seen = new Map();             // deviceId → Set of absolute paths this phone was shown (it may fetch those)
let sendTo = () => false;
const RENDERER = path.join(__dirname, '..', 'renderer');

// ───────────────────────────── capture ─────────────────────────────
// Must run before any ipcMain.handle(): keeps a reference to each handler so a phone can call it too.
function capture() {
  if (capture.done) return; capture.done = true;
  const orig = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (ch, fn) => { handlers.set(ch, fn); return orig(ch, fn); };
  const origRemove = ipcMain.removeHandler.bind(ipcMain);
  ipcMain.removeHandler = (ch) => { handlers.delete(ch); return origRemove(ch); };
  // computer-only effects refuse when a phone asked
  const refuse = (name) => () => { throw new Error(`NEEDS_COMPUTER:${name}`); };
  for (const k of ['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showErrorBox']) {
    const o = dialog[k].bind(dialog); dialog[k] = (...a) => (remoteCtx.getStore() ? refuse(k)() : o(...a));
  }
  for (const k of ['openPath', 'showItemInFolder', 'openExternal']) {
    const o = shell[k].bind(shell); shell[k] = (...a) => (remoteCtx.getStore() ? refuse(k)() : o(...a));
  }
}

// Channels that only arrange the computer's own window (its title bar, the embedded browser's position…):
// from a phone they do nothing, quietly.
const NOOP = new Set(['window:theme', 'window:buttons', 'window:devtools', 'browser:bounds', 'mods:webBounds', 'mods:webHide', 'link:ready', 'hotkey:apply']);
const noop = (ch) => NOOP.has(ch) || ch.startsWith('quick:');
// Channels a phone can't use: they act on the computer itself, or manage the paired phones.
const DENY = new Set([
  'app:quit', 'login:set', 'updater:install', 'shell:open', 'shell:reveal', 'shell:openPath', 'mods:openFolder',
  'skills:openFolder', 'crash:folder', 'anywhere:pairStart', 'anywhere:pairStop', 'anywhere:revoke', 'anywhere:rename',
  'anywhere:configure', 'anywhere:reply',
]);
const denied = (ch) => DENY.has(ch) || ch.startsWith('aw:');

// ───────────────────────────── wire format ─────────────────────────────
// JSON both ways; binary as { __u8: base64 }. Absolute paths seen on the way out are remembered per phone.
const PATH_RE = /^(\/|[A-Za-z]:[\\/])[^\0\n<>"|?*]{1,500}$/;
function encode(v, dev, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') { if (dev && v.length < 520 && PATH_RE.test(v)) remember(dev, v); return v; }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __u8: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
  if (v instanceof ArrayBuffer) return { __u8: Buffer.from(v).toString('base64') };
  if (depth > 40) return null;
  if (Array.isArray(v)) return v.map((x) => encode(x, dev, depth + 1));
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map) return encode(Object.fromEntries(v), dev, depth + 1);
  if (v instanceof Set) return encode([...v], dev, depth + 1);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { const x = v[k]; if (typeof x !== 'function' && x !== undefined) o[k] = encode(x, dev, depth + 1); } return o; }
  return undefined;
}
function decode(v, depth = 0) {
  if (v == null || typeof v !== 'object' || depth > 40) return v;
  if (typeof v.__u8 === 'string' && Object.keys(v).length === 1) return Buffer.from(v.__u8, 'base64');
  if (Array.isArray(v)) return v.map((x) => decode(x, depth + 1));
  const o = {}; for (const k of Object.keys(v)) o[k] = decode(v[k], depth + 1); return o;
}
function remember(dev, p) {
  let s = seen.get(dev); if (!s) { s = new Set(); seen.set(dev, s); }
  if (s.size > 20000) s.clear();
  s.add(path.normalize(p));
}

// ───────────────────────────── the interface itself ─────────────────────────────
// index.html + every script and stylesheet it loads, plus the shape of window.api (from preload.js).
let bundleCache = null;
function apiMap() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  let exposed = null;
  const stub = {
    require: (m) => (m === 'electron' ? {
      contextBridge: { exposeInMainWorld: (_n, obj) => { exposed = obj; } },
      ipcRenderer: { invoke: (ch) => ({ __ch: ch }), on: () => {}, removeListener: () => {} },
      webUtils: { getPathForFile: () => '' },
    } : {}),
  };
  vm.runInNewContext(src, stub, { timeout: 1000 });
  const map = {};
  const walk = (o, pre) => {
    for (const [k, v] of Object.entries(o || {})) {
      const key = pre ? pre + '.' + k : k;
      if (typeof v === 'function') {
        if (k === 'on') { map[key] = '#on'; continue; }
        let r; try { r = v(); } catch { r = null; }
        map[key] = r && r.__ch ? r.__ch : '#local:' + k;
      } else if (v && typeof v === 'object') walk(v, key);
    }
  };
  walk(exposed, '');
  const allowed = (src.match(/const allowed = (\[[^\]]*\])/) || [])[1];
  return { map, events: allowed ? JSON.parse(allowed.replace(/'/g, '"')) : [] };
}
function bundle() {
  if (bundleCache && app.isPackaged) return bundleCache;
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const files = [];
  for (const m of html.matchAll(/<(script|link)\b[^>]*?(?:src|href)="([^"]+)"[^>]*>/g)) {
    const kind = m[1] === 'script' ? 'js' : 'css';
    if (kind === 'css' && !/rel="stylesheet"/.test(m[0])) continue;
    const file = path.resolve(RENDERER, m[2]);
    files.push({ src: m[2], kind, text: fs.readFileSync(file, 'utf8') });
  }
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script\b[^>]*><\/script>\s*/g, '').trim();
  const { map, events } = apiMap();
  const hash = crypto.createHash('sha256').update(JSON.stringify([body, files.map((f) => f.text), map])).digest('hex').slice(0, 16);
  bundleCache = { v: `${app.getVersion()}-${hash}`, body, files, api: map, events };
  return bundleCache;
}

// ───────────────────────────── calls from a phone ─────────────────────────────
function fakeSender(deviceId, ops) {
  return {
    id: -1, isDestroyed: () => false, getURL: () => 'fabro-anywhere://' + deviceId, getType: () => 'remote',
    insertCSS: async (css) => { ops.push({ css: String(css) }); return 'k'; },
    executeJavaScript: async (js) => { ops.push({ js: String(js) }); return undefined; },
    send: (ch, data) => forward(ch, data, deviceId),
    reload: () => ops.push({ reload: true }),
  };
}
async function call(deviceId, { ch, args } = {}) {
  ch = String(ch || '');
  if (noop(ch)) return { r: ch === 'link:ready' ? true : null, ops: [] };
  if (denied(ch)) throw new Error('NEEDS_COMPUTER:' + ch);
  const fn = handlers.get(ch); if (!fn) throw new Error('unknown channel ' + ch);
  const ops = [];
  const sender = fakeSender(deviceId, ops);
  const event = { sender, senderFrame: null, processId: -1, frameId: -1, remote: deviceId };
  const r = await remoteCtx.run({ deviceId }, () => fn(event, ...decode(Array.isArray(args) ? args : [])));
  if (ch === 'app:info') Object.assign(r, { remote: true });
  if (ch === 'mods:enable') ops.push({ reload: true }); // the desktop window reloads its mods; so does the phone
  return { r: encode(r, deviceId), ops };
}

// ───────────────────────────── events to phones ─────────────────────────────
let eventSet = null;
function forward(ch, data, only) {
  if (!subs.size) return;
  if (!eventSet) { eventSet = new Set(bundle().events); eventSet.delete('anywhere:ask'); } // the computer asking its own window: not for phones
  if (!eventSet.has(ch)) return;
  for (const [id, s] of subs) {
    if (only && id !== only) continue;
    s.buf.push([ch, encode(data, id)]);
    if (!s.timer) s.timer = setTimeout(() => flush(id), 50);
  }
}
function flush(id) {
  const s = subs.get(id); if (!s) return;
  s.timer = null; if (!s.buf.length) return;
  const evs = s.buf; s.buf = [];
  if (sendTo(id, { t: 'ev', k: 'ui', evs }) === false) subs.delete(id); // phone gone
}
// Mirror everything the desktop window receives.
function tee(wc) {
  if (!wc || wc.__fabroTee) return; wc.__fabroTee = true;
  const orig = wc.send.bind(wc);
  wc.send = (ch, ...a) => { orig(ch, ...a); try { forward(ch, a[0]); } catch {} };
}

// ───────────────────────────── files ─────────────────────────────
// A phone may fetch a file it was shown (a path that reached it in a result or an event), or anything in
// Fabro's own folders. 25 MB max per file.
function roots() {
  const store = require('./store'); const s = store.getSettings();
  const out = [path.join(os.homedir(), 'Documents', 'Fabro'), app.getPath('userData'), os.tmpdir()];
  for (const f of ((s.agent || {}).folders || [])) out.push(typeof f === 'string' ? f : f && f.path);
  return out.filter(Boolean).map((p) => path.resolve(p));
}
const under = (p, root) => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', csv: 'text/csv', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
function file(deviceId, { path: p } = {}) {
  let f = String(p || '');
  if (/^file:/.test(f)) { try { f = require('url').fileURLToPath(f); } catch { throw new Error('Bad path'); } }
  f = path.resolve(path.normalize(f));
  const ok = (seen.get(deviceId) || new Set()).has(f) || roots().some((r) => under(f, r));
  if (!ok) throw new Error('File not available');
  const st = fs.statSync(f); if (!st.isFile()) throw new Error('Not a file');
  if (st.size > 25e6) throw new Error('File too large to send (25 MB max)');
  const ext = path.extname(f).slice(1).toLowerCase();
  return { name: path.basename(f), size: st.size, mime: MIME[ext] || 'application/octet-stream', data: fs.readFileSync(f).toString('base64') };
}

// ───────────────────────────── entry points (from anywhere.js) ─────────────────────────────
async function handle(deviceId, method, p = {}) {
  switch (method) {
    case 'ui.bundle': {
      const b = bundle(); if (p.have === b.v) return { v: b.v, same: true };
      // ~1 MB of scripts: gzip it when the phone can inflate (DecompressionStream), about 4× less to send
      return p.gz ? { v: b.v, gz: require('zlib').gzipSync(JSON.stringify(b), { level: 9 }).toString('base64') } : b;
    }
    case 'ui.sub': if (p.on === false) subs.delete(deviceId); else if (!subs.has(deviceId)) subs.set(deviceId, { buf: [], timer: null }); return true;
    case 'ui.call': return call(deviceId, p);
    case 'ui.file': return file(deviceId, p);
    case 'ui.art': { const u = String(p.url || ''); if (!u.startsWith('fabro-art://')) throw new Error('Bad URL'); return { html: require('./export').artHtml(u) }; }
    default: return undefined;
  }
}
function init({ send }) { sendTo = send; }
function drop(deviceId) { subs.delete(deviceId); seen.delete(deviceId); }

module.exports = { capture, tee, init, handle, drop, forward, _test: { bundle, apiMap, encode, decode, call, file, handlers, subs } };
