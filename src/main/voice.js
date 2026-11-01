// Voice: local speech-to-text (Whisper models via faster-whisper) and text-to-speech — Kokoro (one fluid,
// natural voice family across English, French, Spanish, Italian, Portuguese, Japanese, Chinese and Hindi), Piper
// for the rest (German) — served by a small Python process (py/voice_server.py) in its own venv, installed on demand.
// Every sentence is read in its own language. Speech recognition gets a vocabulary (recent names Whisper doesn't
// know, the models installed here, the user's own words) and is tuned to catch soft voices and whispers.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const { downloadFile } = require('./download');
const langdetect = require('./langdetect');

let pyInstall = null; // (progress) => python path
const dir = () => path.join(process.env.FABRO_DEPS || path.join(app.getPath('userData'), 'deps'), 'voice');
const modelsDir = () => path.join(app.getPath('userData'), 'voice');
const venvPy = () => (process.platform === 'win32' ? path.join(dir(), 'venv', 'Scripts', 'python.exe') : path.join(dir(), 'venv', 'bin', 'python'));
const runtimeOk = () => fs.existsSync(venvPy()) && fs.existsSync(path.join(dir(), 'ok'));

// Whisper sizes (CTranslate2 conversions by Systran) and curated Piper voices per language.
const CT2 = ['config.json', 'tokenizer.json', 'vocabulary.txt', 'model.bin'];
const WHISPER = {
  base: { repo: 'Systran/faster-whisper-base', mb: 145, files: CT2 },
  small: { repo: 'Systran/faster-whisper-small', mb: 484, files: CT2 },
  medium: { repo: 'Systran/faster-whisper-medium', mb: 1530, files: CT2 },
  // large-v3 quality at a fraction of the cost: far better on new words, accents and soft voices
  turbo: { repo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo', mb: 1620, files: ['config.json', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json', 'model.bin'] },
};
// Kokoro voices by language and voice family (f / m). Kokoro has no German: Piper reads German.
const KOKORO_LANG = { en: 'en-us', fr: 'fr-fr', es: 'es', it: 'it', pt: 'pt-br', ja: 'ja', zh: 'cmn', hi: 'hi' };
const KOKORO = {
  f: { en: 'af_heart', fr: 'ff_siwis', es: 'ef_dora', it: 'if_sara', pt: 'pf_dora', ja: 'jf_alpha', zh: 'zf_xiaoxiao', hi: 'hf_alpha' },
  m: { en: 'am_michael', fr: 'ff_siwis', es: 'em_alex', it: 'im_nicola', pt: 'pm_alex', ja: 'jm_kumo', zh: 'zm_yunxi', hi: 'hm_omega' },
};
// The voices offered for English (the family's "face"); other languages follow the family.
const KOKORO_VOICES = [
  { id: 'k:af_heart', fam: 'f', name: 'Heart' }, { id: 'k:af_bella', fam: 'f', name: 'Bella' }, { id: 'k:af_nicole', fam: 'f', name: 'Nicole' }, { id: 'k:bf_emma', fam: 'f', name: 'Emma (UK)' },
  { id: 'k:am_michael', fam: 'm', name: 'Michael' }, { id: 'k:am_fenrir', fam: 'm', name: 'Fenrir' }, { id: 'k:bm_george', fam: 'm', name: 'George (UK)' },
];
const KOKORO_FILES = [
  ['kokoro-v1.0.int8.onnx', 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx'],
  ['voices-v1.0.bin', 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin'],
];
// Words Whisper (trained before them) tends to mishear. Kept short: hotwords steer, too many confuse it.
const VOCAB = ['Fabro', 'Fabro Anywhere', 'Claude', 'ChatGPT', 'Gemini', 'Gemma', 'Qwen', 'Llama', 'Mistral', 'DeepSeek', 'Grok', 'Ollama', 'LLM', 'MCP', 'GitHub', 'Roblox', 'Luau', 'Discord', 'Netlify', 'Cloudflare', 'WebGPU', 'Kokoro', 'Whisper', 'API', 'PWA'];
const VOICES = [
  { id: 'fr_FR-siwis-medium', lang: 'fr', name: 'Siwis', gender: 'f' }, { id: 'fr_FR-tom-medium', lang: 'fr', name: 'Tom', gender: 'm' }, { id: 'fr_FR-upmc-medium', lang: 'fr', name: 'UPMC', gender: 'f' },
  { id: 'en_US-amy-medium', lang: 'en', name: 'Amy', gender: 'f' }, { id: 'en_US-ryan-medium', lang: 'en', name: 'Ryan', gender: 'm' }, { id: 'en_GB-alba-medium', lang: 'en', name: 'Alba (UK)', gender: 'f' }, { id: 'en_GB-alan-medium', lang: 'en', name: 'Alan (UK)', gender: 'm' },
  { id: 'es_ES-davefx-medium', lang: 'es', name: 'Davefx', gender: 'm' }, { id: 'es_ES-sharvard-medium', lang: 'es', name: 'Sharvard', gender: 'f' }, { id: 'es_MX-ald-medium', lang: 'es', name: 'Ald (MX)', gender: 'm' },
  { id: 'de_DE-thorsten-medium', lang: 'de', name: 'Thorsten', gender: 'm' }, { id: 'de_DE-mls-medium', lang: 'de', name: 'MLS', gender: 'f' },
];
const voiceUrl = (id, ext) => { const [loc, name, q] = id.split('-'); return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${loc.split('_')[0]}/${loc}/${name}/${q}/${id}${ext}`; };
const voiceFile = (id) => path.join(modelsDir(), 'piper', id + '.onnx');
const whisperDir = (size) => path.join(modelsDir(), 'whisper', size);
const whisperOk = (size) => !!WHISPER[size] && WHISPER[size].files.every((f) => fs.existsSync(path.join(whisperDir(size), f)));
const settings = () => store.getSettings().voice || {};
const kokoroDir = () => path.join(modelsDir(), 'kokoro');
const kokoroFilesOk = () => KOKORO_FILES.every(([f]) => fs.existsSync(path.join(kokoroDir(), f)));
const kokoroOk = () => runtimeOk() && fs.existsSync(path.join(dir(), 'kokoro-ok')) && kokoroFilesOk();

// The Whisper size this computer handles well: turbo with enough memory and cores, else small, else base.
let recSize = null;
async function recommendedSize() {
  if (recSize) return recSize;
  try { const sp = await require('./system').getSpecs(); recSize = sp.ramGB >= 12 && sp.cpu.threads >= 8 ? 'turbo' : sp.ramGB >= 6 ? 'small' : 'base'; } catch { recSize = 'small'; }
  return recSize;
}
// The size used now: the chosen one, else the recommended one once downloaded (fetched in the background),
// meanwhile the best one already here.
function activeSize() {
  const s = settings();
  if (s.whisper && whisperOk(s.whisper)) return s.whisper;
  const want = s.whisper || recSize || 'small';
  if (whisperOk(want)) return want;
  return ['turbo', 'medium', 'small', 'base'].find(whisperOk) || want;
}
let upgrading = null;
function upgradeInBackground() {
  if (upgrading) return;
  const want = settings().whisper || recSize;
  if (!want || whisperOk(want)) return;
  upgrading = getWhisper(want).catch((e) => console.warn('whisper upgrade', e.message)).finally(() => { upgrading = null; });
}

function status() {
  const s = settings();
  const engine = ttsEngine();
  return {
    runtime: runtimeOk(), whisper: activeSize(), whisperReady: whisperOk(activeSize()), whisperWanted: s.whisper || recSize || 'small', upgrading: !!upgrading,
    engine, kokoro: kokoroOk(), kokoroInstalling: !!kokoroInstalling,
    voice: engine === 'kokoro' ? 'k:' + (s.kvoice || 'af_heart') : (s.voice || null),
    voices: [
      ...(kokoroOk() ? KOKORO_VOICES.map((v) => ({ ...v, lang: '*', installed: true, engine: 'kokoro' })) : []),
      ...VOICES.map((v) => ({ ...v, installed: fs.existsSync(voiceFile(v.id)), engine: 'piper' })),
    ],
    vocab: s.vocab || '',
    sizes: Object.fromEntries(Object.entries(WHISPER).map(([k, v]) => [k, { mb: v.mb, installed: whisperOk(k) }])),
    running: !!proc,
  };
}
const ttsEngine = () => (settings().engine === 'piper' || !kokoroOk() ? 'piper' : 'kokoro');

function run(bin, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1' } });
    let out = '';
    const on = (d) => { out += d; onLine && onLine(String(d)); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(out.slice(-800)))));
  });
}

// Install the runtime (Python venv + faster-whisper + piper-tts), a Whisper model and a voice.
let installing = null;
async function install(onProgress = () => {}, { lang } = {}) {
  if (installing) return installing;
  installing = (async () => {
    if (!runtimeOk()) {
      const py = await pyInstall((p) => onProgress(p * 0.2));
      fs.mkdirSync(dir(), { recursive: true });
      await run(py, ['-m', 'venv', path.join(dir(), 'venv')]);
      let n = 0;
      await run(venvPy(), ['-m', 'pip', 'install', '--prefer-binary', 'faster-whisper>=1.1', 'av<17', 'piper-tts', 'kokoro-onnx'], (s) => { n += (s.match(/Collecting|Downloading|Installing/g) || []).length; onProgress(Math.min(0.5, 0.2 + n / 110)); });
      fs.writeFileSync(path.join(dir(), 'ok'), new Date().toISOString());
      fs.writeFileSync(path.join(dir(), 'kokoro-ok'), new Date().toISOString());
    }
    onProgress(0.5);
    // a quick model first so voice works right away; the recommended one follows in the background
    const want = settings().whisper || await recommendedSize();
    const first = whisperOk(want) ? want : want === 'turbo' ? 'small' : want;
    await getWhisper(first, (p) => onProgress(0.5 + p * 0.25));
    await getKokoro((p) => onProgress(0.75 + p * 0.15)).catch((e) => console.warn('kokoro', e.message));
    const v = settings().voice || defaultVoice(lang);
    await getVoice(v, (p) => onProgress(0.9 + p * 0.1)).catch(() => {});
    if (!settings().voice) await store.setSettings({ voice: { voice: v } });
    upgradeInBackground();
    onProgress(1);
    return status();
  })();
  try { return await installing; } finally { installing = null; }
}
const defaultVoice = (lang) => (VOICES.find((v) => v.lang === (lang || 'en')) || VOICES.find((v) => v.lang === 'en')).id;
async function getKokoro(onProgress = () => {}) {
  fs.mkdirSync(kokoroDir(), { recursive: true });
  for (let i = 0; i < KOKORO_FILES.length; i++) {
    const [f, url] = KOKORO_FILES[i]; const dst = path.join(kokoroDir(), f);
    if (!fs.existsSync(dst)) await downloadFile(url, dst, { onProgress: (n, t) => onProgress((i + (t ? n / t : 0)) / KOKORO_FILES.length) });
  }
}
// Voice installed before Kokoro existed in Fabro: add it quietly (Piper keeps talking meanwhile).
let kokoroInstalling = null;
function ensureKokoro() {
  if (kokoroOk() || kokoroInstalling || !runtimeOk() || settings().engine === 'piper') return kokoroInstalling;
  kokoroInstalling = (async () => {
    if (!fs.existsSync(path.join(dir(), 'kokoro-ok'))) {
      await run(venvPy(), ['-m', 'pip', 'install', '--prefer-binary', '--upgrade', 'kokoro-onnx', 'faster-whisper>=1.1', 'av<17']);
      fs.writeFileSync(path.join(dir(), 'kokoro-ok'), new Date().toISOString());
      stop(); // the next request starts a server that can import it
    }
    await getKokoro();
  })().catch((e) => console.warn('kokoro install', e.message)).finally(() => { kokoroInstalling = null; });
  return kokoroInstalling;
}
async function getWhisper(size, onProgress = () => {}) {
  if (whisperOk(size)) return;
  const w = WHISPER[size]; if (!w) throw new Error('Unknown Whisper size');
  const d = whisperDir(size); fs.mkdirSync(d, { recursive: true });
  const files = w.files;
  for (let i = 0; i < files.length; i++) {
    if (fs.existsSync(path.join(d, files[i]))) continue;
    await downloadFile(`https://huggingface.co/${w.repo}/resolve/main/${files[i]}?download=true`, path.join(d, files[i]), { onProgress: (n, t) => onProgress((i + (t ? n / t : 0)) / files.length) });
  }
}
async function getVoice(id, onProgress = () => {}) {
  if (fs.existsSync(voiceFile(id))) return;
  if (!VOICES.some((v) => v.id === id)) throw new Error('Unknown voice');
  fs.mkdirSync(path.dirname(voiceFile(id)), { recursive: true });
  await downloadFile(voiceUrl(id, '.onnx.json'), voiceFile(id) + '.json');
  await downloadFile(voiceUrl(id, '.onnx'), voiceFile(id), { onProgress: (n, t) => onProgress(t ? n / t : 0) });
}

// ───────────────────────────── server ─────────────────────────────
let proc = null, port = 0, starting = null, idleT = null;
const script = () => {
  // Packaged apps read scripts from app.asar: copy the server next to the venv once.
  const src = path.join(__dirname, 'py', 'voice_server.py');
  const dst = path.join(dir(), 'voice_server.py');
  try { const a = fs.readFileSync(src, 'utf8'); if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== a) fs.writeFileSync(dst, a); } catch {}
  return dst;
};
async function start() {
  if (proc && port) return port;
  if (starting) return starting;
  if (!runtimeOk()) throw Object.assign(new Error('Voice is not installed'), { code: 'VOICE_MISSING' });
  starting = new Promise((resolve, reject) => {
    proc = spawn(venvPy(), [script(), '0'], { windowsHide: true, env: { ...process.env, FABRO_VOICE_MODELS: modelsDir(), PYTHONUTF8: '1', HF_HUB_OFFLINE: '1' } });
    let err = '';
    const t = setTimeout(() => reject(new Error('Voice server did not start')), 30000);
    proc.stdout.once('data', (d) => { clearTimeout(t); try { port = JSON.parse(String(d).trim().split('\n')[0]).port; resolve(port); } catch (e) { reject(e); } });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    proc.on('exit', () => { proc = null; port = 0; clearTimeout(t); reject(new Error('Voice server stopped: ' + err.slice(-400))); });
  });
  try { return await starting; } finally { starting = null; }
}
function touch() { clearTimeout(idleT); idleT = setTimeout(stop, 15 * 60000); }
function stop() { if (proc) { try { proc.kill(); } catch {} proc = null; port = 0; } }

