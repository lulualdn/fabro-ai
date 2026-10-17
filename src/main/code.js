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
async function hasGit() { return (await git(process.cwd() || require('os').homedir(), ['--version'])).ok; }
// Commits need a name/email: use the user's git identity, else a local fallback (never fails on a fresh PC).
async function identity(root) {
  const e = await git(root, ['config', 'user.email']);
  if (e.ok && e.out.trim()) return [];
  const name = (require('os').userInfo().username || 'Fabro user');
  return ['-c', `user.name=${name}`, '-c', `user.email=${name.replace(/\s+/g, '.')}@localhost`];
}
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
// Run and wait (used by the AI's run_tests / run_lint): output streams to the Tests / Problems tabs.
function runWait(root, command, kind, ctx) {
  return new Promise((resolve) => {
    const id = run(root, command, kind);
    const p = procs.get(id);
    let out = '';
    const t = setTimeout(() => kill(id), 15 * 60000);
    if (ctx && ctx.onAbort) ctx.onAbort(() => kill(id));
    if (!p) return resolve({ code: -1, out: 'could not start' });
    const onData = (d) => { out += d; if (ctx && ctx.emit) ctx.emit({ type: 'tool_progress', id: ctx.callId, text: String(d) }); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
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
    const c = await git(root, [...await identity(root), 'commit', '-m', a.message]);
    if (!c.ok) throw new Error(c.err || c.out);
    emit('code:changed', { root });
    return { content: c.out.trim(), view: { kind: 'commit', message: a.message } };
  },
});

const clip = (s) => (s.length > 14000 ? s.slice(0, 4000) + '\n…\n' + s.slice(-9000) : s);
agent.register({
  name: 'run_tests', category: 'code', risk: 'exec', codeOnly: true, categoryCore: true,
  description: 'Run the project\'s tests (detected command, or `command`), optionally filtered. Returns a summary (passed/failed, failing tests) and the output. Results also show in the Tests tab.',
  parameters: { type: 'object', properties: { command: { type: 'string', description: 'Override the detected test command' }, filter: { type: 'string', description: 'Test name or file to run only' } } },
  summarize: (a) => a.command || 'tests',
  async run(a, ctx) {
    const root = projectOf(ctx); if (!root) throw new Error('No project open');
    let cmd = a.command || detect(root).test;
    if (!cmd) throw new Error('No test command found — pass `command`');
    if (a.filter && !a.command) cmd += /pytest/.test(cmd) ? ` -k "${a.filter}"` : /cargo|go test/.test(cmd) ? ` ${a.filter}` : ` -- ${a.filter}`;
    const r = await runWait(root, cmd, 'tests', ctx);
    const sum = testSummary(r.out, r.code);
    const probs = problems(r.out).slice(0, 40);
    return { content: `$ ${cmd}\n(exit ${r.code}) ${sum.passed != null ? `${sum.passed} passed` : ''}${sum.failed ? `, ${sum.failed} failed` : ''}\n${sum.failures.length ? 'Failing:\n' + sum.failures.map((f) => '- ' + f).join('\n') + '\n' : ''}${probs.length ? 'Locations:\n' + probs.map((p) => `${p.file}:${p.line}: ${p.message}`).join('\n') + '\n' : ''}\n${clip(r.out)}`,
      view: { kind: 'tests', command: cmd, code: r.code, ...sum, out: r.out.slice(-6000) } };
  },
});
agent.register({
  name: 'run_lint', category: 'code', risk: 'exec', codeOnly: true, categoryCore: true,
  description: 'Run the project\'s linter / type checker (detected, or `command`) and get the problems as file:line: message. Problems also show in the Problems tab.',
  parameters: { type: 'object', properties: { command: { type: 'string' } } },
  summarize: (a) => a.command || 'lint',
  async run(a, ctx) {
    const root = projectOf(ctx); if (!root) throw new Error('No project open');
    const cmd = a.command || detect(root).lint;
    if (!cmd) throw new Error('No lint command found — pass `command`');
    const r = await runWait(root, cmd, 'lint', ctx);
    const probs = problems(r.out);
    return { content: `$ ${cmd}\n(exit ${r.code}) ${probs.length} problem(s)\n${probs.slice(0, 80).map((p) => `${p.file}:${p.line}:${p.col} ${p.severity}: ${p.message}`).join('\n')}${probs.length ? '' : '\n' + clip(r.out)}`,
      view: { kind: 'lint', command: cmd, code: r.code, count: probs.length, errors: probs.filter((p) => p.severity === 'error').length } };
  },
});

// ───────────────────────────── preview server (Aperçu) ─────────────────────────────
const http = require('http');
let preview = null;
const MIME = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm', mp4: 'video/mp4', mp3: 'audio/mpeg' };
async function previewUrl(root, rel) {
  if (!preview || preview.root !== root) {
    if (preview) try { preview.server.close(); } catch {}
    const server = http.createServer((req, res) => {
      let p; try { p = within(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '')); } catch { res.writeHead(403); return res.end(); }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    preview = { root, server, port: server.address().port };
  }
  return `http://127.0.0.1:${preview.port}/${String(rel || '').split(path.sep).map(encodeURIComponent).join('/')}`;
}

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

// ───────────────────────────── checkpoints (undo an agent turn) ─────────────────────────────
// For each conversation: the content of every file before the agent first touched it, per turn.
const cpDir = () => path.join(app.getPath('userData'), 'checkpoints');
const cpFile = (convId) => path.join(cpDir(), String(convId).replace(/[^a-z0-9_-]/gi, '_') + '.json');
function loadCp(convId) { try { return JSON.parse(fs.readFileSync(cpFile(convId), 'utf8')); } catch { return { turns: [] }; } }
function saveCp(convId, data) { fs.mkdirSync(cpDir(), { recursive: true }); fs.writeFileSync(cpFile(convId), JSON.stringify(data)); }
function recordTurn(convId, turnId, root, filesBefore) {
  if (!convId || !Object.keys(filesBefore).length) return null;
  const data = loadCp(convId);
  data.turns.push({ id: turnId, root, at: Date.now(), files: filesBefore });
  // keep it reasonable: 60 turns, files ≤ 2 MB each were already filtered by the tools
  if (data.turns.length > 60) data.turns = data.turns.slice(-60);
  saveCp(convId, data);
  return turnId;
}
// Restore every file to its state before `turnId` (that turn and all later ones are undone).
async function revert(convId, turnId) {
  const data = loadCp(convId);
  const i = data.turns.findIndex((t) => t.id === turnId);
  if (i < 0) throw new Error('Checkpoint not found');
  const root = data.turns[i].root;
  const firstState = {};
  for (const t of data.turns.slice(i)) for (const [f, c] of Object.entries(t.files)) if (!(f in firstState)) firstState[f] = c;
  const done = [];
  for (const [f, c] of Object.entries(firstState)) {
    if (c == null) { try { fs.rmSync(f, { force: true }); done.push(f); } catch {} }
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c, 'utf8'); done.push(f); }
  }
  data.turns = data.turns.slice(0, i);
  saveCp(convId, data);
  emit('code:changed', { root });
  return { files: done };
}
// Baseline of a file for this conversation (before the agent's first change), for the Diff view.
function baseline(convId, file) {
  for (const t of loadCp(convId).turns) if (file in t.files) return { content: t.files[file], turn: t.id };
  return null;
}
async function fileDiff(convId, root, rel) {
  const abs = within(root, rel);
  let after = null; try { after = fs.readFileSync(abs, 'utf8'); } catch {}
  const b = convId ? baseline(convId, abs) : null;
  let before = b ? b.content : null, source = b ? 'session' : null;
  if (!b) { const h = await headContent(root, path.relative(root, abs)); if (h != null) { before = h; source = 'git'; } else if (after != null) { before = ''; source = 'new'; } }
  return { path: rel, before: before ?? '', after: after ?? '', deleted: after == null, source };
}
// Files changed by the agent in this conversation, with +/− counts against their baseline.
function sessionChanges(convId) {
  const seen = new Map();
  for (const t of loadCp(convId).turns) for (const [f, c] of Object.entries(t.files)) if (!seen.has(f)) seen.set(f, c);
  return [...seen.entries()].map(([f, before]) => {
    let after = null; try { after = fs.readFileSync(f, 'utf8'); } catch {}
    const d = require('./agent/files').lineDiff(before || '', after || '');
    return { path: f, created: before == null, deleted: after == null, ...d };
  }).filter((x) => x.add || x.del || x.deleted || x.created);
}

