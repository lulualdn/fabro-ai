// Web Push from the computer straight to the phone's push service (RFC 8291 message encryption,
// RFC 8292 VAPID). No Fabro server: the phone's browser gives an endpoint, the computer posts to it.
const crypto = require('crypto');

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const expand = (prk, info, len) => hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, len);

// sub: { p256dh, auth } (base64url). Returns the aes128gcm body.
function encrypt(sub, payload, { salt = crypto.randomBytes(16), asPrivate = null, recordSize = 4096 } = {}) {
  const uaPub = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(asPrivate); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const prkKey = hmac(auth, shared);
  const ikm = expand(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = expand(prk, 'Content-Encoding: nonce\0', 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(recordSize);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

// VAPID key pair (ECDSA P-256): { privateJwk, publicKey (base64url, uncompressed point) }
function vapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { privateJwk: jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])) };
}
function vapidHeader(endpoint, keys, subject = 'https://fabro-local-ai.netlify.app') {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// subscription: PushSubscription JSON ({ endpoint, keys: { p256dh, auth } }). Returns { ok, status, gone }.
async function send(subscription, message, keys, { ttl = 86400, urgency = 'high' } = {}) {
  const body = encrypt(subscription.keys, Buffer.from(JSON.stringify(message)));
  const r = await fetch(subscription.endpoint, {
    method: 'POST', body,
    headers: { TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(subscription.endpoint, keys) },
  });
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410 };
}

module.exports = { encrypt, vapidKeys, vapidHeader, send };
