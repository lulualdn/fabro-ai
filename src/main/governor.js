// Resource governor: Fabro must never starve the machine.
//  - memory budgets that keep headroom for the OS, the desktop compositor and other apps (RAM and VRAM),
//    using live numbers when the platform gives them (MemAvailable, nvidia-smi), static ones otherwise
//  - load plans shrink (fewer GPU layers, smaller context) or are refused rather than pushing the system into
//    swap / shared GPU memory — the classic cause of whole-PC freezes on Windows
//  - thread counts capped to performance cores minus headroom (never every logical core)
//  - one heavy local generation at a time, with a fair priority queue (user > sub-agents > background jobs)
//  - a memory-pressure watcher that unloads idle models when free RAM / VRAM gets low (runs only while a model
//    is loaded, every 10 s, one cheap read; nvidia-smi at most every 30 s)
//  - energy: battery / thermal pressure → eco (fewer threads, no busy polling, lower priority)
// Everything here is async or pure; nothing blocks the main loop.
const os = require('os');
const { EventEmitter } = require('events');

let store = null, system = null, monitor = null;
const lazy = () => {
  if (!store) store = require('./store');
  if (!system) system = require('./system');
  if (!monitor) monitor = require('./monitor');
};
const bus = new EventEmitter();

// ───────────────────────────── limits (settings.limits) ─────────────────────────────
const DEFAULT_LIMITS = {
  threads: 'auto',          // 'auto' | n — threads for generation
  ramHeadroomGB: 'auto',    // 'auto' | GB kept free for the OS and other apps
  vramHeadroomGB: 'auto',   // 'auto' | GB of video memory kept free (desktop, browser, Fabro's own window)
  maxGenerations: 1,        // heavy local generations at the same time
  unloadOnPressure: true,   // unload idle models when memory runs low
  batteryBackoff: true,     // eco mode on battery / thermal pressure
  priority: 'auto',         // 'auto' (below normal) | 'low' | 'normal' | 'high'
  allowSwap: false,         // true = load plans may exceed the RAM budget (not recommended)
  autotune: true,           // measure the fastest settings once per model / machine / engine
};
function limits() {
  let s = {};
  try { lazy(); s = store.getSettings().limits || {}; } catch {}
  return { ...DEFAULT_LIMITS, ...s };
}
const num = (v) => (v === 'auto' || v === '' || v == null || isNaN(+v) ? null : +v);

// ───────────────────────────── headroom & budgets (pure) ─────────────────────────────
// RAM kept free: 2.5 GB on an 8 GB laptop, ~3.4 GB on 16 GB, ~5.3 GB on 32 GB, 6 GB max.
// VRAM kept free on a discrete card: the desktop compositor, browsers and Fabro's own window live there.
function headroom(specs, lim = limits()) {
  const ram = specs.ramGB || 8;
  const autoRam = Math.min(6, Math.max(2.5, 1.5 + ram * 0.12));
  const vramTotal = gpuTotalGB(specs);
  const autoVram = specs.unified ? 0 : vramTotal ? Math.min(2, Math.max(0.8, 0.6 + vramTotal * 0.06)) : 0;
  return { ramGB: +(num(lim.ramHeadroomGB) ?? autoRam).toFixed(2), vramGB: +(num(lim.vramHeadroomGB) ?? autoVram).toFixed(2) };
}
function gpuTotalGB(specs) {
  if (specs.unified) return specs.ramGB || 0;
  if (specs.accel === 'cpu') return 0;
  const g = (specs.gpus || []).filter((x) => x.vramGB).sort((a, b) => (b.vramGB || 0) - (a.vramGB || 0))[0];
  if (g) return g.vramGB;
  return specs.gpuBudgetGB ? specs.gpuBudgetGB / 0.85 : 0;
}

