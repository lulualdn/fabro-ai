'use strict';
// Light / intermediate / complex: every usable model (local, Ollama, provider) gets a tier so that sub-agents (and anything
// else that wants "a fast model" or "the strongest one") can ask for a tier instead of knowing model names.
//
// Tier rules (automatic, relative to what is usable right now):
//   strength  = effective parameters in billions (MoE: geometric mean of total and active), from the catalog entry, the file
//               / repo name, else estimated from the quantized file size. Providers: a size in the name (70b), else the family
//               words (mini / flash / haiku / nano → small, opus / pro / large / reasoner → big), else mid.
//   models within 25 % of each other are ordered by measured speed on this machine (faster = lighter).
//   one model → it is all three tiers; a pool whose strongest is < 1.6× the lightest → all "medium";
//   otherwise the pool is split in three on a log scale: lowest third light, highest third complex, the rest medium.
//   The user can override a model's tier and pick the preferred model of each tier (settings.modelTiers, per account).
// resolve(tier) → the model to use, with a sensible fallback when a tier is empty. forSubAgent() adds the governor check.
const store = require('./store');
const models = require('./models');
const memory = require('./memory');
const governor = require('./governor');

const TIERS = ['light', 'medium', 'complex'];
const GB = 2 ** 30;
const BITS = { Q8_0: 8.5, Q6_K: 6.6, Q5_K_M: 5.7, Q5_K_S: 5.5, Q4_K_M: 4.9, Q4_K_S: 4.6, Q4_0: 4.5, MXFP4: 4.3, IQ4_XS: 4.3, Q3_K_M: 3.9, Q2_K: 3.0, BF16: 16, F16: 16, F32: 32 };
const keyOf = (ref) => (!ref ? '' : ref.backend === 'provider' ? `p:${ref.provider}:${ref.model}` : ref.backend === 'local' ? `l:${ref.id}` : `${ref.backend}:${ref.id || ref.name}`);
const refOfKey = (k) => (/^l:/.test(k) ? { backend: 'local', id: k.slice(2) } : null);
const cfg = () => { const t = store.getSettings().modelTiers || {}; return { overrides: t.overrides || {}, prefer: t.prefer || {} }; };

function effective(total, active, moe) {
  if (!total) return null;
  if (moe) return Math.sqrt(total * (active || total * 0.15));
  return total;
}
function paramsOfLocal(m) {
  const finder = require('./modelfinder');
  const cat = (models.CATALOG || []).find((c) => c.id === m.catalogId || c.repo === m.repo);
  if (cat) {
    const pm = String(cat.params).match(/(\d+(?:\.\d+)?)\s*([BM])/i);
    const total = pm ? parseFloat(pm[1]) * (pm[2].toUpperCase() === 'M' ? 0.001 : 1) : null;
    const p = finder.parseParams(cat.repo);
    return { effB: effective(total || p.total, p.active, !!cat.moe), total: total || p.total, from: 'catalog' };
  }
  const clean = (x) => String(x || '').replace(/\.gguf$/i, '').replace(/:/g, '-');
  let p = finder.parseParams(`${clean(m.repo)} ${clean(m.name).split(' · ')[0]}`);
  if (!p.total) p = finder.parseParams(clean(m.file));
  if (p.total) return { effB: effective(p.total, p.active, p.moe || !!m.moe), total: p.total, from: 'name' };
  const gb = (m.sizeBytes || 0) / GB;
  const bits = BITS[String(m.quant || '').toUpperCase()] || 4.8;
  const total = gb ? gb * 8 / bits : null;
  return { effB: effective(total, null, !!m.moe), total, from: 'size' };
}
const SMALL_WORDS = /(^|[^a-z])(nano|mini|lite|haiku|instant|small|tiny|flash|turbo)([^a-z]|$)/i;
const BIG_WORDS = /(^|[^a-z])(opus|ultra|max|large|pro|reasoner|reasoning|thinking|o1|o3|o4)([^a-z]|$)/i;
function paramsOfProvider(m) {
  const finder = require('./modelfinder');
  const txt = `${m.label || ''} ${m.ref && m.ref.model || ''}`;
  const pm = String(m.params || '').match(/(\d+(?:\.\d+)?)\s*([BM])/i);
  const p = pm ? { total: parseFloat(pm[1]) * (pm[2].toUpperCase() === 'M' ? 0.001 : 1) } : finder.parseParams(txt.replace(/:/g, '-'));
  if (p.total) return { effB: p.total, total: p.total, from: 'name' };
  if (SMALL_WORDS.test(txt)) return { effB: 6, total: null, from: 'family' };
  if (BIG_WORDS.test(txt)) return { effB: 150, total: null, from: 'family' };
  return { effB: 30, total: null, from: 'family' };
}

