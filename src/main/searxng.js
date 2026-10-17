// SearXNG — Fabro's search engine. Either a private instance managed by Fabro (installed on demand
// into userData/deps/searxng, runs on 127.0.0.1 only, started on first search) or a SearXNG URL the
// user provides. Used by web_search (chat), browser_search (agent) and the agent browser's address bar.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawn, execFile } = require('child_process');

let paths = null; // { deps, python() } — injected (electron-free for tests)
let proc = null, port = 0, starting = null, lastErr = '';
let installing = null;

function configure(p) { paths = p; }
const dir = () => path.join(paths.deps, 'searxng');
const srcDir = () => path.join(dir(), 'src');
const venvPy = () => (process.platform === 'win32' ? path.join(dir(), 'venv', 'Scripts', 'python.exe') : path.join(dir(), 'venv', 'bin', 'python'));
const installed = () => !!paths && fs.existsSync(venvPy()) && fs.existsSync(path.join(srcDir(), 'searx', 'webapp.py')) && fs.existsSync(path.join(dir(), 'ok'));

function run(bin, args, opts = {}, onData) {
  return new Promise((resolve, reject) => {
    let out = '';
    const p = spawn(bin, args, { windowsHide: true, ...opts });
    p.stdout.on('data', (d) => { out += d; onData && onData(String(d)); });
    p.stderr.on('data', (d) => { out += d; onData && onData(String(d)); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}: ${out.slice(-600)}`))));
  });
}

// Install: private Python (shared with run_python) → SearXNG source → its own venv + requirements.
async function install(onProgress = () => {}) {
  if (installed()) return { ok: true };
  if (installing) return installing;
  installing = (async () => {
    const py = await paths.python(onProgress); // installs python-build-standalone if needed (0 → 30 %)
    onProgress(0.3);
    fs.mkdirSync(dir(), { recursive: true });
    const zip = path.join(dir(), 'src.zip');
    const { downloadFile } = require('./download');
    await downloadFile('https://codeload.github.com/searxng/searxng/zip/refs/heads/master', zip, { onProgress: (n) => onProgress(0.3 + Math.min(0.2, n / 12e6 * 0.2)) });
    const tmp = path.join(dir(), 'unz');
    fs.rmSync(tmp, { recursive: true, force: true });
    await require('extract-zip')(zip, { dir: tmp });
    const top = fs.readdirSync(tmp).find((f) => fs.existsSync(path.join(tmp, f, 'searx')));
    if (!top) throw new Error('SearXNG archive is incomplete');
    fs.rmSync(srcDir(), { recursive: true, force: true });
    fs.renameSync(path.join(tmp, top), srcDir());
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip, { force: true });
    onProgress(0.5);
    await run(py, ['-m', 'venv', path.join(dir(), 'venv')]);
    onProgress(0.55);
    let n = 0;
    await run(venvPy(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--prefer-binary', '-r', path.join(srcDir(), 'requirements.txt')], { env: { ...process.env, PIP_NO_INPUT: '1' } },
      (s) => { n += (s.match(/Collecting|Downloading|Installing/g) || []).length; onProgress(Math.min(0.97, 0.55 + n / 120)); });
    fs.writeFileSync(path.join(dir(), 'ok'), new Date().toISOString());
    onProgress(1);
    return { ok: true };
  })();
  try { return await installing; } finally { installing = null; }
}

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function settingsFile(p, lang) {
  const f = path.join(dir(), 'settings.yml');
  let key = '';
  try { key = (fs.readFileSync(f, 'utf8').match(/secret_key: "([0-9a-f]+)"/) || [])[1] || ''; } catch {}
  key = key || crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(f, [
    'use_default_settings: true',
    'general:', '  instance_name: "Fabro Search"', '  enable_metrics: false',
    'server:', `  secret_key: "${key}"`, '  bind_address: "127.0.0.1"', `  port: ${p}`, '  limiter: false', '  public_instance: false', '  image_proxy: true', '  method: "GET"',
    'search:', '  formats: [html, json]', '  safe_search: 0', '  autocomplete: "duckduckgo"', `  default_lang: "${lang || 'auto'}"`,
    'valkey:', '  url: false',
    'ui:', '  default_theme: simple', '  theme_args:', '    simple_style: auto', '  query_in_title: true', '  infinite_scroll: true', '  center_alignment: true',
    'outgoing:', '  request_timeout: 4.0', '  max_request_timeout: 8.0',
    '',
  ].join('\n'));
  return f;
}
async function healthy(p) { try { const r = await fetch(`http://127.0.0.1:${p}/healthz`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }

// Start the private instance (once). Resolves with its base URL.
async function start(lang) {
  if (proc && port && await healthy(port)) return `http://127.0.0.1:${port}`;
  if (starting) return starting;
  if (!installed()) throw Object.assign(new Error('SearXNG is not installed'), { code: 'SEARXNG_MISSING' });
  starting = (async () => {
    stop();
    port = await freePort();
    const env = { ...process.env, SEARXNG_SETTINGS_PATH: settingsFile(port, lang), PYTHONPATH: srcDir(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
    lastErr = '';
    proc = spawn(venvPy(), ['-m', 'searx.webapp'], { cwd: srcDir(), env, windowsHide: true });
    proc.stderr.on('data', (d) => { lastErr = (lastErr + d).slice(-3000); });
    proc.stdout.on('data', () => {});
    proc.on('exit', () => { proc = null; });
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      if (!proc) throw new Error('SearXNG stopped: ' + lastErr.split('\n').filter(Boolean).slice(-3).join(' '));
      if (await healthy(port)) return `http://127.0.0.1:${port}`;
      await new Promise((r) => setTimeout(r, 400));
    }
    stop();
    throw new Error('SearXNG did not start in time');
  })();
  try { return await starting; } finally { starting = null; }
}
function stop() { if (proc) { try { proc.kill(); } catch {} proc = null; } }

// Base URL to use: the user's own instance, else the private one (started on demand).
async function base(s, lang) {
  if (s.searxngUrl) return s.searxngUrl.replace(/\/+$/, '');
  return start(lang);
}

const CATS = new Set(['general', 'news', 'images', 'videos', 'science', 'it', 'map', 'music', 'files', 'social media']);
async function search(query, s = {}, opts = {}) {
  const b = await base(s, opts.lang);
  const u = new URL(b + '/search');
  u.searchParams.set('q', query); u.searchParams.set('format', 'json');
  if (opts.category && CATS.has(opts.category)) u.searchParams.set('categories', opts.category);
  if (opts.time && ['day', 'week', 'month', 'year'].includes(opts.time)) u.searchParams.set('time_range', opts.time);
  if (opts.lang) u.searchParams.set('language', opts.lang);
  if (opts.page > 1) u.searchParams.set('pageno', String(opts.page));
  const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'Fabro', 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 403) throw new Error('This SearXNG instance does not allow JSON results (enable the json format in its settings)');
  if (!r.ok) throw new Error(`SearXNG HTTP ${r.status}`);
  const j = await r.json();
  const results = (j.results || []).slice(0, opts.limit || 10).map((x) => ({
    title: String(x.title || x.url || '').trim(), url: x.url, snippet: String(x.content || '').trim().slice(0, 400),
    engines: x.engines, date: x.publishedDate || undefined, img: x.img_src || x.thumbnail_src || undefined,
  })).filter((x) => x.url);
  return {
    results,
    answers: (j.answers || []).map((a) => (typeof a === 'string' ? a : a.answer)).filter(Boolean).slice(0, 3),
    infobox: (j.infoboxes || [])[0] ? { title: j.infoboxes[0].infobox, text: String(j.infoboxes[0].content || '').slice(0, 800), url: (j.infoboxes[0].urls || [])[0] && j.infoboxes[0].urls[0].url } : null,
    suggestions: (j.suggestions || []).slice(0, 5),
    pageUrl: `${b}/search?q=${encodeURIComponent(query)}${opts.category ? `&categories=${encodeURIComponent(opts.category)}` : ''}${opts.time ? `&time_range=${opts.time}` : ''}`,
  };
}
async function homeUrl(s, q) {
  const b = await base(s);
  return q ? `${b}/search?q=${encodeURIComponent(q)}` : b + '/';
}

function status() { return { installed: installed(), running: !!proc, port: proc ? port : null }; }
function remove() { stop(); fs.rmSync(dir(), { recursive: true, force: true }); return status(); }

module.exports = { configure, install, installed, start, stop, search, homeUrl, status, remove };
