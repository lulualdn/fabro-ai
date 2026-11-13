// Offline test of the model finder (criteria, ranking, fit on synthetic machines, offline catalog) and of the
// light / medium / complex tiers (assignment, overrides, resolve + fallback, sub-agent choice).
// Hugging Face is stubbed with scripts/fixtures/models-hf.json (synthetic repos). Usage: node scripts/models-test.js
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-models-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, powerMonitor: { on() {}, isOnBatteryPower: () => false }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, dialog: {}, protocol: {} };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const store = require('../src/main/store'); store.init();
const models = require('../src/main/models');
const system = require('../src/main/system');
const finder = require('../src/main/modelfinder');
const tiers = require('../src/main/modeltiers');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'models-hf.json'), 'utf8'));

let n = 0; const ok = (name) => { n++; console.log('  ✓', name); };

// ── Hugging Face stub ──
let netDown = false; let fetchLog = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url)); fetchLog.push(u.pathname + u.search);
  if (netDown) throw new TypeError('fetch failed');
  const json = (x) => ({ ok: true, status: 200, json: async () => x });
  const m = u.pathname.match(/^\/api\/models\/(.+)\/tree\/main$/);
  if (m) { const t = FIX.trees[m[1]]; return t ? json(t) : { ok: false, status: 404, json: async () => ({}) }; }
  if (u.pathname === '/api/models') return json(FIX.list.map((x) => ({ id: x.repo, downloads: x.downloads, likes: x.likes, lastModified: x.updated, tags: x.tags, pipeline_tag: x.pipeline, gated: x.gated, gguf: x.gguf })));
  return { ok: false, status: 404, json: async () => ({}) };
};

const MACHINES = {
  laptop8: { platform: 'win32', ramGB: 8, accel: 'cpu', gpus: [{ name: 'Intel UHD', vendor: 'intel', vramGB: 1 }], unified: false, gpuBudgetGB: 0, ramBudgetGB: 4.8, cpu: { physical: 4, threads: 8 } },
  desk3060: { platform: 'win32', ramGB: 16, accel: 'cuda', gpus: [{ name: 'NVIDIA GeForce RTX 3060', vendor: 'nvidia', vramGB: 12 }], unified: false, gpuBudgetGB: 11, ramBudgetGB: 9.6, cpu: { physical: 14, threads: 20 } },
  m1: { platform: 'darwin', ramGB: 8, accel: 'metal', gpus: [{ name: 'Apple M1', vendor: 'apple', vramGB: null }], unified: true, gpuBudgetGB: 5.6, ramBudgetGB: 0, cpu: { physical: 8, threads: 8 } },
  big: { platform: 'linux', ramGB: 64, accel: 'cuda', gpus: [{ name: 'NVIDIA GeForce RTX 4090', vendor: 'nvidia', vramGB: 24 }], unified: false, gpuBudgetGB: 22, ramBudgetGB: 38, cpu: { physical: 16, threads: 32 } },
};
const run = (need, machine, o = {}) => finder.find({ need, specs: MACHINES[machine], useModel: false, ...o });
const sizeOf = (p) => p.variant.downloadGB;

