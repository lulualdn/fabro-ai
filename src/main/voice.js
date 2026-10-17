// Voice: local speech-to-text (Whisper models via faster-whisper) and text-to-speech (Piper voices),
// served by a small Python process (py/voice_server.py) in its own venv, installed on demand.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const { downloadFile } = require('./download');

let pyInstall = null; // (progress) => python path
const dir = () => path.join(process.env.FABRO_DEPS || path.join(app.getPath('userData'), 'deps'), 'voice');
const modelsDir = () => path.join(app.getPath('userData'), 'voice');
const venvPy = () => (process.platform === 'win32' ? path.join(dir(), 'venv', 'Scripts', 'python.exe') : path.join(dir(), 'venv', 'bin', 'python'));
const runtimeOk = () => fs.existsSync(venvPy()) && fs.existsSync(path.join(dir(), 'ok'));

// Whisper sizes (CTranslate2 conversions by Systran) and curated Piper voices per language.
const WHISPER = { base: { repo: 'Systran/faster-whisper-base', mb: 145 }, small: { repo: 'Systran/faster-whisper-small', mb: 484 }, medium: { repo: 'Systran/faster-whisper-medium', mb: 1530 } };
const VOICES = [
  { id: 'fr_FR-siwis-medium', lang: 'fr', name: 'Siwis', gender: 'f' }, { id: 'fr_FR-tom-medium', lang: 'fr', name: 'Tom', gender: 'm' }, { id: 'fr_FR-upmc-medium', lang: 'fr', name: 'UPMC', gender: 'f' },
  { id: 'en_US-amy-medium', lang: 'en', name: 'Amy', gender: 'f' }, { id: 'en_US-ryan-medium', lang: 'en', name: 'Ryan', gender: 'm' }, { id: 'en_GB-alba-medium', lang: 'en', name: 'Alba (UK)', gender: 'f' }, { id: 'en_GB-alan-medium', lang: 'en', name: 'Alan (UK)', gender: 'm' },
  { id: 'es_ES-davefx-medium', lang: 'es', name: 'Davefx', gender: 'm' }, { id: 'es_ES-sharvard-medium', lang: 'es', name: 'Sharvard', gender: 'f' }, { id: 'es_MX-ald-medium', lang: 'es', name: 'Ald (MX)', gender: 'm' },
  { id: 'de_DE-thorsten-medium', lang: 'de', name: 'Thorsten', gender: 'm' }, { id: 'de_DE-mls-medium', lang: 'de', name: 'MLS', gender: 'f' },
];
const voiceUrl = (id, ext) => { const [loc, name, q] = id.split('-'); return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${loc.split('_')[0]}/${loc}/${name}/${q}/${id}${ext}`; };
const voiceFile = (id) => path.join(modelsDir(), 'piper', id + '.onnx');
const whisperDir = (size) => path.join(modelsDir(), 'whisper', size);
const whisperOk = (size) => fs.existsSync(path.join(whisperDir(size), 'model.bin'));
const settings = () => store.getSettings().voice || {};

function status() {
  const s = settings();
  return {
    runtime: runtimeOk(), whisper: s.whisper || 'base', whisperReady: whisperOk(s.whisper || 'base'),
    voice: s.voice || null, voices: VOICES.map((v) => ({ ...v, installed: fs.existsSync(voiceFile(v.id)) })),
    sizes: Object.fromEntries(Object.entries(WHISPER).map(([k, v]) => [k, { mb: v.mb, installed: whisperOk(k) }])),
    running: !!proc,
  };
}

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
      await run(venvPy(), ['-m', 'pip', 'install', '--prefer-binary', 'faster-whisper', 'piper-tts'], (s) => { n += (s.match(/Collecting|Downloading|Installing/g) || []).length; onProgress(Math.min(0.6, 0.2 + n / 90)); });
      fs.writeFileSync(path.join(dir(), 'ok'), new Date().toISOString());
    }
    onProgress(0.6);
    const size = settings().whisper || 'base';
    await getWhisper(size, (p) => onProgress(0.6 + p * 0.3));
    const v = settings().voice || defaultVoice(lang);
    await getVoice(v, (p) => onProgress(0.9 + p * 0.1));
    if (!settings().voice) await store.setSettings({ voice: { voice: v } });
    onProgress(1);
    return status();
  })();
  try { return await installing; } finally { installing = null; }
}
const defaultVoice = (lang) => (VOICES.find((v) => v.lang === (lang || 'en')) || VOICES.find((v) => v.lang === 'en')).id;
async function getWhisper(size, onProgress = () => {}) {
  if (whisperOk(size)) return;
  const w = WHISPER[size]; if (!w) throw new Error('Unknown Whisper size');
  const d = whisperDir(size); fs.mkdirSync(d, { recursive: true });
  const files = ['config.json', 'tokenizer.json', 'vocabulary.txt', 'model.bin'];
  for (let i = 0; i < files.length; i++) {
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

async function stt(wav, { lang, prompt } = {}) {
  const size = settings().whisper || 'base';
  if (!whisperOk(size)) await getWhisper(size);
  const p = await start(); touch();
  const u = new URL(`http://127.0.0.1:${p}/stt`);
  u.searchParams.set('model', size);
  if (lang && lang !== 'auto') u.searchParams.set('lang', lang);
  if (prompt) u.searchParams.set('prompt', prompt.slice(0, 200));
  const r = await fetch(u, { method: 'POST', body: Buffer.from(wav), headers: { 'Content-Type': 'audio/wav' } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `STT ${r.status}`);
  return j;
}
async function tts(text, { voice, speed } = {}) {
  const id = voice || settings().voice || defaultVoice('en');
  if (!fs.existsSync(voiceFile(id))) await getVoice(id);
  const p = await start(); touch();
  const r = await fetch(`http://127.0.0.1:${p}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: voiceFile(id), text: String(text).slice(0, 2000), speed: speed || settings().speed || 1 }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `TTS ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function setVoice(id, onProgress) { await getVoice(id, onProgress); await store.setSettings({ voice: { voice: id } }); return status(); }
async function setWhisper(size, onProgress) { await getWhisper(size, onProgress); await store.setSettings({ voice: { whisper: size } }); return status(); }

function init(pythonInstaller) { pyInstall = pythonInstaller; }

module.exports = { init, status, install, stt, tts, setVoice, setWhisper, stop, VOICES };
