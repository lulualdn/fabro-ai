/* Fabro Anywhere — code shared by the phone app (site/app) and the computer (hidden peer window):
   crypto (WebCrypto), Reed-Solomon, the circular pairing code (draw + read from a camera frame),
   a small MQTT-over-WebSocket relay client, the pairing handshake, encrypted sessions upgraded to a
   direct WebRTC data channel, and conflict-free conversation merging.
   Works in browsers and in Node 22+ (tests). No dependencies. */
(function (root) {
  'use strict';
  const C = root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
  const subtle = C.subtle;
  const te = new TextEncoder(), td = new TextDecoder();

  // ───────────────────────────── bytes ─────────────────────────────
  const rand = (n) => C.getRandomValues(new Uint8Array(n));
  const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => new Uint8Array(String(s).match(/../g).map((x) => parseInt(x, 16)));
  function b64u(b) { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  const utf8 = (s) => te.encode(s);
  const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  const uid = () => hex(rand(8));

  // ───────────────────────────── crypto ─────────────────────────────
  const sha256 = async (b) => new Uint8Array(await subtle.digest('SHA-256', b));
  async function hmac(key, data) { const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await subtle.sign('HMAC', k, data)); }
  async function hkdf(ikm, salt, info, len = 32) {
    const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: typeof info === 'string' ? utf8(info) : info }, k, len * 8));
  }
  async function genKeys() {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    return { priv: kp.privateKey, pub: new Uint8Array(await subtle.exportKey('raw', kp.publicKey)), jwk: await subtle.exportKey('jwk', kp.privateKey) };
  }
  async function importPriv(jwk) {
    const priv = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const pub = concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y));
    return { priv, pub, jwk };
  }
  async function ecdh(priv, pubRaw) {
    const pub = await subtle.importKey('raw', pubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
  }
  const aesKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(key, obj) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(obj))));
    return concat(iv, ct);
  }
  async function open(key, bytes) {
    try { return JSON.parse(td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)))); } catch { return null; }
  }
  const fingerprint = async (pub) => (await sha256(pub)).subarray(0, 15);

  // ───────────────────────────── Reed-Solomon (GF(256), poly 0x11d) ─────────────────────────────
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
  const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const gdiv = (a, b) => { if (!b) throw new Error('div0'); return a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0; };
  const gpow = (x, p) => EXP[(((LOG[x] * p) % 255) + 255) % 255];
  const ginv = (x) => EXP[255 - LOG[x]];
  const pscale = (p, x) => p.map((c) => gmul(c, x));
  function padd(p, q) { const r = new Array(Math.max(p.length, q.length)).fill(0); for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i]; for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i]; return r; }
  function pmul(p, q) { const r = new Array(p.length + q.length - 1).fill(0); for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= gmul(p[i], q[j]); return r; }
  function peval(p, x) { let y = p[0]; for (let i = 1; i < p.length; i++) y = gmul(y, x) ^ p[i]; return y; }
  function pdivRem(dividend, divisor) {
    const out = dividend.slice();
    for (let i = 0; i < dividend.length - (divisor.length - 1); i++) { const c = out[i]; if (c) for (let j = 1; j < divisor.length; j++) if (divisor[j]) out[i + j] ^= gmul(divisor[j], c); }
    return out.slice(out.length - (divisor.length - 1));
  }
  function rsEncode(msg, nsym) {
    let g = [1]; for (let i = 0; i < nsym; i++) g = pmul(g, [1, gpow(2, i)]);
    const out = [...msg, ...new Array(nsym).fill(0)];
    for (let i = 0; i < msg.length; i++) { const c = out[i]; if (c) for (let j = 1; j < g.length; j++) out[i + j] ^= gmul(g[j], c); }
    return new Uint8Array([...msg, ...out.slice(msg.length)]);
  }
  function rsDecode(input, nsym) {
    const msg = Array.from(input);
    const synd = [0]; for (let i = 0; i < nsym; i++) synd.push(peval(msg, gpow(2, i)));
    if (Math.max(...synd) === 0) return new Uint8Array(msg.slice(0, msg.length - nsym));
    // Berlekamp-Massey
    let errLoc = [1], oldLoc = [1];
    for (let i = 0; i < nsym; i++) {
      const K = i + 1;
      let delta = synd[K];
      for (let j = 1; j < errLoc.length; j++) delta ^= gmul(errLoc[errLoc.length - 1 - j], synd[K - j]);
      oldLoc = [...oldLoc, 0];
      if (delta) {
        if (oldLoc.length > errLoc.length) { const nl = pscale(oldLoc, delta); oldLoc = pscale(errLoc, ginv(delta)); errLoc = nl; }
        errLoc = padd(errLoc, pscale(oldLoc, delta));
      }
    }
    while (errLoc.length && errLoc[0] === 0) errLoc.shift();
    const errs = errLoc.length - 1;
    if (errs * 2 > nsym) return null;
    // Chien search
    const rev = errLoc.slice().reverse(), pos = [];
    for (let i = 0; i < msg.length; i++) if (peval(rev, gpow(2, i)) === 0) pos.push(msg.length - 1 - i);
    if (pos.length !== errs) return null;
    // Forney
    const coefPos = pos.map((p) => msg.length - 1 - p);
    let eLoc = [1]; for (const i of coefPos) eLoc = pmul(eLoc, padd([1], [gpow(2, i), 0]));
    const sr = synd.slice().reverse();
    const evalRem = pdivRem(pmul(sr, eLoc), [1, ...new Array(eLoc.length).fill(0)]);
    const errEval = evalRem.slice().reverse();
    const X = coefPos.map((c) => gpow(2, -(255 - c)));
    const E = new Array(msg.length).fill(0);
    X.forEach((Xi, i) => {
      const XiInv = ginv(Xi);
      let prime = 1; X.forEach((Xj, j) => { if (j !== i) prime = gmul(prime, 1 ^ gmul(XiInv, Xj)); });
      const y = gmul(Xi, peval(errEval.slice().reverse(), XiInv));
      if (!prime) return;
      E[pos[i]] = gdiv(y, prime);
    });
    const fixed = padd(msg, E);
    for (let i = 0; i < nsym; i++) if (peval(fixed, gpow(2, i)) !== 0) return null;
    return new Uint8Array(fixed.slice(0, fixed.length - nsym));
  }

  // ───────────────────────────── circular pairing code ─────────────────────────────
  // Radii in units of the code radius. Data rings hold 294 bits (35 bytes = 27 data + 8 Reed-Solomon);
  // the outer ring is a fixed pattern used to find the rotation, the size and the colours.
  const RINGS = [{ r: 0.36, n: 30 }, { r: 0.45, n: 38 }, { r: 0.54, n: 45 }, { r: 0.63, n: 53 }, { r: 0.72, n: 60 }, { r: 0.81, n: 68 }];
  const SYNC = { r: 0.91, bits: '0100000111011110111011101001000110010000011010011101001110011001' };
  const STROKE = 0.05, GAP = 0.014, NSYM = 8, DATA_LEN = 27, VERSION = 0xF1;
  const TAU = Math.PI * 2;
  function whitenMask(n) { let s = 0x9e3779b9 >>> 0; const m = new Uint8Array(n); for (let i = 0; i < n; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; m[i] = s & 1; } return m; }
  const CAP = RINGS.reduce((n, r) => n + r.n, 0);
  const MASK = whitenMask(CAP);
  function codeBits(data27) {
    const full = rsEncode(Array.from(data27), NSYM);
    const bits = new Uint8Array(CAP);
    for (let i = 0; i < full.length * 8; i++) bits[i] = (full[i >> 3] >> (7 - (i & 7))) & 1;
    for (let i = 0; i < CAP; i++) bits[i] ^= MASK[i];
    return bits;
  }
  function bitsToData(bits) {
    const b = bits.map((x, i) => x ^ MASK[i]);
    const bytes = new Uint8Array(DATA_LEN + NSYM);
    for (let i = 0; i < bytes.length * 8; i++) bytes[i >> 3] |= b[i] << (7 - (i & 7));
    return rsDecode(bytes, NSYM);
  }
  // payload: { flags, fp: Uint8Array(15), secret: Uint8Array(10) }
  function packPayload({ flags = 0, fp, secret }) { return concat(new Uint8Array([VERSION, flags & 255]), fp.subarray(0, 15), secret.subarray(0, 10)); }
  function unpackPayload(d) { if (!d || d.length !== DATA_LEN || d[0] !== VERSION) return null; return { flags: d[1], fp: d.slice(2, 17), secret: d.slice(17, 27) }; }

  const pt = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];
  const f4 = (x) => +x.toFixed(4);
  function arcPath(r, a0, a1) {
    if (a1 - a0 >= TAU - 1e-6) return `M ${f4(0)} ${f4(-r)} A ${r} ${r} 0 1 1 ${f4(0)} ${f4(r)} A ${r} ${r} 0 1 1 ${f4(0)} ${f4(-r)}`;
    const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1);
    return `M ${f4(x0)} ${f4(y0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f4(x1)} ${f4(y1)}`;
  }
  function ringArcs(r, bits) {
    const n = bits.length, d = TAU / n;
    if (bits.every((b) => b)) return [arcPath(r, 0, TAU)];
    let s = bits.indexOf(0); const out = [];
    for (let k = 1; k <= n; k++) {
      const i = (s + k) % n; if (!bits[i]) continue;
      let L = 0; while (L < n && bits[(i + L) % n]) L++;
      const pad = (STROKE / 2 + GAP / 2) / r;
      out.push(arcPath(r, i * d + pad, (i + L) * d - pad));
      k += L - 1;
    }
    return out;
  }
  // Draw the code as SVG. opts: { size, ink, accent, animate, mark (inner svg markup of the propeller), id }
  function ringCodeSVG(data27, opts = {}) {
    const bits = codeBits(data27);
    const id = opts.id || 'rc' + uid().slice(0, 6);
    const ink = opts.ink || 'currentColor', accent = opts.accent || '#ff5e42';
    const groups = []; let o = 0;
    RINGS.forEach((ring, k) => { groups.push({ r: ring.r, paths: ringArcs(ring.r, Array.from(bits.subarray(o, o + ring.n))), k }); o += ring.n; });
    groups.push({ r: SYNC.r, paths: ringArcs(SYNC.r, SYNC.bits.split('').map(Number)), k: RINGS.length });
    const anim = !!opts.animate;
    const masks = anim ? groups.map((g) => `<mask id="${id}m${g.k}" maskUnits="userSpaceOnUse" x="-1.1" y="-1.1" width="2.2" height="2.2"><circle class="${id}sw" style="--c:${(TAU * g.r + 0.05).toFixed(4)};animation-delay:${(0.12 + g.k * 0.11).toFixed(2)}s" r="${g.r}" fill="none" stroke="#fff" stroke-width="0.12" stroke-dasharray="${(TAU * g.r + 0.05).toFixed(4)} ${(TAU * g.r + 0.05).toFixed(4)}" stroke-dashoffset="${(TAU * g.r + 0.05).toFixed(4)}" transform="rotate(-90)"/></mask>`).join('') : '';
    const style = anim ? `<style>.${id}sw{animation:${id}sweep 1.1s cubic-bezier(.3,.7,.2,1) forwards}@keyframes ${id}sweep{to{stroke-dashoffset:0}}.${id}p{transform-origin:0 0;animation:${id}spin 1.4s cubic-bezier(.2,.8,.2,1) both,${id}spin 7s linear 1.4s infinite}@keyframes ${id}spin{from{transform:rotate(-200deg)}to{transform:rotate(160deg)}}@media (prefers-reduced-motion:reduce){.${id}sw{animation:none;stroke-dashoffset:0}.${id}p{animation:none}}</style>` : '';
    const body = groups.map((g) => `<g${anim ? ` mask="url(#${id}m${g.k})"` : ''}>${g.paths.map((d) => `<path d="${d}"/>`).join('')}</g>`).join('');
    const mark = opts.mark ? `<g class="${id}p"><g transform="translate(-0.25 -0.25) scale(0.005)" fill="${accent}">${opts.mark}</g></g>` : `<circle r="0.2" fill="${accent}"/>`;
    const sz = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2"${sz} role="img" aria-label="${opts.label || 'Fabro pairing code'}">${style}<defs>${masks}</defs><g fill="none" stroke="${ink}" stroke-width="${STROKE}" stroke-linecap="round">${body}</g>${mark}</svg>`;
  }

  // Read the code from a camera frame. img: { data (RGBA), width, height }. The code is expected near the
  // centre, roughly filling `guide` × the shorter side (the viewfinder circle). Returns { data27, ... } or null.
  function decodeRingCode(img, guide = 0.8, trace = null) {
    const maxSide = 360;
    const k = Math.max(1, Math.max(img.width, img.height) / maxSide);
    const W = Math.max(8, Math.floor(img.width / k)), H = Math.max(8, Math.floor(img.height / k));
    const g = new Float32Array(W * H);
    // grayscale + downscale (area average)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      const x0 = Math.floor(x * k), x1 = Math.min(img.width, Math.floor((x + 1) * k)), y0 = Math.floor(y * k), y1 = Math.min(img.height, Math.floor((y + 1) * k));
      for (let yy = y0; yy < Math.max(y1, y0 + 1); yy++) for (let xx = x0; xx < Math.max(x1, x0 + 1); xx++) { const i = (yy * img.width + xx) * 4; s += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; c++; }
      g[y * W + x] = s / c;
    }
    // light blur
    const b = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += g[yy * W + xx]; c++; } }
      b[y * W + x] = s / c;
    }
    const sample = (x, y) => {
      if (x < 0 || y < 0 || x > W - 1.001 || y > H - 1.001) return NaN;
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, i = yi * W + xi;
      return b[i] * (1 - fx) * (1 - fy) + b[i + 1] * fx * (1 - fy) + b[i + W] * (1 - fx) * fy + b[i + W + 1] * fx * fy;
    };
    const P = SYNC.bits.split('').map((x) => (x === '1' ? 1 : -1));
    const minS = Math.min(W, H);
    // a point of the code: angle a (clockwise from the top) on radius r, for a centre, size and tilt
    // (a circle seen at an angle is an ellipse: aspect asp along the direction beta)
    const at2 = (cx, cy, R, asp, beta, r, a) => {
      const u = r * R * Math.sin(a), v = -r * R * Math.cos(a), cb = Math.cos(beta), sb = Math.sin(beta);
      const u1 = (u * cb + v * sb) * asp, v1 = (-u * sb + v * cb) / asp;
      return sample(cx + u1 * cb - v1 * sb, cy + u1 * sb + v1 * cb);
    };
    // correlation of the sync ring for a centre/radius/tilt, over M rotations (both directions)
    function syncScore(cx, cy, R, asp, M, beta = 0, band = 0) {
      const s = new Float32Array(M); let mean = 0, miss = 0, n = 0;
      for (let m = 0; m < M; m++) {
        const a = (m / M) * TAU;
        // with a band, average across the ring's width (tolerates a coarse guess of centre and size)
        const v = band ? (at2(cx, cy, R, asp, beta, SYNC.r - band, a) + at2(cx, cy, R, asp, beta, SYNC.r, a) + at2(cx, cy, R, asp, beta, SYNC.r + band, a)) / 3 : at2(cx, cy, R, asp, beta, SYNC.r, a);
        if (Number.isNaN(v)) { s[m] = NaN; if (++miss > M * 0.15) return null; continue; }
        s[m] = v; mean += v; n++;
      }
      mean /= n; let sd = 0; for (let m = 0; m < M; m++) { s[m] = Number.isNaN(s[m]) ? 0 : s[m] - mean; sd += s[m] * s[m]; }
      sd = Math.sqrt(sd / n) || 1;
      const exp = new Float32Array(M); for (let m = 0; m < M; m++) exp[m] = P[Math.floor((m / M) * 64)];
      let best = { c: 0 };
      for (const dir of [1, -1]) for (let sh = 0; sh < M; sh++) {
        let c = 0;
        for (let m = 0; m < M; m++) { const j = dir > 0 ? (m - sh + M) % M : (sh - m + M) % M; c += s[m] * exp[j]; }
        c /= M * sd;
        if (Math.abs(c) > Math.abs(best.c)) best = { c, sh, dir };
      }
      return { score: Math.abs(best.c), polarity: best.c < 0 ? 'dark' : 'light', rot: (best.sh / M) * TAU, dir: best.dir };
    }
    if (trace && trace.probe) { for (const pr of trace.probe) trace.push({ probe: pr, r: syncScore(pr[0], pr[1], pr[2], pr[3] || 1, 192, pr[4] || 0) }); }
    const R0 = (guide * minS) / 2;
    const cand = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) for (let si = 0; si < 15; si++) {
      const cx = W / 2 + dx * 0.03 * minS, cy = H / 2 + dy * 0.03 * minS, R = R0 * (0.55 + si * 0.05);
      // round, or seen at an angle (ellipse along x, y or a diagonal)
      for (const [asp, beta] of [[1, 0], [1.08, 0], [1.08, Math.PI / 2], [1.08, Math.PI / 4], [1.08, -Math.PI / 4]]) {
        const r = syncScore(cx, cy, R, asp, 96, beta, 0.035); if (!r) continue;
        cand.push({ cx, cy, R, asp, beta, ...r });
      }
    }
    cand.sort((a, b2) => b2.score - a.score);
    const tops = [];
    for (const c of cand) { if (tops.length >= 10) break; if (!tops.some((t) => Math.hypot(t.cx - c.cx, t.cy - c.cy) < 0.04 * minS && Math.abs(t.R - c.R) < 0.08 * R0)) tops.push(c); }
    let best = null;
    for (const t of tops) {
      if (t.score < 0.3) continue;
      let cur = { ...t, score: 0 };
      // local grid around the coarse guess (the coarse grid is wider than a ring's stroke)
      for (let gy = -2; gy <= 2; gy++) for (let gx = -2; gx <= 2; gx++) for (let gs = -2; gs <= 2; gs++) {
        const cx = t.cx + gx * 0.01 * minS, cy = t.cy + gy * 0.01 * minS, R = t.R * (1 + gs * 0.02);
        const r = syncScore(cx, cy, R, t.asp, 128, t.beta, 0.015); if (r && r.score > cur.score) cur = { ...t, cx, cy, R, ...r };
      }
      for (const step of [0.012, 0.005]) {
        let improved = true, guard = 0;
        while (improved && guard++ < 14) {
          improved = false;
          for (const [ddx, ddy, ds, da, db] of [[1, 0, 0, 0, 0], [-1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, -1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, -1, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, -1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, -1]]) {
            const cx = cur.cx + ddx * step * minS, cy = cur.cy + ddy * step * minS, R = cur.R * (1 + ds * step * 2);
            const asp = Math.max(0.8, Math.min(1.25, cur.asp + da * step * 3)), beta = cur.beta + db * step * 12;
            const r = syncScore(cx, cy, R, asp, 192, beta); if (!r) continue;
            if (r.score > cur.score + 1e-4) { cur = { cx, cy, R, asp, beta, ...r }; improved = true; }
          }
        }
      }
      if (!best || cur.score > best.score) best = cur;
      if (trace) trace.push({ top: { cx: t.cx, cy: t.cy, R: t.R, asp: t.asp, beta: t.beta, score: t.score }, cur: { cx: cur.cx, cy: cur.cy, R: cur.R, asp: cur.asp, beta: cur.beta, score: cur.score } });
      const out = readBits(cur);
      if (out) return out;
    }
    return null;

    function readBits(c) {
      if (c.score < 0.45) return null;
      const { cx, cy, R, asp, rot, dir } = c, beta = c.beta || 0;
      const at = (r, a) => {
        let s = 0, n = 0;
        for (const dr of [-0.012, 0, 0.012]) { const v = at2(cx, cy, R, asp, beta, r + dr, a); if (!Number.isNaN(v)) { s += v; n++; } }
        return n ? s / n : NaN;
      };
      const ang = (i, n) => rot + dir * ((i + 0.5) / n) * TAU;
      // ink / background levels from the known sync pattern
      let ink = 0, bg = 0, ni = 0, nb = 0;
      for (let j = 0; j < 64; j++) { const v = at(SYNC.r, ang(j, 64)); if (Number.isNaN(v)) continue; if (SYNC.bits[j] === '1') { ink += v; ni++; } else { bg += v; nb++; } }
      if (!ni || !nb) return null;
      ink /= ni; bg /= nb;
      const raw = []; for (const ring of RINGS) for (let i = 0; i < ring.n; i++) raw.push(at(ring.r, ang(i, ring.n)));
      const tries = [];
      const thr = (ink + bg) / 2, inkLow = ink < bg;
      tries.push(raw.map((v) => ((inkLow ? v < thr : v > thr) ? 1 : 0)));
      // per-ring adaptive threshold (uneven light)
      { const bits = []; let o = 0; for (const ring of RINGS) { const vs = raw.slice(o, o + ring.n); const sorted = [...vs].sort((a, b2) => a - b2); const mid = (sorted[Math.floor(ring.n * 0.25)] + sorted[Math.floor(ring.n * 0.75)]) / 2; vs.forEach((v) => bits.push((inkLow ? v < mid : v > mid) ? 1 : 0)); o += ring.n; } tries.push(bits); }
      for (const bits of tries) {
        const d = bitsToData(Uint8Array.from(bits));
        if (d && unpackPayload(d)) return { data27: d, payload: unpackPayload(d), cx: cx * k, cy: cy * k, r: R * k, score: c.score, mirrored: dir < 0 };
      }
      return null;
    }
  }

  // Text fallback for the code (no camera): base32 of the 27 bytes + 2 check bytes, in groups of 4.
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  async function textCode(data27) {
    const chk = (await sha256(data27)).subarray(0, 2);
    const b = concat(data27, chk); let bits = '', out = '';
    for (const x of b) bits += x.toString(2).padStart(8, '0');
    for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return out.match(/.{1,4}/g).join('-');
  }
  async function parseTextCode(s) {
    const clean = String(s).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
    let bits = ''; for (const ch of clean) { const v = B32.indexOf(ch); if (v < 0) return null; bits += v.toString(2).padStart(5, '0'); }
    const n = DATA_LEN + 2; if (bits.length < n * 8) return null;
    const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    const d = b.subarray(0, DATA_LEN);
    if (!same((await sha256(d)).subarray(0, 2), b.subarray(DATA_LEN))) return null;
    return unpackPayload(d) ? d : null;
  }

  // ───────────────────────────── MQTT relay (3.1.1 over WebSocket, QoS 0) ─────────────────────────────
  const DEFAULT_RELAYS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  function varint(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; }
  const mstr = (s) => { const b = utf8(s); return concat(new Uint8Array([b.length >> 8, b.length & 255]), b); };
  const packet = (type, body) => concat(new Uint8Array([type, ...varint(body.length)]), body);
  class MqttConn {
    constructor(url, { onPublish, onState } = {}) {
      this.url = url; this.onPublish = onPublish || (() => {}); this.onState = onState || (() => {});
      this.topics = new Set(); this.state = 'idle'; this.buf = new Uint8Array(0); this.pid = 1; this.backoff = 1000; this.closed = false;
    }
    open() {
      if (this.closed) return;
      const WS = root.WebSocket; if (!WS) { this.setState('error'); return; }
      let ws; try { ws = new WS(this.url, ['mqtt']); } catch { this.retry(); return; }
      this.ws = ws; ws.binaryType = 'arraybuffer'; this.setState('connecting');
      const id = 'fabro-' + uid();
      ws.onopen = () => { ws.send(packet(0x10, concat(mstr('MQTT'), new Uint8Array([4, 2, 0, 60]), mstr(id)))); };
      ws.onmessage = (e) => { this.last = Date.now(); this.feed(new Uint8Array(e.data)); };
      ws.onclose = () => { clearInterval(this.ping); if (this.ws === ws) { this.ws = null; this.setState('down'); this.retry(); } };
      ws.onerror = () => { try { ws.close(); } catch {} };
    }
    retry() { if (this.closed) return; clearTimeout(this.rt); this.rt = setTimeout(() => this.open(), this.backoff); this.backoff = Math.min(30000, this.backoff * 2); }
    setState(s) { if (this.state !== s) { this.state = s; this.onState(s, this); } }
    feed(chunk) {
      this.buf = concat(this.buf, chunk);
      for (;;) {
        if (this.buf.length < 2) return;
        let len = 0, mul = 1, i = 1, byte;
        do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
        if (this.buf.length < i + len) return;
        const type = this.buf[0], body = this.buf.subarray(i, i + len);
        this.buf = this.buf.slice(i + len);
        this.handle(type, body);
      }
    }
    handle(type, body) {
      const t = type >> 4;
      if (t === 2) {
        if (body[1] !== 0) { this.setState('refused'); try { this.ws.close(); } catch {} return; }
        this.backoff = 1000; this.last = Date.now(); this.setState('up');
        for (const tp of this.topics) this.sendSub(tp);
        clearInterval(this.ping);
        this.ping = setInterval(() => {
          if (Date.now() - this.last > 75000) { try { this.ws.close(); } catch {} return; }
          this.raw(new Uint8Array([0xc0, 0]));
        }, 25000);
      } else if (t === 3) {
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        const qos = (type >> 1) & 3;
        const payload = body.slice(2 + tl + (qos ? 2 : 0));
        this.onPublish(topic, payload, this);
      }
    }
    raw(b) { try { if (this.ws && this.ws.readyState === 1) { this.ws.send(b); return true; } } catch {} return false; }
    sendSub(topic) { const id = this.pid++ & 0xffff || 1; return this.raw(packet(0x82, concat(new Uint8Array([id >> 8, id & 255]), mstr(topic), new Uint8Array([0])))); }
    subscribe(topic) { this.topics.add(topic); if (this.state === 'up') this.sendSub(topic); }
    unsubscribe(topic) { this.topics.delete(topic); if (this.state === 'up') { const id = this.pid++ & 0xffff || 1; this.raw(packet(0xa2, concat(new Uint8Array([id >> 8, id & 255]), mstr(topic)))); } }
    publish(topic, payload) { return this.state === 'up' && this.raw(packet(0x30, concat(mstr(topic), payload))); }
    close() { this.closed = true; clearTimeout(this.rt); clearInterval(this.ping); if (this.ws) { this.raw(new Uint8Array([0xe0, 0])); try { this.ws.close(); } catch {} } this.ws = null; this.setState('closed'); }
  }
  // Several brokers at once: publish everywhere, deliver each message once.
  class Relay {
    constructor(urls, { onState } = {}) {
      this.handlers = new Map(); this.seen = new Set(); this.seenQ = []; this.onState = onState || (() => {});
      this.conns = [...new Set(urls)].map((u) => new MqttConn(u, { onPublish: (t, p) => this.deliver(t, p), onState: () => this.onState(this.status()) }));
      this.conns.forEach((c) => c.open());
    }
    status() { return this.conns.map((c) => ({ url: c.url, state: c.state })); }
    up() { return this.conns.some((c) => c.state === 'up'); }
    deliver(topic, payload) {
      const key = topic + ':' + hex(payload.subarray(0, 12));
      if (this.seen.has(key)) return;
      this.seen.add(key); this.seenQ.push(key); if (this.seenQ.length > 800) this.seen.delete(this.seenQ.shift());
      const h = this.handlers.get(topic); if (h) h(payload, topic);
    }
    on(topic, handler) { this.handlers.set(topic, handler); this.conns.forEach((c) => c.subscribe(topic)); }
    off(topic) { this.handlers.delete(topic); this.conns.forEach((c) => c.unsubscribe(topic)); }
    publish(topic, payload) { let ok = false; for (const c of this.conns) ok = c.publish(topic, payload) || ok; return ok; }
    close() { this.conns.forEach((c) => c.close()); }
  }
  function relaysFor(flags, custom) { const out = DEFAULT_RELAYS.filter((_, i) => flags & (1 << i)); if ((flags & 8) && custom) out.push(custom); return out.length ? out : DEFAULT_RELAYS.slice(); }
  const flagsFor = (urls) => DEFAULT_RELAYS.reduce((f, u, i) => (urls.includes(u) ? f | (1 << i) : f), 0) | (urls.some((u) => !DEFAULT_RELAYS.includes(u)) ? 8 : 0);

  // ───────────────────────────── pairing ─────────────────────────────
  const T = 'fabro/a1/';
  async function pairTopic(fp, secret) { return T + 'p/' + hex((await sha256(concat(utf8('pair'), fp, secret))).subarray(0, 16)); }
  async function pairSealKey(fp, secret) { return aesKey(await hkdf(secret, fp, 'fabro-pair-seal')); }
  async function pairKey(myPriv, peerPub, pcPub, phPub) {
    const shared = await ecdh(myPriv, peerPub);
    return hkdf(shared, concat(await fingerprint(pcPub), await fingerprint(phPub)), 'fabro-anywhere-v1');
  }
  async function linkTopic(k) { return T + 'l/' + hex((await sha256(concat(k, utf8('topic')))).subarray(0, 16)); }
  const transcript = (pcPub, phPub, nonce) => concat(pcPub, phPub, nonce);

  // Computer side: listen for one phone during the pairing window.
  async function pcPairing({ relay, identity, secret, info, onPaired }) {
    const fp = await fingerprint(identity.pub);
    const topic = await pairTopic(fp, secret), sk = await pairSealKey(fp, secret);
    const pending = new Map();
    let done = false;
    relay.on(topic + '/pc', async (bytes) => {
      if (done) return;
      const m = await open(sk, bytes); if (!m) return;
      if (m.t === 'hello' && m.pub) {
        const phPub = unb64u(m.pub);
        const k = await pairKey(identity.priv, phPub, identity.pub, phPub);
        const nonce = unb64u(m.nonce);
        const proof = await hmac(k, concat(utf8('pc'), transcript(identity.pub, phPub, nonce)));
        pending.set(m.pub, { k, phPub, nonce, hello: m });
        relay.publish(topic + '/ph', await seal(sk, { t: 'welcome', pub: b64u(identity.pub), proof: b64u(proof), nonce: m.nonce, ...info }));
      } else if (m.t === 'confirm' && pending.has(m.pub)) {
        const p = pending.get(m.pub);
        const want = await hmac(p.k, concat(utf8('ph'), transcript(identity.pub, p.phPub, p.nonce)));
        if (!same(want, unb64u(m.proof))) return;
        done = true;
        relay.publish(topic + '/ph', await seal(sk, { t: 'paired', nonce: m.nonce }));
        relay.off(topic + '/pc');
        onPaired({ id: 'dev-' + hex(rand(6)), name: String(p.hello.name || 'Phone').slice(0, 60), platform: String(p.hello.platform || '').slice(0, 40), pub: b64u(p.phPub), k: b64u(p.k), pairedAt: Date.now() });
      }
    });
    return { stop: () => { done = true; relay.off(topic + '/pc'); } };
  }
  // Phone side: payload from the code → paired link record { pcPub, k, pcName, ... }.
  async function phonePair({ relay, identity, payload, name, platform, timeout = 45000 }) {
    const topic = await pairTopic(payload.fp, payload.secret), sk = await pairSealKey(payload.fp, payload.secret);
    const nonce = rand(16), n64 = b64u(nonce);
    return new Promise((resolve, reject) => {
      let welcomed = null, timer = null, tick = null, settled = false;
      const end = (err, val) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(tick); relay.off(topic + '/ph'); err ? reject(err) : resolve(val); };
      relay.on(topic + '/ph', async (bytes) => {
        const m = await open(sk, bytes); if (!m || m.nonce !== n64) return;
        if (m.t === 'welcome' && !welcomed) {
          const pcPub = unb64u(m.pub);
          if (!same(await fingerprint(pcPub), payload.fp)) return end(new Error('fingerprint'));
          const k = await pairKey(identity.priv, pcPub, pcPub, identity.pub);
          const want = await hmac(k, concat(utf8('pc'), transcript(pcPub, identity.pub, nonce)));
          if (!same(want, unb64u(m.proof))) return end(new Error('proof'));
          welcomed = { pcPub: b64u(pcPub), k: b64u(k), pcName: m.pcName || 'PC', vapid: m.vapid || '', relays: m.relays || null, ice: m.ice || null, pairedAt: Date.now() };
          const proof = await hmac(k, concat(utf8('ph'), transcript(pcPub, identity.pub, nonce)));
          const send = async () => relay.publish(topic + '/pc', await seal(sk, { t: 'confirm', pub: b64u(identity.pub), proof: b64u(proof), nonce: n64 }));
          clearInterval(tick); send(); tick = setInterval(send, 2000);
        } else if (m.t === 'paired' && welcomed) end(null, welcomed);
      });
      const hello = async () => relay.publish(topic + '/pc', await seal(sk, { t: 'hello', pub: b64u(identity.pub), nonce: n64, name, platform }));
      hello(); tick = setInterval(hello, 2000);
      timer = setTimeout(() => end(new Error('timeout')), timeout);
    });
  }

  // ───────────────────────────── encrypted link (relay → direct WebRTC) ─────────────────────────────
  const FRAG = 40000;
  const hasRTC = () => typeof root.RTCPeerConnection === 'function';
  async function gather(pc, ms = 2500) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((res) => { const t = setTimeout(res, ms); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
  }
  // A Session carries JSON messages both ways over the relay, then over a data channel when it opens.
  class Session {
    constructor({ relay, sendTopic, key, sid, onMessage, onState }) {
      this.relay = relay; this.sendTopic = sendTopic; this.key = key; this.sid = sid; this.onMessage = onMessage; this.onState = onState || (() => {});
      this.dc = null; this.frags = new Map(); this.via = 'relay'; this.alive = Date.now(); this.closed = false;
    }
    async send(obj) {
      if (this.closed) return false;
      let s = JSON.stringify(obj);
      const parts = [];
      if (s.length > FRAG) { const fid = uid(); const n = Math.ceil(s.length / FRAG); for (let i = 0; i < n; i++) parts.push({ t: '_frag', fid, i, n, d: s.slice(i * FRAG, (i + 1) * FRAG) }); }
      else parts.push(obj);
      for (const p of parts) {
        const bytes = await seal(this.key, { sid: this.sid, m: p });
        if (this.dc && this.dc.readyState === 'open') { try { this.dc.send(bytes); continue; } catch {} }
        this.relay.publish(this.sendTopic, bytes);
        if (parts.length > 1) await new Promise((r) => setTimeout(r, 15)); // be gentle with public brokers
      }
      return true;
    }
    async receive(bytes) {
      const env = await open(this.key, bytes); if (!env || env.sid !== this.sid) return false;
      this.alive = Date.now();
      let m = env.m;
      if (m && m.t === '_frag') {
        const f = this.frags.get(m.fid) || { n: m.n, parts: [], got: 0, at: Date.now() };
        if (!f.parts[m.i]) { f.parts[m.i] = m.d; f.got++; }
        this.frags.set(m.fid, f);
        for (const [id, x] of this.frags) if (Date.now() - x.at > 120000) this.frags.delete(id);
        if (f.got < f.n) return true;
        this.frags.delete(m.fid);
        try { m = JSON.parse(f.parts.join('')); } catch { return true; }
      }
      if (m && m.t === '_ping') { this.send({ t: '_pong' }); return true; }
      if (m && m.t === '_pong') return true;
      this.onMessage(m, this);
      return true;
    }
    attach(dc) {
      this.dc = dc; dc.binaryType = 'arraybuffer';
      dc.onopen = () => { this.via = 'direct'; this.onState('direct', this); };
      dc.onclose = () => { if (this.dc === dc) { this.dc = null; this.via = 'relay'; if (!this.closed) this.onState('relay', this); } };
      dc.onmessage = (e) => this.receive(new Uint8Array(e.data));
      if (dc.readyState === 'open') dc.onopen();
    }
    close() { this.closed = true; try { this.dc && this.dc.close(); } catch {} try { this.pc && this.pc.close(); } catch {} this.dc = null; }
  }
  const sessKey = async (k, sid) => aesKey(await hkdf(k, unb64u(sid), 'fabro-session'));
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  // Phone: connect to the paired computer.
  async function phoneConnect({ relay, link, ice = STUN, onMessage, onState, onRevoked, rtc = true }) {
    const k = unb64u(link.k), kk = await aesKey(k), topic = await linkTopic(k);
    const sid = b64u(rand(16));
    const session = new Session({ relay, sendTopic: topic + '/pc', key: await sessKey(k, sid), sid, onMessage, onState });
    let pc = null, offer = null;
    if (rtc && hasRTC()) {
      try {
        pc = new root.RTCPeerConnection({ iceServers: ice });
        session.pc = pc;
        session.attach(pc.createDataChannel('fabro', { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer());
        await gather(pc);
        offer = pc.localDescription.sdp;
      } catch { pc = null; offer = null; }
    }
    return new Promise((resolve, reject) => {
      let acked = false, tries = 0;
      const timer = setTimeout(() => { if (!acked) { relay.off(topic + '/ph'); clearInterval(knockT); reject(new Error('unreachable')); } }, 20000);
      relay.on(topic + '/ph', async (bytes) => {
        if (!acked) {
          const m = await open(kk, bytes);
          if (m && m.t === 'ack' && m.sid === sid) {
            acked = true; clearTimeout(timer); clearInterval(knockT);
            relay.on(topic + '/ph', async (b) => {
              if (await session.receive(b)) return;
              const c = await open(kk, b); // control messages outside the session (the computer removed this phone)
              if (c && c.t === 'revoked') { session.close(); onRevoked && onRevoked(); }
            });
            if (pc && m.answer) { try { await pc.setRemoteDescription({ type: 'answer', sdp: m.answer }); } catch {} }
            session.pcInfo = m.info || {};
            onState && onState('relay', session);
            resolve(session);
            return;
          }
          if (m && m.t === 'revoked') { clearTimeout(timer); clearInterval(knockT); reject(new Error('revoked')); }
          return;
        }
        session.receive(bytes);
      });
      const knock = async () => { tries++; relay.publish(topic + '/pc', await seal(kk, { t: 'knock', sid, ts: Date.now(), offer })); };
      knock(); const knockT = setInterval(() => { if (tries < 8) knock(); }, 2500);
    });
  }
  // Computer: accept phones. devices: [{ id, k (b64u) }]. Returns { add, remove, send, sessions }.
  async function pcHub({ relay, devices, revoked = [], ice = STUN, onMessage, onState, info = () => ({}), rtc = true }) {
    const map = new Map(); // id → { dev, k, kk, topic, session }
    async function add(dev) {
      const k = unb64u(dev.k), kk = await aesKey(k), topic = await linkTopic(k);
      const entry = { dev, k, kk, topic, session: null };
      map.set(dev.id, entry);
      relay.on(topic + '/pc', async (bytes) => {
        const m = await open(kk, bytes);
        if (m && m.t === 'knock') {
          if (Math.abs(Date.now() - (m.ts || 0)) > 10 * 60000) return;
          if (entry.session && entry.session.sid === m.sid) { relay.publish(topic + '/ph', await seal(kk, { t: 'ack', sid: m.sid, answer: entry.answer, info: info(dev.id) })); return; }
          if (entry.session) entry.session.close();
          const s = new Session({ relay, sendTopic: topic + '/ph', key: await sessKey(k, m.sid), sid: m.sid, onMessage: (msg) => onMessage(dev.id, msg, s), onState: (st) => onState && onState(dev.id, st, s) });
          entry.session = s; entry.answer = null;
          if (m.offer && rtc && hasRTC()) {
            try {
              const pc = new root.RTCPeerConnection({ iceServers: ice }); s.pc = pc;
              pc.ondatachannel = (e) => s.attach(e.channel);
              await pc.setRemoteDescription({ type: 'offer', sdp: m.offer });
              await pc.setLocalDescription(await pc.createAnswer());
              await gather(pc);
              entry.answer = pc.localDescription.sdp;
            } catch { entry.answer = null; }
          }
          relay.publish(topic + '/ph', await seal(kk, { t: 'ack', sid: m.sid, answer: entry.answer, info: info(dev.id) }));
          onState && onState(dev.id, 'relay', s);
          return;
        }
        if (entry.session) entry.session.receive(bytes);
      });
    }
    // phones removed while away still learn it when they knock
    async function addRevoked(dev) {
      const k = unb64u(dev.k), kk = await aesKey(k), topic = await linkTopic(k);
      map.set('x:' + dev.id, { dev, k, kk, topic, revoked: true });
      relay.on(topic + '/pc', async (bytes) => { const m = await open(kk, bytes); if (m && m.t === 'knock') relay.publish(topic + '/ph', await seal(kk, { t: 'revoked' })); });
    }
    async function remove(id, notify) {
      const e = map.get(id); if (!e) return;
      if (notify) relay.publish(e.topic + '/ph', await seal(e.kk, { t: 'revoked' }));
      if (e.session) e.session.close();
      relay.off(e.topic + '/pc'); map.delete(id);
      if (notify) await addRevoked(e.dev.k ? e.dev : { id, k: b64u(e.k) });
    }
    for (const d of devices) await add(d);
    for (const d of revoked) await addRevoked(d);
    return {
      add, remove, addRevoked,
      session: (id) => { const e = map.get(id); return e && e.session && !e.session.closed ? e.session : null; },
      send: (id, obj) => { const e = map.get(id); return e && e.session ? e.session.send(obj) : false; },
      ids: () => [...map.keys()].filter((k) => !k.startsWith('x:')),
    };
  }

  // ───────────────────────────── conversations ─────────────────────────────
  // Conversations are trees of messages (nodes) addressed by id: merging is a union of nodes, the newer copy
  // of a node wins (updatedAt, then finished over pending, then longer content), so both sides converge.
  function pickNode(a, b) {
    if ((a.updatedAt || 0) !== (b.updatedAt || 0)) return (a.updatedAt || 0) > (b.updatedAt || 0) ? a : b;
    if (!!a.pending !== !!b.pending) return a.pending ? b : a;
    return (b.content || '').length > (a.content || '').length ? b : a;
  }
  function leafOf(nodes, id) {
    let cur = id;
    for (let guard = 0; guard < 10000; guard++) {
      const kids = nodes.filter((n) => n.parentId === cur).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
      if (!kids.length) return cur; cur = kids[0].id;
    }
    return cur;
  }
  function nodesOf(c) {
    if (c.nodes) return c.nodes;
    const list = c.messages || [];
    return list.map((m, i) => ({ ...m, parentId: m.parentId !== undefined ? m.parentId : i ? list[i - 1].id : null }));
  }
  function mergeConv(a, b) {
    if (!a) return b; if (!b) return a;
    const newer = (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a, older = newer === a ? b : a;
    const byId = new Map();
    for (const n of nodesOf(older)) byId.set(n.id, n);
    for (const n of nodesOf(newer)) byId.set(n.id, byId.has(n.id) ? pickNode(byId.get(n.id), n) : n);
    const nodes = [...byId.values()].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
    const leafStart = newer.leafId && byId.has(newer.leafId) ? newer.leafId : older.leafId;
    const out = { ...older, ...newer, nodes, leafId: leafStart ? leafOf(nodes, leafStart) : (nodes.length ? nodes[nodes.length - 1].id : null) };
    if (older.aiTitle && !newer.aiTitle) { out.title = older.title; out.aiTitle = true; }
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
    delete out.messages;
    return out;
  }
  function pathOf(c) {
    const nodes = nodesOf(c); const byId = new Map(nodes.map((n) => [n.id, n])); const out = []; const seen = new Set();
    let cur = byId.get(c.leafId);
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = cur.parentId ? byId.get(cur.parentId) : null; }
    return out.reverse();
  }
  const metaOf = (c) => ({ id: c.id, title: c.title || '', updatedAt: c.updatedAt || 0, agent: !!c.agent, pinned: !!c.pinned, project: c.project || null });

  const API = {
    rand, concat, hex, unhex, b64u, unb64u, utf8, same, uid, sha256, hmac, hkdf, genKeys, importPriv, ecdh, aesKey, seal, open, fingerprint,
    rsEncode, rsDecode, codeBits, bitsToData, packPayload, unpackPayload, ringCodeSVG, decodeRingCode, textCode, parseTextCode, RINGS, SYNC,
    MqttConn, Relay, DEFAULT_RELAYS, relaysFor, flagsFor, pcPairing, phonePair, pairKey, linkTopic, Session, phoneConnect, pcHub, STUN,
    mergeConv, pathOf, nodesOf, metaOf, leafOf,
  };
  root.FabroAnywhere = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
