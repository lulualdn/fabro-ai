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
    await engine.stop();
    return;
  }

  // v1 engine features: import without copy, profiles (KV q8_0), two models loaded at once, local API.
  try {
    const models = require('../src/main/models');
    const localapi = require('../src/main/localapi');
    models.init(() => {});
    const twin = path.join(tmp, 'twin', 'Qwen3-0.6B-twin.gguf');
    fs.mkdirSync(path.dirname(twin), { recursive: true });
    try { fs.linkSync(model, twin); } catch { fs.copyFileSync(model, twin); }
    const found = await models.scanImports(path.dirname(twin));
    const [a] = await models.importModels([{ path: model, name: 'Qwen A', source: 'folder' }]);
    const [b] = await models.importModels(found);
    if (!a || !b) throw new Error('import failed');
    await store.setSettings({ modelProfiles: { [b.id]: { kvType: 'q8_0', ctx: 4096 } }, engine: { multiModel: true } });
    const ia = await engine.ensure(a); const ib = await engine.ensure(b);
    const loaded = engine.getStatus().loaded;
    note(`multi-model: ${loaded.length} loaded (${loaded.map((l) => `${l.name}:${l.mode}`).join(', ')}), ports ${ia.port}/${ib.port}`);
    if (loaded.length !== 2) fail('expected 2 models loaded');
    await store.setSettings({ localApi: { enabled: true, port: 11599 } });
    await localapi.init(() => {});
    const list = await (await fetch('http://127.0.0.1:11599/v1/models')).json();
    const id = list.data.find((m) => m.id.includes('twin')).id;
    const r = await (await fetch('http://127.0.0.1:11599/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'Say OK. /no_think' }], max_tokens: 16 }) })).json();
    const txt = r.choices && r.choices[0].message.content;
    note(`local API: ${list.data.length} models, ${id} → ${String(txt).replace(/\s+/g, ' ').slice(0, 60)}`);
    if (!txt) fail('local API returned no text: ' + JSON.stringify(r).slice(0, 300));
    await store.setSettings({ localApi: { enabled: false } }); await localapi.apply();

    // Projects: semantic search with a local embedding model (EmbeddingGemma) + keyword fusion.
    const emb = path.join(tmp, 'embeddinggemma-300M-Q8_0.gguf');
    await downloadFile('https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf?download=true', emb);
    const [e] = await models.importModels([{ path: emb, name: 'EmbeddingGemma 300M', source: 'folder' }]);
    if (!e || e.role !== 'embed') throw new Error('embedding model role not detected: ' + JSON.stringify(e && { role: e.role, arch: e.arch }));
    const db = require('../src/main/db'); db.init();
    const rag = require('../src/main/rag'); rag.init(() => {});
    db.saveProject({ id: 'p1', name: 'Smoke' });
    await rag.addText('p1', 'animaux.md', 'Le chat dort sur le canapé toute la journée.\n\n' + 'x '.repeat(10) + '\n\n');
    await rag.addText('p1', 'voitures.md', 'La voiture électrique se recharge la nuit dans le garage.');
    await rag.addText('p1', 'cuisine.md', 'Pour la pâte à crêpes, mélanger la farine, les œufs et le lait.');
    for (let i = 0; i < 300 && (db.listProjectFiles('p1').some((f) => f.status !== 'indexed') || db.chunksWithoutVec('p1', e.id).length); i++) await new Promise((r) => setTimeout(r, 200));
    const t1 = Date.now();
    const s1 = await rag.search('p1', 'où se repose le félin ?', 3); // no shared keyword: needs meaning
    note(`semantic search ${s1.semantic ? 'on' : 'OFF'} in ${Date.now() - t1} ms → ${s1.results.map((r) => r.file).join(', ')}`);
    if (!s1.semantic || s1.results[0].file !== 'animaux.md') fail('semantic search did not find the right file: ' + JSON.stringify(s1.results.map((r) => r.file)));
  } catch (e) {
    fail(`v1 features ${e.code || ''}: ${e.message} | ${String(e.detail || '').slice(0, 600)}`);
  } finally {
    await engine.stop();
  }
})().catch((e) => fail(`crash: ${e.stack || e}`));
