// Python runtime, installed on demand ("Installer les dépendances"): a portable CPython
// (python-build-standalone) in userData/deps/python. Used by run_python for data work, charts, files.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { downloadFile } = require('../download');
const agent = require('./index');
const files = require('./files');

const root = () => path.join(app.getPath('userData'), 'deps');
const pyDir = () => path.join(root(), 'python');
const pyBin = () => (process.platform === 'win32' ? path.join(pyDir(), 'python.exe') : path.join(pyDir(), 'bin', 'python3'));
const installed = () => fs.existsSync(pyBin());

function triple() {
  const a = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'win32') return `${a}-pc-windows-msvc`;
  if (process.platform === 'darwin') return `${a}-apple-darwin`;
  return `${a}-unknown-linux-gnu`;
}

let installing = null;
async function install(onProgress = () => {}) {
  if (installed()) return { ok: true };
  if (installing) return installing;
  installing = (async () => {
    const r = await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=4', { headers: { 'User-Agent': 'Fabro', Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const rels = await r.json();
    const re = new RegExp(`^cpython-3\\.12\\.\\d+\\+\\d+-${triple()}-install_only\\.tar\\.gz$`);
    let asset = null;
    for (const rel of rels) { asset = (rel.assets || []).find((x) => re.test(x.name)); if (asset) break; }
    if (!asset) throw new Error('No Python build for this computer');
    fs.mkdirSync(root(), { recursive: true });
    const tgz = path.join(root(), asset.name);
    await downloadFile(asset.browser_download_url, tgz, { onProgress: (n, t) => onProgress(t ? n / t : 0) });
    fs.rmSync(pyDir(), { recursive: true, force: true });
    await new Promise((res, rej) => execFile('tar', ['-xzf', tgz, '-C', root()], { windowsHide: true }, (e) => (e ? rej(e) : res())));
    fs.rmSync(tgz, { force: true });
    if (!installed()) throw new Error('Python archive did not contain the interpreter');
    return { ok: true };
  })();
  try { return await installing; } finally { installing = null; }
}

function deps() { return { python: { installed: installed(), path: installed() ? pyBin() : null, sizeMB: 32 } }; }

// Python runs in the tool runtime process.
async function run(bin, args, opts, onData) {
  const r = await require('../runtime').exec({ bin, args, cwd: opts.cwd, env: opts.env, timeout: opts.timeout || 120000 }, { onData: (s) => onData && onData(s) });
  return { code: r.code, out: (r.out || '') + (r.err || '') + (r.killed ? '\n[stopped: time limit]' : '') };
}

agent.register({
  name: 'run_python', category: 'python', risk: 'exec', keywords: ['python', 'script', 'calcul', 'calcule', 'csv', 'excel', 'graph', 'chart', 'graphique', 'données', 'data', 'analy', 'statist', 'plot'],
  description: 'Run Python 3.12 code (pandas, matplotlib… can be installed with `packages`). Files you write in the working folder (default Documents/Fabro) are kept. Print results you need to see.',
  parameters: { type: 'object', properties: { code: { type: 'string' }, packages: { type: 'array', items: { type: 'string' }, description: 'pip packages to install first' }, cwd: { type: 'string' } }, required: ['code'] },
  summarize: (a) => `${(a.packages || []).length ? `pip install ${a.packages.join(' ')}\n` : ''}${String(a.code).slice(0, 400)}`,
  async run(a, ctx) {
    if (!installed()) { await ctx.needDeps('python'); if (!installed()) throw new Error('Python is not installed'); }
    const cwd = a.cwd ? files.resolvePath(a.cwd) : files.defaultOut();
    fs.mkdirSync(cwd, { recursive: true });
    if (a.cwd) await files.access(cwd, ctx, true);
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MPLBACKEND: 'Agg', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
    let log = '';
    if (a.packages && a.packages.length) {
      const pkgs = a.packages.filter((p) => /^[A-Za-z0-9_.\-\[\]=<>~!, ]+$/.test(p));
      const r = await run(pyBin(), ['-m', 'pip', 'install', '--quiet', ...pkgs], { cwd, env, timeout: 600000 }, (s) => ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, text: s }));
      log += `$ pip install ${pkgs.join(' ')} (exit ${r.code})\n${r.out.slice(-3000)}\n`;
    }
    const before = new Set(fs.readdirSync(cwd));
    const script = path.join(os.tmpdir(), `fabro-${Date.now().toString(36)}.py`);
    fs.writeFileSync(script, String(a.code), 'utf8');
    const t0 = Date.now();
    const r = await run(pyBin(), [script], { cwd, env, timeout: 180000 }, (s) => ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, text: s }));
    fs.rmSync(script, { force: true });
    const created = fs.readdirSync(cwd).filter((f) => !before.has(f)).map((f) => path.join(cwd, f));
    created.forEach((f) => files.touched(ctx, f, 'created'));
    const imgs = created.filter((f) => /\.(png|jpe?g)$/i.test(f)).slice(0, 1);
    const image = imgs[0] && fs.statSync(imgs[0]).size < 4 << 20 ? `data:image/${/png$/i.test(imgs[0]) ? 'png' : 'jpeg'};base64,${fs.readFileSync(imgs[0]).toString('base64')}` : undefined;
    const out = r.out.length > 16000 ? r.out.slice(0, 6000) + '\n…\n' + r.out.slice(-8000) : r.out;
    return { content: `${log}(exit ${r.code}, ${((Date.now() - t0) / 1000).toFixed(1)} s, cwd ${cwd})\n${out || '(no output)'}${created.length ? `\nNew files: ${created.join(', ')}` : ''}`, image, view: { kind: 'python', code: r.code, out: out.slice(-5000), created, image } };
  },
});

module.exports = { install, deps, installed, pyPath: pyBin };
