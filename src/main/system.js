// Hardware detection → used to pick the engine build and recommend models.
const os = require('os');
const { execFile } = require('child_process');

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? null : String(out)));
  });
}

const vendorOf = (name = '') => {
  const n = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return 'nvidia';
  if (/amd|radeon/.test(n)) return 'amd';
  if (/intel|arc|iris|uhd/.test(n)) return 'intel';
  if (/apple/.test(n)) return 'apple';
  return 'other';
};

async function detectGpus() {
  const gpus = [];
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (smi) {
    for (const line of smi.trim().split(/\r?\n/)) {
      const [name, mem] = line.split(',').map((s) => s.trim());
      if (name) gpus.push({ name, vendor: 'nvidia', vramGB: +(Number(mem) / 1024).toFixed(1) });
    }
  }
  if (process.platform === 'darwin') {
    const out = await run('system_profiler', ['SPDisplaysDataType', '-json'], 10000);
    try {
      for (const g of JSON.parse(out).SPDisplaysDataType || []) {
        const name = g.sppci_model || g._name;
        gpus.push({ name, vendor: vendorOf(name) === 'other' ? 'apple' : vendorOf(name), vramGB: null });
      }
    } catch { /* ignore */ }
  } else if (process.platform === 'win32' && !gpus.length) {
    const out = await run('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'], 10000);
    try {
      let list = JSON.parse(out); if (!Array.isArray(list)) list = [list];
      for (const g of list) {
        if (!g || !g.Name || /basic display|remote/i.test(g.Name)) continue;
        // AdapterRAM is capped at 4 GB by WMI: treat as a lower bound.
        gpus.push({ name: g.Name, vendor: vendorOf(g.Name), vramGB: g.AdapterRAM ? +(g.AdapterRAM / 2 ** 30).toFixed(1) : null });
      }
    } catch { /* ignore */ }
  } else if (process.platform === 'linux' && !gpus.length) {
    const out = await run('sh', ['-c', 'lspci 2>/dev/null | grep -Ei "vga|3d|display"']);
    for (const line of (out || '').trim().split('\n').filter(Boolean)) {
      const name = line.replace(/^.*?:\s.*?:\s/, '');
      gpus.push({ name, vendor: vendorOf(name), vramGB: null });
    }
  }
  return gpus;
}

// ───────────────────────────── CPU topology ─────────────────────────────
// physical cores, performance cores (hybrid Intel P/E, Apple P/E), SMT. Async, cached, never blocks.
const fsp = require('fs').promises;
const parseList = (s) => String(s || '').trim().split(',').filter(Boolean).reduce((n, r) => { const [a, b] = r.split('-').map(Number); return n + (isNaN(b) ? 1 : b - a + 1); }, 0);
async function linuxTopology(logical) {
  const sib = new Set();
  for (let i = 0; i < logical; i++) {
    const t = await fsp.readFile(`/sys/devices/system/cpu/cpu${i}/topology/thread_siblings_list`, 'utf8').catch(() => null);
    if (t == null) break; sib.add(t.trim());
  }
  const physical = sib.size || null;
  // hybrid Intel exposes the two core kinds as separate PMUs
  const core = await fsp.readFile('/sys/devices/cpu_core/cpus', 'utf8').catch(() => null);
  const atom = await fsp.readFile('/sys/devices/cpu_atom/cpus', 'utf8').catch(() => null);
  let perf = null, eff = 0;
  if (core && atom) {
    const pl = parseList(core), el = parseList(atom); // logical CPUs of each kind
    eff = el; perf = physical ? Math.max(1, physical - el) : Math.max(1, Math.round(pl / 2));
  }
  return { physical, perf, eff, source: 'sysfs' };
}
async function winTopology() {
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Processor | Select-Object NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress'], 10000);
  try {
    let l = JSON.parse(out); if (!Array.isArray(l)) l = [l];
    const cores = l.reduce((n, x) => n + (x.NumberOfCores || 0), 0), lp = l.reduce((n, x) => n + (x.NumberOfLogicalProcessors || 0), 0);
    if (!cores) return null;
    return { physical: cores, logicalWmi: lp, source: 'wmi' };
  } catch { return null; }
}
async function macTopology() {
  const o = await run('sysctl', ['-n', 'hw.physicalcpu', 'hw.perflevel0.physicalcpu', 'hw.perflevel1.physicalcpu']);
  const [phys, p0, p1] = String(o || '').trim().split(/\s+/).map(Number);
  if (!phys) return null;
  return { physical: phys, perf: p0 || null, eff: p1 || 0, source: 'sysctl' };
}
// Pure: turns raw counts into the topology the governor uses. Exported for tests.
function shapeTopology({ logical, physical, perf, eff, model = '', platform = process.platform }) {
  logical = logical || 1;
  physical = physical || (logical > 4 ? Math.round(logical / 2) : logical);
  let p = perf || null, e = eff || 0;
  if (!p && platform === 'win32' && /Intel/i.test(model)) {
    // Hybrid Intel with Hyper-Threading: P cores have 2 threads, E cores 1 → logical = 2P + E, cores = P + E
    const P = logical - physical, E = physical - P;
    if (P > 0 && E > 0 && /(1[2-4]\d{2,3}|Core\(TM\) Ultra)/i.test(model)) { p = P; e = E; }
    // Core Ultra without HT (Lunar / Arrow Lake): logical == cores, guess the P share
    else if (logical === physical && /Core\(TM\) Ultra/i.test(model) && physical >= 8) { p = Math.max(4, Math.round(physical * 0.35)); e = physical - p; }
  }
  if (!p) { p = physical; e = 0; }
  return { logical, physical, perf: p, eff: e, smt: logical > physical, hybrid: e > 0 };
}
let topoP = null;
function cpuTopology() {
  if (topoP) return topoP;
  topoP = (async () => {
    const cpus = os.cpus(); const logical = cpus.length; const model = (cpus[0] && cpus[0].model) || '';
    let raw = null;
    try {
      if (process.platform === 'linux') raw = await linuxTopology(logical);
      else if (process.platform === 'win32') raw = await winTopology();
      else if (process.platform === 'darwin') raw = await macTopology();
    } catch { raw = null; }
    return { ...shapeTopology({ logical, model, ...(raw || {}) }), source: (raw && raw.source) || 'guess' };
  })();
  return topoP;
}

