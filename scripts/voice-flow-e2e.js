// Voice mode, the flow end to end in the real app, timed: synthetic speech is fed into the microphone pipeline at
// real-time pace, the speech engines are stubbed in the page with realistic delays, and a fake OpenAI-compatible
// model server streams the answer through the real chat path. Measures every stage and checks the fluidity rules:
// first syllable kept, partial transcript before the end of speech, time from end of speech to first audio,
// gapless playback, barge-in (audio + generation stopped, history cut to what was said), no markdown read aloud.
// Run: flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/voice-flow-e2e.js
// VFLOW_BASELINE=1 only prints the timings (used to measure the old pipeline).
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const BASE = !!process.env.VFLOW_BASELINE;
const TTFT = +(process.env.VFLOW_TTFT || 250), TOK = +(process.env.VFLOW_TOK || 25); // fake model: first token, then one every TOK ms
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fvf-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, onboarded: true, language: 'fr', userName: 'Lulu', theme: 'dark' }));
// a silent file for the fake capture device (Chromium's default one beeps)
const silent = path.join(userData, 'silence.wav');
{ const n = 48000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); fs.writeFileSync(silent, b); }

const REPLIES = [
  '**Bonjour Lulu !** Il fait 21 °C à Paris aujourd’hui, le 12/11/2026. 🙂 Regarde https://meteo.example.com/paris pour les détails. Lance `npm install` puis c’est réglé. Et voilà une phrase un peu plus longue, pour que la réponse dure assez longtemps et qu’on entende bien l’enchaînement des morceaux.',
  'Alors, je vais te raconter une longue histoire. Il était une fois une petite citrouille qui vivait dans un champ. Elle rêvait de voir la mer depuis toujours. Un matin, elle décida de partir. Elle roula sur les chemins pendant des jours et des jours. Elle rencontra un renard, puis un hibou. Et enfin, un soir, elle arriva au bord de l’océan.',
  'Rome, la ville éternelle, a été fondée selon la légende en 753 avant Jésus-Christ.',
];
const log = []; const stamp = () => Date.now();
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
    const body = JSON.parse(b || '{}'); const sys = (body.messages && body.messages[0] && body.messages[0].content) || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (!/Voice conversation/.test(String(sys))) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Titre' } }] })}\n\n`); return res.end('data: [DONE]\n\n'); }
    const n = log.filter((x) => x.k === 'req').length; const text = REPLIES[Math.min(n, REPLIES.length - 1)];
    const entry = { k: 'req', t: stamp(), n, last: body.messages[body.messages.length - 1], msgs: body.messages, aborted: false, sent: 0 }; log.push(entry);
    const toks = text.match(/\S+\s*/g); let i = 0; let closed = false;
    res.on('close', () => { if (i < toks.length) { entry.aborted = true; entry.abortT = stamp(); } closed = true; });
    const tick = () => {
      if (closed) return;
      if (i >= toks.length) { entry.doneT = stamp(); res.write('data: [DONE]\n\n'); return res.end(); }
      if (i === 0) entry.firstTok = stamp();
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: toks[i++] } }] })}\n\n`); entry.sent = i; setTimeout(tick, n === 1 ? TOK * 5 : TOK); // the long story is still being written when the user cuts in
    };
    setTimeout(tick, TTFT);
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, `--user-data-dir=${userData}`, '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${silent}`, '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, FABRO_E2E: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  w.on('console', (m) => { if (process.env.VFLOW_DEBUG) console.log('[page]', m.text()); });
  await w.waitForFunction(() => typeof S !== 'undefined' && S.settings && typeof voiceOpen === 'function', null, { timeout: 30000 });
  await w.evaluate(async (b) => { await api.providers.enable(true); const v = await api.providers.add({ kind: 'custom', baseUrl: b, name: 'Fake' }); await saveSettings({ selectedModel: { backend: 'provider', provider: v.list[0].id, model: 'fake' } }); await applySetting('language', 'fr'); await refreshModels(); }, base);
  // the in-browser engines, stubbed with realistic timings (Whisper base on the processor, Piper)
  await w.evaluate(() => {
    const now = () => performance.timeOrigin + performance.now();
    const T = window.__vf = { stt: [], tts: [], starts: [], plays: [], ends: [], script: 'Bonjour Fabro quel temps fait-il à Paris aujourd’hui dis-moi tout', lastStt: '' };
    const wavDur = (b) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); const rate = v.getUint32(24, true); return (b.length - 44) / 2 / rate; };
    const firstLoud = (b) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); const rate = v.getUint32(24, true); const n = (b.length - 44) >> 1; for (let i = 0; i < n; i++) if (Math.abs(v.getInt16(44 + i * 2, true)) > 3000) return i / rate; return -1; };
    const tone = (sec, rate = 22050) => { const n = Math.round(rate * sec), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const s = (p, x) => { for (let i = 0; i < x.length; i++) v.setUint8(p + i, x.charCodeAt(i)); }; s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / rate)), true); return new Uint8Array(buf); };
    // Whisper: reads whatever audio it is given — the words said so far (about 3.2 words a second of speech)
    VLocal.hear = async (wav, o = {}) => {
      const b = wav instanceof Uint8Array ? wav : new Uint8Array(wav); const d = wavDur(b); const t0 = now();
      await new Promise((r) => setTimeout(r, 180 + d * 90));
      const speech = Math.max(0, d - (T.lead || 0)); const words = T.script.split(' '); const n = Math.min(words.length, Math.round(speech * 3.2));
      const text = T.override != null ? T.override : words.slice(0, n).join(' ');
      T.stt.push({ t0, t1: now(), dur: d, onset: firstLoud(b), partial: !!o.partial, text }); T.lastStt = text; return text;
    };
    VLocal.say = async (text, o = {}) => { const t0 = now(); const d = Math.max(0.4, text.length * 0.06); await new Promise((r) => setTimeout(r, 60 + d * 100)); T.tts.push({ t0, t1: now(), text, d }); return tone(d); };
    Object.assign(VLocal, { prepare: async () => {}, ears: async () => {}, pending: () => null, warm: async () => {} });
    // when audio really starts: Web Audio sources (scheduled on the clock) or media elements (the old pipeline)
    const S0 = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, off, dur) { const c = this.context; if (this.buffer && this.buffer.duration > 0.3 && c.destination) { const at = now() + Math.max(0, when - c.currentTime) * 1000; T.starts.push({ at, dur: this.buffer.duration, when, ct: c.currentTime }); } return S0.apply(this, arguments); };
    const P0 = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { const el = this; T.plays.push({ at: now() }); el.addEventListener('ended', () => T.ends.push({ at: now() }), { once: true }); el.addEventListener('pause', () => T.ends.push({ at: now(), pause: true }), { once: true }); return P0.apply(this, arguments); };
    // synthetic speech at 48 kHz: lead silence (room noise), a sharp onset burst, syllables at ~4 Hz, then silence
    T.make = (sec, { lead = 0.8, tail = 2.5, amp = 0.18 } = {}) => {
      const R = 48000, n = Math.round(R * (lead + sec + tail)), a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * 0.0015;
      const s0 = Math.round(R * lead), s1 = Math.round(R * (lead + sec));
      for (let i = s0; i < s1; i++) { const t = (i - s0) / R; const env = t < 0.12 ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 4 * t)); a[i] += amp * env * (0.6 * Math.sin(2 * Math.PI * 140 * t) + 0.3 * Math.sin(2 * Math.PI * 280 * t) + 0.1 * Math.sin(2 * Math.PI * 1200 * t)); }
      return { a, R, onsetT: lead, endT: lead + sec };
    };
    // feed it at real-time pace, frame by frame; resolves with wall times of the onset and the end of speech
    T.feed = (sig) => new Promise((res) => {
      const F = 2048; let pos = 0; const t0 = now(); const out = { onset: t0 + sig.onsetT * 1000, end: t0 + sig.endT * 1000, t0 };
      const push = (fr) => {
        if (Mic.feed) { Mic.external = true; return Mic.feed(fr, sig.R, true); }
        if (!T.h) { T.h = Mic.proc.onaudioprocess; Mic.proc.onaudioprocess = null; }
        T.h({ inputBuffer: { getChannelData: () => fr } });
      };
      const step = () => {
        const due = Math.floor((now() - t0) / 1000 * sig.R);
        while (pos + F <= Math.min(due, sig.a.length)) { push(sig.a.slice(pos, pos + F)); pos += F; }
        if (pos + F > sig.a.length) return res(out);
        setTimeout(step, 10);
      };
      step();
    });
  });
  await w.evaluate(() => voiceOpen());
  await w.waitForSelector('#vx');
  await w.waitForFunction(() => (S.voice.phase === 'listening'), null, { timeout: 10000 });
  await wait(300);
  const report = {};

  // ── turn 1: a question; everything timed ──
  console.log('• turn 1: speak, get an answer');
  const partialSeen = w.evaluate(() => new Promise((r) => { const t0 = performance.now(); const iv = setInterval(() => { const el = document.querySelector('#vx-user, #vx-partial'); const txt = el ? el.textContent.trim() : ''; if (txt && performance.timeOrigin + performance.now() < (__vf.endWall || Infinity)) { clearInterval(iv); r({ at: performance.timeOrigin + performance.now(), txt }); } if (performance.now() - t0 > 15000) { clearInterval(iv); r(null); } }, 30); }));
  const fedP = w.evaluate(async () => { const sig = __vf.make(2.6); __vf.lead = 0; const p = __vf.feed(sig); const o = await p; return o; });
  await wait(2600); await w.screenshot({ path: path.join(process.env.SHOTS || os.tmpdir(), 'voice-hearing.png') }).catch(() => {});
  const fed = await fedP;
  await w.evaluate((e) => { __vf.endWall = e; }, fed.end);
  await w.waitForFunction(() => __vf.starts.length + __vf.plays.length > 0, null, { timeout: 20000 }).catch(() => {});
  await wait(1500); await w.screenshot({ path: path.join(process.env.SHOTS || os.tmpdir(), 'voice-speaking.png') }).catch(() => {});
  await w.waitForFunction(() => !S.streaming && !Speaker.busy(), null, { timeout: 40000 }).catch(() => {});
  await wait(300);
  const p1 = await partialSeen;
  const SH = process.env.SHOTS || os.tmpdir();
  const r1 = await w.evaluate(() => JSON.parse(JSON.stringify(__vf, (k, v) => (typeof v === 'function' ? undefined : v))));
  const req1 = log.find((x) => x.k === "req" && x.n === 0);
  if (process.env.VFLOW_DEBUG || !req1 || !r1.tts.length) console.log("DEBUG", JSON.stringify({ stt: r1.stt, tts: r1.tts, plays: r1.plays, starts: r1.starts, reqs: log.map((x) => ({ n: x.n, sent: x.sent, ab: x.aborted, done: !!x.doneT, ft: !!x.firstTok })), msgs: await w.evaluate(() => S.conv && S.conv.messages.map((m) => m.role + ":" + (m.content || "").slice(0, 60) + (m.error ? " ERR " + m.error : ""))), err: await w.evaluate(() => S.voice.err), phase: await w.evaluate(() => S.voice.phase) }).slice(0, 1500));
  const finalStt = r1.stt.filter((x) => !x.partial).pop() || r1.stt[r1.stt.length - 1];
  const firstAudio = r1.starts.length ? r1.starts[0].at : r1.plays.length ? r1.plays[0].at : NaN;
  const ms = (x) => Math.round(x);
  const m = {
    sttCalls: r1.stt.length, partials: r1.stt.filter((x) => x.partial).length,
    endToSttStart: ms(finalStt.t0 - fed.end), sttMs: ms(finalStt.t1 - finalStt.t0), endToSttDone: ms(finalStt.t1 - fed.end),
    endToRequest: ms(req1.t - fed.end), ttft: ms(req1.firstTok - req1.t), endToFirstToken: ms(req1.firstTok - fed.end),
    firstTokToFirstTts: ms(r1.tts[0].t0 - req1.firstTok), firstTtsMs: ms(r1.tts[0].t1 - r1.tts[0].t0),
    endToFirstAudio: ms(firstAudio - fed.end),
    partialBeforeEnd: p1 ? ms(fed.end - p1.at) : null, partialText: p1 && p1.txt,
    preRollMs: finalStt.onset >= 0 ? ms(finalStt.onset * 1000) : null, finalText: finalStt.text,
  };
  // gaps between consecutive pieces of the answer
  let gaps = [];
  if (r1.starts.length > 1) { const s = r1.starts.slice().sort((a, b) => a.when - b.when); for (let i = 1; i < s.length; i++) gaps.push(ms((s[i].when - (s[i - 1].when + s[i - 1].dur)) * 1000)); } // on the audio clock
  else if (r1.plays.length > 1) { for (let i = 1; i < r1.plays.length; i++) { const e = r1.ends.filter((x) => x.at <= r1.plays[i].at + 5).pop(); if (e) gaps.push(ms(r1.plays[i].at - e.at)); } }
  m.gaps = gaps; m.maxGap = gaps.length ? Math.max(...gaps) : 0; m.pieces = r1.tts.length;
  m.spoken = r1.tts.map((x) => x.text);
  report.turn1 = m;
  console.log(JSON.stringify(m, null, 1));

  if (!BASE) {
    assert.ok(m.preRollMs != null && m.preRollMs >= 150, 'the first syllable is kept (pre-roll before the onset): ' + m.preRollMs);
    assert.ok(m.partials >= 1 && p1 && m.partialBeforeEnd > 0, 'a partial transcript shows before the end of speech');
    assert.ok(/aujourd’hui|tout/.test(m.finalText), 'the last words are in the final transcript: ' + m.finalText);
    assert.ok(m.maxGap <= 20, 'no gap > 20 ms between pieces: ' + JSON.stringify(gaps));
    const said = m.spoken.join(' | ');
    assert.ok(!/[*`]|https?:|🙂|\/\//.test(said), 'no markdown, code marks, links or emoji read aloud: ' + said);
    assert.ok(/21 degrés/.test(said), 'units read in words: ' + said);
    assert.ok(/12 novembre 2026/.test(said), 'dates read in words: ' + said);
  }

  // ── turn 2: a long story, then the user talks over it ──
  console.log('• turn 2: barge-in');
  await w.evaluate(() => { __vf.stt = []; __vf.tts = []; __vf.starts = []; __vf.plays = []; __vf.ends = []; __vf.script = 'raconte-moi une histoire longue'; });
  await w.evaluate(async () => { const sig = __vf.make(1.6); await __vf.feed(sig); });
  await w.waitForFunction(() => __vf.starts.length + __vf.plays.length >= 2, null, { timeout: 20000 });
  await wait(900);
  await w.evaluate(() => { __vf.script = 'attends parle-moi plutôt de Rome'; });
  const before = await w.evaluate(() => ({ starts: __vf.starts.length, plays: __vf.plays.length }));
  const barge = await w.evaluate(async () => {
    const sig = __vf.make(1.8, { lead: 0.05, tail: 1.6, amp: 0.2 }); const now = () => performance.timeOrigin + performance.now();
    const t0 = now(); let faded = null;
    const watch = setInterval(() => { if (faded == null && typeof Speaker.gainNow === 'function' && Speaker.gainNow() < 0.05) faded = now(); if (faded == null && typeof Speaker.gainNow !== 'function' && Speaker.playing && Speaker.playing.el && Speaker.playing.el.volume < 0.3) faded = now(); }, 10);
    const o = await __vf.feed(sig); clearInterval(watch);
    return { onset: o.onset, faded, t0 };
  });
  await w.waitForFunction(() => S.conv && S.conv.messages.filter((x) => x.role === 'user').length >= 3, null, { timeout: 20000 }).catch(() => {});
  await w.waitForFunction(() => !S.streaming && !Speaker.busy(), null, { timeout: 30000 }).catch(() => {});
  await wait(300);
  const req2 = log.find((x) => x.k === 'req' && x.n === 1), req3 = log.find((x) => x.k === 'req' && x.n === 2);
  const st = await w.evaluate(() => { const ms = S.conv.messages; const a = ms.filter((x) => x.role === 'assistant'); return { a2: a[1] && a[1].content, cutoff: a[1] && a[1].cutoff, users: ms.filter((x) => x.role === 'user').map((x) => x.content) }; });
  const b = { fadeMs: barge.faded ? ms(barge.faded - barge.onset) : null, genAborted: !!(req2 && req2.aborted), abortAfterOnset: req2 && req2.abortT ? ms(req2.abortT - barge.onset) : null, keptAnswer: st.a2, cutoff: !!st.cutoff, nextQuestion: st.users[2], lastMsgToModel: req3 && JSON.stringify(req3.last).slice(0, 200) };
  report.bargeIn = b;
  console.log(JSON.stringify(b, null, 1));
  if (!BASE) {
    assert.ok(b.fadeMs != null && b.fadeMs <= 250, 'the voice fades within ~150 ms of the user speaking (+ detection): ' + b.fadeMs);
    assert.ok(b.genAborted || (req2 && req2.doneT && req2.doneT < barge.onset), 'generation stopped');
    assert.ok(b.cutoff && !/arriva au bord/.test(b.keptAnswer || ''), 'history keeps only what was said: ' + b.keptAnswer);
    assert.ok(/Rome/.test(b.nextQuestion || ''), 'the interruption becomes the next question');
    assert.ok(req3 && /interrupted after/.test(JSON.stringify(req3.last)), 'the model knows where it was cut');
  }
  fs.writeFileSync(path.join(os.tmpdir(), BASE ? 'vflow-baseline.json' : 'vflow.json'), JSON.stringify(report, null, 1));
  if (!BASE) assert.deepStrictEqual(errs, []);
  else if (errs.length) console.log('page errors:', errs);
  console.log(BASE ? 'voice-flow baseline measured' : 'voice-flow e2e OK');
  await app.close(); srv.close(); process.exit(0);
})().catch(async (e) => { console.error(e); process.exit(1); });
