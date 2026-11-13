// Offline tests of the resource governor, autotune planning and flag capability filtering on synthetic machines.
// Usage: node scripts/perf-test.js
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-perf-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, powerMonitor: { on() {}, isOnBatteryPower: () => false } };
  return orig.call(this, req, ...r);
};
const store = require('../src/main/store'); store.init();
const governor = require('../src/main/governor');
const autotune = require('../src/main/autotune');
const memory = require('../src/main/memory');
const system = require('../src/main/system');
const storage = require('../src/main/storage');

let n = 0; const ok = (name) => { n++; console.log('  ✓', name); };

// A synthetic GGUF shape (no file needed): memory.plan reads the shape through shapeOf; give a fake path and patch.
const fakeShape = { layers: 42, headsKv: 4, keyLen: 256, valLen: 256, emb: 2560, ctxTrain: 131072, window: true };
const realShape = memory.shapeOf;
const planFn = (model, o, sp) => {
  memory.shapeOf = () => fakeShape;
  return memory.plan({ ...model, parts: [], path: '' }, o, sp);
};
// memory.plan calls the module-local shapeOf, so instead build models whose size we control and rely on defaults
const model = (gb, name = 'Gemma 4 E4B') => ({ id: name, name, path: '/nonexistent.gguf', sizeBytes: gb * 2 ** 30 });

const MACHINES = {
  laptop8: { specs: { platform: 'win32', ramGB: 8, accel: 'cpu', gpus: [{ name: 'Intel UHD', vendor: 'intel', vramGB: 1 }], unified: false, gpuBudgetGB: 0 }, topo: system.shapeTopology({ logical: 8, physical: 4, model: 'Intel(R) Core(TM) i5-8250U', platform: 'win32' }) },
  desk3060: { specs: { platform: 'win32', ramGB: 16, accel: 'cuda', gpus: [{ name: 'NVIDIA GeForce RTX 3060', vendor: 'nvidia', vramGB: 12 }], unified: false, gpuBudgetGB: 11 }, topo: system.shapeTopology({ logical: 20, physical: 14, model: '12th Gen Intel(R) Core(TM) i7-12700F', platform: 'win32' }) },
  m1: { specs: { platform: 'darwin', ramGB: 8, accel: 'metal', gpus: [{ name: 'Apple M1', vendor: 'apple', vramGB: null }], unified: true, gpuBudgetGB: 5.6 }, topo: system.shapeTopology({ logical: 8, physical: 8, perf: 4, eff: 4, platform: 'darwin' }) },
  quad: { specs: { platform: 'linux', ramGB: 16, accel: 'cpu', gpus: [], unified: false, gpuBudgetGB: 0 }, topo: system.shapeTopology({ logical: 4, physical: 4, platform: 'linux' }) },
};

console.log('topology');
{
  const t = MACHINES.desk3060.topo;
  assert.deepStrictEqual([t.perf, t.eff, t.hybrid], [6, 8, true]); ok('12700F: 6 P + 8 E cores from WMI counts');
  assert.strictEqual(system.shapeTopology({ logical: 12, physical: 6, model: 'AMD Ryzen 5 5600X', platform: 'win32' }).perf, 6); ok('Ryzen 5600X: 6 cores, SMT not counted');
  assert.strictEqual(MACHINES.m1.topo.perf, 4); ok('M1: 4 performance cores');
}

console.log('threads');
{
  const th = (m, o) => governor.threadsFor(MACHINES[m].topo, { lim: governor.DEFAULT_LIMITS, ...o }).threads;
  assert.strictEqual(th('desk3060'), 5); ok('hybrid i7: P cores − 1, never E cores / all 20 logical');
  assert.strictEqual(th('desk3060', { gpuFull: true }), 4); ok('full GPU offload: at most 4 threads');
  assert.strictEqual(th('laptop8'), 3); ok('4-core laptop: 3 threads');
  assert.strictEqual(th('laptop8', { mode: 'eco' }), 1); ok('on battery (eco): halved');
  assert.strictEqual(th('quad'), 3); ok('4 cores without GPU: 3 threads');
  assert.strictEqual(governor.threadsFor(MACHINES.quad.topo, { lim: { ...governor.DEFAULT_LIMITS, threads: 4 } }).threads, 4); ok('limits.threads override wins');
  for (const m of Object.keys(MACHINES)) assert.ok(th(m) < MACHINES[m].topo.logical, m);
  ok('never every logical core');
}

