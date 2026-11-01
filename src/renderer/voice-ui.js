'use strict';
/* Voice: dictation (mic button) and voice mode — a live spoken conversation with local Whisper (speech to
   text) and Piper (text to speech), voice activity detection, interruption, subtitles, a scene where the AI
   shows images / videos / pages / drawings, and the Fabro propeller that spins with what's happening. */

S.voice = { on: false, phase: 'idle', user: '', ai: '', scene: [], muted: false, level: 0, status: null, installing: null, err: '' };

// ───────────────────────────── microphone + voice activity detection ─────────────────────────────
const Mic = {
  stream: null, ctx: null, proc: null, rec: null, pre: [], speaking: false, voiced: 0, silent: 0, floor: 0.008, onUtterance: null, onLevel: null, sens: 1,
  async start() {
    if (this.stream) return;
    // the audio context is made (and resumed) before the permission prompt, while the click still counts —
    // created after it, some browsers leave it suspended and nothing is ever heard
    this.ctx = new AudioContext(); this.ctx.resume().catch(() => {});
    // the browser's noise suppression erases whispers: off; echo cancellation and gain control stay
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { try { this.ctx.close(); } catch {} this.ctx = null; throw e; }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    src.connect(this.proc); this.proc.connect(mute); mute.connect(this.ctx.destination);
    const frameMs = 2048 / this.ctx.sampleRate * 1000;
    this.proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      this.onLevel && this.onLevel(rms);
      if (S.voice.muted && S.voice.on) return;
      // adaptive threshold: just above the room's noise floor, low enough for a whisper
      const thr = Math.max(0.0045, this.floor * 2.4) * this.sens;
      const copy = new Float32Array(d);
      if (!this.speaking) {
        this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03;
        this.pre.push(copy); if (this.pre.length > 12) this.pre.shift();
        if (rms > thr) { if (++this.voiced >= 4) { this.speaking = true; this.rec = [...this.pre]; this.silent = 0; this.onStart && this.onStart(); } } else this.voiced = 0;
      } else {
        this.rec.push(copy);
        if (rms < thr * 0.65) this.silent += frameMs; else this.silent = 0;
        const dur = this.rec.length * frameMs;
        if (this.silent > (this.endMs || 850) || dur > 30000) {
          this.speaking = false; this.voiced = 0; this.pre = [];
          const chunks = this.rec; this.rec = null;
          // short sounds count too (a pop, a fart): 250 ms is enough
          if (dur - this.silent > 250) this.onUtterance && this.onUtterance(encodeWav(chunks, this.ctx.sampleRate), { chunks, rate: this.ctx.sampleRate, dur: (dur - this.silent) / 1000 });
          else this.onCancel && this.onCancel();
        }
      }
    };
  },
  stop() {
    try { this.proc && (this.proc.onaudioprocess = null); this.ctx && this.ctx.close(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    Object.assign(this, { stream: null, ctx: null, proc: null, rec: null, pre: [], speaking: false, voiced: 0, silent: 0 });
  },
};
// Float32 chunks → 16 kHz mono 16-bit WAV.
function encodeWav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / 16000; const len = Math.floor(n / ratio);
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) { const s = all[Math.floor(i * ratio)]; pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff; }
  const buf = new ArrayBuffer(44 + pcm.length * 2); const v = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}
const sttLang = () => { const l = S.settings.language; return l && l !== 'auto' ? l : (S.lang || '').slice(0, 2) || undefined; };

