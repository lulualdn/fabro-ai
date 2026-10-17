'use strict';
/* Voice: dictation in the composer and the real-time voice mode (speak ↔ listen, subtitles,
   interruption, voice choice, a "scene" where Fabro shows images, videos, pages and drawings while it
   talks, and the propeller that spins faster when Fabro speaks). STT = Whisper, TTS = Piper, local. */

S.voice = { on: false, phase: 'idle', user: '', ai: '', scene: [], level: 0, muted: false, status: null, installing: null };

// ───────────────────────────── audio helpers ─────────────────────────────
function wavFromFloat(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44; for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return buf;
}
const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); };

// Microphone with a small energy VAD. onUtterance(wavArrayBuffer) when a phrase ends.
class Mic {
  constructor({ onUtterance, onLevel, onStart, continuous }) { Object.assign(this, { onUtterance, onLevel, onStart, continuous }); this.floor = 0.006; }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(1024, 1, 1);
    this.pre = []; this.rec = null; this.loud = 0; this.quiet = 0;
    this.node.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      const r = rms(d);
      this.onLevel && this.onLevel(r);
      if (this.paused) return;
      if (!this.continuous) { (this.rec ||= []).push(d); return; } // dictation: record everything
      const thr = Math.max(0.012, this.floor * 3) * (this.bargeIn ? 2.6 : 1);
      if (!this.rec) {
        this.pre.push(d); if (this.pre.length > 6) this.pre.shift();
        if (r > thr) { if (++this.loud >= 3) { this.rec = [...this.pre]; this.quiet = 0; this.onStart && this.onStart(); } }
        else { this.loud = 0; this.floor = this.floor * 0.97 + r * 0.03; }
      } else {
        this.rec.push(d);
        this.quiet = r < thr * 0.8 ? this.quiet + 1 : 0;
        const secs = this.rec.length * 1024 / 16000;
        if (this.quiet > 14 || secs > 30) { const chunks = this.rec; this.rec = null; this.loud = 0; if (secs > 0.5) this.onUtterance(wavFromFloat(chunks, 16000)); }
      }
    };
    src.connect(this.node); this.node.connect(this.ctx.destination);
  }
  finish() { const c = this.rec || []; this.rec = null; return c.length ? wavFromFloat(c, 16000) : null; }
  stop() { try { this.node.disconnect(); } catch {} try { this.ctx.close(); } catch {} (this.stream && this.stream.getTracks() || []).forEach((t) => t.stop()); }
}

// ───────────────────────────── dictation (composer mic) ─────────────────────────────
let dict = null;
async function toggleDictation(btn) {
  if (dict) {
    const m = dict; dict = null; btn.classList.remove('rec');
    const wav = m.finish(); m.stop();
    if (!wav) return;
    btn.classList.add('busy');
    try {
      const r = await api.voice.stt(wav, { lang: S.lang });
      const ta = $('#prompt');
      if (ta && r.text) { ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + r.text; ta.dispatchEvent(new Event('input')); ta.focus(); }
    } catch (e) { toast(cleanErr(e), 'err'); }
    btn.classList.remove('busy');
    return;
  }
  if (!(await voiceReady())) return;
  dict = new Mic({ continuous: false, onLevel: (r) => btn.style.setProperty('--lvl', Math.min(1, r * 12).toFixed(2)) });
  try { await dict.start(); btn.classList.add('rec'); } catch (e) { dict = null; toast(t('vo_micDenied'), 'err'); }
}
async function voiceReady() {
  S.voice.status = await api.voice.status();
  if (S.voice.status.runtime) return true;
  openVoice(); // shows the install card
  return false;
}

// ───────────────────────────── voice mode ─────────────────────────────
let mic = null, rafV = 0, playCtx = null, playAn = null;
const speakQ = []; let speaking = null, ttsBusy = false, sentBuf = '', voiceReq = null;