console.log('headroom & budgets');
const lim = governor.DEFAULT_LIMITS;
{
  const hr = governor.headroom(MACHINES.laptop8.specs, lim);
  assert.strictEqual(hr.ramGB, 2.5); ok('8 GB: 2.5 GB RAM kept free');
  const b = governor.budget(MACHINES.desk3060.specs, { lim, live: { availRamGB: 9, gpu: { usedGB: 1.6, totalGB: 12 } } });
  assert.ok(b.vramGB < 12 - 1.6 && b.vramGB > 8, 'vram budget ' + b.vramGB); ok(`RTX 3060 with 1.6 GB used by the desktop: ${b.vramGB} GB usable (not 0.92 × 12 = 11)`);
  assert.ok(b.why.some((w) => /video memory/.test(w))); ok('explains other apps\' VRAM use');
  const m1 = governor.budget(MACHINES.m1.specs, { lim, live: { availRamGB: 4 } });
  assert.ok(m1.vramGB <= 8 * 0.72 && m1.vramGB < 4, 'm1 ' + m1.vramGB); ok(`Apple 8 GB: unified budget ${m1.vramGB} GB follows free memory`);
  const fab = governor.budget(MACHINES.desk3060.specs, { lim, live: { availRamGB: 6, gpu: { usedGB: 7, totalGB: 12 } }, fabro: { ramGB: 1, vramGB: 5.5 } });
  assert.ok(fab.vramGB > 9, 'own models count as free ' + fab.vramGB); ok('Fabro\'s own loaded models count as evictable');
}

console.log('plan fitting');
{
  const bud = (m, live) => governor.budget(MACHINES[m].specs, { lim, live });
  // 5 GB model (Gemma 4 E4B Q4) on the 3060: full offload
  let f = governor.fitPlan(memory.plan, model(5), { ctx: 8192, gpuLayers: -1, kvType: 'f16' }, MACHINES.desk3060.specs, bud('desk3060', { availRamGB: 10, gpu: { usedGB: 1.2, totalGB: 12 } }), { lim });
  assert.strictEqual(f.plan.mode, 'gpu'); assert.ok(f.fits); ok('E4B on RTX 3060: all layers on the GPU');
  // 12 GB model on the 3060 with a browser using 3 GB: split, not overflow into shared memory
  f = governor.fitPlan(memory.plan, model(12, 'gpt-oss 20B'), { ctx: 8192, gpuLayers: -1, kvType: 'f16' }, MACHINES.desk3060.specs, bud('desk3060', { availRamGB: 10, gpu: { usedGB: 3, totalGB: 12 } }), { lim });
  assert.ok(f.plan.vramGB <= f.budget.vramGB + 0.05, `vram ${f.plan.vramGB} <= ${f.budget.vramGB}`); ok(`20B on 3060 with 3 GB used elsewhere: ${f.plan.mode} (${f.plan.vramGB} GB VRAM ≤ budget)`);
  // 5 GB model on the 8 GB laptop with 4 GB free: context shrinks or refused, never swap
  f = governor.fitPlan(memory.plan, model(5), { ctx: 8192, gpuLayers: -1, kvType: 'f16' }, { ...MACHINES.laptop8.specs }, bud('laptop8', { availRamGB: 4 }), { lim });
  assert.ok(f.refused || f.plan.ramGB <= f.budget.ramGB + 0.05); ok(`5 GB model, 8 GB laptop, 4 GB free: ${f.refused ? 'refused (would swap)' : 'fits after ' + f.steps.join(', ')}`);
  // a 2 GB model on the same laptop: fits
  f = governor.fitPlan(memory.plan, model(2, 'Qwen 3B'), { ctx: 8192, gpuLayers: -1, kvType: 'f16' }, MACHINES.laptop8.specs, bud('laptop8', { availRamGB: 5.5 }), { lim });
  assert.ok(f.fits && f.plan.mode === 'cpu'); ok('2 GB model on the laptop: CPU, fits');
  // explicit ctx is never changed, but a hopeless plan is refused
  f = governor.fitPlan(memory.plan, model(7), { ctx: 32768, gpuLayers: -1, kvType: 'f16' }, MACHINES.laptop8.specs, bud('laptop8', { availRamGB: 4 }), { lim, explicit: { ctx: true } });
  assert.strictEqual(f.plan.ctx, 32768); assert.ok(f.refused); ok('explicit context kept; plan refused instead of swapping');
  f = governor.fitPlan(memory.plan, model(7), { ctx: 32768, gpuLayers: -1, kvType: 'f16' }, MACHINES.laptop8.specs, bud('laptop8', { availRamGB: 4 }), { lim: { ...lim, allowSwap: true }, explicit: { ctx: true } });
  assert.ok(!f.refused); ok('allowSwap lets it through');
  // Apple 8 GB: unified budget
  f = governor.fitPlan(memory.plan, model(5), { ctx: 8192, gpuLayers: -1, kvType: 'f16' }, MACHINES.m1.specs, bud('m1', { availRamGB: 5 }), { lim });
  assert.ok(f.refused || f.plan.vramGB <= f.budget.vramGB + 0.05); ok(`5 GB model on an 8 GB Mac: ${f.refused ? 'refused' : f.plan.mode + ' ctx ' + f.plan.ctx}`);
}

