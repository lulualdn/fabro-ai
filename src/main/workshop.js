// Atelier Linux (prototype, Labs): an isolated Linux environment per project, where the AI can install, build,
// run and test a whole app without touching the PC.
// - Backend: Windows 11 WSL containers (`wslc`, WSL 2.9.3+) are the target but their CLI is still to verify on a
//   real machine, so they are only detected; Podman, then Docker, are used today.
// - Only the project folder is shared (/work). No environment variables or tokens from Fabro go in.
// - Memory and CPU are capped so the local model keeps its room.
// - Ports the app listens on are published on 127.0.0.1 so Fabro's browser can preview them.
// - Restore points: the project's own checkpoints (code.js) still apply, since /work is the real folder.
// - A Windows or Mac app can't be tested here (say so instead of trying).
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const IMAGE = process.env.FABRO_WORKSHOP_IMAGE || 'mcr.microsoft.com/devcontainers/base:bookworm'; // Debian + git, curl, build tools; apt for the rest
const FALLBACK_IMAGE = 'debian:bookworm-slim';
const PREVIEW_PORTS = [3000, 5173, 8000, 8080];

function run(cmd, args, { timeout = 30000, input } = {}) {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (e, stdout, stderr) => resolve({ ok: !e, code: e ? (e.code ?? 1) : 0, out: String(stdout || ''), err: String(stderr || e && !stderr ? (e && e.message) || '' : stderr || '') }));
    if (input != null) { p.stdin.end(input); }
  });
}

let cached = null;
// which container engine is here? { kind: 'podman'|'docker'|null, wslc: bool, note }
async function detect(force) {
  if (cached && !force) return cached;
  const r = { kind: null, wslc: false, note: '' };
  if (process.platform === 'win32') {
    const w = await run('wslc', ['--version'], { timeout: 8000 });
    r.wslc = w.ok; // detected only: see the header
  }
  for (const k of ['podman', 'docker']) {
    const v = await run(k, ['info', '--format', '{{json .}}'], { timeout: 15000 });
    if (v.ok) { r.kind = k; break; }
    if (!r.note && /daemon|connect|socket|machine/i.test(v.err)) r.note = `${k} is installed but not running`;
  }
  if (!r.kind && !r.note) r.note = 'No container engine found. Install Podman Desktop or Docker Desktop (Windows: WSL 2 is needed).';
  cached = r; return r;
}

const nameOf = (root) => 'fabro-ws-' + crypto.createHash('sha1').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 12);
function limits() {
  const gb = os.totalmem() / 2 ** 30;
  // leave the model its room: a quarter of the RAM, between 1 and 8 GB; half the cores, at least 1
  const mem = Math.max(1, Math.min(8, Math.floor(gb / 4)));
  const cpus = Math.max(1, Math.floor(os.cpus().length / 2));
  return { mem: `${mem}g`, cpus: String(cpus) };
}
// docker/podman path for a host folder (Windows paths work as-is with Docker Desktop and Podman)
const vol = (root) => `${path.resolve(root)}:/work`;

async function state(root) {
  const d = await detect(); if (!d.kind) return { engine: null, note: d.note, wslc: d.wslc };
  const name = nameOf(root);
  const r = await run(d.kind, ['inspect', '--format', '{{.State.Status}}', name], { timeout: 10000 });
  const ports = r.ok ? (await run(d.kind, ['port', name], { timeout: 10000 })).out.trim().split('\n').filter(Boolean) : [];
  return { engine: d.kind, wslc: d.wslc, name, status: r.ok ? r.out.trim() : 'absent', ports, limits: limits() };
}

async function ensure(root, { onLine } = {}) {
  const d = await detect(); if (!d.kind) throw new Error(d.note);
  if (!fs.existsSync(root)) throw new Error('Project folder not found.');
  const name = nameOf(root); const st = await state(root);
  if (st.status === 'running') return st;
  if (st.status !== 'absent') { const s = await run(d.kind, ['start', name], { timeout: 60000 }); if (s.ok) return state(root); await run(d.kind, ['rm', '-f', name]); }
  const L = limits();
  let image = IMAGE;
  if (!(await run(d.kind, ['image', 'inspect', image], { timeout: 10000 })).ok) {
    if (onLine) onLine(`Downloading the Linux image (${image}), once…`);
    const p = await run(d.kind, ['pull', image], { timeout: 15 * 60000 });
    if (!p.ok) { image = FALLBACK_IMAGE; const p2 = await run(d.kind, ['pull', image], { timeout: 10 * 60000 }); if (!p2.ok) throw new Error('Could not download a Linux image: ' + (p2.err || p.err).slice(0, 300)); }
  }
  const args = ['run', '-d', '--name', name, '--hostname', 'atelier', '--label', 'fabro.workshop=1', '--label', `fabro.root=${path.resolve(root)}`,
    '-v', vol(root), '-w', '/work', '--memory', L.mem, '--cpus', L.cpus, '--pids-limit', '2048',
    ...PREVIEW_PORTS.flatMap((p) => ['-p', `127.0.0.1::${p}`]),
    '--env', 'HOME=/root', '--env', 'TERM=xterm-256color', image, 'sleep', 'infinity'];
  const c = await run(d.kind, args, { timeout: 120000 });
  if (!c.ok) throw new Error('Could not start the workshop: ' + c.err.slice(0, 400));
  return state(root);
}

