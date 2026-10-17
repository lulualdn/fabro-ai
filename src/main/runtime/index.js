// Tool runtime (main side): a separate utility process runs every command started by tools
// (terminal, Python, tests, lint, git). Restarted automatically if it dies; in plain Node (tests)
// commands run in-process with the same API.
const path = require('path');
const { spawn } = require('child_process');
let utilityProcess = null;
try { ({ utilityProcess } = require('electron')); } catch {}

let child = null, seq = 0, restarts = 0, startedAt = 0;
const jobs = new Map(); // id → { onData, resolve }

function ensure() {
  if (child || !utilityProcess || typeof utilityProcess.fork !== 'function') return child;
  child = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'Fabro tool runtime', stdio: 'ignore' });
  startedAt = Date.now();
  child.on('message', (m) => {
    const j = jobs.get(m.id); if (!j) return;
    if (m.type === 'data') j.onData && j.onData(m.data, m.which);
    if (m.type === 'exit') { jobs.delete(m.id); j.resolve(m); }
  });
  child.on('exit', () => {
    child = null; restarts++;
    for (const [id, j] of jobs) { jobs.delete(id); j.resolve({ code: -1, out: '', err: 'The tool runtime stopped unexpectedly (it was restarted).', killed: true, ms: 0 }); }
  });
  return child;
}

// Run a program. opts: { bin, args, cwd, env, timeout, maxBytes, stdin }. Returns { code, out, err, killed, ms }.
function exec(opts, { onData, signal, id: wantId } = {}) {
  const id = wantId || 'r' + (++seq);
  const c = ensure();
  if (!c) return local(opts, { onData, signal, id });
  return new Promise((resolve) => {
    jobs.set(id, { onData, resolve });
    if (signal) { if (signal.aborted) return resolve({ code: -1, out: '', err: 'aborted', killed: true, ms: 0 }); signal.addEventListener('abort', () => kill(id), { once: true }); }
    c.postMessage({ type: 'exec', id, opts: { ...opts, env: opts.env || process.env } });
  }).then((r) => ({ ...r, id }));
}
function kill(id) { if (child) child.postMessage({ type: 'kill', id }); else { const p = localProcs.get(id); if (p) try { p.kill(); } catch {} } }

// In-process fallback (unit tests, or if utility processes are unavailable).
const localProcs = new Map();
function local(o, { onData, signal, id: wantId } = {}) {
  const id = wantId || 'l' + (++seq);
  return new Promise((resolve) => {
    let out = '', err = '', killed = false; const t0 = Date.now();
    let p; try { p = spawn(o.bin, o.args || [], { cwd: o.cwd, env: o.env || process.env, windowsHide: true }); } catch (e) { return resolve({ id, code: -1, out: '', err: e.message, killed: false, ms: 0 }); }
    localProcs.set(id, p);
    const timer = o.timeout ? setTimeout(() => { killed = true; try { p.kill(); } catch {} }, o.timeout) : null;
    if (signal) signal.addEventListener('abort', () => { killed = true; try { p.kill(); } catch {} }, { once: true });
    const on = (w) => (d) => { const s = String(d); if (w === 'out') out += s; else err += s; onData && onData(s, w); if (out.length + err.length > (o.maxBytes || 400000)) { killed = true; try { p.kill(); } catch {} } };
    p.stdout.on('data', on('out')); p.stderr.on('data', on('err'));
    if (o.stdin != null) p.stdin.end(String(o.stdin));
    p.on('error', (e) => { err += e.message; });
    p.on('close', (code) => { if (timer) clearTimeout(timer); localProcs.delete(id); resolve({ id, code: code ?? -1, out, err, killed, ms: Date.now() - t0 }); });
  });
}

function status() { return { isolated: !!(utilityProcess && utilityProcess.fork), running: !!child, pid: child && child.pid, restarts, running_jobs: jobs.size, since: startedAt }; }
function stop() { if (child) { try { child.kill(); } catch {} child = null; } }

module.exports = { exec, kill, status, stop };
