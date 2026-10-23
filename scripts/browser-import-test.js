// Unit test for browser cookie import: Firefox (plaintext) and Chromium (encrypted) stores, plus the
// domain filter and setting cookies into a session. No real browser needed — fake cookie DBs are built.
// Usage: node scripts/browser-import-test.js
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto'); const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const bi = require('../src/main/browser-import');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-ck-test-'));
const die = (m) => { console.error('✗', m); process.exit(1); };

// ── Firefox: moz_cookies, values in the clear ──
const ff = path.join(tmp, 'cookies.sqlite');
{
  const db = new DatabaseSync(ff);
  db.exec('CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)');
  const ins = db.prepare('INSERT INTO moz_cookies (host,name,value,path,expiry,isSecure,isHttpOnly,sameSite) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('.claude.ai', 'sessionKey', 'sk-ff-123', '/', Math.floor(Date.now() / 1000) + 86400, 1, 1, 1);
  ins.run('claude.ai', 'other', 'x', '/', 0, 0, 0, 0);
  ins.run('.google.com', 'SID', 'nope', '/', 0, 1, 1, 1); // different domain → filtered out
  db.close();
}
const ffCookies = bi._internal.readFirefox(ff, ['.claude.ai']);
assert.strictEqual(ffCookies.length, 2, 'firefox: 2 claude.ai cookies');
const sk = ffCookies.find((c) => c.name === 'sessionKey');
assert(sk && sk.value === 'sk-ff-123' && sk.secure && sk.httpOnly && sk.sameSite === 'lax', 'firefox: sessionKey read with flags');
assert(!ffCookies.some((c) => c.domain.includes('google')), 'firefox: other domains filtered out');
console.log('✓ Firefox cookies read (plaintext, domain-filtered)');

// ── Chromium: encrypted_value, Linux "peanuts" scheme (AES-128-CBC) ──
function encryptV10CBC(plain) {
  const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  return Buffer.concat([Buffer.from('v10'), c.update(Buffer.from(plain, 'utf8')), c.final()]);
}
const dec = bi._internal.decryptChromium(encryptV10CBC('sk-chrome-xyz'), { cbc: crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1') }, '.claude.ai');
assert.strictEqual(dec, 'sk-chrome-xyz', 'chromium CBC decrypt');
console.log('✓ Chromium value decrypted (v10 AES-128-CBC)');

// GCM path (Windows-style), with the sha256(host) prefix newer Chrome adds
function encryptV10GCM(plain, key, host) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from(plain, 'utf8')]);
  const enc = Buffer.concat([c.update(body), c.final()]);
  return Buffer.concat([Buffer.from('v10'), nonce, enc, c.getAuthTag()]);
}
const gkey = crypto.randomBytes(32);
const decG = bi._internal.decryptChromium(encryptV10GCM('sk-gcm-9', gkey, 'www.chatgpt.com'), { gcm: gkey }, 'www.chatgpt.com');
assert.strictEqual(decG, 'sk-gcm-9', 'chromium GCM decrypt with host-hash prefix stripped');
console.log('✓ Chromium value decrypted (v10 AES-256-GCM, host prefix stripped)');

// readChromium end to end against a fake Cookies DB, monkey-patching the key source
const ck = path.join(tmp, 'Cookies');
{
  const db = new DatabaseSync(ck);
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)');
  const ins = db.prepare('INSERT INTO cookies (host_key,name,encrypted_value,value,path,expires_utc,is_secure,is_httponly,samesite) VALUES (?,?,?,?,?,?,?,?,?)');
  const future = (Date.now() / 1000 + 86400 + 11644473600) * 1e6;
  ins.run('.claude.ai', 'sessionKey', encryptV10CBC('sk-chrome-xyz'), '', '/', future, 1, 1, 1);
  ins.run('.bing.com', 'x', encryptV10CBC('no'), '', '/', future, 1, 1, 1);
  db.close();
}
// force the Linux-CBC key for the test regardless of the host OS
const orig = require('child_process').execFileSync;
require('child_process').execFileSync = () => { throw new Error('no keyring in test'); }; // → falls back to "peanuts"
const saved = { win: process.platform };
const chromCookies = bi._internal.readChromium(ck, tmp, ['.claude.ai']);
require('child_process').execFileSync = orig;
if (process.platform === 'win32') { console.log('· skipping readChromium end-to-end on Windows (DPAPI)'); }
else {
  assert.strictEqual(chromCookies.length, 1, 'chromium: 1 claude.ai cookie');
  assert.strictEqual(chromCookies[0].value, 'sk-chrome-xyz', 'chromium: decrypted value');
  assert(chromCookies[0].expirationDate > Date.now() / 1000, 'chromium: expiry converted from 1601 epoch');
  console.log('✓ Chromium Cookies DB read end to end (decrypt + domain filter + expiry)');
}

// ── importInto sets the cookies into a session ──
(async () => {
  const set = [];
  const fakeSes = { cookies: { set: async (c) => { set.push(c); } } };
  // patch readProfile to use our Firefox file
  const origRead = bi.readProfile;
  bi.readProfile = ({ domains }) => bi._internal.readFirefox(ff, domains);
  const r = await bi.importInto(fakeSes, { browser: 'firefox', profile: 'x', domains: ['.claude.ai'] });
  bi.readProfile = origRead;
  assert.strictEqual(r.set, 2, 'importInto set 2 cookies');
  const u = set.find((c) => c.name === 'sessionKey');
  assert(u.url === 'https://claude.ai/' && u.domain === '.claude.ai' && u.httpOnly && u.sameSite === 'lax', 'importInto built the right cookie spec');
  console.log('✓ importInto sets cookies into the session');

  // list() just returns an array (whatever is installed on this machine, possibly none)
  assert(Array.isArray(bi.list()), 'list() returns an array');
  console.log('✓ list() returns installed browsers:', bi.list().map((b) => b.name).join(', ') || '(none here)');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('browser-import-test: all passed');
})().catch((e) => die(e.stack || e));