// What a model plan may use right now. `live` (optional): { availRamGB, gpu: { usedGB, totalGB } },
// `fabro`: { ramGB, vramGB } already held by Fabro's loaded models (they can be evicted, so they count as free).
function budget(specs, { live = {}, fabro = { ramGB: 0, vramGB: 0 }, lim = limits() } = {}) {
  const hr = headroom(specs, lim);
  const why = [];
  const ram = specs.ramGB || 8;
  // RAM: what the OS can give without swapping + what our own models hold − headroom; never more than the static cap
  const staticRam = Math.max(0, ram - hr.ramGB - 1.0); // ~1 GB for Fabro's own window and main process
  let ramGB = staticRam;
  if (live.availRamGB != null) {
    const liveRam = live.availRamGB + (fabro.ramGB || 0) - hr.ramGB;
    if (liveRam < ramGB) { ramGB = Math.max(0, liveRam); why.push(`other apps use ${(ram - live.availRamGB - (fabro.ramGB || 0)).toFixed(1)} GB of RAM`); }
  }
  let vramGB = 0;
  if (specs.unified) {
    // Apple Silicon: the GPU can wire ~70-75 % of memory; the same pool also feeds the OS and apps
    vramGB = Math.min(ram * 0.72, ramGB);
    ramGB = vramGB;
  } else if (specs.accel !== 'cpu') {
    const total = gpuTotalGB(specs);
    vramGB = Math.max(0, total - hr.vramGB);
    if (live.gpu && live.gpu.usedGB != null) {
      const others = Math.max(0, live.gpu.usedGB - (fabro.vramGB || 0));
      const liveV = (live.gpu.totalGB || total) - others - hr.vramGB;
      if (liveV < vramGB) { vramGB = Math.max(0, liveV); if (others > 0.3) why.push(`other apps use ${others.toFixed(1)} GB of video memory`); }
    } else if (process.platform !== 'darwin') {
      vramGB = Math.max(0, vramGB - 0.4); // no live numbers: assume the desktop uses a little
    }
  }
  return { ramGB: +ramGB.toFixed(2), vramGB: +vramGB.toFixed(2), headroom: hr, unified: !!specs.unified, why };
}

// ───────────────────────────── threads (pure) ─────────────────────────────
// Generation is memory-bound: past the performance cores, more threads only add contention and make the
// desktop stutter. E cores are slower and make every token wait for the slowest thread; SMT siblings
// don't add bandwidth. Keep 1 core (2 when there are 8+) for the OS and the UI.
function threadsFor(topo, { gpuFull = false, mode = 'balanced', lim = limits() } = {}) {
  const forced = num(lim.threads);
  if (forced && forced > 0) return { threads: Math.round(forced), why: 'set in limits' };
  const perf = Math.max(1, topo.perf || topo.physical || Math.round((topo.logical || 2) / 2));
  const keep = perf >= 8 ? 2 : perf >= 3 ? 1 : 0;
  let t = Math.max(1, perf - keep);
  let why = `${perf} performance cores − ${keep} kept for the system`;
  if (gpuFull) { t = Math.min(t, 4); why = 'all layers on the GPU: few CPU threads needed'; }
  if (mode === 'eco') { t = Math.max(1, Math.floor(t / 2)); why += ', halved (eco)'; }
  return { threads: t, batchThreads: gpuFull ? t : Math.max(t, Math.min(perf, (topo.physical || perf) - keep)), why };
}

// ───────────────────────────── plan fitting (pure, given memory.plan) ─────────────────────────────
// Shrinks a load plan until it fits the budget: fewer GPU layers (memory.plan does that from the budget),
// then a smaller context, then refuses. `explicit` = keys the user set by hand (never changed, but a plan that
// can't fit at all is still refused unless allowSwap).
function fitPlan(planFn, model, opts, specs, bud, { explicit = {}, lim = limits() } = {}) {
  const sp = { ...specs, gpuBudgetGB: bud.vramGB, ramBudgetGB: bud.ramGB };
  const steps = [];
  let o = { ...opts };
  let pl = planFn(model, o, sp);
  const over = (p) => {
    if (specs.unified) return p.vramGB > bud.vramGB + 0.05;
    return p.ramGB > bud.ramGB + 0.05 || (p.vramGB > bud.vramGB + 0.05 && p.mode !== 'cpu');
  };
  // 1) KV cache in q8_0 instead of a split / a smaller context (only when flash attention can be used)
  if (over(pl) && !explicit.kvType && opts.kvOk && (o.kvType || 'f16') === 'f16') {
    const p2 = planFn(model, { ...o, kvType: 'q8_0' }, sp);
    if (!over(p2) || p2.mode === 'gpu' && pl.mode !== 'gpu') { o.kvType = 'q8_0'; pl = p2; steps.push('KV cache q8_0 to fit'); }
  }
  // 2) smaller context, down to 2048
  while (over(pl) && !explicit.ctx && pl.ctx > 2048) {
    const ctx = Math.max(2048, Math.floor(pl.ctx / 2 / 256) * 256);
    o = { ...o, ctx }; pl = planFn(model, o, sp); steps.push(`context ${ctx}`);
  }
  const fits = !over(pl);
  const refused = !fits && !lim.allowSwap;
  return { plan: pl, opts: o, steps, fits, refused, budget: bud };
}

