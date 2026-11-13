# Fabro v0.2 — performance audit (branch `v02-perf`)

Problem reported by the owner: the app makes machines lag and sometimes freeze; models are not tuned when
settings are left on default. Each finding: evidence → fix → status. "Verified" means run on this Linux VM
(2 vCPU, 7.7 GB RAM, no GPU); "unverified" means the code path only exists on Windows / macOS / a GPU and must be
checked on the owner's PC (RTX 3060 12 GB, Windows 11, Gemma 4 E4B).

## Measurements

### Renderer while streaming (`scripts/perf-bench.js`)
Real Electron app, fake OpenAI-compatible server, 4 earlier answers in the conversation, then a ~3000-token answer
(12 k chars: paragraphs, lists, a table, JS/Python/Lua code blocks) at one token every 6 ms, CPU throttled 4× via
CDP (`Emulation.setCPUThrottlingRate`). Long tasks from `PerformanceObserver('longtask')`, frame intervals from rAF.

| | before (fd554ef renderer) | after (run 1) | after (run 2) |
|---|---|---|---|
| main thread blocked by long tasks | **17 555 ms of 20.8 s (84 %)** | 3 685 ms | 2 606 ms |
| long tasks | 126 | 52 | 40 |
| longest task | 345 ms | 351 ms | 242 ms |
| frames painted during the stream | 208 | 648 | 639 |
| frame interval p50 / p95 / p99 | 66.7 / 266.6 / 283.4 ms | 33.3 / 50.1 / 83.3 ms | 33.3 / 50.0 / 66.7 ms |
| frames slower than 50 ms | 120 | 53 | 32 |

Read: before, the window was frozen ~84 % of the time while a long answer streamed on a slow CPU (≈4 fps, the UI
hangs, typing in the composer lags); after, it renders every 2nd vsync under 4× throttling. The remaining longest
task is the final full render of the message when it ends (one-off). Command:
`flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/perf-bench.js 4 3000 6`.

### Engine path with a real llama-server (verified, CPU build)
Built `llama-server` from llama.cpp master (commit 8ca5a80, 2026-11-12) on this VM, model SmolLM2-135M Q4_K_M.
`engine.ensure()` produced:
`-m … -c 8192 -np 1 -ngl 0 --jinja --cache-reuse 256 -fa auto -cram 256 -b 512 -ub 256 -t 2` (no flag dropped),
the server answered, `maxContext()` = 8192 (model limit), `resizeContext(model, 4096)` relaunched at 4096,
the benchmark ran 2 candidates in 2.8 s (planned 64.0 tok/s vs no-poll 65.9 tok/s → kept the plan, < 3 % better),
a user request during a second benchmark aborted it at once, and the next `ensure()` relaunched normally.

## Findings

