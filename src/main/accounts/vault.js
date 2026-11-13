// Extra protection for an account's most sensitive secrets when it has a password.
//
// The account gets a random 256-bit data key. The data key is stored only wrapped (AES-256-GCM) with a key
// derived from the password (scrypt), so it can be opened only by typing the password. While the account is
// open, the data key sits in memory and secrets are sealed with it ("vlt:" prefix) on top of the OS protection
// (Electron safeStorage, "enc:"). Covered: provider API keys (secrets.json) and Anywhere's private keys and
// per-phone keys (anywhere.json). Not covered: everything else (conversations, settings, mods' web sign-ins…).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { scrypt } = require('./password');

let key = null;           // data key of the open account (Buffer) or null
let retired = [];         // keys that were in use earlier in this session (password removed): still opens old values
const ss = () => { try { return require('electron').safeStorage; } catch { return null; } };

const setKey = (k) => { if (key && (!k || !k.equals(key))) retired.push(key); key = k || null; };
const hasKey = () => !!key;
const getKey = () => key;

function seal(k, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(Buffer.from(String(text), 'utf8')), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function unseal(k, b64) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// OS layer (what Fabro did before accounts)
function osProtect(s) {
  try { const S = ss(); if (S && S.isEncryptionAvailable()) return 'enc:' + S.encryptString(s).toString('base64'); } catch {}
  return 'plain:' + Buffer.from(String(s)).toString('base64');
}
function osReveal(v) {
  if (typeof v !== 'string') return v;
  try {
    if (v.startsWith('enc:')) return ss().decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString();
  } catch { return null; }
  return v; // stored as is (old files, no keychain)
}

// protect(): what the modules store. reveal(): back to the secret (null if it can't be opened).
function protect(s, k = key) { const inner = osProtect(s); return k ? 'vlt:' + seal(k, inner) : inner; }
function reveal(v) {
  if (typeof v !== 'string' || !v.startsWith('vlt:')) return osReveal(v);
  for (const k of [key, ...retired].filter(Boolean)) { try { return osReveal(unseal(k, v.slice(4))); } catch { /* next */ } }
  return null;
}

// Password-derived wrapping of the data key.
async function kek(password, saltB64) { return scrypt(password, Buffer.from(saltB64, 'base64')); }
async function wrapNew(password) {
  const dk = crypto.randomBytes(32), salt = crypto.randomBytes(16).toString('base64');
  return { dk, wrap: { salt, box: seal(await kek(password, salt), dk.toString('base64')) } };
}
async function rewrap(dk, password) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { salt, box: seal(await kek(password, salt), dk.toString('base64')) };
}
async function unwrap(wrap, password) {
  try { return Buffer.from(unseal(await kek(password, wrap.salt), wrap.box), 'base64'); } catch { return null; }
}

// Re-seal the secret fields of an account's files: with the data key (password set) or without (removed).
// Values that can't be opened are left untouched (never destroyed).
const FIELDS = {
  'secrets.json': (j) => Object.keys(j).map((k) => [j, k]),
  'anywhere.json': (j) => [
    j.identity && j.identity.jwk && [j.identity.jwk, 'd'], j.vapid && j.vapid.privateJwk && [j.vapid.privateJwk, 'd'],
    ...((j.devices || []).map((d) => d && [d, 'k'])), ...((j.revoked || []).map((d) => d && [d, 'k'])),
  ].filter(Boolean),
};
function resealDir(dir, newKey) {
  let n = 0;
  for (const [name, fields] of Object.entries(FIELDS)) {
    const f = path.join(dir, name);
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const [o, k] of fields(j)) {
      if (typeof o[k] !== 'string' || !o[k]) continue;
      const plain = reveal(o[k]); if (plain == null) continue;
      o[k] = protect(plain, newKey); n++;
    }
    fs.writeFileSync(f + '.tmp', JSON.stringify(j, null, 2), { mode: 0o600 }); fs.renameSync(f + '.tmp', f);
  }
  return n;
}

module.exports = { setKey, hasKey, getKey, protect, reveal, wrapNew, rewrap, unwrap, resealDir, _test: { seal, unseal, reset: () => { key = null; retired = []; } } };
