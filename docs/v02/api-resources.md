# Resources, governor, autotune, storage — API for the other v0.2 features

Renderer: everything below is under `api.resources.*` (preload). Events via `api.on(channel, cb)`.
Main process: `require('./resources' | './governor' | './autotune' | './storage' | './engine')`.
Sizes are bytes unless the name ends in `GB` / `MB`.

## Resources screen (`api.resources`)

### `overview()` → one call for the header
```js
{ specs: { ramGB, gpus, accel, unified, cpu, topology: { logical, physical, perf, eff, smt, hybrid } },
  limits,                       // settings.limits (see governor)
  headroom: { ramGB, vramGB },  // kept free for the system
  budget: { ramGB, vramGB, why: [string] },  // what a model may use right now
  queue: { active: [{ priority, label, since }], waiting: [...], max },
  energy: { battery, thermal, speedLimit, mode: 'eco'|'balanced'|'performance' },
  loaded: [{ id, name, ctx, vramGB, ramGB, busy, auto: summary, tuning: { summary, why[], args[], dropped[], plan } }],
  autotune: { running: { model, since, reason } | null, last } }
```
`summary` (per loaded model, for "auto: 33/33 layers on GPU, 6 threads, 41 tok/s"):
`{ text, layersOnGpu: '33/33', mode: 'gpu'|'split'|'moe'|'cpu', threads, ctx, kvType, poll, cacheRamMB, tokPerSec|null, measured }`.

### `disk({ refresh })` → disk usage in sections (cached 5 min, computed async)
```js
{ at, fabroBytes,
  sections: [{ id, kind, label, bytes, clearable?, modelId?, role?, imported?, inAppData?, path? }], // sorted by size
  disk: { path, totalBytes, freeBytes, otherBytes },  // the disk holding Fabro's data; otherBytes = everything not Fabro
  libraries: [{ id, name, path, usedBytes, freeBytes, count, storage: { kind, slow, how, mbps? } }] }
```
Section ids: `model:<id>` (one per installed model, `kind:'model'`), `engine`, `voice`, `images`, `tools`,
`conversations`, `artifacts`, `checkpoints`, `caches` (`clearable:true`), `other`.
One bar in several parts: `disk.otherBytes` + each section (models outside Fabro's folder have `inAppData:false`:
they may be on another disk — use `libraries` for those) + `disk.freeBytes`.

### `clearCaches()` → `{ freedBytes }`
HTTP / compiled-code / GPU-shader caches and Computer Use screenshots only. Never user data.

### History (sampled only while subscribed)
- `subscribe({ id?, intervalMs = 2000 })` → `{ id, intervalMs, history: [sample] }`. It is a **lease**: call it again with
  the same `id` at least every 60 s while the screen is open, or sampling stops by itself.
- `unsubscribe(id)`, `history()`.
- Event `resources:sample` → one sample:
```js
{ at, cpu: { total: %, fabro: % },
  ram: { totalGB, usedGB, fabroGB, otherGB },
  vram: { totalGB, usedGB, fabroGB, otherGB } | { unified: true } | null,   // null = no live numbers (non-NVIDIA)
  gpu: { util, temp, power, name } | null,
  models: [{ id, name, ramGB, vramGB, busy }] }
```
Ring buffer of 300 samples. Model RSS is refreshed every 3rd sample.

### `tips()` → `[{ id, severity: 'info'|'warn', kind, text, action: { id, label } | null, data? }]`
Computed from the live state (English text; translate by `kind`/`data` if you want). Kinds: `context` (data
`{ modelId, ctx, freesGB }`), `offload`, `models`, `vram`, `ram`, `cpu`, `energy`, `storage` (data = storage advice),
`disk`.

