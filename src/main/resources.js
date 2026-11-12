// Data for the Resources screen (the screen itself is built elsewhere — see docs/v02/api-resources.md):
//  (a) disk usage in sections (each model, engine builds, voice / image engines, conversations, artifacts,
//      caches…) computed asynchronously and cached; safe cache clearing
//  (b) RAM / VRAM / CPU / GPU history in a ring buffer, sampled only while someone is subscribed
//  (c) concrete, computed optimisation tips, each with an optional one-click action
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const GB = 2 ** 30;
let emit = () => {};
const E = () => require('electron');
const userData = () => E().app.getPath('userData');
const depsDir = () => process.env.FABRO_DEPS || path.join(userData(), 'deps');

// ───────────────────────────── (a) disk usage ─────────────────────────────
// Async recursive size, a few directories at a time, symlinks not followed.
async function du(p, seen = new Set()) {
  let st;
  try { st = await fsp.lstat(p); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let entries = [];
  try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { return 0; }
  let total = 0;
  for (let i = 0; i < entries.length; i += 16) {
    const sizes = await Promise.all(entries.slice(i, i + 16).map((e) => {
      const f = path.join(p, e.name);
      if (seen.has(f)) return 0;
      if (e.isSymbolicLink()) return 0;
      if (e.isDirectory()) return du(f, seen);
      return fsp.lstat(f).then((s) => s.size).catch(() => 0);
    }));
    total += sizes.reduce((a, b) => a + b, 0);
  }
  return total;
}

// The caches Fabro may clear without losing anything the user made.
const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', path.join('Service Worker', 'CacheStorage'), path.join('computer', 'shots')];
function sectionsSpec() {
  const ud = userData(), deps = depsDir();
  return [
    { id: 'engine', kind: 'engine', label: 'Engine (llama.cpp)', paths: [path.join(ud, 'engine')] },
    { id: 'voice', kind: 'voice', label: 'Voice', paths: [path.join(deps, 'voice'), path.join(ud, 'voice')] },
    { id: 'images', kind: 'images', label: 'Image generation', paths: [path.join(deps, 'sd'), path.join(ud, 'models', 'images')] },
    { id: 'tools', kind: 'tools', label: 'Tools (Python, Git, search)', paths: [deps], minus: ['voice', 'sd'].map((x) => path.join(deps, x)) },
    { id: 'conversations', kind: 'data', label: 'Conversations & projects', paths: ['fabro.db', 'fabro.db-wal', 'fabro.db-shm', 'conversations', 'projects', 'usage.json'].map((f) => path.join(ud, f)) },
    { id: 'artifacts', kind: 'data', label: 'Artifacts', paths: ['thumbs', 'office', 'webimg', 'kit-photos.json', 'kit-icons.json'].map((f) => path.join(ud, f)) },
    { id: 'checkpoints', kind: 'data', label: 'Code checkpoints', paths: [path.join(ud, 'checkpoints')] },
    { id: 'caches', kind: 'cache', label: 'Caches', paths: CACHE_DIRS.map((d) => path.join(ud, d)), clearable: true },
  ];
}
let diskC = { at: 0, v: null, p: null };
async function computeDisk() {
  const models = require('./models');
  const ud = userData();
  const local = await models.listLocal().catch(() => []);
  const sections = [];
  for (const m of local) {
    const files = [...(m.parts || [m.path]), m.mmproj].filter(Boolean);
    const sizes = await Promise.all(files.map((f) => fsp.stat(f).then((s) => s.size).catch(() => 0)));
    sections.push({ id: 'model:' + m.id, kind: 'model', label: m.name, bytes: sizes.reduce((a, b) => a + b, 0) || m.sizeBytes || 0,
      modelId: m.id, role: m.role || null, imported: !!m.imported, inAppData: !path.relative(ud, m.path).startsWith('..'), path: path.dirname(m.path) });
  }
  for (const s of sectionsSpec()) {
    let bytes = 0;
    for (const p of s.paths) bytes += await du(p);
    for (const p of s.minus || []) bytes -= await du(p);
    sections.push({ id: s.id, kind: s.kind, label: s.label, bytes: Math.max(0, bytes), clearable: !!s.clearable });
  }
  // everything else in Fabro's folder
  const all = await du(ud);
  const inUd = (s) => s.kind !== 'model' || s.inAppData;
  const counted = sections.filter(inUd).reduce((a, s) => a + s.bytes, 0);
  sections.push({ id: 'other', kind: 'other', label: 'Other Fabro data', bytes: Math.max(0, all - counted) });
  // the disk Fabro's data lives on
  let disk = null;
  try { const st = await fsp.statfs(ud); disk = { path: ud, totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize }; } catch {}
  const fabroBytes = sections.reduce((a, s) => a + s.bytes, 0);
  if (disk) disk.otherBytes = Math.max(0, disk.totalBytes - disk.freeBytes - all); // other apps and files on that disk
  // other disks holding model libraries
  const libs = await models.librariesView().catch(() => []);
  const storage = require('./storage');
  const libraries = await Promise.all(libs.map(async (l) => ({ id: l.id, name: l.name, path: l.path, usedBytes: l.used, freeBytes: l.free, count: l.count, storage: await storage.classify(l.path).catch(() => null) })));
  return { at: Date.now(), sections: sections.sort((a, b) => b.bytes - a.bytes), fabroBytes, disk, libraries };
}
function disk({ refresh = false } = {}) {
  if (!refresh && diskC.v && Date.now() - diskC.at < 5 * 60000) return Promise.resolve(diskC.v);
  if (diskC.p) return diskC.p;
  diskC.p = computeDisk().then((v) => { diskC = { at: Date.now(), v, p: null }; return v; }).catch((e) => { diskC.p = null; throw e; });
  return diskC.p;
}
// Clears only regenerable caches (HTTP, compiled code, GPU shaders, Computer Use screenshots). Returns bytes freed.
async function clearCaches() {
  const before = (await disk({ refresh: true })).sections.find((s) => s.id === 'caches');
  try {
    const ses = E().session.defaultSession;
    await ses.clearCache();
    if (ses.clearCodeCaches) await ses.clearCodeCaches({}).catch(() => {});
    await ses.clearStorageData({ storages: ['shadercache', 'cachestorage'] }).catch(() => {});
  } catch {}
  await fsp.rm(path.join(userData(), 'computer', 'shots'), { recursive: true, force: true }).catch(() => {});
  const after = (await disk({ refresh: true })).sections.find((s) => s.id === 'caches');
  return { freedBytes: Math.max(0, (before ? before.bytes : 0) - (after ? after.bytes : 0)) };
}

// ───────────────────────────── (b) history ─────────────────────────────
const RING = 300; // 10 minutes at the default 2 s
const ring = [];
const subs = new Map(); // id → lease expiry
let timer = null, intervalMs = 2000, prevCpu = null, n = 0, lastRss = {};
function cpuTotal() {
  const t = os.cpus().reduce((a, c) => { const v = c.times; a.idle += v.idle; a.total += v.user + v.nice + v.sys + v.idle + v.irq; return a; }, { idle: 0, total: 0 });
  const p = prevCpu; prevCpu = t;
  if (!p || t.total <= p.total) return null;
  return Math.round((1 - (t.idle - p.idle) / (t.total - p.total)) * 100);
}
async function sampleOnce() {
  const engine = require('./engine'), system = require('./system'), monitor = require('./monitor');
  const specs = await system.getSpecs();
  const loaded = (engine.getStatus().loaded || []);
  const totalGB = os.totalmem() / GB;
  const avail = await system.availableRamGB().catch(() => os.freemem() / GB);
  // Fabro's own processes: Electron (app metrics) + loaded models (RSS, every 3rd sample — tasklist is not free on Windows)
  let appRam = 0, appCpu = 0;
  try { for (const m of E().app.getAppMetrics()) { appRam += (m.memory.workingSetSize || 0) * 1024; appCpu += m.cpu.percentCPUUsage || 0; } } catch {}
  if (n % 3 === 0) {
    const r = {};
    await Promise.all(loaded.filter((l) => l.pid).map(async (l) => { r[l.pid] = (await monitor.rssOf(l.pid)) || 0; }));
    lastRss = r;
  }
  n++;
  const modelRam = loaded.reduce((a, l) => a + (lastRss[l.pid] || 0), 0);
  const g = specs.accel === 'cuda' ? await monitor.gpuLive().catch(() => null) : null;
  const gg = g && g.gpus && g.gpus[0];
  let fabroV = loaded.reduce((a, l) => a + ((g && g.procs && g.procs[String(l.pid)]) || 0), 0);
  if (!fabroV && gg) fabroV = loaded.reduce((a, l) => a + (l.vramGB || 0), 0); // Windows (WDDM) gives no per-process numbers: use the plans
  const usedGB = totalGB - avail;
  const fabroRamGB = (appRam + modelRam) / GB;
  const cpu = cpuTotal();
  const s = {
    at: Date.now(),
    cpu: { total: cpu, fabro: Math.round(Math.min(100, appCpu / Math.max(1, os.cpus().length))) },
    ram: { totalGB: +totalGB.toFixed(1), usedGB: +usedGB.toFixed(2), fabroGB: +fabroRamGB.toFixed(2), otherGB: +Math.max(0, usedGB - fabroRamGB).toFixed(2) },
    vram: gg ? { totalGB: gg.totalGB, usedGB: gg.usedGB, fabroGB: +fabroV.toFixed(2), otherGB: +Math.max(0, gg.usedGB - fabroV).toFixed(2) } : specs.unified ? { unified: true } : null,
    gpu: gg ? { util: gg.util, temp: gg.temp, power: gg.power, name: gg.name } : null,
    models: loaded.map((l) => ({ id: l.id, name: l.name, ramGB: +((lastRss[l.pid] || 0) / GB).toFixed(2), vramGB: l.vramGB, busy: l.busy })),
  };
  ring.push(s); if (ring.length > RING) ring.shift();
  emit('resources:sample', s);
  return s;
}
function loop() {
  const now = Date.now();
  for (const [id, exp] of subs) if (exp < now) subs.delete(id);
  if (!subs.size) { clearInterval(timer); timer = null; return; }
  sampleOnce().catch(() => {});
}
// Starts sampling for one subscriber. A lease: call again (or renew) at least every 60 s, or it stops by itself
// (a reloaded window never leaves a sampler running). Returns { id, intervalMs, history }.
function subscribe({ id, intervalMs: ms } = {}) {
  id = id || 'sub-' + Math.random().toString(36).slice(2, 8);
  subs.set(id, Date.now() + 60000);
  if (ms) intervalMs = Math.max(1000, Math.min(10000, ms));
  if (!timer) { cpuTotal(); timer = setInterval(loop, intervalMs); sampleOnce().catch(() => {}); }
  return { id, intervalMs, history: ring.slice() };
}
function unsubscribe(id) { subs.delete(id); if (!subs.size && timer) { clearInterval(timer); timer = null; } return true; }
const history = () => ring.slice();

// ───────────────────────────── (c) tips ─────────────────────────────
const f1 = (x) => (Math.round(x * 10) / 10).toString();
async function tips() {
  const engine = require('./engine'), system = require('./system'), memory = require('./memory'), governor = require('./governor'), models = require('./models'), store = require('./store');
  const specs = await system.getSpecs();
  const out = [];
  const insts = engine.instancesList().filter((i) => i.status === 'ready' && !i.opts._bench);
  const totalV = governor.gpuTotalGB(specs);
  const lv = await governor.live(specs).catch(() => ({}));
  for (const i of insts) {
    const pl = i.plan; if (!pl) continue;
    if (pl.ctx > 8192 && !i.opts.role) {
      const small = memory.plan(i.model, { ...i.opts, ctx: 8192 }, { ...specs, gpuBudgetGB: pl.budgetGB, ramBudgetGB: pl.ramBudgetGB });
      const freed = specs.unified || pl.mode === 'cpu' ? pl.ramGB + pl.vramGB - small.ramGB - small.vramGB : pl.vramGB - small.vramGB;
      if (freed > 0.3) out.push({ id: 'ctx:' + i.model.id, severity: 'info', kind: 'context',
        text: `${i.model.name} uses ${f1(specs.unified || pl.mode === 'cpu' ? pl.ramGB + pl.vramGB : pl.vramGB)} of your ${f1(specs.unified || pl.mode === 'cpu' ? specs.ramGB : totalV)} GB ${specs.unified || pl.mode === 'cpu' ? 'memory' : 'video memory'} with a ${Math.round(pl.ctx / 1024)}k context — an 8k context frees ${f1(freed)} GB.`,
        action: { id: `ctx:${i.model.id}:8192`, label: 'Use an 8k context' }, data: { modelId: i.model.id, ctx: pl.ctx, freesGB: +freed.toFixed(2) } });
    }
    if (pl.mode === 'split' && (i.opts.kvType || 'f16') === 'f16' && !i.opts.role) {
      const q8 = memory.plan(i.model, { ...i.opts, kvType: 'q8_0' }, { ...specs, gpuBudgetGB: pl.budgetGB, ramBudgetGB: pl.ramBudgetGB });
      out.push({ id: 'split:' + i.model.id, severity: 'warn', kind: 'offload',
        text: `${i.model.name} only partly fits on the graphics card (${pl.ngl}/${pl.layers} layers), so it runs slower.${q8.mode === 'gpu' ? ' A compressed context cache (q8) would let it fit entirely.' : ' A smaller model or a smaller context would fit entirely.'}`,
        action: q8.mode === 'gpu' ? { id: `kv-q8:${i.model.id}`, label: 'Compress the context cache' } : null, data: { modelId: i.model.id, layers: pl.layers, onGpu: pl.ngl } });
    }
  }
  if (insts.filter((i) => !i.opts.role).length >= 2) {
    const idle = insts.filter((i) => !i.busy && !i.opts.role).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    const sum = insts.reduce((a, i) => a + (i.plan ? i.plan.vramGB + i.plan.ramGB : 0), 0);
    out.push({ id: 'multi', severity: 'info', kind: 'models', text: `${insts.length} models are loaded at the same time (${f1(sum)} GB).${idle ? ` Unloading ${idle.model.name} frees ${f1((idle.plan.vramGB || 0) + (idle.plan.ramGB || 0))} GB.` : ''}`,
      action: idle ? { id: `unload:${idle.model.id}`, label: `Unload ${idle.model.name}` } : null });
  }
  if (lv.gpu && lv.gpu.usedGB != null) {
    const fabroV = insts.reduce((a, i) => a + ((i.plan && i.plan.vramGB) || 0), 0);
    const others = lv.gpu.usedGB - fabroV;
    if (others > 1.5) out.push({ id: 'vram-others', severity: others > totalV * 0.3 ? 'warn' : 'info', kind: 'vram', text: `Other apps use ${f1(others)} GB of video memory (browsers, games, video). Closing them leaves more room for the model.`, action: null, data: { othersGB: +others.toFixed(2) } });
  }
  if (lv.availRamGB != null) {
    const hr = governor.headroom(specs);
    if (lv.availRamGB < hr.ramGB) out.push({ id: 'ram-low', severity: 'warn', kind: 'ram', text: `Only ${f1(lv.availRamGB)} GB of memory is free. Close a few apps or browser tabs, or use a smaller model.`, action: insts.length ? { id: `unload:${insts.sort((a, b) => a.lastUsed - b.lastUsed)[0].model.id}`, label: 'Unload the model' } : null });
  }
  const eng = store.getSettings().engine || {};
  if (eng.threads && eng.threads >= os.cpus().length) out.push({ id: 'threads', severity: 'warn', kind: 'cpu', text: `The engine is set to use every processor thread (${eng.threads}); that makes the whole computer stutter. Automatic leaves a few for the system and is usually faster.`, action: { id: 'threads:auto', label: 'Back to automatic' } });
  if (governor.env.battery) out.push({ id: 'battery', severity: 'info', kind: 'energy', text: 'On battery: Fabro uses fewer processor threads to save energy. Plug in for full speed.', action: null });
  // slow storage of loaded / installed chat models
  const storage = require('./storage');
  for (const i of insts.filter((x) => !x.opts.role).slice(0, 2)) {
    const a = await storage.adviceFor(i.model).catch(() => null);
    if (a) out.push({ id: 'storage:' + i.model.id, severity: 'info', kind: 'storage', text: a.suggestion === 'move' ? `${i.model.name} is on a slow disk (${a.storage.kind}). Moving it to ${a.toLibrary.name} makes it load faster.` : `${i.model.name} is on a slow disk (${a.storage.kind}). ${a.smallModel.name} (${a.smallModel.sizeGB} GB) on your internal disk would answer faster.`,
      action: { id: a.suggestion === 'move' ? `move:${i.model.id}:${a.toLibrary.id}` : `download:${a.smallModel.id}`, label: a.suggestion === 'move' ? 'Move it' : `Get ${a.smallModel.name}` }, data: a });
  }
  const d = diskC.v;
  if (d) { const c = d.sections.find((s) => s.id === 'caches'); if (c && c.bytes > 500 * 2 ** 20) out.push({ id: 'caches', severity: 'info', kind: 'disk', text: `Caches take ${f1(c.bytes / GB)} GB. They can be cleared safely.`, action: { id: 'clear-caches', label: 'Clear caches' } }); }
  if (d && d.disk && d.disk.freeBytes < 10 * GB) out.push({ id: 'disk-low', severity: 'warn', kind: 'disk', text: `Only ${f1(d.disk.freeBytes / GB)} GB left on the disk. Delete a model you don't use or move it to another disk.`, action: null });
  return out;
}

// Runs a tip's action. Ids: ctx:<model>:<n> · kv-q8:<model> · unload:<model> · threads:auto · clear-caches ·
// move:<model>:<library> · download:<catalogId>
async function action(id) {
  const engine = require('./engine'), models = require('./models'), store = require('./store');
  const [verb, a, b] = String(id || '').split(':');
  const setProfile = (mid, patch) => store.setSettings({ modelProfiles: { [mid]: { ...((store.getSettings().modelProfiles || {})[mid] || {}), ...patch } } });
  if (verb === 'ctx') { const m = await models.getLocal(a); if (!m) throw new Error('Model not found'); engine.resetContext(m); await setProfile(a, { ctx: +b }); if (engine.find(a)) await engine.ensure(m); return { ok: true }; }
  if (verb === 'kv-q8') { const m = await models.getLocal(a); if (!m) throw new Error('Model not found'); await setProfile(a, { kvType: 'q8_0' }); if (engine.find(a)) await engine.ensure(m); return { ok: true }; }
  if (verb === 'unload') { await engine.stop(a); return { ok: true }; }
  if (verb === 'threads') { await store.setSettings({ engine: { threads: 0 }, limits: { threads: 'auto' } }); return { ok: true, note: 'applies at the next model load' }; }
  if (verb === 'clear-caches') return { ok: true, ...(await clearCaches()) };
  if (verb === 'move') { await models.move(a, b, () => engine.stop(a)); return { ok: true }; }
  if (verb === 'download') { const c = models.CATALOG.find((x) => x.id === a); if (!c) throw new Error('Unknown model'); await models.download({ repo: c.repo, catalogId: c.id }); return { ok: true }; }
  throw new Error('Unknown action');
}

// One summary call for the screen.
async function overview() {
  const engine = require('./engine'), system = require('./system'), governor = require('./governor');
  const specs = await system.getSpecs();
  const topo = await system.cpuTopology();
  return {
    specs: { ramGB: specs.ramGB, gpus: specs.gpus, accel: specs.accel, unified: specs.unified, cpu: specs.cpu, topology: topo },
    limits: governor.limits(), headroom: governor.headroom(specs), budget: await governor.currentBudget(specs).then(({ live, ...b }) => b).catch(() => null),
    queue: governor.queueState(), energy: { ...governor.env, mode: governor.energyMode((require('./store').getSettings().engine || {}).energy) },
    loaded: (engine.getStatus().loaded || []).map((l) => ({ ...l, tuning: engine.tuning(l.id) })),
    autotune: require('./autotune').status(),
  };
}

function init(ipcMain, emitter) {
  if (emitter) emit = emitter;
  const governor = require('./governor');
  governor.on('pressure', (p) => emit('resources:pressure', p));
  governor.on('queue', (q) => emit('resources:queue', q));
  if (!ipcMain) return;
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));
  h('resources:overview', () => overview());
  h('resources:disk', (o) => disk(o || {}));
  h('resources:clearCaches', () => clearCaches());
  h('resources:subscribe', (o) => subscribe(o || {}));
  h('resources:unsubscribe', (id) => unsubscribe(id));
  h('resources:history', () => history());
  h('resources:tips', () => tips());
  h('resources:action', (id) => action(id));
  h('resources:maxContext', async (id) => { const m = await require('./models').getLocal(id); return m ? require('./engine').maxContext(m) : null; });
  h('resources:autotune', async (id) => { const m = await require('./models').getLocal(id); if (!m) throw new Error('Model not found'); return require('./autotune').run(m, { reason: 'manual' }); });
  h('resources:autotuneCancel', () => require('./autotune').cancel());
}

module.exports = { init, disk, clearCaches, subscribe, unsubscribe, history, tips, action, overview, du, _sampleOnce: sampleOnce };