console.log('autotune planning');
const caps = autotune.parseHelp(fs.existsSync('/tmp/llama-help.txt') ? fs.readFileSync('/tmp/llama-help.txt', 'utf8') : [
  '-t,    --threads N   number of threads', '-tb,   --threads-batch N', '-c,    --ctx-size N', '-b,    --batch-size N', '-ub,   --ubatch-size N',
  '-fa,   --flash-attn [on|off|auto]       set Flash Attention use', '-ngl,  --gpu-layers, --n-gpu-layers N', '-np,   --parallel N', '-ctk,  --cache-type-k TYPE', '-ctv,  --cache-type-v TYPE',
  '-cram, --cache-ram N', '-cmoe, --cpu-moe', '--poll <0...100>', '-m,    --model FNAME', '--host HOST', '--port PORT', '--jinja', '--cache-reuse N', '-mm,   --mmproj FILE', '--embedding, --embeddings', '--rerank, --reranking',
  '--prio N', '--numa TYPE', '--no-warmup', '--metrics', '--slots'].join('\n'));
{
  const tune = (m, gb, live) => autotune.tune(model(gb), { ctx: 8192, gpuLayers: -1, threads: 0, kvType: 'f16', flashAttn: 'auto' },
    { specs: MACHINES[m].specs, topo: MACHINES[m].topo, caps, budget: governor.budget(MACHINES[m].specs, { lim, live }), mode: 'balanced', explicit: {}, planFn: memory.plan });
  const flags = (t) => autotune.materialize(t.pairs, 1234, caps).args;
  let t = tune('desk3060', 5, { availRamGB: 10, gpu: { usedGB: 1.2, totalGB: 12 } });
  let a = flags(t);
  assert.strictEqual(a[a.indexOf('-ngl') + 1], '999'); assert.strictEqual(a[a.indexOf('-t') + 1], '4'); assert.strictEqual(a[a.indexOf('--poll') + 1], '0');
  ok(`3060 + E4B: ${t.summary.text}; poll 0; argv ${a.slice(6).join(' ')}`);
  assert.ok(+a[a.indexOf('-cram') + 1] <= 4096); ok('prompt cache bounded (llama-server default is 8 GB)');
  t = tune('laptop8', 2, { availRamGB: 5 }); a = flags(t);
  assert.strictEqual(a[a.indexOf('-ngl') + 1], '0'); assert.ok(a.includes('-ub')); assert.ok(+a[a.indexOf('-cram') + 1] <= 1024);
  ok(`8 GB laptop + 2 GB model: ${t.summary.text}, small batches, cache ${a[a.indexOf('-cram') + 1]} MB`);
  t = tune('m1', 2.5, { availRamGB: 5 }); assert.ok(t.plan.ngl > 0); ok(`M1 8 GB: ${t.summary.text}`);
  t = tune('quad', 2, { availRamGB: 12 }); a = flags(t); assert.strictEqual(a[a.indexOf('-t') + 1], '3'); assert.ok(!a.includes('--poll')); ok(`4 cores no GPU: ${t.summary.text}`);
  // explicit user values win
  const e = autotune.tune(model(5), { ctx: 4096, gpuLayers: 20, threads: 12, kvType: 'f16', flashAttn: 'auto' }, { specs: MACHINES.desk3060.specs, topo: MACHINES.desk3060.topo, caps, budget: governor.budget(MACHINES.desk3060.specs, { lim }), explicit: { threads: true, gpuLayers: true, ctx: true }, planFn: memory.plan });
  a = flags(e); assert.strictEqual(a[a.indexOf('-t') + 1], '12'); assert.strictEqual(a[a.indexOf('-ngl') + 1], '20'); assert.strictEqual(a[a.indexOf('-c') + 1], '4096'); ok('explicit modelProfiles values win (threads 12, ngl 20, ctx 4096)');
  assert.deepStrictEqual(autotune.explicitKeys({ ctx: 8192, threads: 0, gpuLayers: -1 }, {}), {}); ok('shipped defaults count as "auto"');
  assert.deepStrictEqual(autotune.explicitKeys({ threads: 8 }, { ctx: 16384 }), { ctx: true, threads: true }); ok('changed global or profile values count as explicit');
  // cached benchmark result is applied
  const b = autotune.tune(model(2), { ctx: 8192, gpuLayers: -1, threads: 0, kvType: 'f16' }, { specs: MACHINES.quad.specs, topo: MACHINES.quad.topo, caps, budget: governor.budget(MACHINES.quad.specs, { lim, live: { availRamGB: 12 } }), explicit: {}, bench: { threads: 2, poll: 0, tokPerSec: 21.5 }, planFn: memory.plan });
  assert.strictEqual(b.summary.threads, 2); assert.match(b.summary.text, /21.5 tok\/s/); ok(`benchmark winner applied: ${b.summary.text}`);
  const c = autotune.candidates({ threads: 5, poll: null }, MACHINES.desk3060.topo, false);
  assert.ok(c.length >= 2 && c.length <= 3); ok(`2-3 benchmark candidates: ${c.map((x) => x.name).join(', ')}`);
}

