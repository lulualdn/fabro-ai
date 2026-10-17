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
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
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
      const thr = Math.max(0.012, this.floor * 3) * this.sens;
      const copy = new Float32Array(d);
      if (!this.speaking) {
        this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03;
        this.pre.push(copy); if (this.pre.length > 10) this.pre.shift();
        if (rms > thr) { if (++this.voiced >= 3) { this.speaking = true; this.rec = [...this.pre]; this.silent = 0; this.onStart && this.onStart(); } } else this.voiced = 0;
      } else {
        this.rec.push(copy);
        if (rms < thr * 0.7) this.silent += frameMs; else this.silent = 0;
        const dur = this.rec.length * frameMs;
        if (this.silent > (this.endMs || 750) || dur > 30000) {
          this.speaking = false; this.voiced = 0; this.pre = [];
          const chunks = this.rec; this.rec = null;
          if (dur - this.silent > 350) this.onUtterance && this.onUtterance(encodeWav(chunks, this.ctx.sampleRate));
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

// ───────────────────────────── speech output ─────────────────────────────
const Speaker = {
  queue: [], playing: null, gen: 0, analyser: null, actx: null,
  say(text) {
    const clean = speakable(text); if (!clean) return;
    const g = this.gen;
    const job = { text: clean, audio: api.voice.tts(clean).catch((e) => { S.voice.err = cleanErr(e); return null; }) };
    this.queue.push(job);
    if (!this.playing) this.next(g);
  },
  async next(g) {
    const job = this.queue.shift();
    if (!job || g !== this.gen) { this.playing = null; if (g === this.gen) vPhase(S.streaming ? 'thinking' : 'listening'); return; }
    this.playing = job;
    const bytes = await job.audio;
    if (g !== this.gen || !bytes) { this.next(g); return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const el = new Audio(url); job.el = el;
    try {
      this.actx = this.actx || new AudioContext();
      const src = this.actx.createMediaElementSource(el); this.analyser = this.actx.createAnalyser(); this.analyser.fftSize = 256;
      src.connect(this.analyser); this.analyser.connect(this.actx.destination);
    } catch {}
    S.voice.ai = job.text; vPhase('speaking'); vRenderSubs();
    el.onended = () => { URL.revokeObjectURL(url); if (this.playing === job) this.next(g); };
    el.onerror = el.onended;
    el.play().catch(() => el.onended());
  },
  level() {
    if (!this.analyser || !this.playing) return 0;
    const a = new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteTimeDomainData(a);
    let m = 0; for (const x of a) m = Math.max(m, Math.abs(x - 128)); return m / 128;
  },
  stop() { this.gen++; this.queue = []; if (this.playing && this.playing.el) { try { this.playing.el.pause(); } catch {} } this.playing = null; },
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
    const m = vBuf.match(/^([\s\S]{12,}?[.!?…:;](?=\s|$)|[\s\S]+?\n\n)/);
    if (!m) break;
    Speaker.say(m[1]); vBuf = vBuf.slice(m[1].length);
  }
  if (final) { if (vBuf.trim()) Speaker.say(vBuf); vBuf = ''; }
}

// ───────────────────────────── voice mode ─────────────────────────────
function vPhase(p) { S.voice.phase = p; const el = $('#vx'); if (el) { el.dataset.phase = p; const st = $('#vx-status'); if (st) st.textContent = t('vx_' + p); } }
async function voiceOpen() {
  if (S.voice.on) return;
  S.voice.on = true; S.voice.scene = []; S.voice.user = ''; S.voice.ai = ''; S.voice.err = '';
  try { S.voice.status = await api.voice.status(); } catch {}
  vRender();
  if (S.voice.status && S.voice.status.runtime) vStartListening();
}
async function vStartListening() {
  try {
    Mic.sens = 1; Mic.endMs = 750;
    Mic.onStart = () => { if (Speaker.busy() || S.streaming) vInterrupt(); vPhase('hearing'); };
    Mic.onCancel = () => vPhase(Speaker.busy() ? 'speaking' : S.streaming ? 'thinking' : 'listening');
    Mic.onUtterance = vHeard;
    Mic.onLevel = (l) => { S.voice.level = l; };
    await Mic.start();
    vPhase('listening'); vSpin();
  } catch (e) { S.voice.err = t('vx_micErr'); vRender(); }
}
function vInterrupt() {
  Speaker.stop(); vBuf = '';
  if (S.streaming) { api.chat.abort(S.streaming.reqId); }
}
async function vHeard(wav) {
  vPhase('transcribing');
  try {
    const last = S.conv && [...S.conv.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    const r = await api.voice.stt(wav, { lang: sttLang(), prompt: last ? speakable(last.content).slice(-180) : '' });
    const text = (r.text || '').trim();
    if (!text || /^[.…\s]*$/.test(text)) { vPhase('listening'); return; }
    S.voice.user = text; S.voice.ai = ''; vRenderSubs();
    if (S.mode !== 'chat') { S.mode = 'chat'; renderSidebar(); }
    for (let i = 0; i < 40 && S.streaming; i++) await new Promise((r2) => setTimeout(r2, 50)); // aborted turn settling
    vPhase('thinking');
    sendPrompt(text, { voice: true });
  } catch (e) { S.voice.err = cleanErr(e); vRender(); vPhase('listening'); }
}
function voiceClose() {
  S.voice.on = false; Mic.stop(); Speaker.stop(); vBuf = '';
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
function vRender() {
  let el = $('#vx');
  const st = S.voice.status || {};
  const voices = (st.voices || []).filter((v) => v.lang === (sttLang() || 'en'));
  const body = !st.runtime ? `<div class="vx-install">
      <h2>${esc(t('vx_installT'))}</h2><p>${esc(t('vx_installB'))}</p>
      ${S.voice.installing != null ? `<div class="bar"><i style="width:${Math.round(S.voice.installing * 100)}%"></i></div><small class="muted">${esc(t('deps_installing', { p: Math.round(S.voice.installing * 100) }))}</small>`
        : `<button class="btn primary lg" data-action="vx-install">${icon('download', 16)} ${esc(t('vx_install'))}</button>`}
      ${S.voice.err ? `<div class="pf-error">${icon('warning', 14)} ${esc(S.voice.err)}</div>` : ''}</div>`
    : `<div class="vx-scene" id="vx-scene">${vSceneHtml()}</div>
       <div class="vx-center ${S.voice.scene.length ? 'small' : ''}"><div class="vx-ring" id="vx-ring"><span id="vx-mark" class="vx-mark">${logo(S.voice.scene.length ? 64 : 120)}</span></div>
         <div class="vx-status" id="vx-status">${esc(t('vx_' + S.voice.phase))}</div></div>
       <div class="vx-subs"><div class="vx-user" id="vx-user">${esc(S.voice.user)}</div><div class="vx-ai" id="vx-ai">${esc(S.voice.ai)}</div>${S.voice.err ? `<div class="vx-err">${esc(S.voice.err)}</div>` : ''}</div>`;
  const html = `<div class="vx-top"><span class="vx-title">${icon('waveform', 16)} ${esc(t('vx_title'))}</span><span class="grow"></span>
      ${st.runtime && voices.length ? `<select class="input sm2" id="vx-voice" aria-label="${esc(t('vx_voice'))}">${voices.map((v) => `<option value="${esc(v.id)}" ${st.voice === v.id ? 'selected' : ''}>${esc(v.name)}${v.installed ? '' : ' ↓'}</option>`).join('')}</select>` : ''}
      <button class="icon-btn" data-action="vx-close" title="${esc(t('close'))}">${icon('x', 18)}</button></div>
    <div class="vx-body">${body}</div>
    ${st.runtime ? `<div class="vx-ctl">
      <button class="vx-btn ${S.voice.muted ? 'off' : ''}" data-action="vx-mute" title="${esc(t(S.voice.muted ? 'vx_unmute' : 'vx_mute'))}">${icon('mic', 22)}</button>
      <button class="vx-btn" data-action="vx-stop-talk" title="${esc(t('vx_interrupt'))}">${icon('stop', 20)}</button>
      <button class="vx-btn end" data-action="vx-close" title="${esc(t('vx_end'))}">${icon('x', 22)}</button></div>` : ''}`;
  if (!el) { el = document.createElement('div'); el.id = 'vx'; el.className = 'vx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('vx_title')); document.body.appendChild(el); }
  el.dataset.phase = S.voice.phase; el.innerHTML = html;
  const sel = $('#vx-voice'); if (sel) sel.addEventListener('change', async () => { try { S.voice.status = await api.voice.setVoice(sel.value); } catch (e) { toast(cleanErr(e), 'err'); } });
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
  if (ev.type === 'tool_start') vPhase('thinking');
  if (ev.type === 'tool_end' && ev.view && ev.view.kind === 'scene') { S.voice.scene = ev.view.items || []; const sc = $('#vx-scene'); if (sc) { vRender(); } }
  if (ev.type === 'done' || ev.type === 'error') { vFeed('', true); if (!Speaker.busy()) vPhase('listening'); if (ev.type === 'error') { S.voice.err = ev.message; vRenderSubs(); } }
};

// ───────────────────────────── dictation (mic button in the composer) ─────────────────────────────
async function dictate(btn) {
  if (S.dictating) { Mic.forceEnd = true; Mic.silent = 99999; return; }
  try { const st = await api.voice.status(); if (!st.runtime) { voiceOpen(); return; } } catch {}
  S.dictating = true; btn.classList.add('rec');
  const done = () => { S.dictating = false; btn.classList.remove('rec'); if (!S.voice.on) Mic.stop(); };
  Mic.sens = 1; Mic.endMs = 1300;
  Mic.onStart = () => btn.classList.add('hot');
  Mic.onCancel = done;
  Mic.onLevel = (l) => btn.style.setProperty('--lv', String(Math.min(1, l * 14)));
  Mic.onUtterance = async (wav) => {
    btn.classList.remove('hot'); btn.classList.add('busy');
    try { const r = await api.voice.stt(wav, { lang: sttLang() }); const ta = $('#prompt'); if (ta && r.text) { ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + r.text; ta.dispatchEvent(new Event('input')); ta.focus(); } }
    catch (e) { toast(cleanErr(e), 'err'); }
    btn.classList.remove('busy'); done();
  };
  try { await Mic.start(); } catch { toast(t('vx_micErr'), 'err'); done(); }
  setTimeout(() => { if (S.dictating && !Mic.speaking) { done(); } }, 12000);
}

Object.assign(actions, {
  'voice-mode': () => voiceOpen(),
  'dictate': (el) => dictate(el),
  'vx-close': () => voiceClose(),
  'vx-mute': () => { S.voice.muted = !S.voice.muted; vRender(); },
  'vx-stop-talk': () => { vInterrupt(); vPhase('listening'); },
  'vx-install': async () => {
    S.voice.installing = 0; S.voice.err = ''; vRender();
    try { S.voice.status = await api.voice.install(); S.voice.installing = null; vRender(); vStartListening(); }
    catch (e) { S.voice.installing = null; S.voice.err = cleanErr(e); vRender(); }
  },
});
document.addEventListener('keydown', (e) => { if (S.voice.on && e.key === 'Escape') voiceClose(); if (S.voice.on && e.key === ' ' && e.target === document.body) { e.preventDefault(); vInterrupt(); vPhase('listening'); } });
