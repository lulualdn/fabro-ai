// Live resources: GPU memory/load/temperature (NVIDIA via nvidia-smi), RAM, CPU, per-model memory.
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : String(out)));
});
let smi = true;
let prevCpu = null;

function cpuLoad() {
  const t = os.cpus().reduce((a, c) => { const v = c.times; a.idle += v.idle; a.total += v.user + v.nice + v.sys + v.idle + v.irq; return a; }, { idle: 0, total: 0 });
  const p = prevCpu; prevCpu = t;
  if (!p) return null;
  const dt = t.total - p.total;
  return dt > 0 ? Math.round((1 - (t.idle - p.idle) / dt) * 100) : null;
}

async function rssOf(pid) {
  try {
    if (process.platform === 'linux') {
      const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
      return m ? +m[1] * 1024 : null;
    }
    if (process.platform === 'darwin') { const o = await run('ps', ['-o', 'rss=', '-p', String(pid)]); return o ? +o.trim() * 1024 : null; }
    if (process.platform === 'win32') {
      const o = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      const m = o && /"([\d.,\s  ]+)\s*K"/i.exec(o);
      return m ? +m[1].replace(/[^\d]/g, '') * 1024 : null;
    }
  } catch {}
  return null;
}

async function gpus() {
  if (!smi) return [];
  const o = await run('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw', '--format=csv,noheader,nounits']);
  if (!o) { smi = false; return []; }
  return o.trim().split(/\r?\n/).map((l) => {
    const [name, used, total, util, temp, power] = l.split(',').map((x) => x.trim());
    const n = (x) => (isNaN(+x) ? null : +x);
    return { name, usedGB: n(used) != null ? +(n(used) / 1024).toFixed(2) : null, totalGB: n(total) != null ? +(n(total) / 1024).toFixed(1) : null, util: n(util), temp: n(temp), power: n(power) };
  });
}
async function gpuProcs() {
  if (!smi) return {};
  const o = await run('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits']);
  const map = {};
  for (const l of (o || '').trim().split(/\r?\n/).filter(Boolean)) { const [pid, mem] = l.split(',').map((x) => x.trim()); if (!isNaN(+mem)) map[pid] = +(+mem / 1024).toFixed(2); }
  return map;
}

async function sample(loaded = []) {
  const [g, gp] = await Promise.all([gpus(), gpuProcs()]);
  const procs = await Promise.all(loaded.filter((l) => l.pid).map(async (l) => ({ id: l.id, name: l.name, pid: l.pid, ramGB: (await rssOf(l.pid) || 0) / 2 ** 30, vramGB: gp[String(l.pid)] ?? null })));
  const total = os.totalmem(), free = os.freemem();
  return {
    at: Date.now(), gpus: g, cpu: cpuLoad(), cpus: os.cpus().length,
    ram: { usedGB: +((total - free) / 2 ** 30).toFixed(2), totalGB: +(total / 2 ** 30).toFixed(1) },
    procs: procs.map((p) => ({ ...p, ramGB: +p.ramGB.toFixed(2) })),
  };
}

module.exports = { sample };
