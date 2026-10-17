// Code mode backend: project folder, file tree with git status, editor I/O, git, integrated
// terminal (Terminal / Tests / Problems), project instructions (FABRO.md / AGENTS.md / CLAUDE.md).
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./store');
const agent = require('./agent');
const { downloadFile } = require('./download');

let emit = () => {};
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'coverage', '.cache', '.turbo', '.gradle', 'bin', 'obj']);
const inside = (p, root) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
function within(root, rel) {
  const p = path.resolve(root, rel || '.');
  if (!inside(p, path.resolve(root))) throw new Error('Outside the project folder');
  return p;
}

// ───────────────────────────── git ─────────────────────────────
function gitBin() {
  const portable = path.join(app.getPath('userData'), 'deps', 'git', 'cmd', 'git.exe');
  return process.platform === 'win32' && fs.existsSync(portable) ? portable : 'git';
}
function git(root, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(gitBin(), args, { cwd: root, windowsHide: true, maxBuffer: 32 << 20, timeout: opts.timeout || 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
  });
}
async function hasGit() { return (await git(process.cwd(), ['--version'])).ok; }
async function status(root) {
  const r = await git(root, ['status', '--porcelain=v1', '-b', '-uall']);
  if (!r.ok) return { repo: false, branch: null, files: {} };
  const lines = r.out.split('\n').filter(Boolean);
  const head = lines.shift() || '';
  const branch = (head.match(/^## (?:No commits yet on )?([^.\s]+)/) || [])[1] || null;
  const ab = head.match(/\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/);
  const files = {};
  for (const l of lines) {
    const x = l.slice(0, 2); let f = l.slice(3);
    if (f.includes(' -> ')) f = f.split(' -> ')[1];
    f = f.replace(/^"|"$/g, '');
    files[f] = x === '??' ? 'U' : x.includes('D') ? 'D' : x.includes('A') ? 'A' : x.includes('R') ? 'R' : 'M';
  }
  return { repo: true, branch, ahead: ab && +ab[1] || 0, behind: ab && +ab[2] || 0, files };
}
async function headContent(root, rel) {
  const r = await git(root, ['show', `HEAD:${rel.split(path.sep).join('/')}`]);
  return r.ok ? r.out : null;
}

// ───────────────────────────── tree & files ─────────────────────────────
async function tree(root, rel = '') {
  const dir = within(root, rel);
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  return ents.filter((e) => !(e.name.startsWith('.') && !['.github', '.env.example', '.gitignore'].includes(e.name)) && !IGNORE.has(e.name))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 800)
    .map((e) => ({ name: e.name, path: path.join(rel, e.name), dir: e.isDirectory() }));
}
async function readFile(root, rel) {
  const p = within(root, rel);
  const st = await fsp.stat(p);
  if (st.size > 2 << 20) return { path: rel, tooBig: true, size: st.size };
  const buf = await fsp.readFile(p);
  if (buf.subarray(0, 8000).includes(0)) return { path: rel, binary: true, size: st.size };
  return { path: rel, content: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs };
}
async function writeFile(root, rel, content) { const p = within(root, rel); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, content, 'utf8'); return true; }

// Project instructions, like CLAUDE.md.
const INSTR = ['FABRO.md', 'AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];
function instructions(root) {
  for (const f of INSTR) { const p = path.join(root, f); if (fs.existsSync(p)) { try { return { file: f, text: fs.readFileSync(p, 'utf8').slice(0, 20000) }; } catch {} } }
  return null;
}

// Commands this project knows (for the Tests / Problems tabs and the AI).
function detect(root) {
  const out = { test: null, lint: null, build: null, run: null, kind: 'unknown' };
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('package.json')) {
    out.kind = 'node';
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); const sc = pj.scripts || {};
      const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
      const r = (k) => (sc[k] ? `${pm} ${pm === 'npm' && k !== 'test' ? 'run ' : ''}${k}` : null);
      out.test = r('test'); out.lint = r('lint') || (has('tsconfig.json') ? 'npx tsc --noEmit' : null); out.build = r('build'); out.run = r('dev') || r('start');
    } catch {}
  } else if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) {
    out.kind = 'python'; out.test = 'python -m pytest -q'; out.lint = 'python -m pyflakes .';
  } else if (has('Cargo.toml')) { out.kind = 'rust'; out.test = 'cargo test'; out.lint = 'cargo clippy --quiet'; out.build = 'cargo build'; }
  else if (has('go.mod')) { out.kind = 'go'; out.test = 'go test ./...'; out.lint = 'go vet ./...'; out.build = 'go build ./...'; }
  return out;
}