### `action(id)` → `{ ok, … }`
`ctx:<modelId>:<n>` (sets the model's context, reloads if loaded) · `kv-q8:<modelId>` · `unload:<modelId>` ·
`threads:auto` · `clear-caches` · `move:<modelId>:<libraryId>` · `download:<catalogId>`.

### Other
`maxContext(modelId)` (see below) · `autotune(modelId)` runs the benchmark now · `autotuneCancel()` ·
`storageAdvice(modelId)` · `storageRefuse(modelId, { never })` · `storageClassify(dir)`.

Events: `resources:pressure` `{ kind: 'ram'|'vram', freeGB, unloaded: { id, name } | null }` (perf-ui.js already shows a
notice) · `resources:queue` (queue state) · `storage:advice` (below).

## Context window that grows on demand (engine, main process)
```js
const engine = require('./engine');
await engine.maxContext(model)
// → { max, fullGpu, ctxTrain, current, limitedBy: 'model'|'memory', budget: { ramGB, vramGB } }
//   max: largest ctx (multiple of 256) within the governor's headroom; fullGpu: largest that keeps every layer
//   on the GPU (null without GPU). Prefer staying ≤ fullGpu: past it the model gets much slower.
await engine.resizeContext(model, newCtx)
// → { ctx, port, key, plan, requested, limitedBy }
//   Clamped to max. Waits for the model's current answer to finish, then relaunches the same model with the new
//   ctx. The conversation lives in the app, nothing is lost; llama-server's prompt cache is rebuilt on the next
//   request (one prompt re-processing). Re-read the port from the result (or engine.ensure) afterwards.
engine.resetContext(model) // back to the profile's ctx at the next load
```
`model` = `await require('./models').getLocal(id)`. A resized ctx counts as explicit (autotune won't shrink it;
the governor still refuses a plan that cannot fit).

## Generation queue (governor)
```js
const governor = require('./governor');
const release = await governor.acquire({ priority: 'user'|'sub'|'bg', label, signal }); try { … } finally { release(); }
const fn2 = governor.gated(fn, { local, priority, label, signal, onWait(isWaiting) }); // wraps a completion call
governor.queueState(); governor.on('queue', cb);
```
Already wired: `chat.js` (every local completion; sub-agents = `sub`, `bg-*` requests and unattended tasks = `bg`;
cloud providers bypass it), `localapi.js` (`user`). Hold a slot only for the duration of one model call — never
while waiting for other agents (that would deadlock). Background work must not call `engine.ensure` on a
different model just to answer: `makeRoom` waits for busy models, so it will simply wait.

## Limits (`settings.limits`, defaults in store.js)
`{ threads: 'auto'|n, ramHeadroomGB: 'auto'|n, vramHeadroomGB: 'auto'|n, maxGenerations: 1, unloadOnPressure: true,
batteryBackoff: true, priority: 'auto'|'low'|'normal'|'high', allowSwap: false, autotune: true }`.
Applied at the next model load (threads/priority) or immediately (queue, pressure).

## Autotune
Explicit values in `modelProfiles` (and global `engine` settings that differ from the shipped defaults) always win.
`engine.tuning(modelId)` gives the chosen argv, dropped flags and the reasons. Benchmark results are cached in
`<shared>/autotune.json` per model file + hardware + engine build; it runs 2 min after the last generation when
the machine is idle and on AC, and yields at once to any request. Engine error code `NO_ROOM` (new) = the plan
would not fit without swapping; the error card falls back to the generic text until i18n adds `err_NO_ROOM_t/_b`.

## Slow storage (`storage.js`)
Event `storage:advice` (once per model per session, after it loads for chat, unless refused):
```js
{ modelId, modelName, storage: { kind: 'hdd'|'usb'|'network'|'sd'|'slow', how, mbps? },
  suggestion: 'move', toLibrary: { id, name, path }, needBytes, freeBytes }
| { …, suggestion: 'small-model', smallModel: { id, name, repo, sizeGB }, toLibrary, needBytes, freeBytes, makeRoomBytes }
```
`perf-ui.js` shows it as a toast with two buttons ("Move it"/"Get it", "No thanks" → `storage:refuse`, remembered in
`<data>/storage-advice.json`).
