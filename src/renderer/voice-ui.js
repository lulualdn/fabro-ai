'use strict';
/* Voice: dictation (mic button) and voice mode — a live spoken conversation that should feel like talking to
   someone: local Whisper (speech to text) and Piper / Kokoro (text to speech), all in the page or on the phone.
   The flow of one turn:
     microphone → 16 kHz → Endpointer (voice-core.js: adaptive floor, pre-roll, echo gate)
       → while the user talks: partial transcripts (shown live, they also tell whether the sentence sounds finished)
       → at the first short silence: the final transcription starts at once (speculative)
       → end of speech (short wait when it sounds finished): the text goes to the model right away
     model tokens → Chunker (first clause first) → speakable() → synthesis one or two pieces ahead (worker)
       → pieces scheduled back to back on the one AudioContext clock (no gaps, soft edges, even loudness)
     the user talks over it → the voice fades out in ~100 ms (paused); a backchannel / its own echo resumes it,
       a real interruption stops it and the generation, and the answer keeps only what was actually heard. */

S.voice = { on: false, phase: 'idle', user: '', partial: '', ai: '', scene: [], muted: false, level: 0, status: null, installing: null, err: '', lang: null };

// ───────────────────────────── one audio context for everything ─────────────────────────────
// Made inside the tap that opens voice mode (iPhone: audio only starts from a gesture, and one context is all
// it handles well): the microphone, the voice and the sound effects all use it.
const VAudio = {
  c: null,
  ctx() {
    if (!this.c || this.c.state === 'closed') { const AC = window.AudioContext || window.webkitAudioContext; this.c = new AC({ latencyHint: 'interactive' }); }
    if (this.c.state === 'suspended') this.c.resume().catch(() => {});
    return this.c;
  },
  // a silent sound, in the gesture: unlocks the speaker on iOS
  unlock() { try { const c = this.ctx(); const b = c.createBuffer(1, 1, c.sampleRate); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(); } catch {} },
  now() { return this.c ? this.c.currentTime : 0; },
  close() { const c = this.c; this.c = null; Speaker.master = null; if (c) c.close().catch(() => {}); },
};
window.VAudio = VAudio;

// ───────────────────────────── microphone ─────────────────────────────
const Mic = {
  stream: null, src: null, proc: null, ep: null, rs: null, rsRate: 0, on: {}, external: false, lost: 0,
  async start(cfg = {}) {
    if (this.stream) { if (cfg) this.ep = VCore.Endpointer(cfg); return; }
    const c = VAudio.ctx();
    // echo cancellation and gain control on; the browser's noise suppression off — it erases whispers
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    if (c.state !== 'running') await c.resume().catch(() => {});
    this.ep = VCore.Endpointer(cfg);
    this.wire(c);
    if (navigator.mediaDevices.addEventListener && !this._dc) { this._dc = () => this.restart('device'); navigator.mediaDevices.addEventListener('devicechange', this._dc); }
  },
  wire(c) {
    this.src = c.createMediaStreamSource(this.stream);
    this.proc = c.createScriptProcessor(1024, 1, 1); // ~21 ms; the work per block is tiny (an RMS per 10 ms)
    const mute = c.createGain(); mute.gain.value = 0;
    this.src.connect(this.proc); this.proc.connect(mute); mute.connect(c.destination);
    this.proc.onaudioprocess = (e) => { if (!this.external) this.feed(e.inputBuffer.getChannelData(0), c.sampleRate); };
    for (const tr of this.stream.getAudioTracks()) tr.onended = () => this.restart('ended');
  },
  // raw samples at `rate` (tests feed synthetic speech here) → events
  feed(frame, rate, ext) {
    if (!this.ep || (this.external && !ext)) return;
    if (!this.rs || this.rsRate !== rate) { this.rs = VCore.Resampler(rate); this.rsRate = rate; }
    const x = this.rs(frame);
    this.ep.playing = Speaker.audible(); this.ep.out = Speaker.outRms(); this.ep.muted = !!(S.voice.on && S.voice.muted);
    const evs = this.ep.feed(x);
    if (this.on.level) this.on.level(this.ep.level);
    for (const ev of evs) { const f = this.on[ev.t]; if (f) { try { f(ev); } catch (e) { console.warn('voice', e); } } }
  },
  get speaking() { return !!(this.ep && this.ep.speaking); },
  sofar() { return this.ep ? this.ep.sofar() : null; },
  // headphones plugged, the device taken away, the permission lost: open the microphone again, once
  async restart(why) {
    if (!this.stream || this._restarting) return;
    this._restarting = true;
    try {
      const old = this.stream; this.unwire(); old.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
      this.wire(VAudio.ctx()); if (this.ep) this.ep.reset(); this.lost = 0;
      if (this.on.restored) this.on.restored(why);
    } catch (e) { this.stream = null; this.lost++; if (this.on.lost) this.on.lost(e); }
    this._restarting = false;
  },
  unwire() { try { if (this.proc) this.proc.onaudioprocess = null; this.src && this.src.disconnect(); this.proc && this.proc.disconnect(); } catch {} this.src = this.proc = null; },
  stop() {
    this.unwire();
    if (this.stream) this.stream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    if (this._dc && navigator.mediaDevices.removeEventListener) navigator.mediaDevices.removeEventListener('devicechange', this._dc);
    Object.assign(this, { stream: null, ep: null, rs: null, rsRate: 0, on: {}, _dc: null, external: false });
  },
};
const sttLang = () => { const l = S.settings.language; return l && l !== 'auto' ? l : (S.lang || '').slice(0, 2) || undefined; };
const vLang = () => S.voice.lang || sttLang() || 'en';

