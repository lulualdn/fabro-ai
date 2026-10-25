// Images: local generation with stable-diffusion.cpp (official release builds: CUDA / Vulkan / Metal / CPU),
// installed on demand with a model preset chosen for the computer. Used by the generate_image tool.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const store = require('./store');
const system = require('./system');
const { downloadFile } = require('./download');

const root = () => path.join(process.env.FABRO_DEPS || path.join(app.getPath('userData'), 'deps'), 'sd');
const modelsDir = () => path.join(app.getPath('userData'), 'models', 'images');
const outDir = () => path.join(os.homedir(), 'Documents', 'Fabro', 'Images');
const settings = () => store.getSettings().images || {};
const hf = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}?download=true`;

// Model presets: SD-Turbo runs everywhere (even CPU), Z-Image Turbo is the quality pick with a GPU.
const PRESETS = {
  'sd-turbo': {
    name: 'SD Turbo', sizeGB: 2.0, minVram: 0, size: 512,
    files: [{ arg: '-m', repo: 'Green-Sky/SD-Turbo-GGUF', file: 'sd_turbo-f16-q8_0.gguf' }],
    args: ['--steps', '4', '--cfg-scale', '1.0', '--sampling-method', 'euler_a'],
  },
  'z-image-turbo': {
    name: 'Z-Image Turbo', sizeGB: 6.7, minVram: 6, size: 1024,
    files: [
      { arg: '--diffusion-model', repo: 'leejet/Z-Image-Turbo-GGUF', file: 'z_image_turbo-Q4_K.gguf' },
      { arg: '--llm', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' },
      { arg: '--vae', repo: 'Comfy-Org/z_image_turbo', file: 'split_files/vae/ae.safetensors' },
    ],
    args: ['--steps', '8', '--cfg-scale', '1.0', '--diffusion-fa'],
  },
};
const fileOf = (f) => path.join(modelsDir(), path.basename(f.file));
const presetReady = (id) => !!PRESETS[id] && PRESETS[id].files.every((f) => fs.existsSync(fileOf(f)));

function binPath() {
  const meta = readMeta();
  return meta && fs.existsSync(meta.bin) ? meta.bin : null;
}
function readMeta() { try { return JSON.parse(fs.readFileSync(path.join(root(), 'current.json'), 'utf8')); } catch { return null; } }

async function recommended() {
  const sp = await system.getSpecs();
  const vram = sp.accel === 'metal' ? sp.ramGB * 0.6 : sp.accel === 'cpu' ? 0 : (sp.gpuBudgetGB || 0);
  return vram >= PRESETS['z-image-turbo'].minVram ? 'z-image-turbo' : 'sd-turbo';
}
async function status() {
  const s = settings();
  return { engine: !!binPath(), build: (readMeta() || {}).asset || null, preset: s.preset || null, recommended: await recommended(),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { name: p.name, sizeGB: p.sizeGB, ready: presetReady(k) }])) };
}

// Pick the release build for this computer.
async function pickAsset(rel) {
  const sp = await system.getSpecs();
  const names = (rel.assets || []).map((a) => a.name);
  const find = (re) => (rel.assets || []).find((a) => re.test(a.name));
  let a = null, extra = null;
  if (process.platform === 'win32') {
    if (sp.accel === 'cuda') { a = find(/bin-win-cuda12-x64\.zip$/); extra = find(/^cudart-sd-bin-win-cu12-x64\.zip$/); }
    if (!a && sp.accel !== 'cpu') a = find(/bin-win-vulkan-x64\.zip$/);
    if (!a) a = find(/bin-win-(cpu|avx2)-x64\.zip$/) || find(/bin-win-.*avx.*-x64\.zip$/);
  } else if (process.platform === 'darwin') a = process.arch === 'arm64' ? find(/bin-Darwin-.*arm64\.zip$/) : find(/^sd-bin-Darwin-x86_64\.zip$/);
  else {
    if (sp.accel !== 'cpu') a = find(/bin-Linux-.*x86_64-vulkan\.zip$/);
    if (!a) a = find(/bin-Linux-.*x86_64\.zip$/);
  }
  if (!a) throw new Error('No stable-diffusion.cpp build for this computer (' + names.slice(0, 6).join(', ') + ')');
  return { a, extra };
}
function findBin(dir) {
  const want = process.platform === 'win32' ? /^sd(-cli)?\.exe$/i : /^sd(-cli)?$/;
  const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isFile() && want.test(e.name)) return f; if (e.isDirectory() && depth < 4) { const r = walk(f, depth + 1); if (r) return r; } } return null; };
  return walk(dir, 0);
}
// Latest release with its assets: the GitHub API, or the release page when the API is rate-limited (403/429).
async function latestRelease(repo) {
  const h = { 'User-Agent': 'Fabro', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const r = process.env.FABRO_GH_PAGE_ONLY ? null : await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: h }).catch(() => null);
  if (r && r.ok) return r.json();
  const page = await fetch(`https://github.com/${repo}/releases/latest`, { headers: { 'User-Agent': 'Fabro' }, redirect: 'follow' });
  const tag = decodeURIComponent((page.url.match(/\/releases\/tag\/([^/?#]+)/) || [])[1] || '');
  if (!tag) throw new Error(`GitHub ${r ? r.status : 'unreachable'}`);
  const html = await (await fetch(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`, { headers: { 'User-Agent': 'Fabro' } })).text();
  const names = [...new Set([...html.matchAll(/\/releases\/download\/[^/"]+\/([^"?]+)"/g)].map((m) => decodeURIComponent(m[1])))];
  return { tag_name: tag, assets: names.map((name) => ({ name, browser_download_url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}` })) };
}
// stable-diffusion.cpp ships no Intel Mac build: Fabro's own release CI compiles one and attaches it.
const OWN_REPO = (() => { const p = (require('../../package.json').build || {}).publish; const g = [].concat(p || [])[0] || {}; return g.owner ? `${g.owner}/${g.repo}` : 'lulualdn/fabro-ai'; })();
const intelMac = () => process.platform === 'darwin' && process.arch !== 'arm64';
async function installEngine(onProgress = () => {}) {
  // FABRO_SD_ZIP: a local build (release CI tests the Intel Mac binary before attaching it)
  const rel = process.env.FABRO_SD_ZIP ? { tag_name: 'local', assets: [{ name: path.basename(process.env.FABRO_SD_ZIP), local: process.env.FABRO_SD_ZIP }] }
    : await latestRelease(intelMac() ? OWN_REPO : 'leejet/stable-diffusion.cpp');
  const { a, extra } = await pickAsset(rel);
  const dir = path.join(root(), rel.tag_name); fs.mkdirSync(dir, { recursive: true });
  for (const [i, asset] of [a, extra].filter(Boolean).entries()) {
    if (asset.local) { await require('extract-zip')(path.resolve(asset.local), { dir }); continue; }
    const zip = path.join(root(), asset.name);
    await downloadFile(asset.browser_download_url, zip, { onProgress: (n, t) => onProgress((i + (t ? n / t : 0)) / (extra ? 2 : 1)) });
    await require('extract-zip')(zip, { dir });
    fs.rmSync(zip, { force: true });
  }
  const bin = findBin(dir);
  if (!bin) throw new Error('The stable-diffusion.cpp archive has no sd binary');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(root(), 'current.json'), JSON.stringify({ tag: rel.tag_name, asset: a.name, bin }));
  return bin;
}
async function installPreset(id, onProgress = () => {}) {
  const p = PRESETS[id]; if (!p) throw new Error('Unknown image model');
  fs.mkdirSync(modelsDir(), { recursive: true });
  const todo = p.files.filter((f) => !fs.existsSync(fileOf(f)));
  for (const [i, f] of todo.entries()) await downloadFile(hf(f.repo, f.file), fileOf(f), { onProgress: (n, t) => onProgress((i + (t ? n / t : 0)) / todo.length) });
}
let installing = null;
async function install(onProgress = () => {}, preset) {
  if (installing) return installing;
  installing = (async () => {
    if (!binPath()) await installEngine((p) => onProgress(p * 0.15));
    const id = preset || settings().preset || await recommended();
    await installPreset(id, (p) => onProgress(0.15 + p * 0.85));
    await store.setSettings({ images: { preset: id } });
    onProgress(1);
    return status();
  })();
  try { return await installing; } finally { installing = null; }
}

// ───────────────────────────── generation ─────────────────────────────
const RATIOS = { square: [1, 1], portrait: [3, 4], landscape: [4, 3], wide: [16, 9], tall: [9, 16] };
async function generate({ prompt, negative, aspect = 'square', seed, steps }, { onProgress = () => {}, signal } = {}) {
  const bin = binPath();
  const id = settings().preset;
  if (!bin || !id || !presetReady(id)) throw Object.assign(new Error('Image generation is not installed'), { code: 'IMAGES_MISSING' });
  const p = PRESETS[id];
  const [rw, rh] = RATIOS[aspect] || RATIOS.square;
  const base = p.size;
  const W = Math.round((rw >= rh ? base : base * rw / rh) / 64) * 64, H = Math.round((rh >= rw ? base : base * rh / rw) / 64) * 64;
  fs.mkdirSync(outDir(), { recursive: true });
  const slug = String(prompt).toLowerCase().normalize('NFD').replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 6).join('-') || 'image';
  const out = path.join(outDir(), `${new Date().toISOString().slice(0, 10)}-${slug}-${Date.now().toString(36).slice(-4)}.png`);
  const sp = await system.getSpecs();
  const args = [...p.files.flatMap((f) => [f.arg, fileOf(f)]), ...p.args, '-p', String(prompt).slice(0, 2000), '-W', String(W), '-H', String(H), '-o', out, '-s', String(seed ?? Math.floor(Math.random() * 2 ** 31))];
  if (steps) { const i = args.indexOf('--steps'); if (i >= 0) args[i + 1] = String(Math.max(1, Math.min(50, steps))); }
  if (negative && id === 'sd-turbo') args.push('-n', String(negative).slice(0, 500));
  if (id === 'z-image-turbo' && (sp.gpuBudgetGB || 0) < 10 && sp.accel !== 'metal') args.push('--offload-to-cpu');
  if (sp.accel === 'cpu') args.push('-t', String(Math.max(2, Math.round(os.cpus().length / 2))));
  const t0 = Date.now();
  let log = '';
  const run = (argv) => new Promise((resolve) => {
    const proc = spawn(bin, argv, { cwd: path.dirname(bin), windowsHide: true });
    if (signal) signal.addEventListener('abort', () => { try { proc.kill(); } catch {} }, { once: true });
    const on = (d) => {
      const s = String(d); log = (log + s).slice(-6000);
      const m = s.match(/(\d+)\/(\d+)\s*-\s*[\d.]+\s*(?:s\/it|it\/s)/g);
      if (m) { const [a, b] = m[m.length - 1].match(/(\d+)\/(\d+)/).slice(1).map(Number); onProgress(b ? a / b : 0); }
    };
    proc.stdout.on('data', on); proc.stderr.on('data', on);
    proc.on('error', (e) => { log += String(e.message); resolve(-1); });
    proc.on('close', resolve);
  });
  // A GPU that already failed here (virtual Mac GPUs, some old cards) goes straight to the processor.
  const cpuArgs = () => [...args.filter((x) => x !== '--vae-on-cpu' && x !== '--clip-on-cpu'), '--backend', 'cpu', ...(args.includes('-t') ? [] : ['-t', String(Math.max(2, Math.round(os.cpus().length / 2)))])];
  const gpuFailed = /metal|vulkan|buffer is nil|out of memory|ErrorOutOfDeviceMemory|ggml_metal|failed to allocate/i;
  const cpuOnly = settings().cpuOnly && (settings().cpuOnly === true || settings().cpuOnly === (readMeta() || {}).asset);
  let code = await run(cpuOnly && sp.accel !== 'cpu' ? cpuArgs() : args);
  // Some Metal / Vulkan drivers fail on large buffers: retry with the text encoder and the VAE on the
  // processor (far less video memory), then everything on the processor.
  if (code !== 0 && !(signal && signal.aborted) && gpuFailed.test(log) && !cpuOnly) {
    const metalBroken = /buffer is nil|ggml_metal/i.test(log); // a driver problem, not a lack of memory
    log = ''; try { fs.rmSync(out, { force: true }); } catch {}
    code = await run([...args, '--vae-on-cpu', '--clip-on-cpu']);
    if (code !== 0 && !(signal && signal.aborted)) {
      log = ''; try { fs.rmSync(out, { force: true }); } catch {}
      code = await run(cpuArgs());
      // remembered for this engine build only: an update gets another chance on the GPU
      if (code === 0 && fs.existsSync(out) && metalBroken) await store.setSettings({ images: { cpuOnly: (readMeta() || {}).asset || true } }).catch(() => {});
    }
  }
  if (code !== 0 || !fs.existsSync(out)) {
    const tail = log.split('\n').filter((l) => /error|fail|out of memory|cuda|vulkan/i.test(l)).slice(-4).join(' | ') || log.slice(-400);
    throw Object.assign(new Error(signal && signal.aborted ? 'Stopped' : `Image generation failed: ${tail}`), { code: 'IMAGES_FAILED' });
  }
  const buf = fs.readFileSync(out);
  return { path: out, width: W, height: H, preset: id, ms: Date.now() - t0, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
}

module.exports = { status, install, generate, PRESETS, recommended };