console.log('capability filtering');
{
  assert.ok(caps.flags.has('-cram') && caps.faValue); ok(`--help parsed: ${caps.count} flags, -fa takes on|off|auto`);
  const r = autotune.filterArgs([['-m', 'x'], ['--mlock'], ['-cram', 512], ['--made-up-flag', 1], ['-fa', 'auto']], caps);
  assert.deepStrictEqual(r.args, ['-m', 'x', '-cram', '512', '-fa', 'auto']); assert.deepStrictEqual(r.dropped, ['--mlock', '--made-up-flag']); ok('unknown flags dropped with their values');
  const old = autotune.parseHelp('-m,    --model FNAME\n-fa,   --flash-attn   enable Flash Attention (default: disabled)\n-c,    --ctx-size N\n' + Array.from({ length: 30 }, (_, i) => `--opt${i} N`).join('\n'));
  assert.strictEqual(old.faValue, false);
  assert.deepStrictEqual(autotune.filterArgs([['-fa', 'auto'], ['-cram', 1], ['-c', 4096]], old).args, ['-c', '4096']); ok('old build: "-fa auto" dropped (switch form), -cram dropped');
  assert.deepStrictEqual(autotune.filterArgs([['-fa', 'on']], old).args, ['-fa']); ok('old build: "-fa on" → "-fa"');
  assert.deepStrictEqual(autotune.filterArgs([['-tb', 4], ['-m', 'x']], null).args, ['-m', 'x']); ok('unreadable --help: legacy flag set only');
}