// ───────────────────────────── on the device: Whisper and Piper in the browser ─────────────────────────────
// The app does it itself (VLocal). Inside Fabro Anywhere's frame, the phone around it does it (same engines),
// through api.voice — the frame can't run them.
const vInFrame = () => !!(window.FABRO_REMOTE);
const vLocalOk = () => !vInFrame() && !!window.VLocal;
// partial: may answer null (the ears aren't there yet, or a newer request replaced it)
async function vStt(wav, o = {}) {
  // no graphics card but the computer's own Whisper is installed: it is faster on the processor
  const pyFaster = S.voice.status && S.voice.status.whisperReady && VLocal && VLocal.st.gpu === false;
  if (vLocalOk() && !pyFaster) {
    const tx = await VLocal.hear(wav, { lang: o.lang, partial: !!o.partial });
    if (tx != null || o.partial) return tx;
    // the ears are still downloading: the computer's own Whisper if it was installed, else wait for them
    if (S.voice.status && S.voice.status.whisperReady) { try { return ((await api.voice.stt(wav, o)) || {}).text || ''; } catch {} }
    return VLocal.hear(wav, { lang: o.lang, wait: true });
  }
  return ((await api.voice.stt(wav, { ...o, local: true, fast: true })) || {}).text || '';
}
// partial transcripts are worth it only where recognition runs on this device and is quick enough
const vPartialsOk = () => !vInFrame() && (!window.VLocal || !VLocal.st.sttMs || VLocal.st.sttMs < 1600);
// WAV bytes, { sys: true } when the natural voice isn't there yet (the system voice speaks the piece then),
// { cancelled } when the piece was dropped (interrupted), null on failure
async function vTts(text, speed, lang, gen) {
  if (vLocalOk()) return (await VLocal.say(text, { lang, speed, gen })) || { sys: true };
  const r = await api.voice.tts(text, { speed, lang }); return r || { sys: true };
}