async function openVoice() {
  S.voice.on = true; S.voice.phase = 'idle'; S.voice.user = ''; S.voice.ai = ''; S.voice.scene = [];
  S.voice.status = S.voice.status || await api.voice.status();
  renderVoice();
  if (!S.voice.status.runtime) return;
  await startListening();
}
async function startListening() {
  if (mic) return;
  mic = new Mic({
    continuous: true,
    onLevel: (r) => { S.voice.micLevel = r; },
    onStart: () => { if (speaking || ttsBusy || (S.streaming && voiceReq === S.streaming.reqId)) interruptVoice(); setPhase('hearing'); },
    onUtterance: async (wav) => {
      setPhase('thinking');
      try {
        const r = await api.voice.stt(wav, { lang: S.settings.voice && S.settings.voice.lang || S.lang });
        const text = (r.text || '').trim();
        if (!text || /^(\W|merci\.?|thank you\.?|sous-titr)/i.test(text) && text.length < 12) { setPhase('listening'); return; }
        S.voice.user = text; S.voice.ai = ''; renderVoiceSubs();
        sendVoice(text);
      } catch (e) { toast(cleanErr(e), 'err'); setPhase('listening'); }
    },
  });
  try { await mic.start(); setPhase('listening'); } catch { mic = null; toast(t('vo_micDenied'), 'err'); setPhase('idle'); }
  loopVoice();
}
function closeVoice() {
  interruptVoice();
  if (mic) { mic.stop(); mic = null; }
  cancelAnimationFrame(rafV); S.voice.on = false;
  $('#overlay-root').innerHTML = '';
  if (S.conv && S.mode === 'chat') renderView();
}
function setPhase(p) { S.voice.phase = p; const el = $('.vo'); if (el) el.dataset.phase = p; if (mic) mic.bargeIn = p === 'speaking'; const st = $('.vo-state'); if (st) st.textContent = t('vo_' + p); }

function sendVoice(text) {
  if (S.mode !== 'chat') { S.mode = 'chat'; }
  if (S.conv && S.conv.code) S.conv = null;
  if (!S.conv) { S.conv = newConv(); S.conv.voice = true; }
  sentBuf = '';
  sendPrompt(text, { voice: true });
  voiceReq = S.streaming && S.streaming.reqId;
}
function interruptVoice() {
  speakQ.length = 0; sentBuf = '';
  if (speaking) { try { speaking.pause(); } catch {} speaking = null; }
  if (S.streaming && voiceReq === S.streaming.reqId) api.chat.abort(voiceReq);
  voiceReq = null;
}