(async () => {
  console.log('criteria');
  const C = (t, c) => finder.extractCriteria(t, c);
  const has = (c, ...u) => u.every((x) => c.uses.includes(x));
  {
    let c = C('something fast to help with homework'); assert.ok(has(c, 'homework', 'speed') && c.priority === 'speed'); ok('EN: fast + homework → speed priority');
    c = C('un modèle pour coder en Python sur mon petit portable'); assert.ok(has(c, 'code') && c.priority === 'speed' && c.small); ok('FR: coder en Python sur petit portable → code, speed, small');
    c = C('the best one my PC can run for long documents'); assert.ok(has(c, 'longctx') && c.priority === 'quality' && c.needs.longContext); ok('EN: best my PC can run + long documents → quality, long context');
    c = C('a model that can see images'); assert.ok(c.needs.vision); ok('EN: see images → vision');
    c = C('je veux analyser des photos et des captures d’écran'); assert.ok(c.needs.vision); ok('FR: photos / captures d’écran → vision');
    c = C('aide-moi à écrire des mails en français'); assert.ok(has(c, 'writing') && c.languages.includes('fr')); ok('FR: écrire des mails en français → writing, fr');
    c = C('translate between English and Japanese'); assert.ok(c.needs.translation && c.languages.includes('ja') && c.languages.includes('en')); ok('EN: translation English/Japanese');
    c = C('un modèle pour des agents qui utilisent des outils'); assert.ok(c.needs.tools); ok('FR: agents / outils → tool use');
    c = C('good at math and step by step reasoning'); assert.ok(c.needs.reasoning); ok('EN: math + step by step → reasoning');
    c = C('quelque chose de léger qui tourne sans GPU'); assert.ok(c.small && c.priority === 'speed'); ok('FR: léger sans GPU → small, speed');
    c = C('le plus puissant possible, j’ai un gros PC avec une RTX 4090'); assert.strictEqual(c.priority, 'quality'); ok('FR: le plus puissant, gros PC → quality');
    c = C('summarize my PDFs, under 4 GB'); assert.strictEqual(c.maxSizeGB, 4); assert.ok(has(c, 'writing')); ok('EN: "under 4 GB" → size limit');
    c = C('modèle de moins de 2,5 Go pour discuter'); assert.strictEqual(c.maxSizeGB, 2.5); ok('FR: "moins de 2,5 Go" → size limit');
    c = C('write a short story with characters, roleplay'); assert.ok(c.needs.roleplay && has(c, 'writing')); ok('EN: story + roleplay');
    c = C('debug my JavaScript and React code'); assert.ok(c.needs.code); ok('EN: debug JavaScript → code');
    c = C('send me the code postal of Paris'); assert.ok(!c.needs.code); ok('"code postal" is not coding');
    c = C('modelo para programar en español'); assert.ok(c.needs.code && c.languages.includes('es')); ok('ES: programar en español → code, es');
    c = C('hello'); assert.ok(c.confidence < 0.3 && c.priority === 'balanced' && !c.uses.length); ok('vague request → low confidence (would ask the model)');
    c = C('fast model', { vision: true, maxSizeGB: 3 }); assert.ok(c.needs.vision && c.maxSizeGB === 3); ok('constraints merge in');
    c = C('une IA pour réviser mon bac, rapide et pas trop gros'); assert.ok(has(c, 'homework') && c.priority === 'speed'); ok('FR: réviser le bac, rapide → homework, speed');
    c = C('I want the fastest but also the smartest'); assert.strictEqual(c.priority, 'balanced'); ok('fast + smartest → balanced');
  }

  console.log('optional model refinement');
  {
    let c = C('hmm i need help with some stuff for my uni thesis presentation and slides');
    const asked = [];
    const r = await finder.refineWithModel(c, async (p) => { asked.push(p); return 'Sure: {"uses":["writing","reasoning","bogus"],"priority":"quality","languages":["fr","xx1"],"small":false}'; });
    assert.ok(asked.length === 1 && r.uses.includes('writing') && !r.uses.includes('bogus') && r.languages.join() === 'fr' && r.by === 'heuristics+model'); ok('model answer is validated and merged');
    const bad = await finder.refineWithModel(c, async () => 'no json here'); assert.deepStrictEqual(bad.uses, c.uses); ok('garbage answer keeps the heuristics');
    const slow = await finder.refineWithModel(c, async () => { throw new Error('boom'); }); assert.strictEqual(slow.by, 'heuristics'); ok('failure keeps the heuristics');
    const none = await finder.refineWithModel(c, null); assert.strictEqual(none.by, 'heuristics'); ok('no model loaded → heuristics only (new user)');
    let calls = 0; await run('hello there my friend please help', 'desk3060', { useModel: true, llm: async () => { calls++; return '{}'; } }); assert.strictEqual(calls, 1); ok('find() asks the model once for an ambiguous request');
    calls = 0; await run('un modèle pour coder en Python sur mon petit portable', 'desk3060', { useModel: true, llm: async () => { calls++; return '{}'; } }); assert.strictEqual(calls, 0); ok('…but not when the heuristics are confident');
  }

  console.log('parameters from names');
  {
    const P = finder.parseParams;
    assert.deepStrictEqual([P('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF').total, P('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF').active, P('x/Qwen3-Coder-30B-A3B-Instruct-GGUF').moe], [30, 3, true]); ok('30B-A3B → 30B total, 3B active, MoE');
    assert.strictEqual(P('unsloth/gemma-4-E4B-it-GGUF').total, 4); ok('E4B → 4');
    assert.strictEqual(P('x/SmolLM2-135M-Instruct-GGUF').total, 0.135); ok('135M → 0.135');
    assert.strictEqual(P('x/Mix-8x7B-Instruct').total, 56); ok('8x7B → 56');
    assert.strictEqual(P('x/Foo-Instruct', 12.2e9).total, 12.2); ok('GGUF metadata beats the name');
  }

  console.log('8 GB iGPU laptop');
  let rLaptop;
  {
    const r = rLaptop = await run('something fast to help with homework', 'laptop8');
    assert.ok(r.ok && !r.offline); const rec = r.picks[0];
    assert.strictEqual(rec.role, 'recommended');
    assert.ok(rec.variant.downloadGB <= 3.5, `small pick: ${rec.model.name} ${rec.variant.downloadGB} GB`);
    assert.ok(/^Q[3-5]/.test(rec.variant.quant) || /^IQ[34]/.test(rec.variant.quant) || rec.variant.quant === 'MXFP4', 'quantized: ' + rec.variant.quant);
    assert.ok(rec.fit.mode === 'cpu'); assert.ok(rec.model.params <= 4.5, 'params ' + rec.model.params);
    ok(`recommended ${rec.model.name} ${rec.variant.quant} (${rec.variant.downloadGB} GB, ${rec.fit.speed}, ${rec.fit.tokPerSec} tok/s)`);
    const slowish = rec.fit.speed === 'slow' || rec.fit.speed === 'very-slow';
    if (slowish) assert.ok(rec.warnings.some((w) => /slow/.test(w.code))); assert.ok(rec.warnings.some((w) => w.code === 'cpuOnly' || /slow/.test(w.code)));
    ok('honest warning: no GPU / slow speed is stated');
    assert.ok(!r.picks.some((p) => p.model.params > 5 && !p.model.moe), 'nothing big on 8 GB RAM');
    for (const p of r.picks) assert.ok(p.fit.ramGB + p.fit.vramGB <= 4.8 + 0.1, `${p.model.name} needs ${p.fit.ramGB} GB of RAM`);
    ok('every pick fits the RAM budget (4.5 GB after headroom)');
    assert.ok(!r.picks.some((p) => /Kappa|Epsilon|Delta|Gamma/.test(p.model.name)), 'never a model that does not fit');
    ok('never recommends one that does not fit');
    assert.ok(r.picks.every((p) => p.why && p.good.length && Array.isArray(p.weak) && p.install.repo)); ok('each pick has a why, good-at / less-good-at and an install target');
  }

  console.log('16 GB + 12 GB VRAM');
  {
    const r = await run('un assistant polyvalent pour écrire et réfléchir', 'desk3060', { constraints: { priority: 'quality' } });
    const rec = r.picks[0];
    assert.ok(rec.fit.mode === 'gpu', `fully on the GPU, got ${rec.fit.mode}`); assert.ok(rec.model.params >= 7 && rec.model.params <= 20, 'mid-size: ' + rec.model.params);
    assert.ok(rec.fit.vramGB <= 11, 'vram ' + rec.fit.vramGB);
    ok(`mid-size pick fully on the GPU: ${rec.model.name} ${rec.variant.quant} (${rec.fit.vramGB} GB VRAM, ${rec.fit.tokPerSec} tok/s)`);
    assert.ok(r.picks.length >= 2); const roles = r.picks.map((p) => p.role); assert.ok(roles.includes('lighter') || roles.includes('stronger')); ok('alternatives: ' + r.picks.map((p) => `${p.role}=${p.model.name} ${p.variant.quant}`).join(' · '));
    const l = r.picks.find((p) => p.role === 'lighter'); if (l) { assert.ok(l.variant.sizeGB < rec.variant.sizeGB && l.fit.tokPerSec > rec.fit.tokPerSec); ok('the lighter alternative is smaller and faster'); }
    const s = r.picks.find((p) => p.role === 'stronger'); if (s) { assert.ok((s.model.params || 0) > (rec.model.params || 0) || s.model.moe); assert.ok(s.fit.tokPerSec >= 4); ok('the stronger alternative is a bigger model that still runs at a usable speed'); }
    assert.ok(!r.picks.some((p) => /Kappa/.test(p.model.name))); ok('70B (gated, 40 GB) is not offered');
    const fast = await run('fast and light', 'desk3060');
    assert.ok(fast.picks[0].variant.sizeGB < rec.variant.sizeGB + 0.01 || fast.picks[0].fit.tokPerSec >= rec.fit.tokPerSec); ok('"fast" prefers speed over size: ' + fast.picks[0].model.name);
  }

  console.log('big machine');
  {
    const r = await run('the best my PC can run', 'big', { constraints: { priority: 'quality' } });
    const rec = r.picks[0]; assert.ok(rec.model.params >= 14 || rec.model.moe, 'strong pick on a 4090: ' + rec.model.name + ' ' + rec.model.params); assert.ok(rec.fit.vramGB <= 22); ok(`4090 + 64 GB: ${rec.model.name} ${rec.variant.quant}`);
    assert.ok(!r.picks.some((p) => p.fit.vramGB + p.fit.ramGB > 60)); ok('still within the budget');
  }

  console.log('apple silicon 8 GB');
  {
    const r = await run('help me write', 'm1');
    assert.ok(r.ok); for (const p of r.picks) assert.ok(p.fit.vramGB <= 5.7, `${p.model.name} ${p.fit.vramGB}`); ok('unified memory budget respected: ' + r.picks[0].model.name);
  }

  console.log('special requests');
  {
    const r = await run('a model that can see images', 'desk3060');
    assert.ok(r.ok && r.picks.every((p) => p.model.vision), 'vision only'); assert.ok(r.picks.every((p) => /VL|Gemma|Qwen|vision/i.test(p.model.name) || p.model.vision)); ok('vision request → only vision-capable picks: ' + r.picks.map((p) => p.model.name).join(', '));
    assert.ok(r.picks[0].variant.downloadGB > r.picks[0].variant.sizeGB); ok('the vision projector is counted in the download size');
    const lap = await run('describe photos', 'laptop8'); assert.ok(lap.picks.every((p) => p.model.vision)); for (const p of lap.picks) assert.ok(p.fit.ramGB <= 4.9); ok('vision on the 8 GB laptop: ' + (lap.picks.map((p) => p.model.name).join(', ') || 'nothing'));
    const code = await run('coder en Python', 'desk3060'); assert.ok(code.picks[0].good.includes('code'), 'code pick: ' + code.picks[0].model.name); ok('coding request → a coding model first: ' + code.picks[0].model.name);
    const lim = await run('chat model under 3 GB', 'desk3060'); assert.ok(lim.picks.every((p) => p.variant.downloadGB <= 3.2)); ok('size limit honoured: ' + lim.picks.map((p) => p.variant.downloadGB + ' GB').join(', '));
    const none = await run('see images', 'laptop8', { constraints: { maxSizeGB: 0.5 } }); assert.ok(!none.ok && none.notes.some((x) => x.code === 'nothing')); ok('impossible limits → no pick and a clear note');
  }

  console.log('metadata ranking');
  {
    const r = await run('chat', 'desk3060', { constraints: { priority: 'quality' } });
    assert.ok(!r.picks.some((p) => /Legacy|Embed|Mu-8B/.test(p.model.name))); ok('2023 model, embedding model and base model are not recommended');
    assert.ok(!r.picks.some((p) => p.model.repo.startsWith('mirror/'))); ok('re-uploads of the same weights are merged');
    const gated = await run('big smart model', 'big', { constraints: { priority: 'quality' } });
    const k = gated.picks.find((p) => /Kappa/.test(p.model.name)); if (k) assert.ok(k.warnings.some((w) => w.code === 'gated')); ok('gated repos carry a token warning when offered' + (k ? '' : ' (not offered here)'));
    const all = (await run('chat', 'big', { constraints: { priority: 'balanced' } })).picks;
    const nc = (await run('writing assistant', 'desk3060')).picks.find((p) => /NC/.test(p.model.name)); if (nc) assert.ok(nc.warnings.some((w) => w.code === 'noncommercial')); ok('non-commercial licences are flagged');
  }

  console.log('offline');
  {
    netDown = true; fetchLog = [];
    const r = await run('something fast to help with homework', 'laptop8');
    assert.ok(r.ok && r.offline && r.notes.some((x) => x.code === 'offline')); ok('no network → catalog only, with a clear note');
    assert.ok(r.picks.every((p) => p.model.source === 'catalog') && r.picks.every((p) => p.variant.estimated)); ok('picks come from the built-in catalog, sizes marked as estimates');
    assert.ok(r.picks[0].variant.downloadGB <= 3.2); for (const p of r.picks) assert.ok(p.fit.ramGB <= 4.9); ok('and still fit: ' + r.picks.map((p) => `${p.model.name} ${p.variant.downloadGB} GB`).join(', '));
    const v = await run('see images', 'desk3060'); assert.ok(v.ok && v.picks.every((p) => p.model.vision)); ok('offline vision request → catalog vision models');
    fetchLog = []; const o2 = await finder.find({ need: 'coding', specs: MACHINES.desk3060, offline: true, useModel: false }); assert.ok(o2.offline && !fetchLog.length); ok('offline:true makes no network call at all');
    netDown = false;
  }

  console.log('tool');
  {
    const t = finder.TOOL; assert.strictEqual(t.name, 'find_model'); assert.deepStrictEqual(t.parameters.required, ['need']); assert.ok(/never invent/i.test(t.description) && /Install/.test(t.description)); ok('tool schema: need (required), priority, max_size_gb; description tells a small model when to call and not to invent');
    const agent = require('../src/main/agent'); require('../src/main/agent/models'); const reg = agent.get('find_model'); assert.ok(reg && reg.risk === 'read'); ok('registered as an agent tool (read-only, no permission prompt)');
    const sel = agent.select({ agentMode: false, text: 'trouve-moi un modèle pour mes devoirs', used: [] }).map((x) => x.name); assert.ok(sel.includes('find_model')); ok('selected in chat when the conversation is about models');
    assert.ok(!agent.select({ agentMode: false, text: 'bonjour, il fait beau', used: [] }).some((x) => x.name === 'find_model')); ok('…and not sent in unrelated chats (small prompt)');
    const orig = finder.find; const res = await finder.toolRun({ need: 'coder en python', priority: 'speed' }, {});
    assert.strictEqual(res.view.kind, 'modelpicks'); assert.ok(res.view.picks.length && /Install/.test(res.content) && /Do NOT list or invent/.test(res.content)); ok('tool result: structured view for the card + instructions for the model');
    assert.ok(!(await finder.toolRun({}, {})).view.picks.length); ok('missing need is handled');
    const before = fetchLog.filter((x) => /\/resolve\//.test(x)).length; assert.strictEqual(before, 0); ok('nothing is downloaded by the tool');
  }

  // ─────────────── tiers ───────────────
  console.log('tier assignment (pure)');
  {
    const it = (key, effB, tps) => ({ key, effB, tokPerSec: tps || null });
    let a = tiers.assign([it('a', 4)]); assert.strictEqual(a.get('a').tier, 'medium'); ok('one model → medium (and it answers for all three tiers)');
    a = tiers.assign([it('a', 4), it('b', 4.5)]); assert.deepStrictEqual([a.get('a').tier, a.get('b').tier], ['medium', 'medium']); ok('nearly the same size → all medium');
    a = tiers.assign([it('s', 1.7), it('m', 8), it('l', 32)]); assert.deepStrictEqual([a.get('s').tier, a.get('m').tier, a.get('l').tier], ['light', 'medium', 'complex']); ok('1.7B / 8B / 32B → light / medium / complex');
    a = tiers.assign([it('s', 3), it('l', 14)]); assert.deepStrictEqual([a.get('s').tier, a.get('l').tier], ['light', 'complex']); ok('two models → light + complex');
    a = tiers.assign([it('s', 1.7), it('m', 8), it('l', 32)], { s: 'complex', zzz: 'light', m: 'bogus' }); assert.strictEqual(a.get('s').tier, 'complex'); assert.strictEqual(a.get('s').auto, 'light'); assert.strictEqual(a.get('m').tier, 'medium'); ok('overrides win, unknown keys / values ignored, the automatic tier is kept');
    a = tiers.assign([it('x', 8, 40), it('y', 8.5, 12), it('s', 1, 90), it('l', 70, 4)]); assert.strictEqual(a.get('s').tier, 'light'); assert.strictEqual(a.get('l').tier, 'complex'); ok('four models: the extremes get light and complex');
    const items = [{ key: 's', effB: 1.7, tier: 'light', tokPerSec: 60 }, { key: 'l', effB: 32, tier: 'complex' }];
    assert.strictEqual(tiers.pick('medium', items).item.key, 's'); assert.ok(tiers.pick('medium', items).fallback); ok('empty medium tier falls back to the nearest tier (lighter first)');
    assert.strictEqual(tiers.pick('light', [{ key: 'l', effB: 32, tier: 'complex' }]).item.key, 'l'); ok('light with only a complex model → that model');
    assert.strictEqual(tiers.pick('complex', items, { complex: 's' }).item.key, 's'); assert.strictEqual(tiers.pick('complex', items, { complex: 's' }).via, 'preferred'); ok('the preferred model of a tier wins');
    assert.strictEqual(tiers.pick('complex', items, { complex: 'gone' }).item.key, 'l'); ok('a preference for a model that is gone is ignored');
    assert.strictEqual(tiers.pick('light', []), null); ok('empty pool → null');
    assert.deepStrictEqual(['search the web for X', 'summarise this page', 'Écris le module', 'résume les articles'].map(tiers.defaultTier), ['light', 'light', 'medium', 'light']); ok('default tier: light for search / summaries / extraction, else medium');
  }

  console.log('tiers with installed models');
  {
    // models index: three local models + one embedding model
    const dir = path.join(tmp, 'models'); fs.mkdirSync(dir, { recursive: true });
    const mk = (id, name, gb, extra = {}) => { const fn = 'f' + Math.abs([...id].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)) + '.gguf'; const p = path.join(dir, fn); fs.writeFileSync(p, 'GGUF'); return { id, name, file: fn, path: p, sizeBytes: gb * 2 ** 30, quant: 'Q4_K_M', ...extra }; };
    const idx = [mk('r/Small-1.5B-GGUF/s.gguf', 'Small 1.5B · Q4_K_M', 1, { repo: 'r/Small-1.5B-GGUF' }), mk('r/Mid-8B-GGUF/m.gguf', 'Mid 8B · Q4_K_M', 4.9, { repo: 'r/Mid-8B-GGUF' }), mk('r/Big-32B-GGUF/l.gguf', 'Big 32B · Q4_K_M', 19.5, { repo: 'r/Big-32B-GGUF' }), mk('emb', 'embed', 0.3, { role: 'embed' })];
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx));
    const l = await tiers.list(); if (process.env.DBG) console.log(l.models.map((m) => [m.label, m.effB, m.paramsB, m.basis, m.tier]));
    const byName = Object.fromEntries(l.models.map((m) => [m.label.split(' ')[0], m.tier]));
    assert.deepStrictEqual(byName, { Small: 'light', Mid: 'medium', Big: 'complex' }); assert.strictEqual(l.models.length, 3); ok('installed models get tiers; the embedding model is not a chat model');
    assert.ok(l.models.every((m) => m.paramsB > 0 && m.basis)); ok('strength comes from the name (or the size when the name says nothing)');
    const r = await tiers.resolve('light'); assert.strictEqual(r.label.split(' ')[0], 'Small'); assert.strictEqual((await tiers.resolve('complex')).label.split(' ')[0], 'Big'); ok('resolve(light|complex)');
    await tiers.setOverride('l:r/Mid-8B-GGUF/m.gguf', 'complex'); assert.strictEqual(await tiers.of('l:r/Mid-8B-GGUF/m.gguf'), 'complex'); assert.strictEqual((await tiers.resolve('medium')).fallback, true); ok('override → tier changes; the empty medium tier falls back');
    assert.strictEqual(store.getSettings().modelTiers.overrides['l:r/Mid-8B-GGUF/m.gguf'], 'complex'); ok('stored per account (settings.modelTiers)');
    await tiers.setOverride('l:r/Mid-8B-GGUF/m.gguf', null); assert.strictEqual(await tiers.of({ backend: 'local', id: 'r/Mid-8B-GGUF/m.gguf' }), 'medium'); ok('override removed → automatic tier again');
    await tiers.setPreferred('light', 'l:r/Big-32B-GGUF/l.gguf'); assert.strictEqual((await tiers.resolve('light')).label.split(' ')[0], 'Big'); assert.strictEqual((await tiers.resolve('light')).via, 'preferred'); await tiers.setPreferred('light', null); ok('preferred model for a tier');
    assert.strictEqual(tiers.keyOf({ backend: 'provider', provider: 'p1', model: 'm1' }), 'p:p1:m1'); ok('provider refs have stable keys');

    console.log('sub-agent tier resolution');
    const main = { backend: 'local', id: 'r/Mid-8B-GGUF/m.gguf' };
    const fits = async () => ({ ok: true });
    let s = await tiers.forSubAgent('light', { main, check: fits });
    assert.deepStrictEqual(s.model, { backend: 'local', id: 'r/Small-1.5B-GGUF/s.gguf' }); assert.strictEqual(s.tier, 'light'); assert.ok(/light tier/.test(s.note)); ok('light → the small model');
    s = await tiers.forSubAgent('complex', { main, check: fits }); assert.strictEqual(s.model.id, 'r/Big-32B-GGUF/l.gguf'); ok('complex → the big model');
    s = await tiers.forSubAgent('medium', { main, check: fits }); assert.deepStrictEqual(s.model, main); assert.strictEqual(s.note, ''); ok('medium = the main model → no switch, no note');
    s = await tiers.forSubAgent(undefined, { main, text: 'search the web and summarise', check: fits }); assert.strictEqual(s.tier, 'light'); ok('no tier given: search / summarise → light');
    s = await tiers.forSubAgent(undefined, { main, text: 'write the module', check: fits }); assert.strictEqual(s.tier, 'medium'); ok('no tier given: otherwise medium');
    s = await tiers.forSubAgent('complex', { main, check: async () => ({ ok: false, why: 'it would not fit next to the model that is already working' }) });
    assert.deepStrictEqual(s.model, main); assert.ok(s.fellBack && /cannot be loaded next to it/.test(s.note)); ok('does not fit next to the main model → falls back to the main model and says so');
    s = await tiers.forSubAgent('Big 32B', { main, check: fits }); assert.strictEqual(s.model.id, 'r/Big-32B-GGUF/l.gguf'); ok('an explicit model name is still accepted');
    s = await tiers.forSubAgent('no-such-model', { main, check: fits, text: 'search' }); assert.strictEqual(s.tier, 'light'); ok('an unknown name falls back to the default tier');
    s = await tiers.forSubAgent('light', { main: { backend: 'local', id: 'r/Small-1.5B-GGUF/s.gguf' }, check: fits }); assert.strictEqual(s.note, ''); ok('already on the right model → nothing to say');
    const lone = tiers.fitsAlongside({ vramGB: 6, ramGB: 1 }, { v: 7, r: 0 }, { vramGB: 11, ramGB: 8 }); assert.strictEqual(lone, false); assert.strictEqual(tiers.fitsAlongside({ vramGB: 3, ramGB: 1 }, { v: 7, r: 0 }, { vramGB: 11, ramGB: 8 }), true); assert.strictEqual(tiers.fitsAlongside({ vramGB: 3, ramGB: 0 }, { v: 6, r: 0 }, { vramGB: 7, unified: true }), false); ok('alongside check: counts the busy main model against the budget (discrete and unified memory)');
    const tool = require('../src/main/agent'); require('../src/main/agent/plan'); const p = tool.get('run_subagent').parameters.properties.model; assert.deepStrictEqual(p.enum, ['light', 'medium', 'complex']); assert.ok(/light/.test(p.description) && /default/.test(p.description)); ok('run_subagent has model: light | medium | complex with one-line guidance');
    let got = null; const r2 = await tool.get('run_subagent').run({ description: 'd', task: 't', model: 'light' }, { spawnSub: async (a) => { got = a; return { text: 'done', steps: 1, tokens: 2, note: 'Sub-agent ran on X (light tier).', tier: 'light', label: 'X' }; } });
    assert.strictEqual(got.model, 'light'); assert.ok(/light tier/.test(r2.content)); ok('the tier reaches spawnSub and the note reaches the calling model');

    // cloud privacy: two providers in the pool; a conversation on provider A never sends a sub-task to provider B by itself
    const prov = require('../src/main/providers'); const realCM = prov.chatModels;
    prov.chatModels = () => [
      { ref: { backend: 'provider', provider: 'pa', model: 'a-large-70b' }, label: 'A large 70B', providerName: 'A', kind: 'openai' },
      { ref: { backend: 'provider', provider: 'pb', model: 'b-mini' }, label: 'B mini', providerName: 'B', kind: 'anthropic' },
    ];
    try {
      const mainA = { backend: 'provider', provider: 'pa', model: 'a-large-70b' };
      await tiers.setOverride('p:pb:b-mini', 'light'); await tiers.setOverride('l:r/Small-1.5B-GGUF/s.gguf', 'medium');
      const lt = await tiers.resolve('light'); assert.strictEqual(lt.key, 'p:pb:b-mini', 'light tier is provider B here');
      s = await tiers.forSubAgent('light', { main: mainA, check: fits });
      assert.deepStrictEqual(s.model, mainA); assert.ok(/another provider/.test(s.note));
      await tiers.setOverride('p:pb:b-mini', null); await tiers.setOverride('l:r/Small-1.5B-GGUF/s.gguf', null);
      ok('never another cloud provider unless chosen in settings');
      await tiers.setPreferred('light', 'p:pb:b-mini'); s = await tiers.forSubAgent('light', { main: mainA, check: fits }); assert.strictEqual(s.model.provider, 'pb'); await tiers.setPreferred('light', null); ok('…but a provider chosen for the tier is used');
      s = await tiers.forSubAgent('light', { main, check: fits }); assert.ok(s.model.backend === 'local'); ok('a local conversation stays local');
    } finally { prov.chatModels = realCM; }
  }

  console.log(`\n${n} checks passed`);
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e && e.stack || e); process.exit(1); });
