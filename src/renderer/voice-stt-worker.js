// Fabro — speech recognition on the device itself (Whisper through transformers.js, WebGPU when the browser has
// it, else WebAssembly): the voice mode of the app and of Fabro Anywhere. The model is downloaded once and kept by
// the browser (Cache API).
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
let pipe = null, loading = null, cur = '';

async function load(model, device) {
  const key = model + '|' + device;
  if (pipe && cur === key) return pipe;
  if (loading && cur === key) return loading;
  cur = key;
  loading = (async () => {
    const { pipeline, env } = await import(LIB);
    env.allowLocalModels = false; env.useBrowserCache = true;
    if (typeof SharedArrayBuffer !== 'undefined' && env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const progress = (p) => { if (p && p.status === 'progress' && p.total) postMessage({ t: 'progress', file: p.file, p: p.loaded / p.total }); };
    const gpu = device === 'webgpu';
    // WebGPU: fp32 encoder + 4-bit decoder (fast, accurate); WebAssembly: 8-bit everywhere (small, fine on phones)
    const dtype = gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
    try { pipe = await pipeline('automatic-speech-recognition', model, { device: gpu ? 'webgpu' : 'wasm', dtype, progress_callback: progress }); }
    catch (e) { if (!gpu) throw e; pipe = await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback: progress }); }
    return pipe;
  })();
  try { return await loading; } finally { loading = null; }
}

// 16 kHz mono float samples → text. Soft voices: the samples are brought to a normal level first
// (Whisper's input features are not level-independent, a whisper otherwise reads as near-silence).
function normalize(x) {
  let peak = 0, sum = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i]; }
  const mean = sum / (x.length || 1);
  const g = peak > 0 && peak < 0.25 ? Math.min(12, 0.6 / peak) : 1;
  if (g === 1 && Math.abs(mean) < 1e-3) return x;
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = Math.max(-1, Math.min(1, (x[i] - mean) * g));
  return y;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.t === 'load') { await load(m.model, m.device); postMessage({ t: 'ready', id: m.id }); return; }
    if (m.t === 'stt') {
      const audio = normalize(new Float32Array(m.pcm));
      const opts = { language: m.lang || null, task: 'transcribe', chunk_length_s: 30, stride_length_s: 4, return_timestamps: false };
      let r;
      try { r = await (await load(m.model, m.device))(audio, opts); }
      catch (e) { if (m.device !== 'webgpu') throw e; r = await (await load(m.model, 'wasm'))(audio, opts); } // GPU lost or refused: the CPU path
      const text = String((r && r.text) || '').trim();
      postMessage({ t: 'text', id: m.id, text: /^(\[.*\]|\(.*\)|sous-titr|merci d.avoir regard|thanks? for watching)/i.test(text) ? '' : text });
    }
  } catch (err) { postMessage({ t: 'error', id: m.id, error: String(err && err.message || err).slice(0, 300) }); }
};