// ───────────────────────────── speech output ─────────────────────────────
// Pieces are synthesised one or two ahead and scheduled back to back on the audio clock: the next one starts the
// moment the previous one ends (a few ms of crossfade), each brought to the same loudness, with a short natural
// pause after a sentence baked into the audio. [son:…] tags play a sound effect in their place.
const XF = 0.008;
const Speaker = {
  gen: 0, q: [], live: [], played: [], said: [], style: 'neutral', master: null, analyser: null, endAt: 0, paused: null, ahead: 2, sysBusy: false, fade: null, idleT: 0, tbuf: null,
  graph() {
    const c = VAudio.ctx();
    if (!this.master || this.master.context !== c) {
      this.master = c.createGain(); this.analyser = c.createAnalyser(); this.analyser.fftSize = 512;
      this.master.connect(this.analyser); this.analyser.connect(c.destination); this.tbuf = new Float32Array(512);
    }
    return c;
  },
  say(text) {
    const { segs, style } = vSegments(String(text), this.style); this.style = style;
    const base = (S.voice.status && S.voice.status.speed) || 1; const lang = vLang();
    for (const sg of segs) {
      if (sg.sfx) { if (VFX.known(sg.sfx)) this.q.push({ sfx: sg.sfx, text: '' }); continue; }
      const st = V_STYLE[sg.laugh ? 'happy' : sg.style] || V_STYLE.neutral;
      const clean = sg.laugh ? (LAUGH[lang.slice(0, 2)] || LAUGH.en) : VCore.speakable(sg.text, lang); if (!clean) continue;
      this.q.push({ text: clean, vol: st.vol, speed: Math.round(base * st.speed * 100) / 100, laugh: !!sg.laugh, lang, pause: /[.!?…]["»”)]*$/.test(clean) ? 0.16 : /[,;:—–]$/.test(clean) ? 0.06 : 0.03 });
    }
    this.pump();
  },
  make(j) {
    if (!j || j.sfx || j.audio) return;
    const g = this.gen;
    j.audio = vTts(j.text, j.speed, j.lang, g).then((r) => r, (e) => { S.voice.err = vErrText(e, 'tts'); return null; })
      .then((r) => { j.res = r; j.ready = true; if (g === this.gen) this.pump(); });
  },
  pump() {
    if (this.paused) return;
    let k = 0; for (const j of this.q) { if (j.sfx) continue; if (k++ >= this.ahead) break; this.make(j); }
    while (this.q.length) {
      const j = this.q[0];
      if (j.sfx) { this.q.shift(); this.scheduleSfx(j); continue; }
      if (!j.ready) break;
      if (!j.buf && (!j.res || j.res.cancelled)) { this.q.shift(); continue; }
      // a few seconds scheduled ahead is plenty (memory stays small, an interruption has little to undo)
      const ahead = this.endAt - VAudio.now(); if (ahead > 6) { clearTimeout(this.aheadT); this.aheadT = setTimeout(() => this.pump(), (ahead - 5) * 1000); break; }
      if (!j.buf && j.res.sys) { // the system voice: it can't be put on the clock, it speaks when the voice before it is done
        const wait = this.endAt - VAudio.now();
        if (this.sysBusy || wait > 0.05) { clearTimeout(this.sysT); this.sysT = setTimeout(() => this.pump(), Math.max(20, wait * 1000)); break; }
        this.q.shift(); this.speakSys(j); break;
      }
      this.q.shift(); this.schedule(j);
    }
    this.idle();
  },
  schedule(j) {
    const c = this.graph();
    if (!j.buf) {
      const { pcm, rate } = VCore.parseWav(j.res.wav || j.res); if (!pcm.length) return;
      // the same loudness for every piece (Kokoro and Piper differ, so do sentences), never clipping
      let e = 0, n = 0, pk = 0; for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > pk) pk = a; if (a > 0.01) { e += a * a; n++; } }
      const rms = n ? Math.sqrt(e / n) : 0.1; const gain = Math.min(rms ? 0.11 / rms : 1, 0.95 / (pk || 1), 4) * (j.vol || 1);
      const pad = Math.round(rate * (j.pause || 0)); const b = c.createBuffer(1, pcm.length + pad, rate); const d = b.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] * gain;
      j.buf = b; j.res = null; // the bytes are not needed any more
    }
    const off = Math.min(j.offset || 0, j.buf.duration - 0.05); j.offset = 0;
    const start = Math.max(c.currentTime + 0.025, this.endAt - XF); const dur = j.buf.duration - off;
    const src = c.createBufferSource(); src.buffer = j.buf; const g = c.createGain();
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(1, start + XF); g.gain.setValueAtTime(1, Math.max(start + XF, start + dur - XF)); g.gain.linearRampToValueAtTime(0, start + dur);
    src.connect(g); g.connect(this.master);
    src.start(start, off);
    Object.assign(j, { src, g, startAt: start, endAt: start + dur, off, gen: this.gen }); this.endAt = start + dur; this.live.push(j);
    const gen = this.gen;
    j.showT = setTimeout(() => { if (gen === this.gen && !j.stopped) this.onPlay(j); }, Math.max(0, (start - c.currentTime) * 1000));
    src.onended = () => { this.live = this.live.filter((x) => x !== j); if (!j.stopped) { j.done = true; this.played.push(j); } try { g.disconnect(); src.disconnect(); } catch {} if (j.done) j.buf = null; this.pump(); };
  },
  scheduleSfx(j) {
    const c = this.graph(); const start = Math.max(c.currentTime + 0.02, this.endAt);
    const d = VFX.schedule ? VFX.schedule(j.sfx, c, this.master, start) : 0; if (!d) return;
    this.endAt = start + d; const gen = this.gen;
    j.endAt = this.endAt; j.startAt = start; j.sfxLive = true; this.live.push(j);
    setTimeout(() => { this.live = this.live.filter((x) => x !== j); if (gen === this.gen) this.pump(); }, (this.endAt - c.currentTime) * 1000 + 20);
    j.showT = setTimeout(() => { if (gen === this.gen && !S.voice.barge) vPhase('speaking'); }, (start - c.currentTime) * 1000);
  },
  async speakSys(j) {
    this.sysBusy = true; this.sysJob = j; this.onPlay(j); const g = this.gen; j.sysAt = performance.now();
    const lang = j.lang || vLang();
    try {
      if (vLocalOk()) await VLocal.sys(j.text, { lang, rate: j.speed || 1, volume: j.vol || 1 });
      else await api.voice.sys(j.text, { rate: j.speed || 1, lang }).catch(() => {}); // Fabro Anywhere: the phone says it
    } finally { this.sysBusy = false; this.sysJob = null; }
    if (g === this.gen && !j.stopped) { j.done = true; this.played.push(j); this.pump(); }
  },
  onPlay(j) {
    if (!j.laugh && !j.counted) { j.counted = true; this.said.push(j.text); if (this.said.length > 40) this.said.shift(); }
    S.voice.ai = j.text; if (!S.voice.barge) vPhase('speaking'); vRenderSubs();
  },
  idle() {
    clearTimeout(this.idleT);
    if (this.busy()) return;
    this.idleT = setTimeout(() => { if (!this.busy() && S.voice.on && !S.voice.barge && !Mic.speaking) vPhase(S.streaming ? 'thinking' : 'listening'); }, 60);
  },
  // the user talks over it: fade out now, remember where it was
  pause() {
    if (this.paused) return; const c = this.c(); const t = c ? c.currentTime : 0; this.paused = { t };
    this.ramp(0, 0.06);
    const gen = this.gen;
    if (this.sysBusy && this.sysJob) { // the system voice can't pause: it stops, and says that piece again after
      const j = this.sysJob; j.stopped = true; this.q.unshift({ ...j, stopped: false, done: false, ready: true, res: { sys: true } });
      if (vLocalOk()) VLocal.sysStop(); else api.voice.sys('').catch(() => {});
    }
    const until = t + 0.06; const back = [];
    for (const j of this.live) {
      if (j.sfxLive) continue;
      const pos = until - j.startAt; // seconds into this piece when it went quiet
      if (pos >= j.endAt - j.startAt - 0.02) continue; // over by then
      j.offset = (j.off || 0) + Math.max(0, pos); j.paused = true; back.push(j);
    }
    setTimeout(() => {
      for (const j of back) { j.stopped = true; clearTimeout(j.showT); try { j.src.onended = null; j.src.stop(); j.g.disconnect(); } catch {} }
      this.live = this.live.filter((j) => !back.includes(j));
      if (gen !== this.gen) return; // stopped meanwhile (a resume comes after this and picks them up)
      // they go back to the front of the queue, to continue from where they stopped
      for (const j of back.reverse()) { const n = { ...j, src: null, g: null, stopped: false, paused: false, counted: j.counted, ready: true }; delete n.done; this.q.unshift(n); }
      this.endAt = 0;
    }, 70);
  },
  // it was nothing (a "mh", a laugh, its own echo): carry on from a little before where it stopped
  resume() {
    if (!this.paused) return; this.paused = null;
    const gen = this.gen;
    setTimeout(() => { if (gen !== this.gen || this.paused) return; const j = this.q.find((x) => !x.sfx); if (j && j.offset) j.offset = Math.max(0, j.offset - 0.35); this.ramp(1, 0.05); this.pump(); }, 80);
  },
  c() { return VAudio.c; },
  ramp(to, sec) {
    const c = this.c(); if (!c || !this.master) { this.fade = null; return; }
    const t = c.currentTime; const from = this.gainNow();
    const p = this.master.gain; p.cancelScheduledValues(t); p.setValueAtTime(from, t); p.linearRampToValueAtTime(to, t + sec);
    this.fade = { from, to, t0: t, t1: t + sec };
  },
  gainNow() {
    const f = this.fade; if (!f) return 1; const c = this.c(); const t = c ? c.currentTime : f.t1;
    if (t >= f.t1) return f.to; if (t <= f.t0) return f.from; return f.from + (f.to - f.from) * (t - f.t0) / (f.t1 - f.t0);
  },
  stop() {
    this.gen++; clearTimeout(this.sysT);
    if (vLocalOk() && VLocal.cancelSay) VLocal.cancelSay(this.gen);
    const live = this.live; this.ramp(0, 0.05);
    for (const j of live) { clearTimeout(j.showT); j.stopped = true; }
    setTimeout(() => { for (const j of live) { try { if (j.src) { j.src.onended = null; j.src.stop(); } j.g && j.g.disconnect(); } catch {} j.buf = null; } this.ramp(1, 0.01); }, 60);
    if (this.sysBusy || live.length) { if (vLocalOk()) VLocal.sysStop(); else if (this.sysBusy) api.voice.sys('').catch(() => {}); }
    clearTimeout(this.aheadT); this.q = []; this.live = []; this.endAt = 0; this.paused = null; this.style = 'neutral';
  },
  // a new answer begins: what was said before doesn't count any more
  newTurn() { this.played = []; this.said = []; this.style = 'neutral'; },
  busy() { return this.q.length > 0 || this.live.length > 0 || this.sysBusy || !!this.paused; },
  audible() { const t = VAudio.now(); return this.sysBusy || this.live.some((j) => j.startAt <= t + 0.02 && j.endAt > t); },
  outRms() {
    if (!this.analyser || !this.live.length) return this.sysBusy ? 0.05 : 0;
    const a = this.tbuf; if (this.analyser.getFloatTimeDomainData) this.analyser.getFloatTimeDomainData(a); else return 0.05;
    let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i]; return Math.sqrt(e / a.length);
  },
  level() { if (this.sysBusy) return 0.3; return Math.min(1, this.outRms() * 5); },
  // what was said aloud in this answer so far: the pieces played, and the part of the current one already heard
  heard() {
    const c = this.c(); const t = this.paused ? this.paused.t : c ? c.currentTime : 0; const out = [];
    for (const j of this.played) if (!j.laugh && j.text) out.push(j.text);
    for (const j of [...this.live, ...this.q.filter((x) => x.offset)]) {
      if (j.sfx || j.laugh || !j.text) continue;
      const full = j.buf ? j.buf.duration - (j.pause || 0) : 0; if (!full) { if (j.sysAt) out.push(VCore.spokenPart(j.text, 0.5)); continue; }
      const pos = j.startAt != null && !j.offset ? (t - j.startAt) + (j.off || 0) : j.offset || 0;
      const part = VCore.spokenPart(j.text, pos / full); if (part) out.push(part);
    }
    return out.join(' ').trim();
  },
};