// Stream → sentences → TTS queue.
const plain = (s) => s.replace(/```[\s\S]*?```/g, ' ').replace(/<artifact[\s\S]*?(<\/artifact>|$)/g, ' ').replace(/[*_#>`|]+/g, '').replace(/\[(\d+)\]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
function voiceToken(text) {
  sentBuf += text;
  S.voice.ai += text; renderVoiceSubs();
  let m;
  while ((m = sentBuf.match(/^([\s\S]{12,}?[.!?…:;](?=\s)|[\s\S]+?\n\n)/))) { const s = plain(m[1]); sentBuf = sentBuf.slice(m[1].length); if (s) speak(s); }
}
function voiceDone() { const s = plain(sentBuf); sentBuf = ''; if (s) speak(s); if (!speakQ.length && !speaking && !ttsBusy) setPhase('listening'); }
function speak(sentence) { speakQ.push({ text: sentence, audio: null }); pumpSpeak(); }
async function pumpSpeak() {
  // prefetch: synthesize the next sentences while the current one plays
  for (const it of speakQ) if (!it.audio && !it.loading) {
    it.loading = true; ttsBusy = true;
    api.voice.tts(it.text).then((u8) => { it.audio = URL.createObjectURL(new Blob([u8], { type: 'audio/wav' })); ttsBusy = speakQ.some((x) => x.loading && !x.audio); pumpSpeak(); })
      .catch((e) => { it.failed = true; ttsBusy = false; toast(cleanErr(e), 'err'); pumpSpeak(); });
    break;
  }
  if (speaking || !speakQ.length) return;
  const it = speakQ[0];
  if (it.failed) { speakQ.shift(); return pumpSpeak(); }
  if (!it.audio) return;
  speakQ.shift();
  const a = new Audio(it.audio);
  speaking = a;
  try {
    playCtx ||= new AudioContext(); playAn ||= (() => { const an = playCtx.createAnalyser(); an.fftSize = 512; an.connect(playCtx.destination); return an; })();
    playCtx.createMediaElementSource(a).connect(playAn);
  } catch {}
  setPhase('speaking');
  a.onended = a.onerror = () => { URL.revokeObjectURL(it.audio); if (speaking === a) speaking = null; if (!speakQ.length && !(S.streaming && voiceReq === S.streaming.reqId)) setPhase('listening'); pumpSpeak(); };
  a.play().catch(() => { speaking = null; pumpSpeak(); });
}

// Hook into the chat stream.
const _onChatEvent = onChatEvent;
onChatEvent = function (ev) { // eslint-disable-line no-global-assign
  const mine = S.voice.on && voiceReq && ev.reqId === voiceReq;
  _onChatEvent(ev);
  if (!mine) return;
  if (ev.type === 'token') voiceToken(ev.text);
  if (ev.type === 'retract') { S.voice.ai = S.voice.ai.replace(ev.text, ''); }
  if (ev.type === 'tool_start') { setPhase('thinking'); }
  if (ev.type === 'tool_end' && ev.view && ev.view.kind === 'scene') { S.voice.scene = ev.view.items || []; renderVoiceScene(); }
  if (ev.type === 'done' || ev.type === 'error') { voiceDone(); voiceReq = null; }
};

// Propeller: slow when listening, medium when thinking, fast when speaking (with the voice level).
function loopVoice() {
  cancelAnimationFrame(rafV);
  let angle = 0, last = performance.now();
  const data = new Uint8Array(256);
  const tick = (now) => {
    const dt = Math.min(64, now - last) / 1000; last = now;
    let lvl = 0;
    if (speaking && playAn) { playAn.getByteTimeDomainData(data); let s = 0; for (const x of data) s += ((x - 128) / 128) ** 2; lvl = Math.sqrt(s / data.length) * 4; }
    else if (S.voice.phase === 'hearing') lvl = Math.min(1, (S.voice.micLevel || 0) * 10);
    S.voice.level = S.voice.level * 0.8 + Math.min(1, lvl) * 0.2;
    const speed = { idle: 20, listening: 30, hearing: 70, thinking: 220, speaking: 420 }[S.voice.phase] || 30;
    angle = (angle + dt * (speed + S.voice.level * 600)) % 360;
    const el = $('.vo-prop');
    if (el) { el.style.transform = `rotate(${angle}deg) scale(${1 + S.voice.level * 0.12})`; el.parentElement.style.setProperty('--glow', (0.25 + S.voice.level).toFixed(2)); }
    if (S.voice.on) rafV = requestAnimationFrame(tick);
  };
  rafV = requestAnimationFrame(tick);
}

function renderVoice() {
  const st = S.voice.status || {};
  const vs = (st.voices || []).filter((v) => v.lang === (S.lang || 'en').slice(0, 2));
  const cur = (S.settings.voice || {}).voice;
  $('#overlay-root').innerHTML = `<div class="vo" data-phase="${S.voice.phase}" role="dialog" aria-label="${esc(t('vo_title'))}">
    <div class="vo-top"><span class="vo-badge">${icon('waveform', 15)} ${esc(t('vo_title'))}</span><span class="grow"></span>
      ${st.runtime ? `<select class="vo-voice" data-voice-pick aria-label="${esc(t('vo_voice'))}">${vs.map((v) => `<option value="${v.id}" ${v.id === cur ? 'selected' : ''}>${esc(v.name)}${v.installed ? '' : ' ↓'}</option>`).join('')}</select>` : ''}
      <button class="icon-btn vo-x" data-action="vo-close" title="${esc(t('close'))}">${icon('x', 20)}</button></div>
    <div class="vo-scene" id="vo-scene"></div>
    <div class="vo-center">
      ${st.runtime ? `<div class="vo-orb"><div class="vo-prop">${logo(118)}</div></div><div class="vo-state" aria-live="polite">${esc(t('vo_' + S.voice.phase))}</div>`
        : `<div class="vo-install">${logo(64)}<h2>${esc(t('vo_installT'))}</h2><p>${esc(t('vo_installB'))}</p>
            ${S.voice.installing != null ? `<div class="bar"><i style="width:${Math.round(S.voice.installing * 100)}%"></i></div><small>${esc(t('deps_installing', { p: Math.round(S.voice.installing * 100) }))}</small>` : `<button class="btn primary lg" data-action="vo-install">${icon('download', 17)} ${esc(t('vo_installGo'))}</button>`}</div>`}
    </div>
    <div class="vo-subs" id="vo-subs"></div>
    ${st.runtime ? `<div class="vo-bar"><button class="vo-btn ${S.voice.muted ? 'off' : ''}" data-action="vo-mute" title="${esc(t(S.voice.muted ? 'vo_unmute' : 'vo_mute'))}">${icon('mic', 22)}</button>
      <button class="vo-btn" data-action="vo-interrupt" title="${esc(t('vo_interrupt'))}">${icon('stop', 20)}</button>
      <button class="vo-btn end" data-action="vo-close" title="${esc(t('vo_end'))}">${icon('x', 22)}</button></div>` : ''}
  </div>`;
  renderVoiceSubs(); renderVoiceScene();
}
function renderVoiceSubs() {
  const el = $('#vo-subs'); if (!el) return;
  const ai = plain(S.voice.ai).split(/(?<=[.!?…])\s/).slice(-2).join(' ');
  el.innerHTML = `${S.voice.user ? `<p class="vo-u">${esc(S.voice.user)}</p>` : ''}${ai ? `<p class="vo-a">${esc(ai)}</p>` : ''}`;
}
function renderVoiceScene() {
  const el = $('#vo-scene'); if (!el) return;
  const items = S.voice.scene || [];
  el.classList.toggle('on', items.length > 0);
  $('.vo') && $('.vo').classList.toggle('with-scene', items.length > 0);
  el.innerHTML = items.map((it, i) => {
    const cap = it.title ? `<figcaption>${esc(it.title)}</figcaption>` : '';
    if (it.type === 'image') return `<figure class="vs-img" style="--i:${i}"><img src="${esc(it.url)}" alt="${esc(it.title || '')}" referrerpolicy="no-referrer" onerror="this.closest('figure').remove()">${cap}</figure>`;
    if (it.type === 'video') return `<figure class="vs-web" style="--i:${i}"><iframe src="${esc(it.embed || it.url)}" allow="autoplay; encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>${cap}</figure>`;
    if (it.type === 'web') return `<figure class="vs-web" style="--i:${i}"><iframe src="${esc(it.url)}" sandbox="allow-scripts allow-same-origin"></iframe>${cap}</figure>`;
    if (it.type === 'html' || it.type === 'svg') return `<figure class="vs-web" style="--i:${i}"><iframe sandbox="allow-scripts" srcdoc="${esc(it.type === 'svg' ? `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#fff">${it.content}</body>` : it.content)}"></iframe>${cap}</figure>`;
    return '';
  }).join('');
}

Object.assign(actions, {
  'voice-mode': () => openVoice(),
  'dictate': (el) => toggleDictation(el),
  'vo-close': () => closeVoice(),
  'vo-mute': () => { S.voice.muted = !S.voice.muted; if (mic) mic.paused = S.voice.muted; renderVoice(); },
  'vo-interrupt': () => { interruptVoice(); setPhase('listening'); },
  'vo-install': async () => {
    S.voice.installing = 0; renderVoice();
    try { S.voice.status = await api.voice.install({ lang: (S.lang || 'en').slice(0, 2) }); S.settings = await api.settings.get(); S.voice.installing = null; renderVoice(); startListening(); }
    catch (e) { S.voice.installing = null; toast(cleanErr(e), 'err'); renderVoice(); }
  },
});
api.on('deps:progress', ({ dep, p }) => { if (dep === 'voice' && S.voice.installing != null) { S.voice.installing = p; const b = $('.vo-install .bar i'); if (b) b.style.width = Math.round(p * 100) + '%'; const s = $('.vo-install small'); if (s) s.textContent = t('deps_installing', { p: Math.round(p * 100) }); } });
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-voice-pick]'); if (!sel) return;
  sel.disabled = true;
  try { S.voice.status = await api.voice.setVoice(sel.value); S.settings = await api.settings.get(); } catch (er) { toast(cleanErr(er), 'err'); }
  sel.disabled = false;
});
document.addEventListener('keydown', (e) => { if (S.voice.on && e.key === 'Escape') closeVoice(); });
