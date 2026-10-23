// Import cookies from the user's own browsers into a mod's session, so the site is already signed in.
// Reads each browser's cookie database (copied first, to avoid locks). Firefox stores values in the
// clear; Chromium-family browsers encrypt them, and we decrypt the same way the browser itself does,
// with the key the current OS user already has access to (Keychain on macOS, the login secret on Linux,
// DPAPI on Windows). Only cookies for the domains the caller asks for are read, and nothing is written
// back to the browser. This is the same "import from another browser" a browser does on first run.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const home = os.homedir();
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const APPDATA = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

// name → where its profiles live, per OS, and what kind of store it is.
function families() {
  const chromium = (id, name, winRel, macRel, linuxRels) => ({
    id, name, kind: 'chromium',
    root: isWin ? path.join(LOCALAPPDATA, ...winRel) : isMac ? path.join(home, 'Library', 'Application Support', ...macRel) : null,
    linuxRoots: linuxRels ? linuxRels.map((r) => path.join(home, '.config', r)) : [],
  });
  return [
    { id: 'firefox', name: 'Firefox', kind: 'firefox', roots: [
      isWin ? path.join(APPDATA, 'Mozilla', 'Firefox', 'Profiles') : isMac ? path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles') : path.join(home, '.mozilla', 'firefox'),
    ] },
    { id: 'librewolf', name: 'LibreWolf', kind: 'firefox', roots: [
      isWin ? path.join(APPDATA, 'librewolf', 'Profiles') : isMac ? path.join(home, 'Library', 'Application Support', 'LibreWolf', 'Profiles') : path.join(home, '.librewolf'),
    ] },
    chromium('chrome', 'Google Chrome', ['Google', 'Chrome', 'User Data'], ['Google', 'Chrome'], ['google-chrome', 'google-chrome-beta']),
    chromium('chromium', 'Chromium', ['Chromium', 'User Data'], ['Chromium'], ['chromium']),
    chromium('edge', 'Microsoft Edge', ['Microsoft', 'Edge', 'User Data'], ['Microsoft Edge'], ['microsoft-edge']),
    chromium('brave', 'Brave', ['BraveSoftware', 'Brave-Browser', 'User Data'], ['BraveSoftware', 'Brave-Browser'], ['BraveSoftware/Brave-Browser']),
    chromium('vivaldi', 'Vivaldi', ['Vivaldi', 'User Data'], ['Vivaldi'], ['vivaldi']),
    chromium('opera', 'Opera', ['Opera Software', 'Opera Stable'], ['com.operasoftware.Opera'], ['opera']),
  ];
}
const chromiumRoot = (f) => isWin || isMac ? f.root : (f.linuxRoots || []).find((d) => safe(() => fs.existsSync(d)));

function safe(fn, def) { try { return fn(); } catch { return def; } }
const exists = (p) => p && safe(() => fs.existsSync(p), false);

function firefoxProfiles(f) {
  const out = [];
  for (const root of f.roots) {
    if (!exists(root)) continue;
    for (const d of safe(() => fs.readdirSync(root), [])) {
      const c = path.join(root, d, 'cookies.sqlite');
      if (exists(c)) out.push({ name: d.replace(/^[a-z0-9]+\./i, ''), cookies: c });
    }
  }
  return out;
}
function chromiumProfiles(f) {
  const root = chromiumRoot(f);
  if (!exists(root)) return { root: null, profiles: [] };
  const profiles = [];
  for (const d of safe(() => fs.readdirSync(root, { withFileTypes: true }), [])) {
    if (!d.isDirectory() || !(d.name === 'Default' || /^Profile \d+$/.test(d.name))) continue;
    const c = [path.join(root, d.name, 'Network', 'Cookies'), path.join(root, d.name, 'Cookies')].find(exists);
    if (c) profiles.push({ name: d.name, cookies: c });
  }
  return { root, profiles };
}

// Test seam: FABRO_IMPORT_FAKE = JSON {id,name,kind,cookies} adds one fake browser (used by the e2e only).
const fake = () => { try { return process.env.FABRO_IMPORT_FAKE ? JSON.parse(process.env.FABRO_IMPORT_FAKE) : null; } catch { return null; } };

