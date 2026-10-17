// A tiny MQTT 3.1.1 broker over WebSocket (QoS 0, exact topics) — enough to stand in for the public relays
// in tests, or to run your own relay for Fabro Anywhere: node scripts/mqtt-relay.js [port]
// (put it behind TLS — wss:// — for phones on the internet).
const { WebSocketServer } = require('ws');

function start(port = 0, { log = false } = {}) {
  const subs = new Map(); // topic → Set(ws)
  const wss = new WebSocketServer({ port, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });
  const varint = (n) => { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; };
  const pkt = (type, body) => Buffer.concat([Buffer.from([type, ...varint(body.length)]), body]);
  let published = 0;
  wss.on('connection', (ws) => {
    let buf = Buffer.alloc(0); const mine = new Set();
    ws.on('message', (data) => {
      buf = Buffer.concat([buf, Buffer.from(data)]);
      for (;;) {
        if (buf.length < 2) return;
        let len = 0, mul = 1, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const type = buf[0], body = buf.subarray(i, i + len); buf = buf.subarray(i + len);
        const t = type >> 4;
        if (t === 1) ws.send(pkt(0x20, Buffer.from([0, 0])));
        else if (t === 8 || t === 10) {
          const id = body.subarray(0, 2); let o = 2; const granted = [];
          while (o < body.length) {
            const tl = body.readUInt16BE(o); const topic = body.subarray(o + 2, o + 2 + tl).toString(); o += 2 + tl;
            if (t === 8) { o += 1; if (!subs.has(topic)) subs.set(topic, new Set()); subs.get(topic).add(ws); mine.add(topic); granted.push(0); }
            else { const s = subs.get(topic); if (s) s.delete(ws); mine.delete(topic); }
          }
          ws.send(t === 8 ? pkt(0x90, Buffer.concat([id, Buffer.from(granted)])) : pkt(0xb0, id));
        } else if (t === 3) {
          const tl = body.readUInt16BE(0); const topic = body.subarray(2, 2 + tl).toString();
          const qos = (type >> 1) & 3; const payload = body.subarray(2 + tl + (qos ? 2 : 0));
          published++;
          const out = pkt(0x30, Buffer.concat([Buffer.from([tl >> 8, tl & 255]), Buffer.from(topic), payload]));
          for (const c of subs.get(topic) || []) if (c.readyState === 1) c.send(out);
          if (log) console.log('pub', topic, payload.length);
        } else if (t === 12) ws.send(Buffer.from([0xd0, 0]));
        else if (t === 14) ws.close();
      }
    });
    ws.on('close', () => { for (const tp of mine) { const s = subs.get(tp); if (s) { s.delete(ws); if (!s.size) subs.delete(tp); } } });
  });
  return new Promise((res) => wss.on('listening', () => res({ url: `ws://127.0.0.1:${wss.address().port}`, close: () => wss.close(), stats: () => ({ published, topics: subs.size, clients: wss.clients.size }), kill: () => { for (const c of wss.clients) c.terminate(); } })));
}
module.exports = { start };
if (require.main === module) start(+process.argv[2] || 8883, { log: !!process.env.LOG }).then((r) => console.log('Fabro relay on', r.url));