// measured speed on this machine: a loaded model's tuning summary, else the autotune benchmark cache
async function speedOf(m) {
  try {
    const engine = require('./engine');
    const t = engine.tuning(m.id);
    const s = t && t.summary;
    if (s && s.tokPerSec) return s.tokPerSec;
  } catch {}
  try {
    const autotune = require('./autotune'); const engine = require('./engine');
    const specs = await require('./system').getSpecs();
    const c = await autotune.cachedBench(m, specs, null, await engine.readMeta());
    if (c && c.tokPerSec) return c.tokPerSec;
  } catch {}
  return null;
}

// everything usable, with its strength
async function pool() {
  const out = [];
  for (const m of await models.listLocal()) {
    if (m.role) continue;
    const p = paramsOfLocal(m);
    out.push({ key: `l:${m.id}`, ref: { backend: 'local', id: m.id }, label: m.name, kind: m.source === 'ollama' ? 'ollama' : 'local', local: true, vision: !!m.vision, sizeGB: m.sizeBytes ? +(m.sizeBytes / GB).toFixed(1) : null, paramsB: p.total, effB: p.effB || 3, basis: p.from, tokPerSec: await speedOf(m), file: m });
  }
  let prov = [];
  try { prov = require('./providers').chatModels(); } catch {}
  for (const m of prov) {
    const p = paramsOfProvider(m);
    out.push({ key: keyOf(m.ref), ref: m.ref, label: m.label, provider: m.providerName, free: m.kind === 'fabro', kind: m.kind === 'ollama' || m.kind === 'lmstudio' ? m.kind : 'provider', local: !!m.local, vision: !!m.vision, sizeGB: null, paramsB: p.total, effB: p.effB, basis: p.from, tokPerSec: null });
  }
  // Fabro Cloud's free pool hands over between its own models: it only counts when nothing else is usable
  return out.some((x) => !x.free) ? out.filter((x) => !x.free) : out;
}

// pure: the pool → tiers (testable without the app)
function assign(items, overrides = {}) {
  const sorted = [...items].sort((a, b) => {
    const r = a.effB / b.effB;
    if (r > 0.8 && r < 1.25 && a.tokPerSec && b.tokPerSec) return b.tokPerSec - a.tokPerSec; // same class: the faster one is the lighter
    return a.effB - b.effB;
  });
  const res = new Map();
  if (!sorted.length) return res;
  const lo = Math.log2(sorted[0].effB), hi = Math.log2(sorted[sorted.length - 1].effB);
  for (const it of sorted) {
    let tier = 'medium';
    if (sorted.length > 1 && sorted[sorted.length - 1].effB / sorted[0].effB >= 1.6) {
      const p = hi === lo ? 0.5 : (Math.log2(it.effB) - lo) / (hi - lo);
      tier = p < 0.34 ? 'light' : p > 0.66 ? 'complex' : 'medium';
    }
    res.set(it.key, { tier, auto: tier });
  }
  for (const [k, v] of Object.entries(overrides)) if (res.has(k) && TIERS.includes(v)) res.get(k).tier = v;
  return res;
}