// What is installed.
function list() {
  const out = [];
  const fk = fake(); if (fk) out.push({ id: fk.id, name: fk.name, kind: fk.kind, profiles: [{ name: 'default' }] });
  for (const f of families()) {
    const profiles = f.kind === 'firefox' ? firefoxProfiles(f) : chromiumProfiles(f).profiles;
    if (profiles.length) out.push({ id: f.id, name: f.name, kind: f.kind, profiles: profiles.map((p) => ({ name: p.name })) });
  }
  return out;
}

function openCopy(src) {
  const tmp = path.join(os.tmpdir(), 'fabro-ck-' + crypto.randomBytes(6).toString('hex') + '.sqlite');
  fs.copyFileSync(src, tmp);
  for (const ext of ['-wal', '-shm']) if (exists(src + ext)) safe(() => fs.copyFileSync(src + ext, tmp + ext));
  const db = new DatabaseSync(tmp, { readOnly: true });
  return { db, cleanup: () => { safe(() => db.close()); for (const s of ['', '-wal', '-shm']) safe(() => fs.rmSync(tmp + s, { force: true })); } };
}

const hostMatches = (host, domains) => domains.some((d) => { const dd = d.replace(/^\./, ''); const h = host.replace(/^\./, ''); return h === dd || h.endsWith('.' + dd); });
const SAMESITE = { 0: 'no_restriction', 1: 'lax', 2: 'strict', '-1': 'unspecified' };

function readFirefox(file, domains) {
  const { db, cleanup } = openCopy(file);
  try {
    const rows = db.prepare('SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies').all();
    return rows.filter((r) => hostMatches(r.host, domains)).map((r) => ({
      name: r.name, value: r.value, domain: r.host, path: r.path || '/',
      secure: !!r.isSecure, httpOnly: !!r.isHttpOnly, sameSite: SAMESITE[r.sameSite] || 'unspecified',
      expirationDate: r.expiry ? Number(r.expiry) : undefined,
    }));
  } finally { cleanup(); }
}