// ───────────────────────────── generation queue ─────────────────────────────
const RANK = { user: 0, sub: 1, bg: 2 };
const AGING_MS = 45000; // a waiting job climbs one class every 45 s: background work is delayed, never starved
const Q = { active: [], waiting: [], lastActivity: Date.now(), seq: 0 };
const maxGen = () => Math.max(1, Math.round(num(limits().maxGenerations) || 1));
function effRank(w, now) { return (RANK[w.priority] ?? 1) - Math.floor((now - w.at) / AGING_MS); }
function pump() {
  const now = Date.now();
  while (Q.active.length < maxGen() && Q.waiting.length) {
    Q.waiting.sort((a, b) => effRank(a, now) - effRank(b, now) || a.seq - b.seq);
    const w = Q.waiting.shift();
    const job = { priority: w.priority, label: w.label, since: Date.now() };
    Q.active.push(job); Q.lastActivity = Date.now();
    let done = false;
    w.resolve(() => {
      if (done) return; done = true;
      Q.active.splice(Q.active.indexOf(job), 1); Q.lastActivity = Date.now();
      pump(); publishQueue();
    });
  }
  publishQueue();
}
function publishQueue() { bus.emit('queue', queueState()); }
function queueState() {
  return { active: Q.active.map((j) => ({ priority: j.priority, label: j.label, since: j.since })), waiting: Q.waiting.map((w) => ({ priority: w.priority, label: w.label, since: w.at })), max: maxGen() };
}
// Waits for a generation slot. Resolves with release(); rejects with AbortError if `signal` aborts first.
function acquire({ priority = 'user', label = '', signal } = {}) {
  bus.emit('demand', { priority }); // the autotune benchmark yields at once
  return new Promise((resolve, reject) => {
    const w = { priority, label, at: Date.now(), seq: Q.seq++, resolve, reject };
    if (signal && signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    Q.waiting.push(w);
    if (signal) signal.addEventListener('abort', () => {
      const i = Q.waiting.indexOf(w);
      if (i >= 0) { Q.waiting.splice(i, 1); publishQueue(); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }
    }, { once: true });
    pump();
  });
}
// Wraps a completion function so local generations go through the queue. Cloud providers pass straight through.
function gated(fn, { local = true, priority = 'user', label = '', signal, onWait } = {}) {
  if (!local) return fn;
  return async (...args) => {
    let waited = false;
    const t = onWait ? setTimeout(() => { waited = true; onWait(true); }, 300) : null;
    const release = await acquire({ priority, label, signal }).finally(() => { if (t) clearTimeout(t); });
    if (waited && onWait) onWait(false);
    try { return await fn(...args); } finally { release(); }
  };
}
const isIdle = (ms = 60000) => !Q.active.length && !Q.waiting.length && Date.now() - Q.lastActivity > ms;
const touch = () => { Q.lastActivity = Date.now(); };

// ───────────────────────────── energy & priority ─────────────────────────────
const env = { battery: false, thermal: 'nominal', speedLimit: 100 };
function energyMode(setting) {
  const lim = limits();
  if (setting && setting !== 'auto') return setting;
  if (lim.batteryBackoff !== false && (env.battery || env.thermal === 'serious' || env.thermal === 'critical' || env.speedLimit < 80)) return 'eco';
  return 'balanced';
}
// Inference runs below normal priority by default: it costs almost nothing when the machine is otherwise idle
// (priority only matters under contention) and keeps the desktop, the browser and Fabro's own window responsive.
function processPriority(mode) {
  const P = os.constants.priority;
  const lim = limits().priority;
  if (lim === 'low') return P.PRIORITY_LOW;
  if (lim === 'normal') return P.PRIORITY_NORMAL;
  if (lim === 'high') return P.PRIORITY_ABOVE_NORMAL;
  if (mode === 'performance') return P.PRIORITY_NORMAL;
  return P.PRIORITY_BELOW_NORMAL;
}
function watchPower(powerMonitor) {
  if (!powerMonitor) return;
  const changed = () => bus.emit('energy', { ...env, mode: energyMode() });
  try { env.battery = !!powerMonitor.isOnBatteryPower(); } catch {}
  try { if (process.platform === 'darwin') env.thermal = powerMonitor.getCurrentThermalState() || 'nominal'; } catch {}
  try { powerMonitor.on('on-battery', () => { env.battery = true; changed(); }); powerMonitor.on('on-ac', () => { env.battery = false; changed(); }); } catch {}
  try { powerMonitor.on('thermal-state-change', (e) => { env.thermal = (e && e.state) || e || 'nominal'; changed(); }); } catch {}
  try { powerMonitor.on('speed-limit-change', (e) => { env.speedLimit = (e && e.limit) || 100; changed(); }); } catch {}
}

// ───────────────────────────── live view & pressure watcher ─────────────────────────────
let engineApi = null; // { instances(): [{ key, model, plan, busy, lastUsed, pinned, pid }], unload(inst) }
async function live(specs) {
  lazy();
  const [availRamGB, g] = await Promise.all([system.availableRamGB().catch(() => null), specs.accel === 'cuda' ? monitor.gpuLive().catch(() => null) : null]);
  const gpu = g && g.gpus && g.gpus[0] ? { usedGB: g.gpus[0].usedGB, totalGB: g.gpus[0].totalGB, procs: g.procs } : null;
  return { availRamGB, gpu };
}
function fabroUse(insts) {
  return insts.reduce((a, i) => ({ ramGB: a.ramGB + ((i.plan && i.plan.ramGB) || 0), vramGB: a.vramGB + ((i.plan && i.plan.vramGB) || 0) }), { ramGB: 0, vramGB: 0 });
}
// Budget for loading `exceptKey` with everything else as it is now.
async function currentBudget(specs, { exceptKey } = {}) {
  const insts = engineApi ? engineApi.instances().filter((i) => i.key !== exceptKey) : [];
  const lv = await live(specs);
  return { ...budget(specs, { live: lv, fabro: fabroUse(insts) }), live: lv };
}

let watch = null, tick = 0, lastPressure = 0;
function startWatcher() {
  if (watch) return;
  watch = setInterval(checkPressure, 10000); watch.unref && watch.unref();
}
function stopWatcher() { if (watch) { clearInterval(watch); watch = null; } }
async function checkPressure() {
  if (!engineApi) return;
  const insts = engineApi.instances();
  if (!insts.length) { stopWatcher(); return; }
  if (limits().unloadOnPressure === false) return;
  lazy(); tick++;
  const specs = await system.getSpecs();
  const hr = headroom(specs);
  const avail = await system.availableRamGB().catch(() => null);
  let reason = null;
  if (avail != null && avail < Math.max(0.75, hr.ramGB * 0.4)) reason = { kind: 'ram', freeGB: avail };
  if (!reason && specs.accel === 'cuda' && (tick % 3 === 0 || Date.now() - lastPressure < 60000) && insts.some((i) => i.plan && i.plan.vramGB > 0)) {
    const g = await monitor.gpuLive().catch(() => null);
    const gg = g && g.gpus && g.gpus[0];
    if (gg && gg.totalGB && gg.usedGB != null && gg.totalGB - gg.usedGB < 0.3) reason = { kind: 'vram', freeGB: +(gg.totalGB - gg.usedGB).toFixed(2) };
  }
  if (!reason) return;
  lastPressure = Date.now();
  const victims = insts.filter((i) => !i.busy && (reason.kind === 'ram' || (i.plan && i.plan.vramGB > 0)))
    .sort((a, b) => (a.pinned - b.pinned) || a.lastUsed - b.lastUsed);
  const v = victims[0];
  if (!v) { bus.emit('pressure', { ...reason, unloaded: null }); return; }
  await engineApi.unload(v).catch(() => {});
  bus.emit('pressure', { ...reason, unloaded: { id: v.model.id, name: v.model.name } });
}

function init({ engine, powerMonitor } = {}) {
  if (engine) engineApi = engine;
  watchPower(powerMonitor);
}

module.exports = {
  DEFAULT_LIMITS, limits, headroom, budget, gpuTotalGB, threadsFor, fitPlan,
  acquire, gated, queueState, isIdle, touch,
  energyMode, processPriority, env,
  live, currentBudget, fabroUse, startWatcher, stopWatcher, checkPressure, init,
  on: (ev, fn) => bus.on(ev, fn), off: (ev, fn) => bus.off(ev, fn), _bus: bus, _Q: Q,
};
