// A helper process spoken to in JSON lines: {"id":n,"op":…} in, {"id":n,"ok":…} out.
// Lines without an id are events ({"event":"ready"} first, then e.g. {"event":"user","kind":"esc"}).
const { spawn } = require('child_process');

class LineProc {
  constructor(name, bin, args, { cwd, env, onEvent, readyTimeout = 20000 } = {}) {
    Object.assign(this, { name, bin, args, cwd, env, onEvent: onEvent || (() => {}), readyTimeout });
    this.p = null; this.seq = 0; this.wait = new Map(); this.ready = null; this.stderr = '';
  }
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let p;
      try { p = spawn(this.bin, this.args, { cwd: this.cwd, env: this.env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (e) { this.ready = null; return reject(e); }
      this.p = p; this.stderr = '';
      let buf = '', ok = false;
      const timer = setTimeout(() => { if (!ok) { this.kill(); reject(new Error(`${this.name} did not start: ${this.stderr.slice(-600) || 'timeout'}`)); } }, this.readyTimeout);
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d) => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.event === 'ready' && !ok) { ok = true; clearTimeout(timer); this.info = m; resolve(m); continue; }
          if (m.id != null && this.wait.has(m.id)) { const w = this.wait.get(m.id); this.wait.delete(m.id); clearTimeout(w.timer); if (m.ok === false) w.reject(Object.assign(new Error(m.error || 'failed'), { code: m.code })); else w.resolve(m); continue; }
          if (m.event) this.onEvent(m);
        }
      });
      p.stderr.setEncoding('utf8');
      p.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
      p.on('error', (e) => { if (!ok) { clearTimeout(timer); reject(e); } });
      p.on('exit', (code) => {
        this.p = null; this.ready = null;
        if (!ok) { clearTimeout(timer); reject(new Error(`${this.name} stopped (exit ${code}): ${this.stderr.slice(-600)}`)); }
        for (const [, w] of this.wait) { clearTimeout(w.timer); w.reject(new Error(`${this.name} stopped unexpectedly (exit ${code}). ${this.stderr.slice(-300)}`)); }
        this.wait.clear();
      });
    });
    return this.ready;
  }
  async call(op, args = {}, timeout = 30000) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wait.delete(id); reject(new Error(`${this.name}: "${op}" timed out`)); }, timeout);
      this.wait.set(id, { resolve, reject, timer });
      try { this.p.stdin.write(JSON.stringify({ id, op, ...args }) + '\n'); }
      catch (e) { clearTimeout(timer); this.wait.delete(id); reject(e); }
    });
  }
  kill() { if (this.p) { try { this.p.kill(); } catch {} this.p = null; } this.ready = null; }
}

module.exports = { LineProc };