// ── Chromium value decryption ──
function dpapiUnprotect(buf) {
  // Windows only: CryptUnprotectData via PowerShell (no native module needed).
  const b64 = buf.toString('base64');
  const ps = `Add-Type -AssemblyName System.Security;[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'),$null,'CurrentUser'))`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, windowsHide: true });
  return Buffer.from(out.toString().trim(), 'base64');
}
function chromiumKey(root) {
  if (isWin) {
    const ls = JSON.parse(fs.readFileSync(path.join(path.dirname(root) === root ? root : root, 'Local State'), 'utf8'));
    const enc = Buffer.from(ls.os_crypt.encrypted_key, 'base64');
    return { gcm: dpapiUnprotect(enc.subarray(5)) }; // strip "DPAPI" prefix → 32-byte AES-256-GCM key
  }
  // mac / Linux: a passphrase run through PBKDF2 (AES-128-CBC).
  let secret = 'peanuts'; // Linux default when no keyring secret is set
  if (isMac) secret = safe(() => execFileSync('security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage'], { timeout: 8000 }).toString().trim(), 'peanuts');
  else {
    const name = { chrome: 'Chrome', chromium: 'Chromium', edge: 'Chromium', brave: 'Chrome', vivaldi: 'Chrome', opera: 'Chromium' };
    for (const label of ['Chrome Safe Storage', 'Chromium Safe Storage', 'Brave Safe Storage']) {
      const s = safe(() => execFileSync('secret-tool', ['lookup', 'application', label.split(' ')[0].toLowerCase()], { timeout: 8000 }).toString(), '');
      if (s) { secret = s; break; }
    }
  }
  const iter = isMac ? 1003 : 1;
  return { cbc: crypto.pbkdf2Sync(secret, 'saltysalt', iter, 16, 'sha1') };
}
function decryptChromium(enc, key, host) {
  if (!enc || !enc.length) return '';
  const prefix = enc.subarray(0, 3).toString('latin1');
  if ((prefix === 'v10' || prefix === 'v11') && key.gcm) {
    const nonce = enc.subarray(3, 15), tag = enc.subarray(enc.length - 16), data = enc.subarray(15, enc.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key.gcm, nonce); d.setAuthTag(tag);
    let out = Buffer.concat([d.update(data), d.final()]);
    if (out.length >= 32 && out.subarray(0, 32).equals(crypto.createHash('sha256').update(host).digest())) out = out.subarray(32); // newer Chrome prepends sha256(host)
    return out.toString('utf8');
  }
  if ((prefix === 'v10' || prefix === 'v11') && key.cbc) {
    const d = crypto.createDecipheriv('aes-128-cbc', key.cbc, Buffer.alloc(16, ' ')); d.setAutoPadding(true);
    let out = Buffer.concat([d.update(enc.subarray(3)), d.final()]);
    if (out.length >= 32 && out.subarray(0, 32).equals(crypto.createHash('sha256').update(host).digest())) out = out.subarray(32);
    return out.toString('utf8');
  }
  if (isWin) return safe(() => dpapiUnprotect(enc).toString('utf8'), ''); // very old cookies: DPAPI on the whole value
  return '';
}
function readChromium(file, root, domains) {
  const key = chromiumKey(root);
  const { db, cleanup } = openCopy(file);
  try {
    const stmt = db.prepare('SELECT host_key, name, encrypted_value, value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies');
    stmt.setReadBigInts(true); // expires_utc (µs since 1601) overflows a JS number
    const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
    const rows = stmt.all();
    const out = [];
    for (const r of rows) {
      const host = String(r.host_key);
      if (!hostMatches(host, domains)) continue;
      let value = r.value;
      if ((!value || !value.length) && r.encrypted_value && r.encrypted_value.length) value = safe(() => decryptChromium(Buffer.from(r.encrypted_value), key, host), '');
      if (value == null) continue;
      const exp = num(r.expires_utc);
      out.push({
        name: r.name, value, domain: host, path: r.path || '/',
        secure: !!num(r.is_secure), httpOnly: !!num(r.is_httponly), sameSite: SAMESITE[num(r.samesite)] ?? 'unspecified',
        expirationDate: exp ? exp / 1e6 - 11644473600 : undefined, // Chrome epoch (1601) µs → unix s
      });
    }
    return out;
  } finally { cleanup(); }
}

// Read cookies for `domains` from one browser profile. Returns [] and a reason string on failure.
function readProfile({ browser, profile, domains }) {
  const fk = fake();
  if (fk && browser === fk.id) return fk.kind === 'firefox' ? readFirefox(fk.cookies, domains) : readChromium(fk.cookies, path.dirname(fk.cookies), domains);
  const f = families().find((x) => x.id === browser);
  if (!f) throw new Error('Unknown browser');
  if (f.kind === 'firefox') {
    const p = firefoxProfiles(f).find((x) => x.name === profile) || firefoxProfiles(f)[0];
    if (!p) throw new Error('No profile');
    return readFirefox(p.cookies, domains);
  }
  const { root, profiles } = chromiumProfiles(f);
  const p = profiles.find((x) => x.name === profile) || profiles[0];
  if (!p) throw new Error('No profile');
  return readChromium(p.cookies, root, domains);
}

// Read cookies and set them into an Electron session. Returns { set, total }.
async function importInto(ses, { browser, profile, domains }) {
  const cookies = module.exports.readProfile({ browser, profile, domains }); // module.exports so tests can override
  let set = 0;
  for (const c of cookies) {
    if (!c.value) continue;
    const host = c.domain.replace(/^\./, '');
    const url = `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`;
    const spec = { url, name: c.name, value: c.value, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite };
    if (c.domain.startsWith('.')) spec.domain = c.domain; // a domain-wide cookie keeps its leading dot
    if (c.expirationDate && c.expirationDate > Date.now() / 1000) spec.expirationDate = c.expirationDate;
    try { await ses.cookies.set(spec); set++; } catch {}
  }
  return { set, total: cookies.length };
}

module.exports = { list, readProfile, importInto, _internal: { decryptChromium, hostMatches, readFirefox, readChromium } };