// Available RAM (what the OS can hand out without swapping), not just "free" pages. Async, cached 3 s.
let availC = { at: 0, v: null };
async function availableRamGB() {
  if (Date.now() - availC.at < 3000 && availC.v != null) return availC.v;
  let bytes = null;
  try {
    if (process.platform === 'linux') {
      const m = /MemAvailable:\s+(\d+)/.exec(await fsp.readFile('/proc/meminfo', 'utf8'));
      if (m) bytes = +m[1] * 1024;
    } else if (process.platform === 'darwin') {
      const o = await run('vm_stat', [], 3000);
      const ps = +((/page size of (\d+)/.exec(o || '') || [])[1] || 16384);
      const g = (k) => +((new RegExp(`${k}:\\s+(\\d+)`).exec(o || '') || [])[1] || 0);
      if (o) bytes = (g('Pages free') + g('Pages inactive') + g('Pages speculative') + g('Pages purgeable')) * ps;
    }
  } catch {}
  if (bytes == null) bytes = os.freemem(); // Windows: free = available (standby list counted as free)
  availC = { at: Date.now(), v: +(bytes / 2 ** 30).toFixed(2) };
  return availC.v;
}

let cache = null, specsP = null;
function getSpecs() {
  if (cache) return Promise.resolve(cache);
  if (!specsP) specsP = buildSpecs().finally(() => { specsP = null; });
  return specsP;
}
async function buildSpecs() {
  const cpus = os.cpus();
  const ramGB = +(os.totalmem() / 2 ** 30).toFixed(1);
  const gpus = await detectGpus();
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  // A GPU only helps with enough video memory: tiny or integrated GPUs run on the CPU.
  const MIN_VRAM = 2.5;
  const nvidia = gpus.filter((g) => g.vendor === 'nvidia').sort((a, b) => (b.vramGB || 0) - (a.vramGB || 0))[0];
  const dedicated = gpus.find((g) => (g.vendor === 'amd' || (g.vendor === 'intel' && /arc/i.test(g.name))) && (g.vramGB == null || g.vramGB >= MIN_VRAM));

  let accel = 'cpu', gpuNote = '';
  if (appleSilicon) accel = 'metal';
  else if (nvidia && nvidia.vramGB >= MIN_VRAM) accel = 'cuda';
  else if (dedicated) accel = 'vulkan';
  if (accel === 'cpu' && gpus.length && !appleSilicon) gpuNote = 'gpu-too-small';

  // Memory the model can live in at full speed.
  let gpuBudgetGB = 0;
  if (appleSilicon) gpuBudgetGB = ramGB * 0.7;
  else if (accel === 'cuda') gpuBudgetGB = nvidia.vramGB * 0.92;
  else if (accel === 'vulkan') gpuBudgetGB = (dedicated.vramGB || 4) * 0.85;

  cache = {
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cpu: { model: (cpus[0] && cpus[0].model.trim()) || 'CPU', threads: cpus.length, ...(await cpuTopology().then((t) => ({ physical: t.physical, perf: t.perf, eff: t.eff, hybrid: t.hybrid })).catch(() => ({}))) },
    ramGB,
    gpus,
    accel,
    gpuNote,
    unified: appleSilicon,
    gpuBudgetGB: +gpuBudgetGB.toFixed(1),
    ramBudgetGB: +(appleSilicon ? 0 : ramGB * 0.6).toFixed(1),
    // too modest for a good local model at a usable speed: no real GPU and little memory or few cores
    lowPower: !appleSilicon && accel === 'cpu' && (ramGB < 12 || cpus.length < 8) || ramGB < 6,
  };
  return cache;
}

module.exports = { getSpecs, cpuTopology, shapeTopology, availableRamGB };