// ───────────────────────────── one conversation turn ─────────────────────────────
const Turn = { utt: 0, stt: null, spec: null, partialAt: 0, iv: 0, feat: null, carry: '', t: {} };
const vNow = () => performance.timeOrigin + performance.now();
function vPhase(p) {
  if (S.voice.muted && (p === 'listening' || p === 'hearing')) p = 'muted';
  if (S.voice.phase === p) return; S.voice.phase = p;
  const el = $('#vx'); if (el) { el.dataset.phase = p; const st = $('#vx-status'); if (st) st.textContent = t('vx_' + p); }
}
// one recognition at a time from here; the result says how much of the utterance it covers
function vRecognise(pcm, partial) {
  const utt = Turn.utt; const pos = Mic.ep ? Mic.ep.st.pos : 0;
  const lastAssistant = S.conv && [...S.conv.messages].reverse().find((m) => m.role === 'assistant' && m.content);
  const run = { utt, partial, pos, voicedTo: Mic.ep ? Mic.ep.st.lastVoiced : 0, t0: vNow() };
  // long enough to recognise the language: Whisper picks it (the user may switch); short: the conversation's
  const voiced = pcm.length / 16;
  const lang = voiced > 1400 ? undefined : vLang();
  run.p = vStt(VCore.wav16k(pcm), { lang, partial, prompt: lastAssistant ? VCore.speakable(vStripTags(lastAssistant.content), vLang()).slice(-180) : '' })
    .then((x) => x, (e) => { run.err = e; return null; })
    .then(async (x) => {
      run.t1 = vNow();
      // auto-detected and slipped into another alphabet: again, held to the conversation's language
      if (x && lang === undefined && !partial && /[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\s]/u.test(x) && !/^(ru|uk|zh)/.test(vLang())) x = await vStt(VCore.wav16k(pcm), { lang: vLang() }).catch(() => x);
      return x;
    });
  Turn.stt = run; run.p.then(() => { if (Turn.stt === run) Turn.stt = null; });
  return run;
}
function vClean(text) { return String(text || '').replace(/[^\p{Script=Latin}\p{M}\p{N}\s.,;:!?…'’"«»()\-–—%€$£&@\/+=°]/gu, (ch) => (/^(ru|uk)/.test(vLang()) && /\p{Script=Cyrillic}/u.test(ch)) || (/^zh/.test(vLang()) && /\p{Script=Han}/u.test(ch)) ? ch : ' ').replace(/\s+/g, ' ').trim(); }
function vPartialTick() {
  if (!Mic.speaking || Turn.stt || !vPartialsOk()) return;
  const ep = Mic.ep; if (!ep || ep.st.voicedMs < 450 || ep.st.paused) return;
  const last = (window.VLocal && VLocal.st.sttMs) || 500;
  if (vNow() - Turn.partialAt < Math.max(450, last)) return; // at most half of the time recognising
  let pcm = Mic.sofar(); if (!pcm) return; if (pcm.length > 16000 * 20) pcm = pcm.subarray(pcm.length - 16000 * 20);
  Turn.partialAt = vNow();
  const run = vRecognise(pcm, true);
  run.p.then((x) => {
    if (x == null || run.utt !== Turn.utt || !Mic.speaking) return;
    const text = vClean(x); if (!text || NOISE_TEXT.test(text)) return;
    S.voice.partial = text; vRenderSubs();
    if (Mic.ep) Mic.ep.hint = VCore.soundsDone(text, vLang());
    vBargeCheck(text);
  });
}
// talking over Fabro: a real interruption (several real words, not its own echo, not "mh"), decided early so
// the model stops writing at once
function vBargeCheck(text) {
  const b = S.voice.barge; if (!b || b.cut != null || b.utt !== Turn.utt) return;
  const words = (String(text || '').match(/[\p{L}\d']+/gu) || []).length;
  const long = Mic.ep && Mic.ep.st.voicedMs > 1300;
  if ((text && words >= 3 && !vEcho(text) && !vRefereeKeepTalking(text, [], 2)) || (long && !text && !vPartialsOk())) b.cut = vCut();
}
function vOnStart(ev) {
  Turn.utt++; Turn.spec = null; Turn.feat = null; Turn.partialAt = vNow(); Turn.t = { start: vNow() };
  S.voice.partial = ''; if (Mic.ep) Mic.ep.hint = null;
  // over Fabro's voice (or while it is about to answer): it goes quiet at once, until we know what this is
  if (Speaker.busy() || S.streaming) { S.voice.barge = { at: vNow(), utt: Turn.utt, cut: null }; Speaker.pause(); }
  vPhase('hearing'); vRenderSubs();
  clearInterval(Turn.iv); Turn.iv = setInterval(() => { vPartialTick(); if (S.voice.barge && Mic.ep && Mic.ep.st.voicedMs > 1300) vBargeCheck(S.voice.partial); }, 120);
}
function vOnPause() {
  // a short silence: start the final recognition now — by the time the end is confirmed it is (almost) ready
  const pcm = Mic.sofar(); if (!pcm) return;
  const cur = Turn.stt;
  let spec;
  if (cur && cur.utt === Turn.utt && cur.pos >= Mic.ep.st.lastVoiced) { // already running on everything said
    spec = { ...cur, partial: false }; spec.p = cur.p.then((x) => (x != null ? x : vRecognise(pcm, false).p)); cur.p.then(() => { spec.t1 = cur.t1; spec.err = cur.err; });
  } else spec = vRecognise(pcm, false);
  Turn.spec = spec;
  spec.p.then((x) => { if (Turn.spec === spec && Mic.ep && Mic.speaking && x) Mic.ep.hint = VCore.soundsDone(vClean(x), vLang()); });
  // how it was said (laughs, whistles, a whisper…): a few ms of signal analysis, while Whisper works
  setTimeout(() => { if (Turn.spec === spec) { try { Turn.feat = VEar.analyse([pcm.subarray(0, Math.min(pcm.length, 16000 * 4))], 16000); } catch {} } }, 0);
}
function vOnResume() { Turn.spec = null; Turn.feat = null; }
function vOnCancel() {
  clearInterval(Turn.iv); S.voice.partial = ''; vRenderSubs();
  if (S.voice.barge && S.voice.barge.cut == null) { S.voice.barge = null; Speaker.resume(); }
  vPhase(Speaker.busy() ? 'speaking' : S.streaming ? 'thinking' : 'listening');
}
async function vOnEnd(ev) {
  clearInterval(Turn.iv); Turn.t.end = vNow();
  const utt = Turn.utt; const barge = S.voice.barge;
  if (!barge || barge.cut != null) vPhase('thinking');
  try {
    // the speculative recognition covers everything said? then it is the final one
    const spec = Turn.spec && Turn.spec.utt === utt ? Turn.spec : null;
    const run = spec || vRecognise(ev.pcm, false);
    let raw = await run.p; Turn.t.sttDone = vNow(); Turn.t.sttFrom = run.t0;
    if (run.err) throw run.err;
    let feat = Turn.feat; if (!feat) { try { feat = VEar.analyse([ev.pcm.subarray(0, Math.min(ev.pcm.length, 16000 * 4))], 16000); } catch {} }
    let text = vClean(raw);
    const noise = !text || NOISE_TEXT.test(text);
    const tags = feat ? VEar.tags(feat, noise ? '' : text) : [];
    if (noise) text = '';
    // over Fabro's voice: carry on (an "mh", a laugh, its own echo), or turn to what was just said
    if (barge && barge.cut == null) {
      if ((!text && !tags.some((x) => !x.startsWith('voice:'))) || vEcho(text) || vRefereeKeepTalking(text, tags, ev.voicedMs / 1000)) {
        S.voice.barge = null; S.voice.partial = ''; vRenderSubs(); Speaker.resume(); vPhase(Speaker.busy() ? 'speaking' : S.streaming ? 'thinking' : 'listening'); return;
      }
    }
    if (!text) {
      const snd = tags.find((x) => !x.startsWith('voice:'));
      if (!snd) { S.voice.barge = null; S.voice.partial = ''; vRenderSubs(); Speaker.resume(); vPhase(Speaker.busy() ? 'speaking' : 'listening'); return; }
      text = (V_SOUNDS[vLang().slice(0, 2)] || V_SOUNDS.en)[snd] || '*' + snd + '*';
    }
    // they already started a new sentence: it goes out with that one, nothing is lost
    if (utt !== Turn.utt && Mic.speaking) { Turn.carry = (Turn.carry ? Turn.carry + ' ' : '') + text; return; }
    if (Turn.carry) { text = Turn.carry + ' ' + text; Turn.carry = ''; }
    const cut = barge ? await (barge.cut != null ? barge.cut : vCut()) : '';
    S.voice.barge = null;
    vFollowLanguage(text);
    S.voice.user = text; S.voice.partial = ''; S.voice.ai = ''; S.voice.err = ''; vRenderSubs();
    if (S.mode !== 'chat') { S.mode = 'chat'; renderSidebar(); }
    await vSettled();
    Speaker.newTurn(); vChunker.reset(); vPhase('thinking');
    Turn.t.send = vNow(); S.voice.trace = Turn.t;
    sendPrompt(text, { voice: true, cues: tags, cut });
  } catch (e) {
    S.voice.barge = null; Speaker.resume();
    S.voice.err = vErrText(e, 'stt'); vRenderSubs(); vPhase(Speaker.busy() ? 'speaking' : 'listening');
  }
}
// the aborted answer has finished closing (its 'done' event came)
async function vSettled() { for (let i = 0; i < 75 && S.streaming; i++) await new Promise((r) => setTimeout(r, 20)); }
// The user's language, turn by turn: a whole sentence in another language the voices speak switches to it.
function vFollowLanguage(text) {
  if (!window.FALang) return;
  const cur = vLang().slice(0, 2); const words = (text.match(/[\p{L}']+/gu) || []).length; if (words < 4) return;
  const l = FALang.detect(text, cur);
  // accents alone are thin evidence ("plutôt de Rome" is not Portuguese): its common words must say so too
  if (l !== FALang.detect(text.normalize('NFD').replace(/\p{M}/gu, ''), cur)) return;
  if (l === cur || !['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl'].includes(l)) return;
  S.voice.lang = l;
  if (vLocalOk()) VLocal.prepare(l); // its voice downloads in the background; meanwhile the system voice speaks it
}
// Why the microphone didn't start, in words the user can act on.
function micErrText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return t('vx_micDenied');
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return t('vx_micNone');
  if (n === 'NotReadableError') return t('vx_micBusy');
  return t('vx_micErr');
}
// Errors of the engines, in plain words (the detail goes to the console)
function vErrText(e, what) {
  console.warn('voice ' + what, e);
  const m = String((e && e.message) || e || '');
  if (/fetch|network|Failed to load|404|ENOTFOUND|offline/i.test(m)) return t('vx_errNet');
  if (/memory|OOM|allocation/i.test(m)) return t('vx_errMem');
  return t(what === 'tts' ? 'vx_errTts' : 'vx_errStt');
}
function vInterrupt() {
  Speaker.stop(); vChunker.reset();
  if (S.streaming) { api.chat.abort(S.streaming.reqId); }
}
// A real interruption: stop where we were, keep in the conversation only what was actually said aloud.
async function vCut() {
  const heard = Speaker.heard();
  const m = (S.streaming && S.streaming.msg) || (S.conv && [...S.conv.messages].reverse().find((x) => x.role === 'assistant'));
  vInterrupt();
  await vSettled();
  if (m && m.voice && VCore.speakable(vStripTags(m.content || ''), vLang()).length > heard.length + 8) {
    m.content = heard ? heard + ' …' : ''; m.cutoff = true;
    const el = $(`#m-${m.id}`); if (el && S.conv) el.outerHTML = renderMessage(m, S.conv.messages.indexOf(m));
    persist();
  }
  return heard;
}
// Sounds with no words: what the conversation shows for them (and the AI reads, with the cues)
const V_SOUNDS = {
  fr: { whistling: '*siffle*', humming: '*chantonne*', singing: '*chante*', laughing: '*rit*', 'fart-like low rumble': '*prout*', 'clapping or knocking': '*tape*' },
  en: { whistling: '*whistles*', humming: '*hums*', singing: '*sings*', laughing: '*laughs*', 'fart-like low rumble': '*farts*', 'clapping or knocking': '*claps*' },
  es: { whistling: '*silba*', humming: '*tararea*', singing: '*canta*', laughing: '*se ríe*', 'fart-like low rumble': '*pedo*', 'clapping or knocking': '*aplaude*' },
  de: { whistling: '*pfeift*', humming: '*summt*', singing: '*singt*', laughing: '*lacht*', 'fart-like low rumble': '*pupst*', 'clapping or knocking': '*klatscht*' },
};
// Whisper writes music and noises as words: "♪", "(Musique)", "[sifflement]"…
const NOISE_TEXT = /^[\s♪♫🎵*([\-]*(musique|music|musik|música|sifflement|siffle|whistl|pfeif|silb|hum|fredonn|chantonn|tarare|summ|applaudissements|applause|rires?|laugh|pet|prout|fart|bruit|noise)?[\s♪♫🎵*)\]\-.…!]*$/i;
// Is this just the AI's own voice coming back through the speakers?
function vEcho(text) {
  const w = (x) => (String(x).toLowerCase().match(/[\p{L}\d']+/gu) || []);
  const said = new Set(w(Speaker.said.slice(-3).join(' '))); const heard = w(text);
  return heard.length > 0 && heard.filter((x) => said.has(x)).length / heard.length >= 0.7;
}
// The model of voice mode: small and very fast. Automatic: if the chosen model runs on this computer and a much
// smaller one is installed (from about 1 GB — below that they understand too little), that one answers.
function voiceModel() {
  const pref = S.settings.voiceModel || 'same'; // by default, the model chosen in the chat answers
  if (pref === 'same') return null;
  if (pref !== 'auto') return allModels().find((m) => refKey(m.ref) === pref) || null;
  const cur = currentModel(); if (!cur || cur.ref.backend !== 'local') return null;
  const size = (m) => { const x = S.installed.local.find((l) => l.id === m.ref.id); return x ? x.sizeBytes || 0 : 0; };
  const small = allModels().filter((m) => m.ref.backend === 'local' && size(m) > 0.9e9 && size(m) < 5.6e9).sort((a, b) => size(a) - size(b))[0];
  return small && size(small) * 1.6 < size(cur) ? small : null;
}

// ───────────────────────────── voice mode ─────────────────────────────
const vChunker = VCore.Chunker();
async function voiceOpen() {
  if (S.voice.on) return;
  // first thing, still inside the tap: the one audio context, and the speaker unlocked (iPhone)
  VAudio.ctx(); VAudio.unlock();
  S.voice.on = true; S.voice.scene = []; S.voice.user = ''; S.voice.partial = ''; S.voice.ai = ''; S.voice.err = ''; S.voice.lang = null; S.voice.phase = 'idle';
  vRender();
  const stP = api.voice.status().then((s) => s, () => ({}));
  if (!vInFrame() && api.voice.warm) api.voice.warm().catch(() => {}); // the computer's own Whisper, if that's what will listen
  vStartListening();
  S.voice.status = await stP;
  // everything runs in the browser: nothing to install, the models download in the background the first time
  if (vLocalOk() && S.voice.on) { VLocal.st.pref = { ...(S.settings.localVoices || {}) }; Promise.resolve(VLocal.prepare(vLang())).then(() => { if (S.voice.on) vRender(); }); vWatch(); }
  if (S.voice.on) vRender();
}
async function vStartListening() {
  try {
    await Mic.start({});
    Mic.on = {
      start: vOnStart, pause: vOnPause, resume: vOnResume, cancel: vOnCancel, end: vOnEnd,
      level: (l) => { S.voice.level = l; },
      lost: (e) => { S.voice.err = t('vx_micLost'); vPhase('paused'); vRender(); console.warn('mic lost', e); },
      restored: () => { if (S.voice.err === t('vx_micLost')) S.voice.err = ''; vRenderSubs(); },
    };
    if (!S.voice.on) { Mic.stop(); return; }
    vPhase('listening'); vSpin();
  } catch (e) { S.voice.err = micErrText(e); vPhase('paused'); vRender(); }
}
function voiceClose() {
  S.voice.on = false; S.voice.barge = null; clearInterval(Turn.iv); Turn.utt++; Turn.carry = '';
  Mic.stop(); Speaker.stop(); Speaker.newTurn(); vChunker.reset();
  if (S.streaming && S.streaming.msg && S.streaming.msg.voice) api.chat.abort(S.streaming.reqId);
  cancelAnimationFrame(vSpin.raf); vSpin.raf = 0; vSpin.els = null;
  setTimeout(() => { if (!S.voice.on && !S.dictating) VAudio.close(); }, 200); // nothing left running between sessions
  const el = $('#vx'); if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 260); }
  refreshComposer && refreshComposer();
}
// The propeller: slow when listening, faster while thinking, pulsing with the voice while speaking. Only
// transform and a CSS variable; stops when the window is hidden; no spin with "reduce motion".
function vSpin() {
  if (vSpin.raf) return;
  let a = 0, last = performance.now(), sp = 30, lvS = 0;
  const tick = (now) => {
    vSpin.raf = 0;
    if (!S.voice.on || document.hidden) return; // visibilitychange starts it again
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!vSpin.els || !vSpin.els.m.isConnected) vSpin.els = { m: $('#vx-mark'), ring: $('#vx-ring') };
    const { m, ring } = vSpin.els; const p = S.voice.phase;
    const lv = p === 'speaking' ? Speaker.level() : p === 'hearing' ? Math.min(1, S.voice.level * 14) : 0;
    lvS += (lv - lvS) * Math.min(1, dt * 12);
    const still = document.documentElement.classList.contains('reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const target = p === 'speaking' ? 260 + lvS * 500 : p === 'thinking' ? 190 : p === 'hearing' ? 60 + lvS * 220 : p === 'listening' ? 22 : 0;
    sp += (target - sp) * Math.min(1, dt * 4); if (!still) a = (a + sp * dt) % 360;
    if (m) m.style.transform = `rotate(${a.toFixed(1)}deg) scale(${(1 + (p === 'speaking' || p === 'hearing' ? lvS * 0.12 : 0)).toFixed(3)})`;
    if (ring) ring.style.setProperty('--lv', lvS.toFixed(3));
    vSpin.raf = requestAnimationFrame(tick);
  };
  vSpin.raf = requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => {
  if (!S.voice.on) return;
  if (document.hidden) return;
  // back: the clock may have been suspended (phones), the microphone taken away
  const c = VAudio.c; if (c && c.state !== 'running') c.resume().catch(() => {});
  if (!Mic.stream || Mic.stream.getAudioTracks().every((tr) => tr.readyState === 'ended')) { Mic.stream = Mic.stream || null; if (Mic.stream) Mic.restart('visible'); else vStartListening(); }
  vSpin();
});
function vRenderSubs() {
  const u = $('#vx-user'), a = $('#vx-ai');
  if (u) { const live = !!S.voice.partial; u.textContent = live ? S.voice.partial : S.voice.user; u.classList.toggle('partial', live); }
  if (a) a.textContent = S.voice.ai;
  const e = $('#vx-err'); if (e) { e.textContent = S.voice.err || ''; e.hidden = !S.voice.err; }
}
function vSceneHtml() {
  const it = S.voice.scene; if (!it.length) return '';
  const one = (x) => x.type === 'image' ? `<figure class="vs-img"><img src="${esc(x.url)}" alt="${esc(x.title || '')}" referrerpolicy="no-referrer" onerror="this.closest('figure').remove()"><figcaption>${esc(x.title || '')}</figcaption></figure>`
    : x.type === 'video' ? `<iframe class="vs-frame" src="${esc(x.embed || x.url)}" allow="autoplay; encrypted-media" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`
    : x.type === 'web' ? `<iframe class="vs-frame" src="${esc(x.url)}" sandbox="allow-scripts allow-same-origin"></iframe>`
    : x.type === 'svg' ? `<div class="vs-svg">${DOMPurify.sanitize(x.content, { USE_PROFILES: { svg: true, svgFilters: true } })}</div>`
    : `<iframe class="vs-frame" sandbox="allow-scripts" srcdoc="${esc(x.content)}"></iframe>`;
  return `<div class="vs ${it.length > 1 ? 'grid' : ''}">${it.map(one).join('')}</div>${it[0].title && it.length === 1 && it[0].type !== 'image' ? `<div class="vs-cap">${esc(it[0].title)}</div>` : ''}`;
}
// The natural voices of this language (downloaded on first use)
function vVoiceSelect() {
  if (!vLocalOk()) return '';
  const l = vLang().slice(0, 2); const list = VLocal.voicesOf(l); if (!list.length) return '';
  const cur = VLocal.voiceFor(l);
  return `<select class="input sm2" id="vx-voice" aria-label="${esc(t('vx_voice'))}">${list.map(([id, name, f]) => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(name)} ${f === 'm' ? '♂' : '♀'}${VLocal.st.voices[id] === 'ready' ? '' : ' ↓'}</option>`).join('')}</select>`;
}
// First use: what is still downloading (the voice, the ears), shown under the status
function vDlText() {
  if (!vLocalOk()) return '';
  const p = VLocal.pending(vLang()); if (p == null) return '';
  return t('vx_dl', { p: Math.round(p * 100) });
}
function vWatch() {
  if (vWatch.off) return;
  vWatch.off = VLocal.on(() => { const d = $('#vx-dl'); if (d) d.textContent = vDlText(); });
}
// Which model answers in voice mode: automatic (a small installed one when the chosen model is big), the chat's own, or one picked
function vModelSelect() {
  const pref = S.settings.voiceModel || 'same'; const auto = pref === 'auto' ? voiceModel() : null;
  const opts = allModels().filter((m) => !m.mod).map((m) => `<option value="${esc(refKey(m.ref))}" ${pref === refKey(m.ref) ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  return `<select class="input sm2" id="vx-model" aria-label="${esc(t('vx_model'))}" title="${esc(t('vx_modelHint'))}">
    <option value="same" ${pref === 'same' ? 'selected' : ''}>${esc(t('vx_modelSame'))}${currentModel() ? ' · ' + esc(currentModel().label) : ''}</option>
    <option value="auto" ${pref === 'auto' ? 'selected' : ''}>⚡ ${esc(t('vx_modelAuto'))}${auto ? ' · ' + esc(auto.label) : ''}</option><optgroup label="${esc(t('vx_model'))}">${opts}</optgroup></select>`;
}
function vRender() {
  let el = $('#vx');
  const phase = S.voice.phase === 'idle' ? 'listening' : S.voice.phase;
  const body = `<div class="vx-scene" id="vx-scene">${vSceneHtml()}</div>
       <div class="vx-center ${S.voice.scene.length ? 'small' : ''}"><button class="vx-ring" id="vx-ring" data-action="vx-tap" aria-label="${esc(t('vx_tap'))}"><span id="vx-mark" class="vx-mark">${logo(S.voice.scene.length ? 64 : 120)}</span></button>
         <div class="vx-status" id="vx-status" role="status" aria-live="polite">${esc(t('vx_' + phase))}</div><div class="vx-dl" id="vx-dl">${esc(vDlText())}</div></div>
       <div class="vx-subs"><div class="vx-user ${S.voice.partial ? 'partial' : ''}" id="vx-user">${esc(S.voice.partial || S.voice.user)}</div><div class="vx-ai" id="vx-ai">${esc(S.voice.ai)}</div><div class="vx-err" id="vx-err" ${S.voice.err ? '' : 'hidden'}>${esc(S.voice.err)}</div></div>`;
  const html = `<div class="vx-top"><span class="vx-title">${icon('waveform', 16)} ${esc(t('vx_title'))}</span><span class="grow"></span>
      ${vVoiceSelect()}
      ${vModelSelect()}
      <button class="icon-btn" data-action="vx-close" title="${esc(t('close'))}">${icon('x', 18)}</button></div>
    <div class="vx-body">${body}</div>
    <div class="vx-ctl">
      <button class="vx-btn ${S.voice.muted ? 'off' : ''}" data-action="vx-mute" aria-pressed="${S.voice.muted ? 'true' : 'false'}" title="${esc(t(S.voice.muted ? 'vx_unmute' : 'vx_mute'))}" aria-label="${esc(t(S.voice.muted ? 'vx_unmute' : 'vx_mute'))}">${icon('mic', 22)}</button>
      <button class="vx-btn" data-action="vx-stop-talk" title="${esc(t('vx_interrupt'))}" aria-label="${esc(t('vx_interrupt'))}">${icon('stop', 20)}</button>
      <button class="vx-btn end" data-action="vx-close" title="${esc(t('vx_end'))}" aria-label="${esc(t('vx_end'))}">${icon('x', 22)}</button></div>`;
  if (!el) { el = document.createElement('div'); el.id = 'vx'; el.className = 'vx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('vx_title')); document.body.appendChild(el); }
  el.dataset.phase = phase; el.innerHTML = html; vSpin.els = null;
  const vm = $('#vx-model'); if (vm) vm.addEventListener('change', () => saveSettings({ voiceModel: vm.value }).catch(() => {}));
  const sel = $('#vx-voice'); if (sel) sel.addEventListener('change', async () => {
    const l = vLang().slice(0, 2);
    if (vLocalOk()) { VLocal.setVoice(l, sel.value); saveSettings({ localVoices: { ...(S.settings.localVoices || {}), [l]: sel.value } }).catch(() => {}); }
    else { try { S.voice.status = await api.voice.setVoice(sel.value); } catch (e) { toast(cleanErr(e), 'err'); } }
  });
}
api.on('deps:progress', ({ dep, p }) => { if (dep === 'voice' && S.voice.installing != null) { S.voice.installing = p; if (S.voice.on) vRender(); } });

// Hook the chat stream: speak the answer as it is written, show the scene.
const _onChatEvent = onChatEvent;
onChatEvent = function (ev) {
  const live = S.voice.on && S.streaming && ev.reqId === S.streaming.reqId;
  _onChatEvent(ev);
  if (!live) return;
  if (ev.type === 'token') { if (Turn.t && !Turn.t.firstTok) Turn.t.firstTok = vNow(); for (const piece of vChunker.push(ev.text)) Speaker.say(piece); }
  if (ev.type === 'retract') vChunker.retract(ev.text);
  if (ev.type === 'tool_start' && !S.voice.barge && !Speaker.busy()) vPhase('thinking');
  if (ev.type === 'tool_end' && ev.view && ev.view.kind === 'scene') { S.voice.scene = ev.view.items || []; if ($('#vx-scene')) vRender(); }
  if (ev.type === 'done' || ev.type === 'error') {
    for (const piece of vChunker.flush()) Speaker.say(piece);
    if (!Speaker.busy() && !S.voice.barge && !Mic.speaking) vPhase('listening');
    if (ev.type === 'error') { S.voice.err = String(ev.message || t('vx_errModel')).slice(0, 200); vRenderSubs(); }
  }
};

// ───────────────────────────── dictation (mic button in the composer) ─────────────────────────────
async function dictate(btn) {
  // second tap: done now (what was said is transcribed)
  if (S.dictating) { if (Mic.speaking) Mic.ep.cfg.endMs = Mic.ep.cfg.doneMs = Mic.ep.cfg.midMs = 0; else if (S.dictateDone) S.dictateDone(); return; }
  if (vLocalOk()) VLocal.ears().catch(() => {});
  VAudio.ctx();
  S.dictating = true; btn.classList.add('rec');
  const done = S.dictateDone = () => { S.dictateDone = null; S.dictating = false; btn.classList.remove('rec', 'hot', 'busy'); if (!S.voice.on) { Mic.stop(); setTimeout(() => { if (!S.voice.on && !S.dictating) VAudio.close(); }, 200); } };
  try { await Mic.start({ endMs: 1300, doneMs: 1000, midMs: 1800 }); } catch (e) { toast(micErrText(e), 'err'); done(); return; }
  Mic.on = {
    start: () => btn.classList.add('hot'),
    cancel: done,
    level: (l) => btn.style.setProperty('--lv', String(Math.min(1, l * 14))),
    end: async (ev) => {
      btn.classList.remove('hot'); btn.classList.add('busy');
      try { const text = vClean(await vStt(VCore.wav16k(ev.pcm), { lang: sttLang() })); const ta = $('#prompt'); if (ta && text) { ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + text; ta.dispatchEvent(new Event('input')); ta.focus(); } }
      catch (e) { toast(vErrText(e, 'stt'), 'err'); }
      done();
    },
  };
  setTimeout(() => { if (S.dictating && !Mic.speaking) done(); }, 12000);
}

// Words to recognise (names, jargon, brands): added to Whisper's vocabulary.
function vocabDialog() {
  const cur = (S.voice.status && S.voice.status.vocab) || '';
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="vv-t" style="max-width:520px">
      <h2 id="vv-t">${esc(t('vx_vocab'))}</h2><p class="muted small">${esc(t('vx_vocabHint'))}</p>
      <textarea class="input" id="vv-in" rows="5" style="width:100%;height:auto;padding:10px" placeholder="Fabro, Lumeria, Transdev, Luau…">${esc(cur)}</textarea>
      <div class="modal-actions"><button class="btn" data-action="close-modal">${esc(t('cancel'))}</button><button class="btn primary" data-action="vx-vocab-save">${esc(t('save'))}</button></div>
    </div>`;
  setTimeout(() => $('#vv-in') && $('#vv-in').focus(), 30);
}
// Stop Fabro talking (button, Space, a tap on the propeller): what was heard stays, it listens.
async function vStopTalk() {
  if (S.voice.phase === 'paused' && (!Mic.stream || S.voice.err)) { S.voice.err = ''; VAudio.ctx(); vRenderSubs(); if (Mic.stream) Mic.restart('tap'); else vStartListening(); return; }
  if (!Speaker.busy() && !S.streaming) return;
  S.voice.barge = null; await vCut(); vPhase(S.voice.muted ? 'muted' : 'listening');
}
Object.assign(actions, {
  'vx-vocab': () => vocabDialog(),
  'close-modal': () => closeModal(),
  'vx-vocab-save': async () => { const v = $('#vv-in') ? $('#vv-in').value : ''; closeModal(); try { S.voice.status = await api.voice.setVocab(v); toast(t('vx_vocabSaved')); } catch (e) { toast(cleanErr(e), 'err'); } },
  'voice-mode': () => voiceOpen(),
  'dictate': (el) => dictate(el),
  'vx-close': () => voiceClose(),
  'vx-mute': () => { S.voice.muted = !S.voice.muted; vRender(); vPhase(S.voice.muted ? 'muted' : Speaker.busy() ? 'speaking' : S.streaming ? 'thinking' : 'listening'); },
  'vx-stop-talk': () => vStopTalk(),
  'vx-tap': () => vStopTalk(),
  'vx-install': async () => {
    S.voice.installing = 0; S.voice.err = ''; vRender();
    try { S.voice.status = await api.voice.install(); S.voice.installing = null; vRender(); vStartListening(); }
    catch (e) { S.voice.installing = null; S.voice.err = cleanErr(e); vRender(); }
  },
});
document.addEventListener('keydown', (e) => {
  if (!S.voice.on) return;
  if (e.key === 'Escape') voiceClose();
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable);
  if (e.key === ' ' && !typing) { e.preventDefault(); vStopTalk(); }
  if ((e.key === 'm' || e.key === 'M') && !typing && !e.metaKey && !e.ctrlKey) actions['vx-mute']();
});