// Words to listen for: Fabro's own vocabulary, the AI's and user's names, the installed models, the user's list.
function vocabulary() {
  const st = store.getSettings();
  const words = [...VOCAB, st.aiName, st.userName, ...String(settings().vocab || '').split(/[,;\n]/)];
  try { for (const m of require('./models').installedNames ? require('./models').installedNames() : []) words.push(m); } catch {}
  const seen = new Set(); const out = [];
  for (const w of words) { const x = String(w || '').trim(); if (x && x.length < 40 && !seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); } }
  return out.slice(0, 40).join(', ');
}
async function stt(wav, { lang, prompt, fast } = {}) {
  await recommendedSize();
  const size = activeSize();
  if (!whisperOk(size)) await getWhisper(size);
  upgradeInBackground();
  const p = await start(); touch();
  const u = new URL(`http://127.0.0.1:${p}/stt`);
  u.searchParams.set('model', size);
  // big models on the CPU: a narrower beam keeps a short sentence under a few seconds
  // voice mode (fast): greedy decoding — a spoken turn is short, latency matters more than the last 1 %
  u.searchParams.set('beam', fast ? (size === 'turbo' || size === 'medium' ? '1' : '2') : size === 'turbo' || size === 'medium' ? '3' : '5');
  if (lang && lang !== 'auto') u.searchParams.set('lang', lang);
  if (prompt) u.searchParams.set('prompt', prompt.slice(0, 220));
  u.searchParams.set('hot', vocabulary());
  const r = await fetch(u, { method: 'POST', body: Buffer.from(wav), headers: { 'Content-Type': 'audio/wav' } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `STT ${r.status}`);
  return j;
}
async function transcribeFile(file, { lang } = {}) {
  await recommendedSize();
  const size = activeSize();
  if (!whisperOk(size)) await getWhisper(size);
  const p = await start(); touch();
  const r = await fetch(`http://127.0.0.1:${p}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file, model: size, lang, hot: vocabulary() }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `Transcription ${r.status}`);
  return j;
}
// Text → speech. Each sentence is spoken in its own language: Kokoro for the languages it knows (one voice
// family, so a bilingual answer still sounds like one person), Piper otherwise.
const uiLang = () => { const l = store.getSettings().language; return (l && l !== 'auto' ? l : app.getLocale()).slice(0, 2); };
async function tts(text, { voice, speed, lang } = {}) {
  ensureKokoro();
  const sp = speed || settings().speed || 1;
  const runs = langdetect.runs(String(text).slice(0, 2000), lang || uiLang());
  const p = await start(); touch();
  const post = (body) => fetch(`http://127.0.0.1:${p}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const parts = [];
  const engine = voice && !String(voice).startsWith('k:') ? 'piper' : ttsEngine();
  const kv = String(voice && voice.startsWith('k:') ? voice.slice(2) : settings().kvoice || 'af_heart');
  const fam = /^[ab]m_|^[a-z]m_/.test(kv) ? 'm' : 'f';
  // consecutive runs Kokoro can read go out together (one request, one natural flow)
  let kBatch = [];
  const flushK = async () => {
    if (!kBatch.length) return;
    const r = await post({ engine: 'kokoro', segments: kBatch, speed: sp }); kBatch = [];
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `TTS ${r.status}`);
    parts.push(new Uint8Array(await r.arrayBuffer()));
  };
  for (const run of runs.length ? runs : [{ lang: lang || uiLang(), text }]) {
    if (engine === 'kokoro' && KOKORO_LANG[run.lang]) {
      const v = run.lang === 'en' ? kv : KOKORO[fam][run.lang];
      kBatch.push({ text: run.text, voice: v, lang: run.lang === 'en' && /^b/.test(kv) ? 'en-gb' : KOKORO_LANG[run.lang] });
      continue;
    }
    await flushK();
    // Piper: the chosen voice when it speaks this language, else the first voice of the language
    const chosen = VOICES.find((x) => x.id === (voice || settings().voice));
    const id = chosen && chosen.lang === run.lang ? chosen.id : (VOICES.find((x) => x.lang === run.lang && fs.existsSync(voiceFile(x.id))) || VOICES.find((x) => x.lang === run.lang) || chosen || VOICES.find((x) => x.lang === 'en')).id;
    if (!fs.existsSync(voiceFile(id))) await getVoice(id);
    const r = await post({ voice: voiceFile(id), text: run.text, speed: sp });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `TTS ${r.status}`);
    parts.push(new Uint8Array(await r.arrayBuffer()));
  }
  await flushK();
  return parts.length === 1 ? parts[0] : joinWavs(parts);
}
// Several WAV clips (maybe different sample rates) → one 24 kHz clip.
function joinWavs(list) {
  const pcm = []; const RATE = 24000;
  for (const b of list) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let off = 12, rate = 22050, data = null;
    while (off + 8 <= b.length) { const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]); const n = v.getUint32(off + 4, true); if (id === 'fmt ') rate = v.getUint32(off + 12, true); if (id === 'data') { data = new Int16Array(b.buffer.slice(b.byteOffset + off + 8, b.byteOffset + off + 8 + n)); break; } off += 8 + n + (n % 2); }
    if (!data) continue;
    const k = rate / RATE, len = Math.floor(data.length / k), out = new Int16Array(len);
    for (let i = 0; i < len; i++) out[i] = data[Math.min(data.length - 1, Math.floor(i * k))];
    pcm.push(out, new Int16Array(Math.round(RATE * 0.12)));
  }
  const total = pcm.reduce((a, x) => a + x.length, 0);
  const buf = Buffer.alloc(44 + total * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + total * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(total * 2, 40);
  let o = 44; for (const x of pcm) { Buffer.from(x.buffer, x.byteOffset, x.byteLength).copy(buf, o); o += x.byteLength; }
  return new Uint8Array(buf);
}
async function setVoice(id, onProgress) {
  if (String(id).startsWith('k:')) { await getKokoro(onProgress); await store.setSettings({ voice: { kvoice: id.slice(2), engine: 'kokoro' } }); return status(); }
  await getVoice(id, onProgress); await store.setSettings({ voice: { voice: id, engine: 'piper' } }); return status();
}
async function setWhisper(size, onProgress) { await getWhisper(size, onProgress); await store.setSettings({ voice: { whisper: size } }); return status(); }
async function setVocab(text) { await store.setSettings({ voice: { vocab: String(text || '').slice(0, 2000) } }); return status(); }

function init(pythonInstaller) { pyInstall = pythonInstaller; recommendedSize().then(() => { if (runtimeOk()) { upgradeInBackground(); ensureKokoro(); } }).catch(() => {}); }

module.exports = { init, status, install, stt, transcribeFile, tts, setVoice, setWhisper, setVocab, stop, VOICES, recommendedSize, ensureKokoro };
