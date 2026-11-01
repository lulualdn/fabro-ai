// Voice mode, end to end in the real app (speech engines and model stubbed in the page): emotions and sound
// effects in the reply, talking over the AI (a backchannel lets it carry on, a real interruption cuts it where it
// was), sounds without words (a whistle) reaching the model as cues.
// Run: xvfb-run -a node scripts/voice-e2e.js
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, onboarded: true, language: 'fr', userName: 'Lulu', theme: 'dark' }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, `--user-data-dir=${userData}`, '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, FABRO_E2E: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.waitForFunction(() => typeof S !== 'undefined' && S.settings && typeof voiceOpen === 'function', null, { timeout: 30000 });
  // speech engines and the model, stubbed in the app's main process
  await app.evaluate(({ ipcMain }) => {
    const wav = (sec) => { const rate = 8000, n = Math.round(rate * sec), b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return new Uint8Array(b); };
    const T = global.__vt = { tts: [], stt: [], sent: [], runs: new Map() };
    const re = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
    re('voice:status', () => ({ runtime: true, whisperReady: true, voices: [], speed: 1 }));
    re('voice:tts', (_e, text, o) => { T.tts.push({ text, o }); return wav(0.6); });
    re('voice:stt', () => ({ text: T.stt.shift() || '' }));
    re('chat:send', (e, p) => {
      T.sent.push(p);
      const words = (T.sent.length === 1 ? '(joyeux) Salut Lulu 你好 ! [son:ding] Je vais te raconter une histoire. Il était une fois une citrouille. Elle rêvait de voir la mer. Un jour elle partit. Elle marcha longtemps. Et enfin elle arriva.' : 'Rome, la ville éternelle.').split(/(?<= )/);
      let i = 0; const run = { stop: false }; T.runs.set(p.reqId, run);
      const tick = () => { if (run.stop) return e.sender.send('chat:event', { reqId: p.reqId, type: 'done', stats: { aborted: true } }); if (i < words.length) { e.sender.send('chat:event', { reqId: p.reqId, type: 'token', text: words[i++] }); setTimeout(tick, 60); } else e.sender.send('chat:event', { reqId: p.reqId, type: 'done', stats: {} }); };
      setTimeout(tick, 50); return true;
    });
    re('chat:abort', (_e, id) => { const r = T.runs.get(id); if (r) r.stop = true; return true; });
  });
  const T = (fn, arg) => app.evaluate(fn, arg);
  await w.evaluate(() => { window.__sine = (f, sec) => { const R = 48000, a = new Float32Array(R * sec); for (let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin(2 * Math.PI * f * i / R); return { chunks: [a], rate: R, dur: sec }; }; });
  // the in-browser engines (Whisper, Piper), stubbed the same way
  await w.evaluate(() => {
    const wav = (sec) => { const rate = 8000, n = Math.round(rate * sec), b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const s = (p, x) => { for (let i = 0; i < x.length; i++) v.setUint8(p + i, x.charCodeAt(i)); }; s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true); return new Uint8Array(b); };
    window.__stt = []; window.__tts = [];
    Object.assign(VLocal, { prepare: async () => {}, ears: async () => {}, pending: () => null, say: async (text, o) => { __tts.push({ text, o }); return wav(0.6); }, hear: async () => __stt.shift() || '' });
  });
  const say = (text) => w.evaluate((x) => { __stt.push(x); }, text);
  await w.evaluate(() => voiceOpen());
  await w.waitForSelector('#vx');
  console.log('• first turn');
  await say('Raconte-moi une histoire'); await w.evaluate(() => vHeard(new Uint8Array(100), __sine(150, 1)));
  await w.waitForFunction(() => Speaker.busy() && Speaker.said.length >= 1, null, { timeout: 10000 }).catch(async (e) => { console.log(await w.evaluate(() => JSON.stringify({ err: S.voice.err, phase: S.voice.phase, said: Speaker.said, q: Speaker.queue.length, playing: !!Speaker.playing,  model: !!currentModel(), msgs: S.conv && S.conv.messages.map((m) => m.role + ':' + m.content.slice(0, 40)) }))); throw e; });
  const t1 = await w.evaluate(() => __tts.map((x) => x.text));
  assert.ok(t1.every((x) => !/\[|\(joyeux\)/.test(x)), 'tags are never spoken: ' + JSON.stringify(t1));
  assert.ok(t1[0].startsWith('Salut Lulu'), 'the first clause goes out early');
  assert.ok(t1.every((x) => !/[\u3000-\u9fff]/.test(x)), 'no Chinese spoken');
  assert.ok(t1.length <= 2, 'pieces are made one ahead, not all at once: ' + t1.length);
  console.log('• backchannel: carries on');
  await w.evaluate(() => { Mic.onStart(); });
  assert.strictEqual(await w.evaluate(() => Speaker.ducked), true, 'ducked while the user talks');
  await say('mh mh'); await w.evaluate(() => vHeard(new Uint8Array(100), __sine(150, 0.4)));
  assert.strictEqual(await w.evaluate(() => Speaker.ducked), false);
  assert.strictEqual(await w.evaluate(() => S.conv.messages.filter((m) => m.role === 'user').length), 1, 'no new turn for "mh mh"');
  await wait(400);
  assert.ok(await w.evaluate(() => Speaker.busy() || !!S.streaming), 'still talking');
  console.log('• real interruption: cut where it was');
  await say('Attends, parle-moi plutôt de Rome'); await w.evaluate(() => { Mic.onStart(); return vHeard(new Uint8Array(100), __sine(150, 1.2)); });
  const st = await w.evaluate(() => { const ms = S.conv.messages; const a = ms.filter((m) => m.role === 'assistant')[0]; const u = ms.filter((m) => m.role === 'user')[1]; return { a: a.content, cutoff: a.cutoff, u: u && u.content, cut: u && u.cut }; });
  st.last = await T(() => JSON.stringify(global.__vt.sent[global.__vt.sent.length - 1].messages.slice(-1)));
  console.log('  ', JSON.stringify(st).slice(0, 300));
  assert.ok(st.cutoff && / …$/.test(st.a) && !/arriva/.test(st.a), 'the answer keeps only what was said');
  assert.ok(st.cut && /interrupted after/.test(st.last), 'the model knows where it was cut');
  await w.waitForFunction(() => !S.streaming && !Speaker.busy(), null, { timeout: 15000 });
  console.log('• a whistle, no words');
  await w.evaluate(() => vHeard(new Uint8Array(100), __sine(1600, 1.2)));
  const wh = await w.evaluate(() => { const u = S.conv.messages.filter((m) => m.role === 'user').pop(); return { c: u.content, cues: u.cues }; });
  wh.last = await T(() => JSON.stringify(global.__vt.sent[global.__vt.sent.length - 1].messages.slice(-1)));
  console.log('  ', JSON.stringify(wh));
  assert.strictEqual(wh.c, '*siffle*'); assert.deepStrictEqual(wh.cues, ['whistling']); assert.ok(/heard: whistling/.test(wh.last));
  console.log('• tags hidden in the conversation');
  await w.evaluate(() => voiceClose());
  const shown = await w.evaluate(() => document.querySelector('.msg.assistant .md') && document.querySelector('.msg.assistant .md').textContent);
  assert.ok(shown && !/\[son:|\(joyeux\)/.test(shown), 'no tags on screen: ' + shown);
  assert.deepStrictEqual(errs, []);
  console.log('voice e2e OK');
  await app.close();
})().catch(async (e) => { console.error(e); process.exit(1); });
