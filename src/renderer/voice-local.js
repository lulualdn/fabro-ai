'use strict';
/* Fabro — voice on the device itself, in the browser (the app, and Fabro Anywhere on the phone): nothing to
   install, nothing sent anywhere.
   - Ears: Whisper through transformers.js (voice-stt-worker.js), WebGPU when there is one (then a bigger,
     more accurate model is fetched in the background), WebAssembly otherwise.
   - Mouth: Piper voices (voice-tts-worker.js), one per language, each sentence in its own language.
   - Until a voice is downloaded the system's own voice speaks (speechSynthesis): it talks from the first second.
   Models are downloaded once and kept by the browser. */
(function () {
  const here = (() => { try { const s = document.currentScript && document.currentScript.src; return s ? s.slice(0, s.lastIndexOf('/') + 1) : ''; } catch { return ''; } })();
  // a few natural voices per language: [Piper id, name, f/m]
  const VOICES = {
    fr: [['fr_FR-siwis-medium', 'Siwis', 'f'], ['fr_FR-tom-medium', 'Tom', 'm'], ['fr_FR-upmc-medium', 'Jessica', 'f']],
    en: [['en_US-amy-medium', 'Amy', 'f'], ['en_US-ryan-medium', 'Ryan', 'm'], ['en_GB-alba-medium', 'Alba', 'f'], ['en_US-lessac-medium', 'Lessac', 'f']],
    es: [['es_ES-sharvard-medium', 'Sharvard', 'm'], ['es_MX-claude-high', 'Claude', 'f'], ['es_ES-davefx-medium', 'Davefx', 'm']],
    de: [['de_DE-thorsten-medium', 'Thorsten', 'm'], ['de_DE-kerstin-low', 'Kerstin', 'f']],
    it: [['it_IT-riccardo-x_low', 'Riccardo', 'm']],
    pt: [['pt_BR-faber-medium', 'Faber', 'm'], ['pt_PT-tugão-medium', 'Tugão', 'm']],
    nl: [['nl_NL-mls-medium', 'MLS', 'f']], pl: [['pl_PL-gosia-medium', 'Gosia', 'f']], ru: [['ru_RU-irina-medium', 'Irina', 'f']],
    uk: [['uk_UA-ukrainian_tts-medium', 'Lada', 'f']], tr: [['tr_TR-fahrettin-medium', 'Fahrettin', 'm']], zh: [['zh_CN-huayan-medium', 'Huayan', 'f']],
  };
  // with a graphics card: Kokoro, the most natural voices (lively intonation), still faster than speech
  const KOKORO = {
    fr: [['kokoro:ff_siwis', 'Siwis HD', 'f']],
    en: [['kokoro:af_heart', 'Heart HD', 'f'], ['kokoro:af_bella', 'Bella HD', 'f'], ['kokoro:am_michael', 'Michael HD', 'm'], ['kokoro:bf_emma', 'Emma HD', 'f']],
    es: [['kokoro:ef_dora', 'Dora HD', 'f'], ['kokoro:em_alex', 'Alex HD', 'm']],
    it: [['kokoro:if_sara', 'Sara HD', 'f'], ['kokoro:im_nicola', 'Nicola HD', 'm']],
    pt: [['kokoro:pf_dora', 'Dora HD', 'f'], ['kokoro:pm_alex', 'Alex HD', 'm']],
  };
  const EARS = { small: 'onnx-community/whisper-base', big: 'onnx-community/whisper-small' };
  const LOCALE = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', nl: 'nl-NL', pl: 'pl-PL', ru: 'ru-RU', ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR', tr: 'tr-TR', uk: 'uk-UA' };

  const st = { voices: {}, ears: null, earsModel: '', earsP: 0, gpu: null, pref: {} }; // voices: id → 'ready' | progress 0..1 | 'error'
  const subs = new Set(); const emit = () => subs.forEach((f) => { try { f(st); } catch {} });

  // ── workers ──
  function worker(file) {
    let w = null, n = 0; const waits = new Map(); const prog = new Map();
    const get = () => {
      if (w) return w;
      w = new Worker(here + file, { type: 'module' });
      w.onmessage = (e) => { const m = e.data || {}; if (m.t === 'progress') { const f = prog.get(m.id); f && f(m.p, m.what || m.file); return; } const p = waits.get(m.id); if (!p) return; waits.delete(m.id); prog.delete(m.id); m.t === 'error' ? p.rej(new Error(m.error)) : p.res(m); };
      w.onerror = (e) => { for (const p of waits.values()) p.rej(new Error(e.message || 'worker')); waits.clear(); w = null; };
      return w;
    };
    return (msg, onP, transfer) => new Promise((res, rej) => { const id = ++n; waits.set(id, { res, rej }); if (onP) prog.set(id, onP); get().postMessage({ ...msg, id }, transfer || []); });
  }
  const tts = worker('voice-tts-worker.js'), stt = worker('voice-stt-worker.js');

  async function gpu() {
    if (st.gpu != null) return st.gpu;
    try { st.gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { st.gpu = false; }
    return st.gpu;
  }

  // ── mouth ──
  const base = (l) => String(l || 'en').slice(0, 2).toLowerCase();
  // phones: the lighter version of a voice (twice as fast, still natural)
  const phone = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent || '');
  const LIGHT = { 'fr_FR-siwis-medium': 'fr_FR-siwis-low', 'en_US-amy-medium': 'en_US-amy-low', 'en_US-ryan-medium': 'en_US-ryan-low', 'en_US-lessac-medium': 'en_US-lessac-low', 'de_DE-thorsten-medium': 'de_DE-thorsten-low' };
  const voicesOf = (l) => [...(st.gpu && !phone ? KOKORO[l] || [] : []), ...(VOICES[l] || [])];
  function voiceFor(lang) { const l = base(lang); const list = voicesOf(l); if (!list.length) return null; const p = st.pref[l]; const id = (p && list.find((v) => v[0] === p)) ? p : list[0][0]; return phone && LIGHT[id] ? LIGHT[id] : id; }
  function loadVoice(id) {
    if (!id || st.voices[id] === 'ready' || typeof st.voices[id] === 'number') return;
    st.voices[id] = 0; emit();
    tts({ t: 'load', voice: id }, (p) => { st.voices[id] = p; emit(); }).then(() => { st.voices[id] = 'ready'; emit(); }, () => {
      st.voices[id] = 'error'; emit();
      // Kokoro couldn't start (graphics card refused): the light voice of the same language takes over
      if (id.startsWith('kokoro:')) { const l = Object.keys(KOKORO).find((k) => KOKORO[k].some((v) => v[0] === id)); const alt = l && VOICES[l] && VOICES[l][0][0]; if (alt) { if (st.pref[l] === id) delete st.pref[l]; KOKORO[l] = KOKORO[l].filter((v) => v[0] !== id); loadVoice(alt); } }
    });
  }
  // the voice for this text, as WAV bytes — or null while it is still downloading (the system voice speaks then)
  async function say(text, { lang = 'en', speed = 1 } = {}) {
    // the user's language first: another one only for a real sentence in it, with its voice already here
    // (never a 60 MB download in the middle of a conversation for one English word)
    const u = base(lang); let id = voiceFor(u);
    if (window.FALang && (String(text).match(/\S+/g) || []).length >= 6) { const o = FALang.detect(text, u); const oid = o !== u && voiceFor(o); if (oid && st.voices[oid] === 'ready') id = oid; }
    if (!id) return null;
    if (st.voices[id] !== 'ready') { loadVoice(id); return null; }
    try { return (await tts({ t: 'tts', voice: id, text, speed })).wav; } catch { return null; }
  }
  // the system's own voice: instant, while the natural one downloads
  let sysVoices = []; const loadSys = () => { try { sysVoices = speechSynthesis.getVoices() || []; } catch {} };
  if ('speechSynthesis' in window) { loadSys(); speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', loadSys); }
  function sysVoice(lang) {
    const l = base(lang); let best = null, bs = -1;
    for (const v of sysVoices) { const vl = String(v.lang || '').toLowerCase(); if (!vl.startsWith(l)) continue; let s = v.localService ? 20 : 0; if (/natural|neural|premium|enhanced|siri/i.test(v.name)) s += 30; if (/google/i.test(v.name)) s += 10; if (/espeak|compact|novelty/i.test(v.name)) s -= 40; if (s > bs) { bs = s; best = v; } }
    return best;
  }
  function sys(text, { lang = 'en', rate = 1, volume = 1, onStart } = {}) {
    if (!('speechSynthesis' in window)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const l = base(lang);
      const u = new SpeechSynthesisUtterance(text); const v = sysVoice(l);
      if (v) u.voice = v; u.lang = v ? v.lang : LOCALE[l] || l; u.rate = rate; u.volume = volume;
      u.onstart = () => onStart && onStart(); u.onend = () => resolve(true); u.onerror = () => resolve(false);
      speechSynthesis.speak(u);
    });
  }
  const sysStop = () => { try { speechSynthesis.cancel(); } catch {} };

  // ── ears ──
  async function loadEars(model) {
    st.ears = st.ears === 'ready' ? 'ready' : 0; emit();
    const dev = (await gpu()) ? 'webgpu' : 'wasm';
    await stt({ t: 'load', model, device: dev }, (p) => { if (st.ears !== 'ready') { st.ears = p; emit(); } });
    st.earsModel = model; st.earsDev = dev; st.ears = 'ready'; emit();
  }
  let earsLoading = null;
  function ears() {
    if (st.ears === 'ready') return Promise.resolve();
    if (!earsLoading) earsLoading = loadEars(EARS.small).then(async () => {
      // a graphics card: the more accurate model comes next, quietly, and takes over once it's there
      if (await gpu()) stt({ t: 'load', model: EARS.big, device: 'webgpu' }).then(() => { st.earsModel = EARS.big; emit(); }, () => {});
    }).catch((e) => { st.ears = 'error'; emit(); earsLoading = null; throw e; });
    return earsLoading;
  }
  // 16-bit WAV → 16 kHz float samples
  function pcm16k(wav) {
    const b = wav instanceof Uint8Array ? wav : new Uint8Array(wav); const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const rate = v.getUint32(24, true); let o = 12, data = 44, len = b.length - 44;
    while (o + 8 <= b.length) { const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), sz = v.getUint32(o + 4, true); if (id === 'data') { data = o + 8; len = Math.min(sz, b.length - data); break; } o += 8 + sz; }
    const n = len >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = v.getInt16(data + i * 2, true) / 32768;
    if (rate === 16000) return x;
    const r = rate / 16000, m = Math.floor(n / r), y = new Float32Array(m); for (let i = 0; i < m; i++) y[i] = x[Math.floor(i * r)]; return y;
  }
  // speech → text; null while the ears are still downloading (wait: true waits for them)
  async function hear(wav, { lang, wait = false } = {}) {
    if (st.ears !== 'ready') { const p = ears(); if (!wait) return null; await p; }
    const pcm = pcm16k(wav);
    const r = await stt({ t: 'stt', pcm: pcm.buffer, model: st.earsModel, device: st.earsDev, lang: lang && lang !== 'auto' ? base(lang) : null }, null, [pcm.buffer]);
    return r.text || '';
  }

  // get everything ready for a voice conversation in this language (downloads in the background)
  async function prepare(lang) { await gpu(); loadVoice(voiceFor(lang)); ears().catch(() => {}); }
  // a voice already downloaded on this device? (then it is used at once, no fallback)
  async function warm(lang) { const id = voiceFor(lang); if (!id || st.voices[id] === 'ready') return; try { if ((await tts({ t: 'has', voice: id })).ok) loadVoice(id); } catch {} }

  window.VLocal = {
    VOICES, st, voicesOf, phon: (text, lang) => tts({ t: 'phon', text, lang }), _kokoroCpu: () => { st.gpu = true; return tts({ t: 'kokoroCpu' }); }, prepare, warm, say, sys, sysStop, hear, ears, voiceFor, loadVoice,
    setVoice(lang, id) { st.pref[base(lang)] = id; loadVoice(id); emit(); },
    on(f) { subs.add(f); return () => subs.delete(f); },
    // progress of what a conversation in this language still needs (null: all there)
    pending(lang) { const id = voiceFor(lang); const v = id ? st.voices[id] : 'ready'; const parts = []; if (v !== 'ready' && v !== 'error') parts.push(typeof v === 'number' ? v : 0); if (st.ears !== 'ready' && st.ears !== 'error') parts.push(typeof st.ears === 'number' ? st.ears : 0); return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null; },
  };
})();
