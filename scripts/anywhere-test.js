// Fabro Anywhere core, without a browser: Reed-Solomon, the circular code bits, text codes, pairing and
// encrypted sessions over an in-memory relay, conversation merging, and Web Push encryption (RFC 8291).
// Run: node scripts/anywhere-test.js
const assert = require('assert');
const A = require('../src/anywhere/core.js');

// In-memory relay with the same interface as A.Relay (on/off/publish), shared by both sides.
function memoryBus() {
  const subs = new Map();
  const mk = () => ({
    mine: new Map(),
    on(t, h) { this.mine.set(t, h); (subs.get(t) || subs.set(t, new Set()).get(t)).add(this); },
    off(t) { this.mine.delete(t); const s = subs.get(t); if (s) s.delete(this); },
    publish(t, p) { const s = subs.get(t); if (!s) return false; for (const r of s) { const h = r.mine.get(t); if (h) setTimeout(() => h(new Uint8Array(p), t), 1); } return true; },
    status: () => [], up: () => true, close() {},
  });
  return { relay: mk };
}

(async () => {
  // Reed-Solomon: random data, up to 4 byte errors corrected, 5 refused or detected.
  for (let n = 0; n < 300; n++) {
    const data = Array.from(A.rand(27));
    const code = A.rsEncode(data, 8);
    const bad = Array.from(code);
    const errs = n % 5;
    const pos = new Set(); while (pos.size < errs) pos.add(Math.floor(Math.random() * bad.length));
    for (const p of pos) bad[p] ^= 1 + Math.floor(Math.random() * 255);
    const fixed = A.rsDecode(bad, 8);
    assert.ok(fixed, `rs decode with ${errs} errors`);
    assert.deepStrictEqual(Array.from(fixed), data);
  }
  let caught = 0;
  for (let n = 0; n < 200; n++) {
    const data = Array.from(A.rand(27)); const bad = Array.from(A.rsEncode(data, 8));
    for (let e = 0; e < 6; e++) bad[(n * 7 + e * 5) % 35] ^= 0x5a;
    const r = A.rsDecode(bad, 8);
    if (!r || A.hex(r) !== A.hex(Uint8Array.from(data))) caught++;
  }
  assert.ok(caught >= 195, 'too many errors are not silently accepted');
  console.log('• Reed-Solomon ok');

  // Code bits round trip, with bit flips.
  const id = await A.genKeys();
  const fp = await A.fingerprint(id.pub);
  const payload = { flags: 3, fp, secret: A.rand(10) };
  const data27 = A.packPayload(payload);
  const bits = A.codeBits(data27);
  assert.strictEqual(bits.length, A.RINGS.reduce((n, r) => n + r.n, 0));
  const flipped = Uint8Array.from(bits); for (const i of [3, 40, 41, 100, 200, 290]) flipped[i] ^= 1;
  assert.deepStrictEqual(A.unpackPayload(A.bitsToData(flipped)).secret, payload.secret);
  const svg = A.ringCodeSVG(data27, { animate: true, mark: '<circle cx="50" cy="50" r="40"/>' });
  assert.ok(svg.startsWith('<svg') && svg.includes('mask'));
  const txt = await A.textCode(data27);
  assert.match(txt, /^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
  assert.deepStrictEqual(Array.from(await A.parseTextCode(txt.toLowerCase().replace(/-/g, ' '))), Array.from(data27));
  assert.strictEqual(await A.parseTextCode(txt.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))), null);
  console.log('• code bits + text code ok:', txt);

  // Pairing + session over an in-memory relay.
  const bus = memoryBus();
  const pcRelay = bus.relay(), phRelay = bus.relay();
  const phoneId = await A.genKeys();
  let device = null;
  const pairing = await A.pcPairing({ relay: pcRelay, identity: id, secret: payload.secret, info: { pcName: 'Test PC', vapid: 'VAPIDKEY' }, onPaired: (d) => { device = d; } });
  const link = await A.phonePair({ relay: phRelay, identity: phoneId, payload: A.unpackPayload(data27), name: 'Pixel', platform: 'Android' });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(device && link, 'paired');
  assert.strictEqual(device.k, link.k, 'same pair key on both sides');
  assert.strictEqual(link.pcName, 'Test PC'); assert.strictEqual(link.vapid, 'VAPIDKEY');
  pairing.stop();
  // wrong secret: never pairs
  await assert.rejects(A.phonePair({ relay: phRelay, identity: phoneId, payload: { ...A.unpackPayload(data27), secret: A.rand(10) }, name: 'x', timeout: 300 }), /timeout/);
  console.log('• pairing ok');

  const got = { pc: [], ph: [] };
  const hub = await A.pcHub({ relay: pcRelay, devices: [device], onMessage: (devId, m, s) => { got.pc.push(m); if (m.t === 'echo') s.send({ t: 'echo-back', n: m.n, big: m.big }); }, info: () => ({ pcName: 'Test PC' }) });
  const session = await A.phoneConnect({ relay: phRelay, link, onMessage: (m) => got.ph.push(m) });
  assert.strictEqual(session.pcInfo.pcName, 'Test PC');
  const big = 'x'.repeat(130000);
  await session.send({ t: 'echo', n: 1 });
  await session.send({ t: 'echo', n: 2, big });
  for (let i = 0; i < 100 && got.ph.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(got.ph.map((m) => m.n), [1, 2]);
  assert.strictEqual(got.ph[1].big.length, 130000, 'fragmented message rebuilt');
  // a third party with another key sees nothing usable
  const spy = bus.relay(); const spyMsgs = [];
  spy.on((await A.linkTopic(A.unb64u(link.k))) + '/pc', (b) => spyMsgs.push(b));
  await session.send({ t: 'echo', n: 3 });
  for (let i = 0; i < 50 && got.ph.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(spyMsgs.length && !Buffer.from(spyMsgs[0]).toString().includes('echo'), 'relay sees ciphertext only');
  await hub.remove(device.id, true);
  await assert.rejects(A.phoneConnect({ relay: phRelay, link, onMessage() {} }), /revoked|unreachable/);
  console.log('• sessions ok (relay transport, fragments, ciphertext only, revoke)');

  // Conversation merge: offline phone message + desktop answer converge.
  const base = { id: 'c1', title: 'Hi', updatedAt: 10, nodes: [{ id: 'u1', role: 'user', content: 'a', parentId: null, createdAt: 1 }, { id: 'a1', role: 'assistant', content: 'b', parentId: 'u1', createdAt: 2 }], leafId: 'a1' };
  const phone = A.mergeConv(base, { ...base, updatedAt: 20, nodes: [...base.nodes, { id: 'u2', role: 'user', content: 'from phone', parentId: 'a1', createdAt: 5 }], leafId: 'u2' });
  const pc = { ...base, updatedAt: 15, title: 'Better title', aiTitle: true, nodes: [...base.nodes.slice(0, 1), { ...base.nodes[1], content: 'b, longer', updatedAt: 15 }] };
  const m1 = A.mergeConv(phone, pc), m2 = A.mergeConv(pc, phone);
  assert.deepStrictEqual(m1, m2, 'merge is order independent');
  assert.strictEqual(m1.nodes.length, 3); assert.strictEqual(m1.leafId, 'u2'); assert.strictEqual(m1.title, 'Better title');
  assert.strictEqual(m1.nodes.find((n) => n.id === 'a1').content, 'b, longer');
  assert.deepStrictEqual(A.pathOf(m1).map((n) => n.id), ['u1', 'a1', 'u2']);
  console.log('• merge ok');

  // Web Push encryption: RFC 8291 appendix A test vector.
  const push = require('../src/main/webpush.js');
  const v = {
    ua_private: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', ua_public: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    as_private: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', as_public: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg', salt: 'DGv6ra1nlYgDCS1FRnbzlw', plaintext: 'When I grow up, I want to be a watermelon',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };
  const body = push.encrypt({ p256dh: v.ua_public, auth: v.auth }, Buffer.from(v.plaintext), { salt: Buffer.from(v.salt, 'base64url'), asPrivate: Buffer.from(v.as_private, 'base64url'), recordSize: 4096 });
  assert.strictEqual(Buffer.from(body).toString('base64url'), v.body, 'RFC 8291 vector');
  const vk = push.vapidKeys();
  const hdr = push.vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vk);
  assert.match(hdr, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  console.log('• web push ok (RFC 8291 vector, VAPID header)');

  console.log('anywhere-test: all passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
