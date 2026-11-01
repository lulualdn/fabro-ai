'use strict';
/* Fabro Anywhere — the phone's own voice and ears, for when the computer can't be reached.
   Voice: the browser's best voices (the natural / neural / enhanced ones when the device has them), each sentence
   in its own language, so a reply mixing French and English is read fluently by native voices.
   Ears: Whisper on the device (stt-worker.js), downloaded once, works offline. */
(function () {
  const L = () => window.FALang;
  const LOCALE = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', ru: 'ru-RU', ar: 'ar-SA' };

  // ── voices ──
  let voices = [];
  const loadVoices = () => { try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; } };
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', loadVoices); }
  // natural/neural voices first (Edge "Online (Natural)", Chrome "Google", Apple "Premium/Enhanced/Siri"), robotic ones last
  function score(v, lang, fam) {
    const vl = String(v.lang || '').replace('_', '-').toLowerCase(), want = (LOCALE[lang] || lang).toLowerCase();
    if (!vl.startsWith(lang)) return -1;
    let s = vl === want ? 30 : 20;
    const n = v.name || '';
    if (/natural|neural|online/i.test(n)) s += 40;
    if (/premium|enhanced|siri|\(plus\)/i.test(n)) s += 34;
    if (/google/i.test(n)) s += 22;
    if (/compact|espeak|robot|novelty|whisper|bad news|bells|boing|bubbles|cellos|zarvox|trinoids|albert|jester|organ|superstar/i.test(n)) s -= 50;
    if (fam === 'm' && /\b(male|homme|thomas|daniel|henri|guy|paul|jorge|diego|reed|eddy|rocko|grandpa|aaron|arthur|fred|ralph|antoine|rémy|remy)\b/i.test(n)) s += 6;
    if (fam === 'f' && /\b(female|femme|amélie|amelie|audrey|aurélie|marie|denise|eloise|jenny|aria|samantha|karen|moira|monica|paulina|anna|alice|joana|sara)\b/i.test(n)) s += 6;
    if (v.default) s += 2;
    return s;
  }
  function bestVoice(lang, fam = 'f', name = '') {
    if (!voices.length) loadVoices();
    if (name) { const v = voices.find((x) => x.name === name && String(x.lang).toLowerCase().startsWith(lang)); if (v) return v; }
    let best = null, bs = -1; for (const v of voices) { const s = score(v, lang, fam); if (s > bs) { bs = s; best = v; } }
    return best;
  }
  function listVoices(lang) { if (!voices.length) loadVoices(); return voices.filter((v) => score(v, lang) >= 0).sort((a, b) => score(b, lang) - score(a, lang)); }

  // Speak a text: language runs → utterances of ≤ 220 characters (long ones stop halfway in some browsers).
  function chunks(text, max = 220) {
    const out = []; let cur = '';
    for (const w of String(text).split(/(\s+)/)) { if ((cur + w).length > max && cur.trim()) { out.push(cur); cur = ''; } cur += w; }
    if (cur.trim()) out.push(cur); return out;
  }
  function speak(text, { lang = 'en', fam = 'f', rate = 1, voiceName = '', onStart, single = false } = {}) {
    if (!('speechSynthesis' in window)) return Promise.resolve(false);
    const runs = L() && !single ? L().runs(text, lang) : [{ lang, text }]; // single: all in the user's language (voice mode)
    const jobs = [];
    for (const r of runs) for (const c of chunks(r.text)) jobs.push({ lang: r.lang, text: c });
    return new Promise((resolve) => {
      let i = 0; let started = false;
      const next = () => {
        if (i >= jobs.length) { resolve(true); return; }
        const j = jobs[i++]; const u = new SpeechSynthesisUtterance(j.text);
        const v = bestVoice(j.lang, fam, j.lang === lang ? voiceName : '');
        if (v) u.voice = v; u.lang = v ? v.lang : (LOCALE[j.lang] || j.lang); u.rate = rate; u.pitch = 1;
        u.onstart = () => { if (!started) { started = true; onStart && onStart(); } };
        u.onend = next; u.onerror = next;
        speechSynthesis.speak(u);
      };
      next();
    });
  }

  // ── ears: Whisper on the device ──
  const MODELS = [
    { id: 'onnx-community/whisper-base', name: 'Whisper Base', size: '≈ 80 MB', phone: true },
    { id: 'onnx-community/whisper-small', name: 'Whisper Small', size: '≈ 250 MB', phone: true },
    { id: 'onnx-community/whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', size: '≈ 600 MB', gpu: true },
  ];
  let worker = null, wn = 0; const waits = new Map(); let onProgress = null;
  function w() {
    if (worker) return worker;
    worker = new Worker('stt-worker.js', { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.t === 'progress') { onProgress && onProgress(m.p, m.file); return; }
      const x = waits.get(m.id); if (!x) return; waits.delete(m.id);
      m.t === 'error' ? x.reject(new Error(m.error)) : x.resolve(m);
    };
    worker.onerror = (e) => { for (const [, x] of waits) x.reject(new Error(e.message || 'worker')); waits.clear(); worker = null; };
    return worker;
  }
  const call = (msg, transfer) => new Promise((resolve, reject) => { const id = 'w' + (++wn); waits.set(id, { resolve, reject }); w().postMessage({ ...msg, id }, transfer || []); });
  // WebGPU only when the device really has an adapter (many phones expose navigator.gpu without one)
  let dev = null;
  async function device() { if (dev) return dev; try { dev = navigator.gpu && (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm'; } catch { dev = 'wasm'; } return dev; }
  async function loadEars(model, progress) { onProgress = progress; try { await call({ t: 'load', model, device: await device() }); } finally { onProgress = null; } return true; }
  // WAV bytes (16 kHz mono 16-bit, as made by the mic) → text
  async function hear(wavBytes, { model, lang } = {}) {
    const dv = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
    const n = (wavBytes.byteLength - 44) >> 1; const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = dv.getInt16(44 + i * 2, true) / 32768;
    const r = await call({ t: 'stt', model, lang: { en: 'english', fr: 'french', es: 'spanish', de: 'german', it: 'italian', pt: 'portuguese' }[lang] || null, device: await device(), pcm: f.buffer }, [f.buffer]);
    return r.text || '';
  }

  // ── microphone permission: what state it's in, and how to unblock it on this device ──
  async function micState() {
    try { if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
    return 'unknown';
  }
  function micHelpKey() {
    const ua = navigator.userAgent;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (/iPhone|iPad/.test(ua)) return standalone ? 'micHelpIosApp' : 'micHelpIos';
    if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? 'micHelpSamsung' : standalone ? 'micHelpAndroidApp' : 'micHelpAndroid';
    if (/Edg\//.test(ua)) return 'micHelpEdge';
    if (/Firefox/.test(ua)) return 'micHelpFirefox';
    if (/Safari/.test(ua) && !/Chrome/.test(ua)) return 'micHelpSafari';
    return 'micHelpChrome';
  }

  window.FASpeech = { speak, bestVoice, listVoices, stop: () => { try { speechSynthesis.cancel(); } catch {} }, MODELS, loadEars, hear, device, micState, micHelpKey, LOCALE };
})();