| # | Finding | Evidence | Fix | Status |
|---|---|---|---|---|
| 1 | **Whole message re-parsed and re-highlighted every frame while streaming** (O(n²) over an answer). Each rAF: `marked.parse` of the whole content, `hljs.highlightAuto` on every code block (auto-detection runs every grammar), `DOMPurify` of all of it, citation walk, then `innerHTML` replaces the whole body. | `app.js` `scheduleStreamRender` → `assistantBody` → `md()`; bench above: 84 % main-thread time | `src/renderer/stream-render.js`: finished blocks (blank line outside a code fence, next line not indented) parsed once, their nodes kept; only the tail is parsed per frame; code highlighted on idle (`requestIdleCallback`); parts around the text only rewritten when they change; final render unchanged (same markup), its highlighting also idle. Full renders (artifacts, inputs focused) are throttled adaptively (a render that took d ms waits 3·d). | Fixed, measured |
| 2 | Long chats keep every message laid out and painted | `.thread` holds all messages; 2 239 nodes in the bench chat | `styles/perf.css`: `content-visibility:auto` + `contain-intrinsic-size:auto 320px` on every message but the last two | Fixed |
| 3 | Animations keep running when the window is hidden: `backgroundThrottling:false` (needed for quick-bar answers) means Chromium keeps rendering the hidden window; 27 infinite CSS animations exist (spinners, shimmer on `background-position` = repaint each frame) | `main.js` `backgroundThrottling: false`; `styles.css` `animation: … infinite` | `html.fabro-hidden * { animation-play-state: paused }` toggled on `visibilitychange` | Fixed |
| 4 | **VRAM budget ignored other apps**: plan budget = 0.92 × total VRAM (11 GB on a 3060) whatever the desktop, browser and Fabro's own window already use → models spill into Windows "shared GPU memory" (system RAM over PCIe): the classic whole-PC freeze | `system.js` `gpuBudgetGB = nvidia.vramGB * 0.92`; `memory.plan` used it as-is | `governor.budget()`: total − headroom (0.8–2 GB, 1.32 GB on 12 GB) − live use by others (nvidia-smi used − Fabro's own models); static deduction when no live numbers | Fixed, unverified on GPU |
| 5 | **RAM budget allowed swapping**: `makeRoom` let models use 80 % of total RAM regardless of what other apps hold; `fits` allowed +2 GB over budget | `engine.js` makeRoom `ramGB * 0.8`; `memory.js` `ramBudgetGB + 2` | Budget = MemAvailable (Linux) / vm_stat free+inactive+purgeable (macOS) / freemem (Windows) + Fabro's own evictable models − headroom (2.5 GB on 8 GB … 6 GB max); `fitPlan` shrinks (KV q8_0 when flash attention is available, then context halves down to 2048) and **refuses** with `NO_ROOM` rather than swap (`limits.allowSwap` to override) | Fixed |
| 6 | **llama-server's prompt cache defaults to 8 GB of RAM** (`--cache-ram`, default 8192 MiB) — on an 8 GB laptop that alone can push the system into swap after a few conversations | llama.cpp `common/common.h` `cache_ram_mib = 8192`; arg.cpp `-cram` | `-cram` = 25 % of what is left in the RAM budget after the model, 256–4096 MB | Fixed, verified flag |
| 7 | **Threads**: default threads = llama.cpp's own (all physical cores on Windows, *including E-cores* on hybrid Intel; it is not hybrid-aware on Windows) → every core pinned at 100 %, the desktop stutters, and E-cores slow every token down. Eco mode used `os.cpus().length / 2` | llama.cpp `common.cpp` `cpu_get_num_physical_cores` (Windows branch); `engine.js` old argsFor | `system.cpuTopology()` (sysfs / WMI / sysctl, async, cached): physical, performance and efficiency cores; `governor.threadsFor`: P-cores − 1 (− 2 from 8), ≤ 4 when everything is on the GPU, halved in eco; `limits.threads` override | Fixed; Windows P/E split heuristic unverified |
| 8 | Busy-wait polling: llama.cpp threads poll at level 50 by default, spinning cores even when the GPU does all the work | `common.h` `poll = 50` | `--poll 0` with full GPU offload and in eco; benchmark may pick otherwise | Fixed |
| 9 | Inference priority: "balanced" = NORMAL, "performance" = ABOVE_NORMAL — competes with the desktop compositor and input | `engine.js` `PRIORITY()` | Below normal by default (costs nothing when the machine is otherwise idle), NORMAL for "performance", `limits.priority` override | Fixed (Windows priority classes unverified) |
| 10 | **Several heavy generations at once**: parallel sub-agents, scheduled tasks, background title/memory jobs and the local API all hit the engine at the same time, and a scheduled task on another model loads a second big model next to a busy one | `chat.js` sub-agents `Promise.all`; `tasks.js` / `brain.js` / `localapi.js` call `engine.ensure` freely; `makeRoom` never evicts busy models but loaded the new one anyway | `governor.acquire/gated`: one local generation at a time (`limits.maxGenerations`), priority user > sub-agents > background with aging (45 s per class); the queue is per completion call, so a parent never deadlocks with its sub-agents; `makeRoom` now **waits** for a busy model rather than overloading memory. The UI shows "waiting for the other answer" (`status: 'queued'`) | Fixed, tested (queue) |
| 11 | No reaction to memory pressure: a model stays loaded while the user opens a game or a browser | — | Pressure watcher (only while a model is loaded; every 10 s one cheap read; nvidia-smi every 30 s): available RAM < max(0.75 GB, 40 % of headroom) or < 0.3 GB VRAM free → unload the least recently used *idle* model; notice in the app | Fixed, tested (unit) |
| 12 | Battery only, no thermal / speed-limit back-off | `engine.js` powerMonitor on-battery/on-ac | `governor.watchPower`: battery, macOS thermal state (serious/critical), `speed-limit-change` < 80 % → eco | Fixed, unverified on laptops |
| 13 | Flags passed blindly: `-fa auto` breaks builds older than mid-2025 (switch form), an engine update that renames a flag breaks launching | `engine.js` argsFor; llama.cpp renamed `--mmap/--mlock` to `--load-mode` this year | `autotune.capabilities()`: `--help` parsed once per build (cached in `fabro-caps.json` next to the build), every flag filtered, `-fa on` → `-fa` on old builds, legacy set when help is unreadable | Fixed, verified on current build |
| 14 | Startup: the window waits for `system.getSpecs()` (nvidia-smi; PowerShell WMI up to 10 s on machines without NVIDIA) through `providers.autoFree` | `main.js` whenReady `await providers.autoFree(...)` before `createWindow()` | Not changed (hot file, behaviour of another feature). CPU topology runs in parallel with the GPU query so it adds no time; `getSpecs` now de-duplicates concurrent calls | **Open** — recommend creating the window before `autoFree` |
| 15 | `agent-ui.js` calls `syncBrowser()` every 700 ms forever: `getBoundingClientRect` (forced layout when dirty) + an IPC + `setBounds` in main | `agent-ui.js:285` | Not changed (not my file) | **Open** — only run it while the agent browser is shown |
| 16 | Sync fs on hot paths: `gguf.summarize` uses `readSync` (first plan of each model, cached after), `monitor.rssOf` read `/proc` synchronously, `models.librariesView` `mkdirSync`/`statfsSync`, `memory.fileBytes` `statSync` | files as named | `monitor.rssOf` made async; others are once-per-model or small, left | Partly fixed |
| 17 | `memory.plan` treated Apple unified memory as 70 % of RAM regardless of what is free | `system.js` `gpuBudgetGB = ramGB * 0.7` | unified budget = min(72 % of RAM, available + Fabro's − headroom) | Fixed, unverified on Mac |
| 18 | Slow storage: no notion of where models live | — | `storage.js` (see API doc) | New |
| 19 | Per-token IPC: every token is one `chat:event` IPC message, forwarded to Fabro Anywhere and the remote UI tee too | `chat.js` `acc.push` → `main.js send` | Not changed; the renderer now batches DOM work per frame so the cost is the IPC itself (~µs each). Could be batched in main at 16 ms if needed | Open, low impact |

## Not verified here (check on the owner's PC)
- Everything NVIDIA: live VRAM numbers, `nvidia-smi --query-compute-apps` (often "N/A" per process under WDDM — the code falls back to Fabro's planned VRAM), the pressure watcher's VRAM branch, full offload of Gemma 4 E4B with `-t 4 --poll 0 -cram …`.
- Windows: WMI CPU counts → P/E split for hybrid Intel (heuristic: logical = 2P + E), Core Ultra without HT (guessed 35 % P), process priority, PowerShell `Get-PhysicalDisk` storage detection, `os.freemem()` as "available".
- macOS: `sysctl hw.perflevel0.physicalcpu`, `vm_stat` available memory, `diskutil` storage, thermal state. The 8 GB Mac budget may be conservative (2.5 GB headroom + 1 GB for Fabro on top of memory compression) — tune `ramHeadroomGB` if Gemma E2B gets refused there.
- The micro-benchmark on a GPU (candidates: poll 0 vs 50, +2 threads) — verified only on CPU.