const FALLBACK = { light: ['light', 'medium', 'complex'], medium: ['medium', 'light', 'complex'], complex: ['complex', 'medium', 'light'] };
// pure: which model answers for a tier. `prefer` = explicit choice per tier; `items` carry their tier.
function pick(tier, items, prefer = {}) {
  const want = prefer[tier] && items.find((i) => i.key === prefer[tier]);
  if (want) return { item: want, via: 'preferred', fallback: false };
  for (const t of FALLBACK[tier]) {
    const c = items.filter((i) => i.tier === t);
    if (!c.length) continue;
    const best = tier === 'complex' ? c.sort((a, b) => b.effB - a.effB)[0]
      : tier === 'light' ? c.sort((a, b) => (b.tokPerSec || 0) - (a.tokPerSec || 0) || a.effB - b.effB)[0]
        : c.sort((a, b) => Math.abs(Math.log2(a.effB) - 4) - Math.abs(Math.log2(b.effB) - 4))[0];
    return { item: best, via: 'auto', fallback: t !== tier, from: t };
  }
  return null;
}

async function list() {
  const items = await pool();
  const { overrides, prefer } = cfg();
  const tiers = assign(items, overrides);
  const rows = items.map((i) => { const t = tiers.get(i.key); const { file, ...rest } = i; return { ...rest, tier: t.tier, auto: t.auto, overridden: t.tier !== t.auto }; });
  const chosen = {};
  for (const t of TIERS) { const r = pick(t, rows, prefer); chosen[t] = r ? { key: r.item.key, ref: r.item.ref, label: r.item.label, via: r.via, fallback: r.fallback, from: r.from || t } : null; }
  return { models: rows, chosen, prefer, overrides, single: rows.length === 1, tiers: TIERS };
}
async function of(modelOrKey) { const k = typeof modelOrKey === 'string' ? modelOrKey : keyOf(modelOrKey); const r = (await list()).models.find((m) => m.key === k); return r ? r.tier : null; }
async function resolve(tier) {
  if (!TIERS.includes(tier)) throw new Error('tier must be light, medium or complex');
  const l = await list(); const c = l.chosen[tier];
  if (!c) return null;
  const m = l.models.find((x) => x.key === c.key);
  return { tier, ref: c.ref, key: c.key, label: c.label, modelTier: m.tier, via: c.via, fallback: c.fallback, local: m.local };
}
async function setOverride(key, tier) {
  const t = TIERS.includes(tier) ? tier : null;
  await store.setSettings({ modelTiers: { overrides: { [key]: t } } });
  return list();
}
async function setPreferred(tier, key) {
  if (!TIERS.includes(tier)) throw new Error('tier must be light, medium or complex');
  await store.setSettings({ modelTiers: { prefer: { [tier]: key || null } } });
  return list();
}

