// Fabro tool runtime (Electron utility process): runs the commands of agents, Code mode, Python and
// tests away from the main process — a hung or crashing child never freezes or takes down the app.
// Permissions are decided in the main process before anything reaches this worker.
const { spawn } = require('child_process');
const procs = new Map();
const port = process.parentPort;

function exec(id, o) {
  let out = '', err = '', killed = false;
  const t0 = Date.now();
  let p;
  try { p = spawn(o.bin, o.args || [], { cwd: o.cwd, env: o.env || process.env, windowsHide: true, shell: false }); }
  catch (e) { port.postMessage({ id, type: 'exit', code: -1, out: '', err: String(e.message), killed: false, ms: 0 }); return; }
  procs.set(id, p);
  const max = o.maxBytes || 400000;
  const timer = o.timeout ? setTimeout(() => { killed = true; kill(id); }, o.timeout) : null;
  const on = (which) => (d) => {
    const s = String(d);
    if (which === 'out') out += s; else err += s;
    port.postMessage({ id, type: 'data', which, data: s });
    if (out.length + err.length > max) { killed = true; kill(id); }
  };
  p.stdout.on('data', on('out')); p.stderr.on('data', on('err'));
  if (o.stdin != null) { p.stdin.end(String(o.stdin)); }
  p.on('error', (e) => { err += String(e.message); });
  p.on('close', (code) => { if (timer) clearTimeout(timer); procs.delete(id); port.postMessage({ id, type: 'exit', code: code ?? -1, out: out.slice(-max), err: err.slice(-max), killed, ms: Date.now() - t0 }); });
}
function kill(id) {
  const p = procs.get(id); if (!p) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
    else p.kill('SIGTERM');
  } catch {}
}
port.on('message', (e) => {
  const m = e.data;
  if (m.type === 'exec') exec(m.id, m.opts);
  else if (m.type === 'kill') kill(m.id);
  else if (m.type === 'ping') port.postMessage({ type: 'pong', n: procs.size, pid: process.pid, mem: process.memoryUsage().rss });
});
