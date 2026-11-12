// Account passwords: only a salted scrypt hash is stored, compared in constant time, attempts are rate limited.
const crypto = require('crypto');

const PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 32 };
const scrypt = (pw, salt, o = PARAMS) => new Promise((resolve, reject) =>
  crypto.scrypt(String(pw).normalize('NFC'), salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 128 * o.N * o.r * 2 }, (e, k) => (e ? reject(e) : resolve(k))));

async function hash(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt);
  return { algo: 'scrypt', N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, salt: salt.toString('base64'), hash: h.toString('base64') };
}
async function verify(pw, rec) {
  if (!rec || rec.algo !== 'scrypt' || typeof pw !== 'string') return false;
  const want = Buffer.from(rec.hash, 'base64');
  const got = await scrypt(pw, Buffer.from(rec.salt, 'base64'), { N: rec.N, r: rec.r, p: rec.p, keylen: want.length });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Rate limit: 5 free tries, then a wait that doubles from 30 s up to 15 min. The state is kept in the account
// list (not only in memory), so restarting Fabro does not reset it.
const FREE = 5, FIRST = 30e3, MAX = 15 * 60e3;
function waitMs(att, now = Date.now()) { return att && att.until > now ? att.until - now : 0; }
function fail(att, now = Date.now()) {
  const n = ((att && att.fails) || 0) + 1;
  const until = n < FREE ? 0 : now + Math.min(MAX, FIRST * 2 ** (n - FREE));
  return { fails: n, until };
}

module.exports = { hash, verify, scrypt, waitMs, fail, PARAMS, FREE };
