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

let cache = null;
async function getSpecs() {
  if (cache) return cache;
  const cpus = os.cpus();
  const ramGB = +(os.totalmem() / 2 ** 30).toFixed(1);
  const gpus = await detectGpus();
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const nvidia = gpus.find((g) => g.vendor === 'nvidia');
  const dedicated = gpus.find((g) => ['amd', 'intel'].includes(g.vendor));

  let accel = 'cpu';
  if (appleSilicon) accel = 'metal';
  else if (nvidia) accel = 'cuda';
  else if (dedicated) accel = 'vulkan';

  // Memory the model can live in at full speed.
  let gpuBudgetGB = 0;
  if (appleSilicon) gpuBudgetGB = ramGB * 0.7;
  else if (nvidia) gpuBudgetGB = nvidia.vramGB * 0.92;
  else if (dedicated && dedicated.vramGB) gpuBudgetGB = dedicated.vramGB * 0.85;

  cache = {
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cpu: { model: (cpus[0] && cpus[0].model.trim()) || 'CPU', threads: cpus.length },
    ramGB,
    gpus,
    accel,
    unified: appleSilicon,
    gpuBudgetGB: +gpuBudgetGB.toFixed(1),
    ramBudgetGB: +(appleSilicon ? 0 : ramGB * 0.6).toFixed(1),
  };
  return cache;
}

module.exports = { getSpecs };