// ───────────────────────────── projects ─────────────────────────────
function projectSettings(root) { return ((store.getSettings().code || {}).projects || {})[root] || {}; }
async function setProject(root, patch) {
  const cur = (store.getSettings().code || {}).projects || {};
  await store.setSettings({ code: { projects: { ...cur, [root]: { ...(cur[root] || {}), ...patch } } } });
  return projectSettings(root);
}
async function touchRecent(root) {
  const rec = ((store.getSettings().code || {}).recent || []).filter((r) => r !== root);
  await store.setSettings({ code: { recent: [root, ...rec].slice(0, 12) } });
}
function recent() { return ((store.getSettings().code || {}).recent || []).filter((r) => fs.existsSync(r)).map((r) => ({ root: r, name: path.basename(r), ...detect(r) })); }
async function info(root) {
  if (!fs.existsSync(root)) throw new Error('Folder not found');
  await touchRecent(root);
  return { root, name: path.basename(root), git: await status(root), hasGit: await hasGit(), instructions: instructions(root), commands: detect(root), settings: projectSettings(root) };
}
async function branches(root) { const r = await git(root, ['branch', '--format=%(refname:short)']); return r.ok ? r.out.split('\n').filter(Boolean) : []; }
async function log(root, n = 15) {
  const r = await git(root, ['log', `-${n}`, '--pretty=format:%h%x09%an%x09%ar%x09%s']);
  return r.ok ? r.out.split('\n').filter(Boolean).map((l) => { const [hash, author, when, subject] = l.split('\t'); return { hash, author, when, subject }; }) : [];
}
async function gitAction(root, action, arg) {
  let r;
  if (action === 'init') r = await git(root, ['init']);
  else if (action === 'switch') { r = await git(root, ['switch', arg]); if (!r.ok) r = await git(root, ['switch', '-c', arg]); }
  else if (action === 'commit') { await git(root, ['add', '-A']); r = await git(root, [...await identity(root), 'commit', '-m', arg || 'Update']); }
  else if (action === 'discard') { const rel = arg; const st = (await status(root)).files[rel]; r = st === 'U' ? (fs.rmSync(within(root, rel), { force: true }), { ok: true }) : await git(root, ['restore', '--staged', '--worktree', '--', rel]); }
  else if (action === 'undoCommit') r = await git(root, ['reset', '--soft', 'HEAD~1']);
  else throw new Error('Unknown git action');
  if (!r.ok) throw new Error((r.err || r.out).trim().slice(0, 600));
  emit('code:changed', { root });
  return status(root);
}

// Watch the open project so the tree and git badges follow changes made outside Fabro too.
let watcher = null, watchRoot = null, watchT = null;
function watch(root) {
  if (watchRoot === root) return;
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  watchRoot = root;
  if (!root) return;
  try {
    watcher = fs.watch(root, { recursive: true }, (_e, f) => {
      if (f && /(^|[\\/])(node_modules|\.git[\\/]objects|dist|build|target|__pycache__)([\\/]|$)/.test(f)) return;
      clearTimeout(watchT); watchT = setTimeout(() => emit('code:changed', { root, file: f }), 300);
    });
    watcher.on('error', () => {});
  } catch {}
}

function init(emitter) { emit = emitter; }

module.exports = { init, status, tree, readFile, writeFile, headContent, git, instructions, detect, problems, testSummary, run, kill, deps, install, within,
  watch, recordTurn, revert, previewUrl, runWait, fileDiff, sessionChanges, projectSettings, setProject, recent, info, branches, log, gitAction, touchRecent };