console.log('queue');
(async () => {
  const order = [];
  const job = (p, label, ms) => governor.acquire({ priority: p, label }).then(async (rel) => { order.push(label); await new Promise((r) => setTimeout(r, ms)); rel(); });
  const all = [job('user', 'u1', 30), job('bg', 'title', 5), job('sub', 's1', 5), job('user', 'u2', 5), job('sub', 's2', 5)];
  await Promise.all(all);
  assert.deepStrictEqual(order, ['u1', 'u2', 's1', 's2', 'title']); ok(`one at a time, user > sub-agents > background: ${order.join(' → ')}`);
  const ctrl = new AbortController();
  const hold = await governor.acquire({ priority: 'user' });
  const waiting = governor.acquire({ priority: 'bg', signal: ctrl.signal }).then(() => 'got', (e) => e.name);
  ctrl.abort(); assert.strictEqual(await waiting, 'AbortError'); hold(); ok('an aborted waiter leaves the queue');
  // aging: a background job waiting long enough goes before a fresh sub-agent
  const Q = governor._Q; const old = Q.waiting; void old;
  let gotBg = false; const h2 = await governor.acquire({ priority: 'user' });
  const pbg = governor.acquire({ priority: 'bg' }).then((r) => { gotBg = true; r(); });
  Q.waiting[0].at -= 100000; // pretend it waited 100 s
  const psub = governor.acquire({ priority: 'sub' }).then((r) => { assert.ok(gotBg, 'aged bg first'); r(); });
  h2(); await Promise.all([pbg, psub]); ok('aging: background work is delayed, never starved');
  let calls = 0; const g = governor.gated(async () => { calls++; return 7; }, { local: false });
  assert.strictEqual(await g(), 7); assert.strictEqual(governor.queueState().active.length, 0); ok('cloud providers bypass the queue');

  console.log('pressure watcher');
  const unloaded = [];
  const realAvail = system.availableRamGB;
  system.availableRamGB = async () => 0.3;
  governor.init({ engine: { instances: () => [{ key: 'a', model: { id: 'a', name: 'A' }, plan: { ramGB: 3, vramGB: 0 }, busy: 0, lastUsed: 1, pinned: false }, { key: 'b', model: { id: 'b', name: 'B' }, plan: { ramGB: 3, vramGB: 0 }, busy: 1, lastUsed: 0, pinned: false }], unload: async (v) => unloaded.push(v.model.id) } });
  const events = []; governor.on('pressure', (p) => events.push(p));
  await governor.checkPressure();
  assert.deepStrictEqual(unloaded, ['a']); assert.strictEqual(events[0].kind, 'ram'); ok('low RAM: the idle model is unloaded, the busy one never');
  system.availableRamGB = realAvail; governor.stopWatcher();

  console.log('storage');
  assert.strictEqual(storage.classifyWin({ DriveType: 3, Bus: 'SATA', Media: 'HDD' }).kind, 'hdd');
  assert.strictEqual(storage.classifyWin({ DriveType: 3, Bus: 'NVMe', Media: 'SSD' }).kind, 'ssd');
  assert.strictEqual(storage.classifyWin({ DriveType: 2, Bus: 'USB' }).kind, 'usb');
  assert.strictEqual(storage.classifyWin({ DriveType: 4 }).kind, 'network'); ok('Windows: HDD / NVMe / USB / network');
  assert.strictEqual(storage.classifyMac('   Solid State:              No\n   Protocol:                 SATA\n').kind, 'hdd');
  assert.strictEqual(storage.classifyMac('   Protocol:                 USB\n   Device Location:          External\n   Solid State:              Yes\n').kind, 'usb');
  assert.strictEqual(storage.classifyMac('   Protocol:                 Apple Fabric\n   Solid State:              Yes\n   Device Location:          Internal\n').kind, 'ssd'); ok('macOS diskutil: HDD / USB / internal SSD');
  assert.strictEqual(storage.classifyLinux({ devName: 'sda', sys: '/sys/devices/pci0000:00/usb2/2-1', rot: '0', rem: '1' }).kind, 'usb');
  assert.strictEqual(storage.classifyLinux({ devName: 'sdb', rot: '1', rem: '0' }).kind, 'hdd');
  assert.strictEqual(storage.classifyLinux({ devName: 'nvme0n1', rot: '0', rem: '0' }).kind, 'ssd');
  assert.strictEqual(storage.classifyLinux({ devName: 'mmcblk0' }).kind, 'sd'); ok('Linux sysfs: USB / HDD / NVMe / SD');

  memory.shapeOf = realShape; void planFn;
  console.log(`perf-test: all ${n} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