// run a shell command in the workshop, streaming lines; returns { code, out } (out trimmed to the last 20 000 chars)
async function exec(root, command, { timeout = 10 * 60000, onLine, signal } = {}) {
  const d = await detect(); if (!d.kind) throw new Error(d.note);
  await ensure(root, { onLine });
  return new Promise((resolve) => {
    const p = spawn(d.kind, ['exec', '-i', '-w', '/work', nameOf(root), 'bash', '-lc', String(command)], { windowsHide: true });
    let out = ''; const add = (x) => { const s = String(x); out = (out + s).slice(-20000); if (onLine) for (const l of s.split('\n')) if (l.trim()) onLine(l); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const t = setTimeout(() => { add('\n[stopped: time limit]'); p.kill(); }, timeout);
    if (signal) signal.addEventListener('abort', () => { add('\n[stopped]'); p.kill(); }, { once: true });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 1, out: String(e.message) }); });
  });
}
async function stop(root) { const d = await detect(); if (d.kind) await run(d.kind, ['stop', '-t', '2', nameOf(root)], { timeout: 30000 }); return state(root); }
async function reset(root) { const d = await detect(); if (d.kind) await run(d.kind, ['rm', '-f', nameOf(root)], { timeout: 30000 }); return state(root); }
// host URL for a port the app listens on inside (for the preview)
async function previewUrl(root, port) {
  const st = await state(root);
  const line = st.ports.find((l) => l.startsWith(`${port}/tcp`));
  const m = line && line.match(/:(\d+)\s*$/);
  return m ? `http://127.0.0.1:${m[1]}` : null;
}

// ───────────────────────────── agent tool (Labs) ─────────────────────────────
function registerTool() {
  const agent = require('./agent');
  const store = require('./store');
  agent.register({
    name: 'workshop', category: 'code', risk: 'exec', codeOnly: true, keywords: ['linux', 'atelier', 'workshop', 'container', 'conteneur', 'docker', 'apt', 'sandbox'],
    description: 'Linux workshop (isolated container) for the open project: the project folder is /work, nothing else of the PC is visible. Use it to install packages (apt, npm, pip), build, run servers and tests without touching the PC. action: "run" (command), "status", "preview" (port → URL to open in the browser), "stop", "reset" (delete the container; files in /work stay). Not for Windows or Mac apps.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['run', 'status', 'preview', 'stop', 'reset'] }, command: { type: 'string' }, port: { type: 'number' }, timeout_s: { type: 'number' } }, required: ['action'] },
    summarize: (a) => a.action === 'run' ? a.command : a.action,
    guard() { return (store.getSettings().labs || {}).workshop ? null : { refuse: 'The Linux workshop is a Labs feature and is off. The user can turn it on in Settings › Advanced › Labs.' }; },
    async run(a, ctx) {
      const root = ctx && ctx.projectRoot; if (!root) throw new Error('Open a project in Fabro Code first.');
      if (a.action === 'status') { const s = await state(root); return { content: JSON.stringify(s), view: { kind: 'workshop', ...s } }; }
      if (a.action === 'stop') { await stop(root); return { content: 'Workshop stopped.' }; }
      if (a.action === 'reset') { await reset(root); return { content: 'Workshop deleted. /work (the project folder) is untouched.' }; }
      if (a.action === 'preview') { const u = await previewUrl(root, a.port || 3000); if (!u) throw new Error(`Port ${a.port || 3000} is not published. Use one of ${PREVIEW_PORTS.join(', ')} and listen on 0.0.0.0.`); return { content: `Open ${u} (browser tools) to see the app.`, view: { kind: 'workshop', url: u } }; }
      if (!a.command) throw new Error('command is required for run.');
      const ctrl = new AbortController(); if (ctx.onAbort) ctx.onAbort(() => ctrl.abort());
      const r = await exec(root, a.command, { timeout: Math.min(30 * 60, a.timeout_s || 600) * 1000, signal: ctrl.signal, onLine: (l) => ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, text: l + '\n' }) });
      return { content: `exit ${r.code}\n${r.out}`, view: { kind: 'terminal', command: a.command, code: r.code, out: r.out.slice(-4000) } };
    },
  });
}

module.exports = { detect, state, ensure, exec, stop, reset, previewUrl, nameOf, limits, registerTool };