// ───────────────────────────── on the device: Whisper and Piper in the browser ─────────────────────────────
// The app does it itself (VLocal). Inside Fabro Anywhere's frame, the phone around it does it (same engines),
// through api.voice — the frame can't run them.
const vInFrame = () => !!(window.FABRO_REMOTE);
const vLocalOk = () => !vInFrame() && !!window.VLocal;
async function vStt(wav, o = {}) {
  // no graphics card but the computer's own Whisper is installed: it is faster on the processor
  const pyFaster = S.voice.status && S.voice.status.whisperReady && VLocal && VLocal.st.gpu === false;
  if (vLocalOk() && !pyFaster) {
    const tx = await VLocal.hear(wav, { lang: o.lang });
    if (tx != null) return tx;
    // the ears are still downloading: the computer's own Whisper if it was installed, else wait for them
    if (S.voice.status && S.voice.status.whisperReady) { try { return ((await api.voice.stt(wav, o)) || {}).text || ''; } catch {} }
    return VLocal.hear(wav, { lang: o.lang, wait: true });
  }
  return ((await api.voice.stt(wav, { ...o, local: true })) || {}).text || '';
}
// WAV bytes, or { sys: true } when the natural voice isn't there yet (the system voice speaks the piece then)
async function vTts(text, speed) {
  if (vLocalOk()) return (await VLocal.say(text, { lang: sttLang() || 'en', speed })) || { sys: true };
  return api.voice.tts(text, { speed, lang: sttLang() });
}

