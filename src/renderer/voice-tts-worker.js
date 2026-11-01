// Fabro — the voice, made in the browser itself (app and Fabro Anywhere): Piper (VITS) through ONNX Runtime Web,
// with espeak-ng phonemes (piper_phonemize, WebAssembly). Each voice is downloaded once (~60 MB) and kept in the
// browser's Cache API, like the phonemizer data; nothing leaves the device. A sentence is synthesised in a
// fraction of its own duration on a computer, so speaking starts almost at once.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const PHON_JS = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js';
const PHON_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const CACHE = 'fabro-voice-v1';

let ort = null, phon = null, phonData = null, phonWasm = null;
const sessions = new Map(); // voice id → { session, cfg }
const loading = new Map();

// fetch through the Cache API, reporting progress for big files
async function cached(url, onP) {
  let c = null; try { c = await caches.open(CACHE); const hit = await c.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
  const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url.split('/').pop()}`);
  const total = +r.headers.get('content-length') || 0;
  let buf;
  if (r.body && total && onP) {
    const rd = r.body.getReader(); const parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onP(n / total); }
    buf = new Uint8Array(n); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  } else buf = new Uint8Array(await r.arrayBuffer());
  try { if (c) await c.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch {}
  return buf;
}
const has = async (url) => { try { return !!(await (await caches.open(CACHE)).match(url)); } catch { return false; } };

// fr_FR-siwis-medium → fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx
function voiceUrl(id) { const [loc, name, q] = id.split('-'); return `${VOICES}${loc.split('_')[0]}/${loc}/${name}/${q}/${id}.onnx`; }

async function base(onP) {
  if (!ort) {
    ort = await import(ORT + 'ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = ORT; ort.env.wasm.numThreads = typeof SharedArrayBuffer !== 'undefined' ? Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  }
  if (!phon) {
    const [mod, data, wasm] = await Promise.all([import(PHON_JS), cached(PHON_BASE + 'piper_phonemize.data', (p) => onP && onP(p * 0.2, 'phonemes')), cached(PHON_BASE + 'piper_phonemize.wasm')]);
    phonData = data; phonWasm = await WebAssembly.compile(wasm); phon = mod.createPiperPhonemize;
  }
}
async function voice(id, onP) {
  if (sessions.has(id)) return sessions.get(id);
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    await base(onP);
    const url = voiceUrl(id);
    const [model, cfgBytes] = await Promise.all([cached(url, (x) => onP && onP(0.2 + x * 0.8, 'voice')), cached(url + '.json')]);
    const cfg = JSON.parse(new TextDecoder().decode(cfgBytes));
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const v = { session, cfg }; sessions.set(id, v);
    try { await synth(id, '.', 1); } catch {} // first run compiles the graph: done now, not on the first sentence
    return v;
  })();
  loading.set(id, p);
  try { return await p; } finally { loading.delete(id); }
}

// text → phoneme ids (espeak-ng, the voice's own language)
function phonemes(text, lang) {
  return new Promise((resolve, reject) => {
    let done = false;
    phon({
      print: (d) => { if (!done) { done = true; try { resolve(JSON.parse(d).phoneme_ids); } catch (e) { reject(e); } } },
      printErr: () => {},
      getPreloadedPackage: () => phonData.buffer.slice(phonData.byteOffset, phonData.byteOffset + phonData.byteLength),
      instantiateWasm: (imports, ok) => { WebAssembly.instantiate(phonWasm, imports).then((inst) => ok(inst, phonWasm), reject); return {}; },
      locateFile: (u) => PHON_BASE + u,
    }).then((m) => {
      m.callMain(['-l', lang, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
      if (!done) reject(new Error('no phonemes'));
    }, reject);
  });
}

async function synth(id, text, speed) {
  const { session, cfg } = await voice(id);
  const ids = await phonemes(text, cfg.espeak.voice);
  const inf = cfg.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / (speed || 1), inf.noise_w ?? 0.8]), [3]),
  };
  if (cfg.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  return { pcm: out.output.data, rate: cfg.audio.sample_rate };
}

// Float32 → 16-bit WAV, the silence around the sentence trimmed (keeping 30 ms before, 60 ms after)
function wav(pcm, rate) {
  let a = 0, b = pcm.length; const thr = 0.004;
  while (a < b && Math.abs(pcm[a]) < thr) a++; while (b > a && Math.abs(pcm[b - 1]) < thr) b--;
  a = Math.max(0, a - Math.round(rate * 0.03)); b = Math.min(pcm.length, b + Math.round(rate * 0.06));
  const n = b - a, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const s = (p, x) => { for (let i = 0; i < x.length; i++) v.setUint8(p + i, x.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
  const o = new Int16Array(buf, 44); for (let i = 0; i < n; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[a + i] * 32767)));
  return new Uint8Array(buf);
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.t === 'has') { postMessage({ t: 'has', id: m.id, ok: (await has(voiceUrl(m.voice))) && (await has(PHON_BASE + 'piper_phonemize.data')) }); return; }
    if (m.t === 'load') { await voice(m.voice, (p, what) => postMessage({ t: 'progress', id: m.id, p, what })); postMessage({ t: 'ready', id: m.id }); return; }
    if (m.t === 'tts') {
      const t0 = performance.now();
      const { pcm, rate } = await synth(m.voice, m.text, m.speed);
      const bytes = wav(pcm, rate);
      postMessage({ t: 'wav', id: m.id, wav: bytes, ms: Math.round(performance.now() - t0) }, [bytes.buffer]);
    }
  } catch (err) { postMessage({ t: 'error', id: m.id, error: String((err && err.message) || err).slice(0, 300) }); }
};
