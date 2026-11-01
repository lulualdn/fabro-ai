// Fabro — the voice, made in the browser itself (app and Fabro Anywhere), through ONNX Runtime Web with espeak-ng
// phonemes (piper_phonemize, WebAssembly):
// - Kokoro (82M, the most natural and lively voices) on a graphics card (WebGPU): ids like "kokoro:ff_siwis";
// - Piper (VITS, light) everywhere else: ids like "fr_FR-siwis-medium".
// Each model is downloaded once and kept in the browser's Cache API; nothing leaves the device. A sentence is
// synthesised in a fraction of its own duration, so speaking starts almost at once.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const PHON_JS = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js';
const PHON_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const CACHE = 'fabro-voice-v1';
const KOKORO = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
const KOKORO_VOCAB = {"$":0,";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"̃":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};
const KOKORO_LANG = { f: 'fr', a: 'en-us', b: 'en-gb', e: 'es', i: 'it', p: 'pt-br' }; // voice prefix → espeak language
let ortGpu = null, kModel = null, kLoading = null, kOrt = null; const kVoices = new Map();
let kokoroCpu = false; // tests: Kokoro on the processor (8-bit), when there's no graphics card

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
    if (id.startsWith('kokoro:')) { await kokoroModel(onP); await kokoroVoice(id.slice(7)); try { await kokoroSynth(id.slice(7), 'Bonjour.', 1); } catch {} const v = { kokoro: true }; sessions.set(id, v); return v; }
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

// ── Kokoro ──
async function kokoroModel(onP) {
  if (kModel) return kModel;
  if (kLoading) return kLoading;
  kLoading = (async () => {
    await base((p) => onP && onP(p * 0.5));
    if (kokoroCpu) { kOrt = ort; kModel = await ort.InferenceSession.create(await cached(KOKORO + 'onnx/model_quantized.onnx', (x) => onP && onP(0.1 + x * 0.88)), { executionProviders: ['wasm'] }); return kModel; }
    let gpu = null; try { gpu = navigator.gpu && (await navigator.gpu.requestAdapter()); } catch {}
    if (!gpu) throw new Error('no WebGPU');
    if (!ortGpu) { ortGpu = await import(ORT + 'ort.webgpu.min.mjs'); ortGpu.env.wasm.wasmPaths = ORT; }
    const f16 = gpu.features && gpu.features.has('shader-f16');
    const model = await cached(KOKORO + (f16 ? 'onnx/model_fp16.onnx' : 'onnx/model.onnx'), (x) => onP && onP(0.1 + x * 0.88));
    kOrt = ortGpu; kModel = await ortGpu.InferenceSession.create(model, { executionProviders: ['webgpu'] });
    return kModel;
  })();
  try { return await kLoading; } finally { kLoading = null; }
}
async function kokoroVoice(name) {
  if (kVoices.has(name)) return kVoices.get(name);
  const b = await cached(KOKORO + 'voices/' + name + '.bin');
  const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); kVoices.set(name, v); return v;
}
async function kokoroSynth(name, text, speed) {
  const session = await kokoroModel(); const voice = await kokoroVoice(name);
  const lang = KOKORO_LANG[name[0]] || 'en-us';
  let ph = (await phonemize(text, lang)).phonemes;
  // the same clean-up as kokoro-js
  ph = ph.replace(/([.!?,;:…])(?=\S)/g, '$1 ').replace(/-/g, '').replace(/ʲ/g, 'j').replace(/x/g, 'k').replace(/ɬ/g, 'l').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (lang.startsWith('en')) ph = ph.replace(/r/g, 'ɹ').replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ');
  const ids = []; for (const ch of ph) { const id = KOKORO_VOCAB[ch]; if (id != null) ids.push(id); }
  const toks = ids.slice(0, 509); const n = toks.length;
  const style = voice.subarray(n * 256, n * 256 + 256);
  const out = await session.run({
    input_ids: new kOrt.Tensor('int64', BigInt64Array.from([0, ...toks, 0].map(BigInt)), [1, n + 2]),
    style: new kOrt.Tensor('float32', Float32Array.from(style), [1, 256]),
    speed: new kOrt.Tensor('float32', Float32Array.from([speed || 1]), [1]),
  });
  return { pcm: out.waveform.data, rate: 24000 };
}

// text → phoneme ids (espeak-ng, the voice's own language)
// One phonemizer for the whole session: a new one per sentence copied its 18 MB of data each time, which an
// iPhone does not survive. If running it again ever fails, it is made anew once.
let pm = null, pmOut = null;
function makePm() {
  return phon({
    print: (d) => { if (pmOut) pmOut(d); },
    printErr: () => {},
    getPreloadedPackage: () => phonData.buffer.slice(phonData.byteOffset, phonData.byteOffset + phonData.byteLength),
    instantiateWasm: (imports, ok) => { WebAssembly.instantiate(phonWasm, imports).then((inst) => ok(inst, phonWasm)); return {}; },
    locateFile: (u) => PHON_BASE + u,
  });
}
function runPm(m, text, lang) {
  let out = null; pmOut = (d) => { if (out == null) out = d; };
  try { m.callMain(['-l', lang, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']); } catch (e) { if (out == null && !(e && (e.name === 'ExitStatus' || /exit/i.test(e.message || '')))) throw e; }
  pmOut = null;
  if (out == null) throw new Error('no phonemes');
  const j = JSON.parse(out); return { ids: j.phoneme_ids, phonemes: [].concat(j.phonemes || []).flat().join('') };
}
async function phonemize(text, lang) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!pm) pm = await makePm();
    try { return runPm(pm, text, lang); } catch (e) { pm = null; if (attempt) throw e; }
  }
}

async function synth(id, text, speed) {
  if (id.startsWith('kokoro:')) return kokoroSynth(id.slice(7), text, speed);
  const { session, cfg } = await voice(id);
  const ids = (await phonemize(text, cfg.espeak.voice)).ids;
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
    if (m.t === 'has') { const k = m.voice.startsWith('kokoro:'); postMessage({ t: 'has', id: m.id, ok: (k ? (await has(KOKORO + 'onnx/model_fp16.onnx')) || (await has(KOKORO + 'onnx/model.onnx')) : await has(voiceUrl(m.voice))) && (await has(PHON_BASE + 'piper_phonemize.data')) }); return; }
    if (m.t === 'kokoroCpu') { kokoroCpu = true; postMessage({ t: 'ok', id: m.id }); return; }
    if (m.t === 'phon') { postMessage({ t: 'phon', id: m.id, ...(await (async () => { await base(); return phonemize(m.text, m.lang); })()) }); return; } // tests
    if (m.t === 'load') { await voice(m.voice, (p, what) => postMessage({ t: 'progress', id: m.id, p, what })); postMessage({ t: 'ready', id: m.id }); return; }
    if (m.t === 'tts') {
      const t0 = performance.now();
      const { pcm, rate } = await synth(m.voice, m.text, m.speed);
      const bytes = wav(pcm, rate);
      postMessage({ t: 'wav', id: m.id, wav: bytes, ms: Math.round(performance.now() - t0) }, [bytes.buffer]);
    }
  } catch (err) { postMessage({ t: 'error', id: m.id, error: String((err && err.message) || err).slice(0, 300) }); }
};