// ───────────────────────────── speech output ─────────────────────────────
// Each piece of the reply is spoken in its mood (speed, loudness), laughs and sighs included; [son:…] tags play a
// sound effect in its place. When the user talks over it, the voice only gets quieter (ducked) until we know
// whether that was a real interruption.
const Speaker = {
  queue: [], playing: null, gen: 0, analyser: null, actx: null, style: 'neutral', ducked: false, said: [],
  say(text) {
    const { segs, style } = vSegments(String(text), this.style); this.style = style;
    const g = this.gen; const base = (S.voice.status && S.voice.status.speed) || 1;
    for (const sg of segs) {
      if (sg.sfx) { if (VFX.known(sg.sfx)) this.queue.push({ sfx: sg.sfx, text: '' }); continue; }
      const st = V_STYLE[sg.laugh ? 'happy' : sg.style] || V_STYLE.neutral;
      const clean = sg.laugh ? (LAUGH[(sttLang() || 'fr')] || LAUGH.en) : speakable(sg.text); if (!clean) continue;
      const sp = Math.round(base * st.speed * 100) / 100;
      this.queue.push({ text: clean, vol: st.vol, speed: sp, laugh: !!sg.laugh, audio: vTts(clean, sp).catch((e) => { S.voice.err = cleanErr(e); return null; }) });
    }
    if (!this.playing) this.next(g);
  },
  async next(g) {
    const job = this.queue.shift();
    if (!job || g !== this.gen) { this.playing = null; if (g === this.gen && !S.voice.barge) vPhase(S.streaming ? 'thinking' : 'listening'); return; }
    this.playing = job;
    if (job.sfx) { if (!S.voice.barge) vPhase('speaking'); await VFX.play(job.sfx); if (this.playing === job) this.next(g); return; }
    const bytes = await job.audio;
    if (g !== this.gen || !bytes) { this.next(g); return; }
    if (bytes.sys) { // the system voice, while the natural one downloads
      if (!job.laugh) { this.said.push(job.text); if (this.said.length > 40) this.said.shift(); }
      S.voice.ai = job.text; if (!S.voice.barge) vPhase('speaking'); vRenderSubs();
      job.sys = true; await VLocal.sys(job.text, { lang: sttLang() || 'en', rate: job.speed || 1, volume: (job.vol || 1) * (this.ducked ? 0.3 : 1) });
      if (this.playing === job) this.next(g); return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const el = new Audio(url); job.el = el; this.vol(job);
    try {
      this.actx = this.actx || new AudioContext();
      const src = this.actx.createMediaElementSource(el); this.analyser = this.actx.createAnalyser(); this.analyser.fftSize = 256;
      src.connect(this.analyser); this.analyser.connect(this.actx.destination);
    } catch {}
    if (!job.laugh) { this.said.push(job.text); if (this.said.length > 40) this.said.shift(); }
    S.voice.ai = job.text; if (!S.voice.barge) vPhase('speaking'); vRenderSubs();
    el.onended = () => { URL.revokeObjectURL(url); if (this.playing === job) this.next(g); };
    el.onerror = el.onended;
    el.play().catch(() => el.onended());
  },
  vol(job) { if (job && job.el) job.el.volume = Math.max(0, Math.min(1, (job.vol || 1) * (this.ducked ? 0.22 : 1))); },
  duck(on) { this.ducked = !!on; this.vol(this.playing); },
  level() {
    if (this.playing && this.playing.sys) return 0.25 + Math.random() * 0.25;
    if (!this.analyser || !this.playing) return 0;
    const a = new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteTimeDomainData(a);
    let m = 0; for (const x of a) m = Math.max(m, Math.abs(x - 128)); return m / 128;
  },
  // what was said aloud in this answer so far (the sentence being spoken included)
  heard() { return this.said.join(' ').trim(); },
  stop() { this.gen++; this.queue = []; if (this.playing && this.playing.el) { try { this.playing.el.pause(); } catch {} } if (this.playing && this.playing.sys) VLocal.sysStop(); this.playing = null; this.ducked = false; this.style = 'neutral'; },
  busy() { return !!this.playing || this.queue.length > 0; },
};
// Spoken form: no markdown, code, links or artifacts.
function speakable(t) {
  return String(t).replace(/<artifact[\s\S]*?(<\/artifact>|$)/g, ' ').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\[\d+\]/g, '')
    .replace(/^#+\s*/gm, '').replace(/^\s*[-*•]\s+/gm, '').replace(/[*_~>#|]/g, '').replace(/\s+/g, ' ').trim();
}
// Streamed reply → sentences → speech.
let vBuf = '';
function vFeed(text, final) {
  vBuf += text;
  for (;;) {
    // the very first piece goes out as soon as there's a clause (a comma will do): the voice starts sooner
    const first = !Speaker.busy() && !vFeed.started;
    const m = vBuf.match(first ? /^([\s\S]{14,}?[.!?…:;,](?=\s)|[\s\S]{8,}?[.!?…](?=\s|$)|[\s\S]+?\n\n)/ : /^([\s\S]{12,}?[.!?…:;](?=\s|$)|[\s\S]+?\n\n)/);
    if (!m) break;
    Speaker.say(m[1]); vBuf = vBuf.slice(m[1].length); vFeed.started = true;
  }
  if (final) { if (vBuf.trim()) Speaker.say(vBuf); vBuf = ''; vFeed.started = false; }
}

// ───────────────────────────── voice mode ─────────────────────────────
function vPhase(p) { S.voice.phase = p; const el = $('#vx'); if (el) { el.dataset.phase = p; const st = $('#vx-status'); if (st) st.textContent = t('vx_' + p); } }
async function voiceOpen() {
  if (S.voice.on) return;
  S.voice.on = true; S.voice.scene = []; S.voice.user = ''; S.voice.ai = ''; S.voice.err = '';
  try { S.voice.status = await api.voice.status(); } catch { S.voice.status = {}; }
  // everything runs in the browser: nothing to install, the models download in the background the first time
  if (vLocalOk()) { VLocal.st.pref = { ...(S.settings.localVoices || {}) }; VLocal.prepare(sttLang() || 'en'); vWatch(); }
  if (!S.catalog && !vInFrame()) api.models.catalog().then((c) => { S.catalog = c; if (S.voice.on) vRender(); }).catch(() => {});
  vRender();
  vStartListening();
}
async function vStartListening() {
  try {
    Mic.sens = 1; Mic.endMs = 620;
    // talking over the AI doesn't cut it: its voice gets quieter while we find out what that was (vHeard)
    Mic.onStart = () => {
      if (Speaker.busy() || S.streaming) { S.voice.barge = { at: Date.now() }; Speaker.duck(true); Mic.endMs = 520; }
      vPhase('hearing');
    };
    Mic.onCancel = () => { if (S.voice.barge) { S.voice.barge = null; Speaker.duck(false); Mic.endMs = 620; } vPhase(Speaker.busy() ? 'speaking' : S.streaming ? 'thinking' : 'listening'); };
    Mic.onUtterance = vHeard;
    Mic.onLevel = (l) => { S.voice.level = l; };
    await Mic.start();
    vPhase('listening'); vSpin();
  } catch (e) { S.voice.err = micErrText(e); vRender(); }
}
// Why the microphone didn't start, in words the user can act on.
function micErrText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return t('vx_micDenied');
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return t('vx_micNone');
  if (n === 'NotReadableError') return t('vx_micBusy');
  return t('vx_micErr');
}
function vInterrupt() {
  Speaker.stop(); vBuf = ''; vFeed.started = false;
  if (S.streaming) { api.chat.abort(S.streaming.reqId); }
}
// A real interruption: stop where we were, keep in the conversation only what was actually said aloud.
async function vCut() {
  const heard = Speaker.heard();
  const m = (S.streaming && S.streaming.msg) || (S.conv && [...S.conv.messages].reverse().find((x) => x.role === 'assistant'));
  vInterrupt();
  for (let i = 0; i < 40 && S.streaming; i++) await new Promise((r) => setTimeout(r, 50)); // the aborted turn settles
  if (m && heard && speakable(vStripTags(m.content || '')).length > heard.length + 8) {
    m.content = heard + ' …'; m.cutoff = true;
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
async function vHeard(wav, info) {
  const barge = S.voice.barge; S.voice.barge = null; Mic.endMs = 620;
  if (!barge) vPhase('transcribing');
  try {
    const last = S.conv && [...S.conv.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    const pr = vStt(wav, { lang: sttLang(), prompt: last ? speakable(vStripTags(last.content)).slice(-180) : '', fast: true });
    let feat = null; try { feat = info ? VEar.analyse(info.chunks, info.rate) : null; } catch {} // while Whisper works
    let text = String((await pr) || '').trim();
    const noise = !text || NOISE_TEXT.test(text);
    const tags = feat ? VEar.tags(feat, noise ? '' : text) : [];
    if (noise) text = '';
    // over the AI's voice: carry on (an "mh", a laugh, its own echo), or turn to what was just said
    if (barge && (Speaker.busy() || S.streaming)) {
      if ((!text && !tags.some((x) => !x.startsWith('voice:'))) || vEcho(text) || vRefereeKeepTalking(text, tags, info ? info.dur : 1)) {
        Speaker.duck(false); vPhase(Speaker.busy() ? 'speaking' : 'thinking'); return;
      }
    }
    if (!text) {
      const snd = tags.find((x) => !x.startsWith('voice:'));
      if (!snd) { Speaker.duck(false); vPhase(Speaker.busy() ? 'speaking' : 'listening'); return; }
      text = (V_SOUNDS[sttLang()] || V_SOUNDS.en)[snd] || '*' + snd + '*';
    }
    const cut = barge ? await vCut() : '';
    S.voice.user = text; S.voice.ai = ''; vRenderSubs();
    if (S.mode !== 'chat') { S.mode = 'chat'; renderSidebar(); }
    for (let i = 0; i < 40 && S.streaming; i++) await new Promise((r2) => setTimeout(r2, 50)); // aborted turn settling
    Speaker.said = []; vPhase('thinking');
    sendPrompt(text, { voice: true, cues: tags, cut });
  } catch (e) { Speaker.duck(false); S.voice.err = cleanErr(e); vRender(); vPhase('listening'); }
}
// The model of voice mode: small and very fast. Automatic: if the chosen model runs on this computer and a much
// smaller one is installed (from about 1 GB — below that they understand too little), that one answers.
function voiceModel() {
  const pref = S.settings.voiceModel || 'auto';
  if (pref === 'same') return null;
  if (pref !== 'auto') return allModels().find((m) => refKey(m.ref) === pref) || null;
  const cur = currentModel(); if (!cur || cur.ref.backend !== 'local') return null;
  const size = (m) => { const x = S.installed.local.find((l) => l.id === m.ref.id); return x ? x.sizeBytes || 0 : 0; };
  const small = allModels().filter((m) => m.ref.backend === 'local' && size(m) > 0.9e9 && size(m) < 5.6e9).sort((a, b) => size(a) - size(b))[0];
  return small && size(small) * 1.6 < size(cur) ? small : null;
}
function voiceClose() {
  S.voice.on = false; S.voice.barge = null; Mic.stop(); Speaker.stop(); Speaker.said = []; vBuf = ''; vFeed.started = false;
  cancelAnimationFrame(vSpin.raf); vSpin.raf = 0;
  const el = $('#vx'); if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 260); }
  refreshComposer && refreshComposer();
}
// The propeller: slow when listening, faster while thinking, fastest — and pulsing — while speaking.
function vSpin() {
  if (vSpin.raf) return;
  let a = 0, last = performance.now(), sp = 30;
  const tick = (now) => {
    const dt = (now - last) / 1000; last = now;
    const p = S.voice.phase; const lv = Speaker.level();
    const target = p === 'speaking' ? 320 + lv * 900 : p === 'thinking' || p === 'transcribing' ? 200 : p === 'hearing' ? 70 + S.voice.level * 2000 : 26;
    sp += (target - sp) * Math.min(1, dt * 4); a = (a + sp * dt) % 360;
    const m = $('#vx-mark');
    if (m) { m.style.transform = `rotate(${a}deg) scale(${1 + (p === 'speaking' ? lv * 0.18 : p === 'hearing' ? Math.min(0.15, S.voice.level * 3) : 0)})`; }
    const ring = $('#vx-ring'); if (ring) ring.style.setProperty('--lv', String(p === 'hearing' ? Math.min(1, S.voice.level * 12) : p === 'speaking' ? lv : 0));
    vSpin.raf = requestAnimationFrame(tick);
  };
  vSpin.raf = requestAnimationFrame(tick);
}
function vRenderSubs() { const u = $('#vx-user'), a = $('#vx-ai'); if (u) u.textContent = S.voice.user; if (a) a.textContent = S.voice.ai; }
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
  const l = (sttLang() || 'en').slice(0, 2); const list = VLocal.VOICES[l] || []; if (!list.length) return '';
  const cur = VLocal.voiceFor(l);
  return `<select class="input sm2" id="vx-voice" aria-label="${esc(t('vx_voice'))}">${list.map(([id, name, f]) => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(name)} ${f === 'm' ? '♂' : '♀'}${VLocal.st.voices[id] === 'ready' ? '' : ' ↓'}</option>`).join('')}</select>`;
}
// The chat's model runs here and is big, no small one installed: offer the small fast one, in one tap
function vFastHint() {
  if (voiceModel() || (S.settings.voiceModel && S.settings.voiceModel !== 'auto')) return '';
  const cur = currentModel(); if (!cur || cur.ref.backend !== 'local') return '';
  const big = (S.installed.local.find((l) => l.id === cur.ref.id) || {}).sizeBytes || 0; if (big < 6e9) return '';
  const it = S.catalog && S.catalog.items.find((m) => m.id === 'gemma-4-e2b'); if (!it) return '';
  const dl = Object.values(S.downloads || {}).find((d) => d.repo === it.repo && d.status === 'downloading');
  return `<div class="vx-fast">${dl ? esc(t('vx_fastDl', { p: dl.total ? Math.round(dl.received / dl.total * 100) : 0 })) : `<button class="chip" data-action="dl-catalog" data-id="gemma-4-e2b">⚡ ${esc(t('vx_fast', { m: it.name, s: it.sizeGB }))}</button>`}</div>`;
}
// First use: what is still downloading (the voice, the ears), shown under the status
function vDlText() {
  if (!vLocalOk()) return '';
  const p = VLocal.pending(sttLang() || 'en'); if (p == null) return '';
  return t('vx_dl', { p: Math.round(p * 100) });
}
function vWatch() {
  if (vWatch.off) return;
  vWatch.off = VLocal.on(() => { const d = $('#vx-dl'); if (d) d.textContent = vDlText(); });
}
// Which model answers in voice mode: automatic (a small installed one when the chosen model is big), the chat's own, or one picked
function vModelSelect() {
  const pref = S.settings.voiceModel || 'auto'; const auto = voiceModel();
  const opts = allModels().filter((m) => !m.mod).map((m) => `<option value="${esc(refKey(m.ref))}" ${pref === refKey(m.ref) ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  return `<select class="input sm2" id="vx-model" aria-label="${esc(t('vx_model'))}" title="${esc(t('vx_modelHint'))}">
    <option value="auto" ${pref === 'auto' ? 'selected' : ''}>⚡ ${esc(t('vx_modelAuto'))}${pref === 'auto' && auto ? ' · ' + esc(auto.label) : ''}</option>
    <option value="same" ${pref === 'same' ? 'selected' : ''}>${esc(t('vx_modelSame'))}</option><optgroup label="${esc(t('vx_model'))}">${opts}</optgroup></select>`;
}
function vRender() {
  let el = $('#vx');
  const st = { ...(S.voice.status || {}), runtime: true };
  const body = `<div class="vx-scene" id="vx-scene">${vSceneHtml()}</div>
       <div class="vx-center ${S.voice.scene.length ? 'small' : ''}"><div class="vx-ring" id="vx-ring"><span id="vx-mark" class="vx-mark">${logo(S.voice.scene.length ? 64 : 120)}</span></div>
         <div class="vx-status" id="vx-status">${esc(t('vx_' + S.voice.phase))}</div><div class="vx-dl" id="vx-dl">${esc(vDlText())}</div>${vFastHint()}</div>
       <div class="vx-subs"><div class="vx-user" id="vx-user">${esc(S.voice.user)}</div><div class="vx-ai" id="vx-ai">${esc(S.voice.ai)}</div>${S.voice.err ? `<div class="vx-err">${esc(S.voice.err)}</div>` : ''}</div>`;
  const html = `<div class="vx-top"><span class="vx-title">${icon('waveform', 16)} ${esc(t('vx_title'))}</span><span class="grow"></span>
      ${vVoiceSelect()}
      ${vModelSelect()}
      <button class="icon-btn" data-action="vx-close" title="${esc(t('close'))}">${icon('x', 18)}</button></div>
    <div class="vx-body">${body}</div>
    ${st.runtime ? `<div class="vx-ctl">
      <button class="vx-btn ${S.voice.muted ? 'off' : ''}" data-action="vx-mute" title="${esc(t(S.voice.muted ? 'vx_unmute' : 'vx_mute'))}">${icon('mic', 22)}</button>
      <button class="vx-btn" data-action="vx-stop-talk" title="${esc(t('vx_interrupt'))}">${icon('stop', 20)}</button>
      <button class="vx-btn end" data-action="vx-close" title="${esc(t('vx_end'))}">${icon('x', 22)}</button></div>` : ''}`;
  if (!el) { el = document.createElement('div'); el.id = 'vx'; el.className = 'vx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('vx_title')); document.body.appendChild(el); }
  el.dataset.phase = S.voice.phase; el.innerHTML = html;
  const vm = $('#vx-model'); if (vm) vm.addEventListener('change', () => saveSettings({ voiceModel: vm.value }).catch(() => {}));
  const sel = $('#vx-voice'); if (sel) sel.addEventListener('change', async () => {
    const l = (sttLang() || 'en').slice(0, 2);
    if (vLocalOk()) { VLocal.setVoice(l, sel.value); saveSettings({ localVoices: { ...(S.settings.localVoices || {}), [l]: sel.value } }).catch(() => {}); }
    else { try { S.voice.status = await api.voice.setVoice(sel.value); } catch (e) { toast(cleanErr(e), 'err'); } }
  });
}
api.on('deps:progress', ({ dep, p }) => { if (dep === 'voice' && S.voice.installing != null) { S.voice.installing = p; if (S.voice.on) vRender(); } });

// Hook the chat stream: speak the answer, show the scene.
const _onChatEvent = onChatEvent;
onChatEvent = function (ev) {
  const live = S.voice.on && S.streaming && ev.reqId === S.streaming.reqId;
  _onChatEvent(ev);
  if (!live) return;
  if (ev.type === 'token') vFeed(ev.text, false);
  if (ev.type === 'retract') vBuf = vBuf.replace(ev.text, '');
  if (ev.type === 'tool_start' && !S.voice.barge) vPhase('thinking');
  if (ev.type === 'tool_end' && ev.view && ev.view.kind === 'scene') { S.voice.scene = ev.view.items || []; const sc = $('#vx-scene'); if (sc) { vRender(); } }
  if (ev.type === 'done' || ev.type === 'error') { vFeed('', true); if (!Speaker.busy() && !S.voice.barge) vPhase('listening'); if (ev.type === 'error') { S.voice.err = ev.message; vRenderSubs(); } }
};

// ───────────────────────────── dictation (mic button in the composer) ─────────────────────────────
async function dictate(btn) {
  if (S.dictating) { Mic.forceEnd = true; Mic.silent = 99999; return; }
  if (vLocalOk()) VLocal.ears().catch(() => {});
  S.dictating = true; btn.classList.add('rec');
  const done = () => { S.dictating = false; btn.classList.remove('rec'); if (!S.voice.on) Mic.stop(); };
  Mic.sens = 1; Mic.endMs = 1300;
  Mic.onStart = () => btn.classList.add('hot');
  Mic.onCancel = done;
  Mic.onLevel = (l) => btn.style.setProperty('--lv', String(Math.min(1, l * 14)));
  Mic.onUtterance = async (wav) => {
    btn.classList.remove('hot'); btn.classList.add('busy');
    try { const r = { text: await vStt(wav, { lang: sttLang() }) }; const ta = $('#prompt'); if (ta && r.text) { ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + r.text; ta.dispatchEvent(new Event('input')); ta.focus(); } }
    catch (e) { toast(cleanErr(e), 'err'); }
    btn.classList.remove('busy'); done();
  };
  try { await Mic.start(); } catch (e) { toast(micErrText(e), 'err'); done(); }
  setTimeout(() => { if (S.dictating && !Mic.speaking) { done(); } }, 12000);
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
Object.assign(actions, {
  'vx-vocab': () => vocabDialog(),
  'close-modal': () => closeModal(),
  'vx-vocab-save': async () => { const v = $('#vv-in') ? $('#vv-in').value : ''; closeModal(); try { S.voice.status = await api.voice.setVocab(v); toast(t('vx_vocabSaved')); } catch (e) { toast(cleanErr(e), 'err'); } },
  'voice-mode': () => voiceOpen(),
  'dictate': (el) => dictate(el),
  'vx-close': () => voiceClose(),
  'vx-mute': () => { S.voice.muted = !S.voice.muted; vRender(); },
  'vx-stop-talk': () => { vCut(); vPhase('listening'); },
  'vx-install': async () => {
    S.voice.installing = 0; S.voice.err = ''; vRender();
    try { S.voice.status = await api.voice.install(); S.voice.installing = null; vRender(); vStartListening(); }
    catch (e) { S.voice.installing = null; S.voice.err = cleanErr(e); vRender(); }
  },
});
document.addEventListener('keydown', (e) => { if (S.voice.on && e.key === 'Escape') voiceClose(); if (S.voice.on && e.key === ' ' && e.target === document.body) { e.preventDefault(); vInterrupt(); vPhase('listening'); } });