// ───────────────────────────── sub-agents ─────────────────────────────
const LIGHT_TASK = /\b(search|look ?up|find|research|summari[sz]e|summary|extract|list|read|scan|check|gather|collect|fetch|translate|cherche\w*|recherche\w*|resum\w*|extrai\w*|liste\w*|lis\b|lire|collecte\w*|verifi\w*|traduis\w*)\b/i;
const defaultTier = (text) => (LIGHT_TASK.test(String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')) ? 'light' : 'medium');

// Would `target` (a local model) load next to what is busy right now? The parent's model is busy while it waits for the
// sub-agent, and the engine never evicts a busy model, so a plan that does not fit would just wait. Pure given the numbers.
function fitsAlongside(plan, busyUse, bud) {
  if (bud.unified) return busyUse.v + plan.vramGB <= bud.vramGB + 0.05;
  return (plan.vramGB <= 0 || busyUse.v + plan.vramGB <= bud.vramGB + 0.05) && busyUse.r + plan.ramGB <= bud.ramGB + 0.05;
}
async function canLoadAlongside(file) {
  const engine = require('./engine'); const system = require('./system');
  const insts = (engine.instancesList ? engine.instancesList() : []).filter((i) => i.status === 'ready' || i.status === 'starting');
  if (insts.some((i) => i.model && i.model.id === file.id && i.status === 'ready')) return { ok: true, loaded: true };
  const specs = await system.getSpecs();
  const bud = await governor.currentBudget(specs, {});
  const busyUse = insts.filter((i) => i.busy > 0 && i.model && i.model.id !== file.id).reduce((a, i) => ({ v: a.v + ((i.plan && i.plan.vramGB) || 0), r: a.r + ((i.plan && i.plan.ramGB) || 0) }), { v: 0, r: 0 });
  const opts = engine.optionsFor(file);
  const fp = governor.fitPlan(memory.plan, file, { ctx: opts.ctx, gpuLayers: opts.gpuLayers, kvType: opts.kvType }, specs, bud, { lim: governor.limits() });
  if (fp.refused) return { ok: false, why: 'it does not fit in memory' };
  const ok = fitsAlongside(fp.plan, busyUse, bud);
  return ok ? { ok: true } : { ok: false, why: 'it would not fit next to the model that is already working' };
}

// Which model runs a sub-agent. `wanted`: 'light' | 'medium' | 'complex' | an explicit model name or id | undefined (→ by task).
// Returns { model (ref for chat.send), label, tier, note }. Never throws: any problem keeps the main model.
async function forSubAgent(wanted, { main, text, check = canLoadAlongside } = {}) {
  const keep = (note, extra = {}) => ({ model: main, label: null, tier: null, note, ...extra });
  try {
    const l = await list();
    if (!l.models.length) return keep('');
    let tier = String(wanted || '').toLowerCase().trim();
    let item = null; let via = null;
    if (TIERS.includes(tier)) { /* a tier */ }
    else if (tier) {
      const q = tier; item = l.models.find((m) => m.key.toLowerCase() === q || String(m.label).toLowerCase() === q || String(m.label).toLowerCase().includes(q));
      if (!item) { tier = defaultTier(text); via = `unknown model "${wanted}"`; } else tier = item.tier;
    } else tier = defaultTier(text);
    let chosen = item;
    let preferredByUser = false;
    if (!chosen) { const r = await resolve(tier); chosen = r && l.models.find((m) => m.key === r.key); preferredByUser = !!(r && r.via === 'preferred'); }
    if (!chosen) return keep('');
    const mainKey = keyOf(main);
    const mainItem = l.models.find((m) => m.key === mainKey);
    if (chosen.key === mainKey) return { model: main, label: chosen.label, tier, note: via ? `Sub-agent used the main model (${via}).` : '' };
    // privacy: a conversation on a local model never sends its sub-tasks to a cloud provider unless the user chose that model for the tier
    if (!chosen.local && mainItem && mainItem.local && !item && !preferredByUser) {
      return keep(`Sub-agent used the main model (the ${tier} tier points to a cloud model, which is only used when you choose it in settings).`, { tier, label: mainItem.label });
    }
    if (chosen.ref.backend === 'local') {
      const file = await models.getLocal(chosen.ref.id);
      if (!file) return keep(`Sub-agent used the main model (${chosen.label} is not available).`, { tier });
      const c = await check(file);
      if (!c.ok) return keep(`Sub-agent used the main model: the ${tier} model (${chosen.label}) cannot be loaded next to it (${c.why}).`, { tier, label: mainItem ? mainItem.label : null, fellBack: true });
    }
    return { model: chosen.ref, label: chosen.label, tier, note: `Sub-agent ran on ${chosen.label} (${tier} tier).`, switched: true };
  } catch (e) { return keep(''); }
}

function init(ipcMain) {
  ipcMain.handle('tiers:list', () => list());
  ipcMain.handle('tiers:resolve', (_e, t) => resolve(t));
  ipcMain.handle('tiers:setOverride', (_e, k, t) => setOverride(k, t));
  ipcMain.handle('tiers:setPreferred', (_e, t, k) => setPreferred(t, k));
}

module.exports = { TIERS, keyOf, list, of, resolve, setOverride, setPreferred, forSubAgent, defaultTier, init, assign, pick, fitsAlongside, paramsOfLocal, paramsOfProvider, effective };
