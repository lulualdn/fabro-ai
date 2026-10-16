// End-to-end engine test, run in CI on real Windows / macOS / Linux runners:
// pick + download + unpack + self-test llama.cpp, then load a tiny model and chat.
// Results are printed as GitHub annotations (::notice / ::error).
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-smoke-'));
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false } };
  return origLoad.call(this, req, ...rest);
};

const store = require('../src/main/store');
const system = require('../src/main/system');
const engine = require('../src/main/engine');
const { downloadFile } = require('../src/main/download');

const note = (m) => console.log(`::notice title=engine-smoke ${process.platform}::${m}`);
const fail = (m) => { console.log(`::error title=engine-smoke ${process.platform}::${m}`); process.exitCode = 1; };

(async () => {
  store.init();
  const specs = await system.getSpecs();
  if (process.env.FORCE_ACCEL) specs.accel = process.env.FORCE_ACCEL; // exercise the GPU build path on CPU runners
  note(`specs ${specs.platform} ${specs.arch} accel=${specs.accel} ram=${specs.ramGB}GB gpus=${specs.gpus.map((g) => g.name).join('|') || 'none'}`);

  let last = '';
  await engine.init((s) => { const k = `${s.status}:${s.build || ''}`; if (k !== last) { last = k; console.log('engine', k, s.error || ''); } });

  let meta;
  try {
    meta = await engine.install();
    note(`installed ${meta.tag} build=${meta.build} bin=${path.basename(meta.bin)}`);
  } catch (e) {
    return fail(`install ${e.code}: ${e.message} | ${String(e.detail || '').replace(/\n/g, ' / ').slice(0, 900)}`);
  }

  const model = path.join(tmp, 'Qwen3-0.6B-Q4_0.gguf');
  await downloadFile('https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf?download=true', model);
  try {
    const t0 = Date.now();
    const r = await engine.ensure({ path: model, name: 'Qwen3 0.6B' }, { ctx: 2048, gpuLayers: -1, threads: 0 });
    const res = await fetch(`http://127.0.0.1:${r.port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello in one word. /no_think' }], max_tokens: 24 }),
    });
    const j = await res.json();
    const text = (j.choices && j.choices[0] && (j.choices[0].message.content || j.choices[0].message.reasoning_content)) || JSON.stringify(j).slice(0, 200);
    const tps = j.timings && j.timings.predicted_per_second;
    note(`chat ok in ${Date.now() - t0} ms, ${tps ? tps.toFixed(1) + ' tok/s' : ''}: ${String(text).replace(/\s+/g, ' ').slice(0, 120)}`);
  } catch (e) {
    fail(`chat ${e.code || ''}: ${e.message} | ${String(e.detail || '').replace(/\n/g, ' / ').slice(0, 900)}`);
  } finally {
    await engine.stop();
  }
})().catch((e) => fail(`crash: ${e.stack || e}`));