// Problems from compiler / linter output: file:line:col message.
function problems(text) {
  const list = []; const seen = new Set();
  for (const raw of String(text).split('\n')) {
    const l = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const m = l.match(/^\s*([^\s:(][^:(]*?\.[a-zA-Z0-9]+)[:(](\d+)[:,](\d+)\)?:?\s*-?\s*(error|warning|warn|info)?\s*:?\s*(.+)$/i)
      || l.match(/^\s*File "([^"]+)", line (\d+)()(.*)$/) && null;
    if (m) { const k = m[1] + m[2] + m[5]; if (seen.has(k)) continue; seen.add(k); list.push({ file: m[1].trim(), line: +m[2], col: +m[3] || 1, severity: /warn/i.test(m[4] || l) ? 'warning' : 'error', message: m[5].trim().slice(0, 300) }); }
    if (list.length >= 300) break;
  }
  return list;
}
// Test summary from common runners.
function testSummary(text, code) {
  const t = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  const num = (re) => { const m = t.match(re); return m ? +m[1] : null; };
  const passed = num(/(\d+) passed/i) ?? num(/Tests:.*?(\d+) passed/i) ?? num(/# pass (\d+)/i) ?? num(/test result: \w+\. (\d+) passed/i);
  const failed = num(/(\d+) failed/i) ?? num(/# fail (\d+)/i) ?? num(/(\d+) failing/i);
  const failures = [...t.matchAll(/(?:✕|✗|FAIL(?:ED)?|×)\s+(.{3,160})/g)].map((m) => m[1].trim()).slice(0, 50);
  return { ok: code === 0, passed, failed: failed ?? (code === 0 ? 0 : null), failures };
}

// ───────────────────────────── terminal ─────────────────────────────
const procs = new Map();
function run(root, command, kind = 'terminal') {
  const id = kind + '-' + Date.now().toString(36);
  const win = process.platform === 'win32';
  const [bin, pre] = win ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']] : [process.env.SHELL || '/bin/bash', ['-lc']];
  const p = spawn(bin, [...pre, command], { cwd: root, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', CI: '1' } });
  let out = '';
  procs.set(id, p);
  const push = (d) => { const s = String(d); out += s; emit('code:term', { id, kind, data: s }); };
  p.stdout.on('data', push); p.stderr.on('data', push);
  p.on('error', (e) => push(String(e.message)));
  p.on('close', (code) => {
    procs.delete(id);
    const extra = kind === 'tests' ? { summary: testSummary(out, code), problems: problems(out) } : kind === 'lint' ? { problems: problems(out) } : {};
    emit('code:exit', { id, kind, code, ...extra });
  });
  return id;
}
function kill(id) { const p = procs.get(id); if (p) try { p.kill(); } catch {} return true; }

// ───────────────────────────── agent tools for code sessions ─────────────────────────────
const projectOf = (ctx) => ctx.projectRoot;
agent.register({
  name: 'git_status', category: 'git', risk: 'read', keywords: ['git', 'commit', 'branch', 'diff', 'branche'],
  description: 'Show the current branch and changed files of the project repository.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Project folder (defaults to the open project)' } } },
  summarize: (a) => a.path || '',
  async run(a, ctx) { const root = a.path || projectOf(ctx); if (!root) throw new Error('No project folder'); const s = await status(root); return { content: s.repo ? `Branch ${s.branch}${s.ahead ? ` (ahead ${s.ahead})` : ''}\n${Object.entries(s.files).map(([f, k]) => `${k} ${f}`).join('\n') || 'Clean working tree'}` : 'Not a git repository', view: { kind: 'git', branch: s.branch, count: Object.keys(s.files).length } }; },
});
agent.register({
  name: 'git_diff', category: 'git', risk: 'read', untrusted: true,
  description: 'Show the diff of uncommitted changes (whole project or one file).',
  parameters: { type: 'object', properties: { file: { type: 'string' }, path: { type: 'string' } } },
  summarize: (a) => a.file || 'all',
  async run(a, ctx) { const root = a.path || projectOf(ctx); const r = await git(root, ['diff', 'HEAD', '--stat', '-p', ...(a.file ? ['--', a.file] : [])]); return { content: (r.out || r.err || 'No changes').slice(0, 30000), view: { kind: 'git' } }; },
});
agent.register({
  name: 'git_commit', category: 'git', risk: 'write',
  description: 'Commit changes with a message (all changed files unless `files` is given). Optionally create/switch to `branch` first.',
  parameters: { type: 'object', properties: { message: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, branch: { type: 'string' }, path: { type: 'string' } }, required: ['message'] },
  summarize: (a) => `${a.branch ? `[${a.branch}] ` : ''}${a.message}`,
  async run(a, ctx) {
    const root = a.path || projectOf(ctx);
    if (a.branch) { const sw = await git(root, ['switch', a.branch]); if (!sw.ok) await git(root, ['switch', '-c', a.branch]); }
    const add = await git(root, ['add', ...(a.files && a.files.length ? ['--', ...a.files] : ['-A'])]);
    if (!add.ok) throw new Error(add.err);
    const c = await git(root, ['commit', '-m', a.message]);
    if (!c.ok) throw new Error(c.err || c.out);
    emit('code:changed', { root });
    return { content: c.out.trim(), view: { kind: 'commit', message: a.message } };
  },
});

// ───────────────────────────── dependencies (Code mode) ─────────────────────────────
async function deps() { return { git: await hasGit() || (process.platform === 'win32' && fs.existsSync(path.join(app.getPath('userData'), 'deps', 'git', 'cmd', 'git.exe'))) }; }
async function install(onProgress = () => {}) {
  if ((await deps()).git) return { ok: true };
  if (process.platform !== 'win32') throw new Error('Install git with your package manager (e.g. apt install git / xcode-select --install)');
  const r = await fetch('https://api.github.com/repos/git-for-windows/git/releases/latest', { headers: { 'User-Agent': 'Fabro' } });
  const j = await r.json();
  const asset = (j.assets || []).find((x) => /^MinGit-[\d.]+-64-bit\.zip$/.test(x.name));
  if (!asset) throw new Error('MinGit not found');
  const dir = path.join(app.getPath('userData'), 'deps', 'git');
  const zip = dir + '.zip';
  await downloadFile(asset.browser_download_url, zip, { onProgress: (n, t) => onProgress(t ? n / t : 0) });
  fs.rmSync(dir, { recursive: true, force: true });
  await require('extract-zip')(zip, { dir });
  fs.rmSync(zip, { force: true });
  return { ok: true };
}

function init(emitter) { emit = emitter; }

module.exports = { init, status, tree, readFile, writeFile, headContent, git, instructions, detect, problems, testSummary, run, kill, deps, install, within };
