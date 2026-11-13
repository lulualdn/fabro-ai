'use strict';
// Model finder: "something fast to help with homework" → one recommended model + two alternatives that fit THIS computer.
//
//  1. criteria   plain words (any language) → uses, languages, priority, size limits. Fast multilingual heuristics first;
//                one optional short call to the model that is already loaded when the request stays ambiguous.
//  2. candidates the built-in catalog + live Hugging Face search (metadata only: downloads, likes, recency, tags, GGUF info).
//                No "best models" list lives here: what exists today comes from the search, ranking uses its metadata.
//  3. fit        for each candidate and quantization: memory.plan + governor.fitPlan against the governor's budget
//                (the same planning the engine uses to load), expected speed class, comfortable context.
//  4. picks      1 recommended + a lighter and a stronger alternative, with plain reasons and honest warnings.
// Works offline against the catalog (with a note). Installing is never done here: the UI / chat card asks the user.
const store = require('./store');
const models = require('./models');
const memory = require('./memory');
const governor = require('./governor');

const GB = 2 ** 30;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => Math.round(x * 10) / 10;

// ───────────────────────────── 1. criteria ─────────────────────────────
// Patterns run on accent-less lowercase text. French and English first; common Spanish / German / Italian words too.
const USE_RE = {
  code: /\b(cod(e|er|ing|age)|programm\w*|python|javascript|typescript|java|c\+\+|c#|rust|golang|php|sql|html|css|react|debug\w*|script\w*|develop\w*|dev|software|logiciel|algo\w*|bug|github|lua|roblox|unity|programar|codigo|programmieren|programmare)\b/,
  vision: /\b(images?|photos?|pictures?|vision|voir|see|sees|look at|regarder|screenshots?|captures? d'?ecran|diagrammes?|schemas?|ocr|multimodal\w*|visuel\w*|dessins?|imagen|bild\w*|vedere|immagin\w*|scann?\w*|lire des images|describe images)\b/,
  reasoning: /\b(raisonn\w*|reason\w*|think\w*|logique|logic\w*|maths?|mathemati\w*|problemes? (complexes?|difficiles?)|complex\w*|difficil\w*|hard problems?|puzzles?|demonstr\w*|proofs?|etape par etape|step by step|analy[sz]\w*|science\w*|physique|physics|chimie|chemistry|razonar|rechnen|ragionare)\b/,
  longctx: /\b(longs? documents?|documents? longs?|long texts?|gros documents?|livres?|books?|rapports?|reports?|long context|contexte long|beaucoup de texte|large documents?|many pages|des pages|pages? de|pdfs?|thesis|these|memoire|articles? entiers?|whole (book|document)|archives?|contratos?|langer text)\b/,
  tools: /\b(agents?|outils?|tools?|function[- ]call\w*|appels? de fonctions?|automati[sz]\w*|mcp|sous-?agents?|sub-?agents?|workflows?|api|herramientas|werkzeuge)\b/,
  translation: /\b(tradu\w*|translat\w*|traduc\w*|uebersetz\w*|traduzion\w*|multilingue|multilingual|plusieurs langues|several languages|bilingue)\b/,
  writing: /\b(ecri\w*|redig\w*|redaction|write|writing|writer|mails?|e-?mails?|courriers?|lettres?|letters?|essays?|dissertations?|stor(y|ies)|histoires?|creati\w*|creat\w+ de contenu|blogs?|articles?|resum\w*|summar\w*|reformul\w*|rewrite|poemes?|poems?|escribir|schreiben|scrivere|cover letter|cv)\b/,
  homework: /\b(devoirs?|homework|ecole|school|lycee|college|etud\w*|study|studying|revis\w*|cours|exams?|bac|student|eleve|apprendre|learn\w*|tutor\w*|deberes|hausaufgaben|compiti)\b/,
  roleplay: /\b(role-?play\w*|jeux? de role|rp|personnages?|characters?|compagnon|companion|fiction|rpg|interactive stor\w*)\b/,
  speed: /\b(rapides?|fast(er|est)?|quick\w*|vite|speed\w*|reactif\w*|snappy|instant\w*|rapido|schnell|veloce)\b/,
};
// the machine is modest / the person wants something small
const SMALL_RE = /\b(legers?|light(weight)?|petit\w*|small|tiny|mini|low[- ]?end|faibles?|modestes?|vieux|vieille|old|ancien\w*|sans gpu|no gpu|without (a )?gpu|cpu only|processeur seulement|portables?|laptops?|netbook|chromebook|raspberry|batterie|battery|peu de (ram|memoire)|little ram|8 ?go|8 ?gb|4 ?go|4 ?gb|ligero|leicht|piccolo|pequeno)\b/;
const QUALITY_RE = /\b(meilleurs?|best|le plus (puissant|intelligent|performant|precis|fort)|most (powerful|capable|intelligent|accurate)|haute qualite|high[- ]quality|smartest|puissants?|powerful|gros modeles?|biggest|largest|plus gros|max(imum)?|top|mejor|beste|migliore|qualite|quality|precis|accurate)\b/;
const BIGPC_RE = /\b(gros pc|beast|puissant pc|gaming pc|pc de guerre|rtx|4090|4080|3090|5090|workstation|station de travail|serveur|server|beaucoup de (ram|vram)|lots of (ram|vram)|32 ?go|64 ?go|128 ?go|32 ?gb|64 ?gb|128 ?gb|24 ?go|24 ?gb)\b/;
const LANGS = { fr: /\b(francais|french|frances|franzosisch|francese)\b/, en: /\b(anglais|english|ingles|englisch|inglese)\b/, es: /\b(espagnol|spanish|espanol|spanisch|spagnolo)\b/, de: /\b(allemand|german|aleman|deutsch|tedesco)\b/, it: /\b(italien|italian|italiano)\b/, pt: /\b(portugais|portuguese|portugues)\b/, zh: /\b(chinois|chinese|mandarin|chino)\b/, ja: /\b(japonais|japanese|japones)\b/, ko: /\b(coreen|korean)\b/, ar: /\b(arabe|arabic)\b/, ru: /\b(russe|russian)\b/, hi: /\b(hindi)\b/, tr: /\b(turc|turkish)\b/, nl: /\b(neerlandais|dutch|flemish)\b/, pl: /\b(polonais|polish)\b/ };

function extractCriteria(need, constraints = {}) {
  const raw = String(need || '').trim().slice(0, 600);
  const t = norm(raw);
  const uses = new Set();
  for (const [k, re] of Object.entries(USE_RE)) if (re.test(t)) uses.add(k);
  // "code" also matches "code postal" etc.: a coding use needs one more hint, or a clear programming word
  if (uses.has('code') && /\bcode (postal|promo|couleur|pin)\b/.test(t)) uses.delete('code');
  if (/\bsee (what|how|if)\b/.test(t)) uses.delete('vision'); // "let me see what exists"
  const languages = [];
  for (const [l, re] of Object.entries(LANGS)) if (re.test(t)) languages.push(l);
  let reqLang = 'en';
  try { reqLang = require('./langdetect').detect(raw, 'en'); } catch {}
  // writing / chatting in a language other than English = it should handle that language
  if (reqLang !== 'en' && !languages.includes(reqLang) && (uses.has('writing') || uses.has('translation') || uses.has('homework'))) languages.push(reqLang);
  if (constraints.language && !languages.includes(constraints.language)) languages.push(constraints.language);

  const fast = USE_RE.speed.test(t); const small = SMALL_RE.test(t); const best = QUALITY_RE.test(t) || BIGPC_RE.test(t);
  let priority = constraints.priority || (fast || small ? (best ? 'balanced' : 'speed') : best ? 'quality' : 'balanced');
  if (!['speed', 'balanced', 'quality'].includes(priority)) priority = 'balanced';
  if (/\b(my pc|mon pc|mon ordi\w*|mon portable|ma machine|this (computer|machine|pc|laptop)|cet ordi\w*|mon materiel|my hardware|can run|peut faire tourner|peut supporter)\b/.test(t) && !fast && !small) priority = priority === 'speed' ? 'speed' : 'quality';

  let maxSizeGB = constraints.maxSizeGB || null;
  const sz = t.match(/(?:moins de|under|below|max(?:imum)?|at most|jusqu'?a|<|up to|pas plus de|no more than)\s*(\d+(?:[.,]\d+)?)\s*(go|gb|gio|g)\b/);
  if (sz) maxSizeGB = Math.min(maxSizeGB || Infinity, parseFloat(sz[1].replace(',', '.')));

  const needs = {
    vision: !!constraints.vision || uses.has('vision'),
    tools: !!constraints.tools || uses.has('tools'),
    longContext: !!constraints.longContext || uses.has('longctx'),
    code: uses.has('code'), reasoning: uses.has('reasoning'), translation: uses.has('translation'), roleplay: uses.has('roleplay'),
  };
  const found = [...uses].filter((u) => u !== 'speed' && u !== 'homework');
  const confidence = clamp((raw.split(/\s+/).length < 3 ? 0.1 : 0.25) + found.length * 0.25 + (fast || small || best ? 0.2 : 0) + (uses.has('homework') ? 0.2 : 0) + (maxSizeGB ? 0.2 : 0), 0, 1);
  return { text: raw, lang: reqLang, uses: [...uses], languages: [...new Set(languages)], priority, small: small || fast, maxSizeGB, needs, confidence: +confidence.toFixed(2), by: 'heuristics' };
}

// One short call to a model that is ALREADY loaded (never loads one): only for vague requests. Anything it returns is
// validated; a failure or a timeout silently keeps the heuristics. `llm(prompt) → string` can be injected (tests).
async function refineWithModel(crit, llm) {
  const call = llm || defaultLlm;
  if (!call) return crit;
  const prompt = `You help choose a local AI model. Read the user's request and answer with ONE line of JSON only, no text around it:\n{"uses":[any of "chat","writing","code","reasoning","vision","translation","longctx","tools"],"priority":"speed"|"balanced"|"quality","languages":["fr","en",...],"small":true|false}\nRequest: ${JSON.stringify(crit.text.slice(0, 400))}`;
  let out = '';
  try { out = await Promise.race([call(prompt), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))]); } catch { return crit; }
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return crit;
  let j; try { j = JSON.parse(m[0]); } catch { return crit; }
  const okUse = new Set(['chat', 'writing', 'code', 'reasoning', 'vision', 'translation', 'longctx', 'tools']);
  const uses = new Set(crit.uses);
  for (const u of Array.isArray(j.uses) ? j.uses : []) if (okUse.has(u) && u !== 'chat') uses.add(u);
  const priority = ['speed', 'balanced', 'quality'].includes(j.priority) && crit.confidence < 0.5 ? j.priority : crit.priority;
  const languages = [...new Set([...crit.languages, ...(Array.isArray(j.languages) ? j.languages : []).filter((l) => /^[a-z]{2}$/.test(l) && l !== 'en')])];
  const needs = { ...crit.needs, vision: crit.needs.vision || uses.has('vision'), tools: crit.needs.tools || uses.has('tools'), longContext: crit.needs.longContext || uses.has('longctx'), code: uses.has('code'), reasoning: uses.has('reasoning'), translation: uses.has('translation') };
  return { ...crit, uses: [...uses], priority, languages, small: crit.small || j.small === true, needs, by: 'heuristics+model', confidence: Math.max(crit.confidence, 0.6) };
}
async function defaultLlm(prompt) {
  const engine = require('./engine');
  const inst = (engine.instancesList ? engine.instancesList() : []).find((i) => i.status === 'ready' && !(i.opts && i.opts._bench) && !(i.model && i.model.role));
  if (!inst) return null;
  const release = await governor.acquire({ priority: 'user', label: 'find-model' });
  try {
    const r = await fetch(`http://127.0.0.1:${inst.port}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 120, temperature: 0, stream: false }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  } finally { release(); }
}

// ───────────────────────────── 2. candidates ─────────────────────────────
const NOT_CHAT = /embed|rerank|reward|clip|whisper|tts|speech|lora|adapter|vae|diffusion|flux|sdxl|stable-?diffusion|yolo|mmproj|\bbert\b|\bt5\b|ocr-only|\bcolpali|\bsentence|classif|detect|segment|upscal|guard|moderat/i;
const SPICY = /uncensored|abliterat|nsfw|erp\b|lewd|jailbreak|dolphin/i;

// parameters in billions from a repo name: Qwen3-30B-A3B → { total 30, active 3, moe }, gemma-4-E4B → 4, SmolLM2-135M → 0.135
function parseParams(name, ggufTotal) {
  const base = String(name || '').split('/').pop().replace(/[_\s]+/g, '-');
  let active = null, total = null, moe = /moe|\bA\d+(?:\.\d+)?B\b|mixtral|\d+x\d+b/i.test(base);
  const a = base.match(/(?:^|[-.])A(\d+(?:\.\d+)?)B(?![a-z])/i); if (a) active = parseFloat(a[1]);
  const mx = base.match(/(\d+)x(\d+(?:\.\d+)?)B/i); if (mx) { total = parseInt(mx[1], 10) * parseFloat(mx[2]); }
  const nums = [];
  const re = /(?:^|[-.])E?(\d+(?:\.\d+)?)([BM])(?![a-z])/gi; let m;
  while ((m = re.exec(base))) { const v = parseFloat(m[1]) * (m[2].toUpperCase() === 'M' ? 0.001 : 1); if (!(a && m[0].toUpperCase().includes('A' + a[1] + 'B') && /^[-.]A/i.test(m[0]))) nums.push(v); }
  if (total == null && nums.length) total = Math.max(...nums);
  if (ggufTotal && ggufTotal > 1e6) total = ggufTotal / 1e9;
  return { total, active, moe };
}
const licenseOf = (tags) => { const t = (tags || []).find((x) => /^license:/.test(x)); return t ? t.slice(8) : null; };
const PERMISSIVE = /^(apache-2\.0|mit|bsd(-\d-clause)?|cc-by-4\.0|cc0-1\.0|unlicense|isc|openrail\+*|bigscience-openrail-m)$/;
const NONCOMMERCIAL = /(^cc-by-nc|-nc-|non-?commercial|research|\bnc\b)/;
const langTags = (tags) => (tags || []).filter((x) => /^[a-z]{2}$/.test(x));

function fromCatalog(c) {
  const p = parseParams(c.repo + ' ' + c.params.replace(/\s*·.*$/, ''), null);
  const pm = String(c.params).match(/(\d+(?:\.\d+)?)\s*([BM])/i);
  const total = pm ? parseFloat(pm[1]) * (pm[2].toUpperCase() === 'M' ? 0.001 : 1) : p.total;
  return { source: 'catalog', catalogId: c.id, repo: c.repo, name: c.name, by: c.by, total, active: p.active, moe: !!c.moe, tags: new Set(c.tags || []), langs: [], downloads: null, likes: null, updated: null, license: null, gated: false, vision: (c.tags || []).includes('vision'), ctxTrain: null, quant: c.quant || null, sizeGB: c.sizeGB, role: c.role || null };
}
function fromHF(h) {
  const name = h.repo.split('/')[1].replace(/-GGUF$/i, '').replace(/[-_]gguf$/i, '');
  const p = parseParams(h.repo, h.gguf && h.gguf.total);
  const tags = new Set();
  const nm = norm(h.repo);
  if (h.pipeline === 'image-text-to-text' || (h.tags || []).includes('image-text-to-text') || /(^|[-_/])(vl|vision|llava|pixtral|smolvlm|minicpm-v|internvl|multimodal)([-_.]|$)/.test(nm)) tags.add('vision');
  if (/coder|code|devstral|codestral|starcoder|deepseek-coder/.test(nm)) tags.add('code');
  if (/think|reason|r1\b|qwq|magistral|-r\d|cot\b/.test(nm)) tags.add('reasoning');
  if (/tool|function|agent|hermes|xlam/.test(nm) || (h.tags || []).some((x) => /tool|function-calling/.test(x))) tags.add('tools');
  if (!tags.has('code')) tags.add('chat');
  return { source: 'hf', catalogId: null, repo: h.repo, name, by: h.repo.split('/')[0], total: p.total, active: p.active, moe: p.moe, tags, langs: langTags(h.tags), downloads: h.downloads || 0, likes: h.likes || 0, updated: h.updated || null, license: licenseOf(h.tags), gated: !!h.gated, vision: tags.has('vision'), ctxTrain: (h.gguf && h.gguf.context_length) || null, quant: null, sizeGB: null, role: null, spicy: SPICY.test(h.repo), base: /(^|[-_])base($|[-_])/i.test(h.repo) && !/instruct|[-_]it($|[-_])|chat/i.test(h.repo) };
}
// "unsloth/Qwen3-4B-GGUF" and "lmstudio-community/Qwen3-4B-GGUF" are the same model: keep one
const familyKey = (c) => norm(c.repo.split('/')[1]).replace(/-?gguf|[-_.]?(instruct|it|chat|ud|imatrix|q\d\w*)(?=[-_.]|$)/g, '').replace(/[^a-z0-9.]+/g, '');

function sizeTokens(machine) {
  const cap = (machine.gpuGB > 0 ? Math.max(machine.gpuBudgetGB, machine.ramBudgetGB * 0.7) : machine.ramBudgetGB) * 0.85;
  const ladder = [1, 1.7, 3, 4, 7, 8, 9, 12, 14, 20, 24, 27, 32, 70];
  return ladder.filter((p) => p * 0.6 + 0.8 <= cap).slice(-2).map((p) => `${p}B`);
}
function searchQueries(crit, machine) {
  const n = crit.needs; const terms = [];
  if (n.vision) terms.push('vl instruct', 'vision');
  else if (n.code) terms.push('coder instruct');
  else if (n.reasoning) terms.push('thinking', 'instruct');
  else terms.push('instruct');
  const main = terms[0];
  const qs = [{ q: main, sort: 'trendingScore' }, { q: main, sort: 'downloads' }];
  if (terms[1]) qs.push({ q: terms[1], sort: 'trendingScore' });
  for (const s of sizeTokens(machine).slice(-1)) qs.push({ q: `${s} ${n.vision ? 'vl' : n.code ? 'coder' : 'instruct'}`.trim(), sort: 'downloads' });
  qs.push({ q: '', sort: 'trendingScore' });
  return qs.slice(0, 5);
}

// ───────────────────────────── 3. fit on this machine ─────────────────────────────
function machineView(specsIn) {
  const specs = { ...specsIn };
  specs.gpus = specs.gpus || []; specs.accel = specs.accel || 'cpu'; if (specs.gpuBudgetGB == null) specs.gpuBudgetGB = 0;
  if (specs.ramBudgetGB == null) specs.ramBudgetGB = specs.unified ? 0 : +((specs.ramGB || 8) * 0.6).toFixed(1);
  const bud = governor.budget(specs, { lim: governor.limits() });
  const gpuGB = specs.unified ? bud.vramGB : specs.accel !== 'cpu' ? governor.gpuTotalGB(specs) : 0;
  return { specs, bud, ramGB: specs.ramGB || 0, gpuGB, gpuBudgetGB: bud.vramGB, ramBudgetGB: bud.ramGB, accel: specs.accel, unified: !!specs.unified, hasGpu: specs.accel !== 'cpu' };
}
function gpuBW(m) {
  if (m.unified) return m.ramGB <= 8 ? 68 : m.ramGB <= 16 ? 100 : m.ramGB <= 32 ? 200 : 300;
  if (m.accel === 'cuda') return m.gpuGB >= 20 ? 700 : m.gpuGB >= 11 ? 360 : m.gpuGB >= 7 ? 250 : 170;
  return 150;
}
function cpuBW(m) { const c = m.specs.cpu || {}; const ph = c.physical || (c.threads ? Math.round(c.threads / 2) : 0); return ph ? Math.min(45, ph * 5.5) : m.ramGB <= 8 ? 14 : 22; }
const speedClass = (t) => (t >= 18 ? 'fast' : t >= 7 ? 'ok' : t >= 3 ? 'slow' : 'very-slow');

// plan for one file size on this machine: mode, memory, comfortable context, speed
function assess(sizeGB, cand, m, { ctxTrain } = {}) {
  const name = `${cand.name}${cand.moe ? ' MoE' : ''}`;
  const pseudo = { id: cand.repo, name, path: '', sizeBytes: sizeGB * GB };
  const base = { gpuLayers: -1, kvType: 'f16' };
  const fit = (ctx) => governor.fitPlan(memory.plan, pseudo, { ...base, ctx }, m.specs, m.bud, { explicit: { ctx: true } });
  const p4 = fit(4096);
  if (!p4.fits) return { fits: false, plan: p4.plan };
  const cap = ctxTrain || cand.ctxTrain || 131072;
  let ctx = 4096;
  for (const c of [65536, 32768, 16384, 8192]) { if (c > cap) continue; const f = fit(c); if (f.fits && f.plan.mode === p4.plan.mode) { ctx = c; break; } }
  const plan = fit(Math.min(ctx, 8192)).fits ? fit(Math.min(ctx, 8192)).plan : p4.plan;
  // tokens per second: memory-bound, bytes read per token / bandwidth
  const act = cand.moe && cand.active && cand.total ? clamp(cand.active / cand.total * 1.2, 0.05, 1) : 1;
  const bytes = sizeGB * act; const bg = gpuBW(m); const bc = cpuBW(m);
  let t;
  if (plan.mode === 'gpu') t = bytes / bg;
  else if (plan.mode === 'moe') t = bytes * 0.12 / bg + bytes * 0.88 / bc;
  else if (plan.mode === 'split') { const f = plan.vramGB / Math.max(0.1, plan.vramGB + plan.ramGB); t = bytes * f / bg + bytes * (1 - f) / bc; }
  else t = bytes / bc;
  const tok = round1((plan.mode === 'gpu' ? 0.7 : plan.mode === 'cpu' ? 0.5 : 0.6) / t);
  const need = Math.max(plan.vramGB + plan.ramGB, plan.totalGB);
  const budgetAll = m.unified ? m.gpuBudgetGB : m.gpuBudgetGB + m.ramBudgetGB;
  return { fits: true, mode: plan.mode, plan, ctx, vramGB: plan.vramGB, ramGB: plan.ramGB, tokPerSec: tok, speed: speedClass(tok), tight: need > budgetAll * 0.9 && plan.mode !== 'gpu' || (plan.mode === 'gpu' && plan.vramGB > m.gpuBudgetGB * 0.92) };
}

// ───────────────────────────── 4. scoring + picks ─────────────────────────────
const QUANT_Q = { Q8_0: 1.12, Q6_K: 1.1, Q5_K_M: 1.06, Q5_K_S: 1.05, Q5_0: 1.04, Q4_K_M: 1, Q4_K_L: 1, MXFP4: 1, MXFP4_MOE: 1, Q4_K_XL: 1, Q4_K_S: 0.98, IQ4_XS: 0.97, IQ4_NL: 0.97, Q4_0: 0.95, Q3_K_L: 0.88, Q3_K_M: 0.85, Q3_K_S: 0.8, IQ3_M: 0.84, IQ3_XS: 0.8, Q2_K: 0.6, IQ2_M: 0.6, IQ2_S: 0.55, IQ1_M: 0.4, BF16: 1.15, F16: 1.15, F32: 1.15 };
const quantQ = (q) => QUANT_Q[String(q || '').toUpperCase()] || (/^Q4|^IQ4/i.test(q) ? 0.98 : /^Q[5-8]/i.test(q) ? 1.05 : 0.9);
const effParams = (c, sizeGB) => (c.moe && c.active && c.total ? Math.sqrt(c.total * c.active) : c.total || (sizeGB ? sizeGB / 0.6 : 3));

function relevance(c, crit, extraTags) {
  const n = crit.needs; const t = c.tags; let r = 0; const hit = [], miss = [];
  const has = (k) => t.has(k) || (extraTags && extraTags.has(k));
  if (n.vision) { if (c.vision) hit.push('vision'); else miss.push('vision'); }
  if (n.code) { if (has('code')) { r += 2.2; hit.push('code'); } else { r -= 0.5; miss.push('code'); } }
  if (n.reasoning) { if (has('reasoning')) { r += 1.2; hit.push('reasoning'); } }
  if (n.tools) { if (has('tools')) { r += 1; hit.push('tools'); } else miss.push('tools'); }
  const wanted = crit.languages.filter((l) => l !== 'en');
  if (wanted.length) {
    if (c.langs.length) { if (wanted.every((l) => c.langs.includes(l))) { r += 1; hit.push('languages'); } else { r -= 0.6; miss.push('languages'); } }
    else if (c.langs.length === 0 && c.source === 'hf') { /* unknown: neutral */ }
    if (c.langs.length >= 8) r += 0.3;
  }
  if (!n.vision && c.vision) r -= 0.4; // a vision build carries a projector: only when images matter
  if (c.base) r -= 1.5;
  if (c.spicy && !crit.needs.roleplay) r -= 1.5;
  if (!n.code && has('code') && !has('chat')) r -= 2;
  return { r, hit, miss };
}
function recency(c) { if (!c.updated) return 0.5; const months = (Date.now() - Date.parse(c.updated)) / (30 * 864e5); return Number.isFinite(months) ? clamp(1 - months / 24, 0, 1) : 0.5; }
function popularity(c) { if (c.downloads == null) return 0.7; return clamp(Math.log10((c.downloads || 0) + 1) / 6 + Math.log10((c.likes || 0) + 1) / 8, 0, 1.2); }

function scoreRow(c, row, a, crit) {
  const rel = relevance(c, crit);
  const W = crit.priority === 'speed' ? { q: 0.45, s: 1.7 } : crit.priority === 'quality' ? { q: 1.25, s: 0.3 } : { q: 0.9, s: 0.85 };
  const q = Math.log2(effParams(c, row.sizeGB) + 0.5) * quantQ(row.quant);
  const s = clamp(Math.log2(Math.max(a.tokPerSec, 0.5) / 3) / 3, 0, 1.2);
  let score = rel.r + W.q * q + 0.9 * recency(c) + 0.8 * popularity(c) + W.s * s;
  score += a.mode === 'gpu' ? 0.8 : a.mode === 'moe' ? 0.2 : a.mode === 'cpu' ? -0.2 : 0;
  if (a.speed === 'very-slow') score -= crit.priority === 'quality' ? 1.5 : 3; else if (a.speed === 'slow') score -= crit.priority === 'quality' ? 0.4 : 1;
  if (crit.needs.longContext) score += a.ctx >= 32768 ? 1 : a.ctx >= 16384 ? 0.4 : a.ctx < 8192 ? -1.5 : 0;
  if (a.tight) score -= 0.6;
  const sizePen = crit.small ? 0.7 : crit.priority === 'speed' ? 0.3 : 0; // "light", "small laptop": smaller is better even when the machine could take more
  if (sizePen) score -= sizePen * Math.max(0, Math.log2(row.sizeGB / 2));
  return score;
}

// rows of one candidate: its downloadable quantizations (from the repo listing) or the catalog estimate
function rowsOf(c, info, m) {
  if (info && info.files && info.files.length) {
    const mmprojGB = (info.files[0] && info.files[0].mmprojSize || 0) / GB;
    return info.files.filter((f) => !/^(Q1|IQ1|Q2|IQ2)/i.test(f.quant) || info.files.length === 1).map((f) => ({ file: f.file, quant: f.quant || '', sizeGB: f.sizeGB, mmprojGB: +mmprojGB.toFixed(2), vision: !!f.mmproj, blocked: !!f.blocked, est: false }));
  }
  if (c.sizeGB) return [{ file: null, quant: c.quant || 'Q4_K_M', sizeGB: c.sizeGB, mmprojGB: c.vision ? 0.9 : 0, vision: c.vision, blocked: false, est: true }];
  if (c.total) { const gbs = c.total * 0.6; return [{ file: null, quant: 'Q4_K_M', sizeGB: +gbs.toFixed(2), mmprojGB: 0, vision: c.vision, blocked: false, est: true }]; }
  return [];
}

function describe(c, row, a, crit, m, installed) {
  const good = [], weak = [], warnings = [], why = [];
  const rel = relevance(c, crit);
  const uses = crit.uses.filter((u) => !['speed', 'homework'].includes(u));
  const params = c.total ? (c.moe && c.active ? `${c.total}B (${c.active}B active)` : `${c.total}B`) : null;
  // good at
  if (c.vision || row.vision) good.push('vision');
  if (c.tags.has('code')) good.push('code');
  if (c.tags.has('reasoning')) good.push('reasoning');
  if (c.tags.has('tools')) good.push('tools');
  if (a.ctx >= 32768) good.push('longctx');
  if (c.langs.length >= 8 || (crit.languages.length && rel.hit.includes('languages'))) good.push('languages');
  if (a.speed === 'fast') good.push('fast');
  if (!good.length) good.push('general');
  // less good at
  const eff = effParams(c, row.sizeGB);
  if (eff < 2.5) weak.push('small');
  else if (eff < 8 && (crit.needs.reasoning || crit.priority === 'quality')) weak.push('hardTasks');
  if (!(c.vision || row.vision) && !crit.needs.vision) weak.push('noVision');
  if (!c.tags.has('tools') && crit.needs.tools) weak.push('noTools');
  if (!c.tags.has('code') && crit.needs.code) weak.push('noCode');
  if (a.ctx < 8192) weak.push('shortCtx');
  if (rel.miss.includes('languages')) weak.push('languages');
  // honest warnings
  if (a.speed === 'very-slow') warnings.push({ code: 'veryslow', level: 'warn', p: { tps: a.tokPerSec } });
  else if (a.speed === 'slow') warnings.push({ code: 'slow', level: 'warn', p: { tps: a.tokPerSec } });
  if (a.mode === 'cpu' && m.hasGpu) warnings.push({ code: 'cpuFallback', level: 'warn' });
  else if (a.mode === 'cpu') warnings.push({ code: 'cpuOnly', level: 'info' });
  else if (a.mode === 'split' || a.mode === 'moe') warnings.push({ code: 'partial', level: 'info' });
  if (a.tight) warnings.push({ code: 'tight', level: 'warn' });
  const dl = row.sizeGB + (row.mmprojGB || 0);
  if (dl >= 8) warnings.push({ code: 'bigDownload', level: 'info', p: { gb: round1(dl) } });
  if (c.gated && !store.getSettings().hfToken) warnings.push({ code: 'gated', level: 'warn' });
  if (c.license) {
    if (NONCOMMERCIAL.test(c.license)) warnings.push({ code: 'noncommercial', level: 'warn', p: { license: c.license } });
    else if (!PERMISSIVE.test(c.license)) warnings.push({ code: 'license', level: 'info', p: { license: c.license } });
  }
  if (row.est) warnings.push({ code: 'estimate', level: 'info' });
  if (installed) warnings.push({ code: 'installed', level: 'info' });
  // plain-language why (English: for the model and as a fallback; the UI translates from the codes)
  const bits = [];
  bits.push(a.mode === 'gpu' ? 'fits entirely on your graphics card' : a.mode === 'cpu' ? 'runs on your processor' : 'is shared between your graphics card and memory');
  bits.push(`${({ fast: 'fast', ok: 'comfortable', slow: 'slowish', 'very-slow': 'very slow' })[a.speed]} here (about ${a.tokPerSec} tokens/s)`);
  if (uses.length && rel.hit.length) bits.push(`good for ${rel.hit.join(', ')}`);
  why.push(`${c.name}${params ? ' (' + params + ')' : ''} ${bits.join(', ')}.`);
  return { good, weak, warnings, why: why.join(' ') };
}

function buildPick(role, c, row, a, crit, m, installed) {
  const d = describe(c, row, a, crit, m, installed);
  return {
    role, installed: !!installed,
    model: { name: c.name, by: c.by, repo: c.repo, catalogId: c.catalogId, params: c.total, activeParams: c.active, moe: c.moe, vision: !!(c.vision || row.vision), source: c.source },
    variant: { file: row.file, quant: row.quant, sizeGB: round1(row.sizeGB), downloadGB: round1(row.sizeGB + (row.mmprojGB || 0)), estimated: !!row.est },
    fit: { mode: a.mode, ctx: a.ctx, vramGB: round1(a.vramGB), ramGB: round1(a.ramGB), tokPerSec: a.tokPerSec, speed: a.speed },
    license: c.license, gated: c.gated, downloads: c.downloads, likes: c.likes, updated: c.updated,
    good: d.good, weak: d.weak, warnings: d.warnings, why: d.why,
    install: { repo: c.repo, file: row.file, catalogId: c.catalogId },
    _score: row._score,
  };
}

// ───────────────────────────── the whole thing ─────────────────────────────
const sleepTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } })); return out; }

async function find({ need, constraints = {}, specs, offline = !!process.env.FABRO_E2E, llm, useModel = true } = {}) {
  const t0 = Date.now(); // (the Electron e2e runs without network: FABRO_E2E = catalog only)
  let crit = extractCriteria(need, constraints);
  if (useModel && crit.confidence < 0.5 && crit.text.split(/\s+/).length >= 4) crit = await refineWithModel(crit, llm).catch(() => crit);
  const sys = specs || await require('./system').getSpecs();
  const m = machineView(sys);
  const installedList = await models.listLocal().catch(() => []);
  const installedRepos = new Set(installedList.map((x) => x.repo).filter(Boolean));

  // candidates: catalog + Hugging Face
  const cands = new Map();
  for (const c of models.CATALOG.filter((x) => !x.role)) cands.set(c.repo.toLowerCase(), fromCatalog(c));
  let online = !offline; let hfCount = 0; let hfError = null;
  if (online) {
    const qs = searchQueries(crit, m);
    const lists = await Promise.all(qs.map((q) => sleepTimeout(models.searchRich(q.q, { sort: q.sort, limit: 30 }), 9000).catch((e) => { hfError = e; return null; })));
    if (lists.every((l) => l === null)) online = false;
    for (const h of lists.flat().filter(Boolean)) {
      const key = h.repo.toLowerCase();
      if (cands.has(key)) { const c = cands.get(key); c.downloads = h.downloads; c.likes = h.likes; c.updated = h.updated; c.license = c.license || licenseOf(h.tags); c.gated = !!h.gated; c.langs = langTags(h.tags); c.ctxTrain = c.ctxTrain || (h.gguf && h.gguf.context_length) || null; continue; }
      if (NOT_CHAT.test(h.repo) || (h.pipeline && !/text-generation|image-text-to-text|any-to-any|conversational|text2text/.test(h.pipeline))) continue;
      cands.set(key, fromHF(h)); hfCount++;
    }
  }
  // one entry per model family (re-uploads of the same weights): keep the best known
  const fam = new Map();
  for (const c of cands.values()) { const k = familyKey(c); const o = fam.get(k); if (!o || (c.source === 'catalog' && o.source !== 'catalog') || (o.source === c.source && (c.downloads || 0) > (o.downloads || 0))) fam.set(k, c); }
  let list = [...fam.values()];

  // hard filters from the request
  const maxGB = crit.maxSizeGB;
  list = list.filter((c) => {
    if (crit.needs.vision && !c.vision) return false;
    if (c.role) return false;
    const est = c.sizeGB || (c.total ? c.total * 0.6 : null);
    if (maxGB && est && est > maxGB * 1.05) return false;
    if (est && models.BLOCKED.has(models.fitFor(est, m.specs, c.moe))) return false;
    if (est && c.total && !c.sizeGB && est > (m.gpuBudgetGB + m.ramBudgetGB) * 0.95) return false;
    return true;
  });
  // vision unknown for hf results until the file list is seen: keep those whose name hints it, confirm below
  const pre = list.map((c) => { const rel = relevance(c, crit); return { c, pre: rel.r + 0.7 * Math.log2(effParams(c, c.sizeGB) + 0.5) + 0.9 * recency(c) + 0.8 * popularity(c) + (c.source === 'catalog' ? 0.3 : 0) }; }).sort((a, b) => b.pre - a.pre);
  const top = pre.slice(0, 9).map((x) => x.c);
  // real quantizations + sizes from the repository listing (online)
  const infos = new Map();
  if (online) await pool(top, 4, async (c) => { const info = await sleepTimeout(models.repoFiles(c.repo, m.specs), 10000); if (info) infos.set(c.repo, info); });

  const rows = [];
  for (const c of top) {
    const info = infos.get(c.repo);
    if (info && info.files.length) { c.vision = !!info.files.find((f) => f.mmproj) || c.vision && c.source === 'catalog'; }
    if (crit.needs.vision && !c.vision) continue;
    const variants = rowsOf(c, info, m);
    const evaluated = [];
    for (const v of variants) {
      if (v.blocked) continue;
      if (maxGB && v.sizeGB + (v.mmprojGB || 0) > maxGB * 1.05) continue;
      const a = assess(v.sizeGB + (v.mmprojGB || 0), c, m, { ctxTrain: c.ctxTrain });
      if (!a.fits) continue;
      v._score = scoreRow(c, v, a, crit); evaluated.push({ v, a });
    }
    if (!evaluated.length) continue;
    // a heavier quantization than Q4 only when the model sits fully on the GPU with room to spare, or quality is the priority
    const lean = evaluated.filter(({ v, a }) => quantQ(v.quant) <= 1.01 || (a.mode === 'gpu' && !a.tight && crit.priority !== 'speed' && !crit.small) || crit.priority === 'quality' && a.mode === 'gpu');
    const pool = lean.length ? lean : evaluated;
    pool.sort((x, y) => y.v._score - x.v._score);
    const best = pool[0];
    rows.push({ c, row: best.v, a: best.a, score: best.v._score, eff: effParams(c, best.v.sizeGB) });
  }
  rows.sort((x, y) => y.score - x.score);
  // Asked for code: a code model that runs at a usable speed is the recommendation, even when a smaller general model
  // scores higher on speed; that one can still show up as the "lighter" alternative, with its weakness spelled out.
  if (crit.needs.code && rows.length && !rows[0].c.tags.has('code')) {
    const k = rows.findIndex((r) => r.c.tags.has('code') && r.a.speed !== 'very-slow');
    if (k > 0) rows.unshift(rows.splice(k, 1)[0]);
  }

  const picks = [];
  if (rows.length) {
    const rec = rows[0];
    const isInst = (c) => installedRepos.has(c.repo);
    picks.push(buildPick('recommended', rec.c, rec.row, rec.a, crit, m, isInst(rec.c)));
    const rest = rows.slice(1);
    // lighter: clearly smaller and quicker, still relevant (needs vision etc. already filtered)
    const lighter = rest.filter((r) => r.row.sizeGB <= rec.row.sizeGB * 0.65 && r.a.tokPerSec >= rec.a.tokPerSec * 1.25).sort((x, y) => y.score - x.score)[0];
    // stronger: a clearly bigger model this machine still runs at a usable speed
    const stronger = rest.filter((r) => r !== lighter && r.eff >= rec.eff * 1.35 && r.a.tokPerSec >= 4).sort((x, y) => y.eff - x.eff || y.score - x.score)[0];
    if (lighter) picks.push(buildPick('lighter', lighter.c, lighter.row, lighter.a, crit, m, isInst(lighter.c)));
    if (stronger) picks.push(buildPick('stronger', stronger.c, stronger.row, stronger.a, crit, m, isInst(stronger.c)));
  }
  for (const p of picks) delete p._score;
  const machine = { ramGB: m.ramGB, gpu: (m.specs.gpus || [])[0] ? { name: m.specs.gpus[0].name, vramGB: m.specs.gpus[0].vramGB } : null, accel: m.accel, unified: m.unified, budget: { gpuGB: m.gpuBudgetGB, ramGB: m.ramBudgetGB } };
  const notes = [];
  if (!online) notes.push({ code: 'offline', text: 'No connection to Hugging Face: these picks come from the built-in list only, so newer models may exist.' });
  if (!picks.length) notes.push({ code: 'nothing', text: crit.needs.vision ? 'No vision model fits this computer with the given limits.' : 'No model fits this computer with the given limits.' });
  return {
    ok: picks.length > 0, offline: !online, criteria: { text: crit.text, uses: crit.uses, languages: crit.languages, priority: crit.priority, needs: crit.needs, maxSizeGB: crit.maxSizeGB, by: crit.by },
    machine, picks, notes, considered: { total: list.length, fromSearch: hfCount, evaluated: rows.length }, ms: Date.now() - t0,
  };
}

// ───────────────────────────── text for the chat model ─────────────────────────────
function toolText(res) {
  if (!res.picks.length) return `No suitable model found. ${res.notes.map((n) => n.text).join(' ')} Tell the user, and suggest a smaller size limit or a different need.`;
  const lines = res.picks.map((p) => `- ${p.role.toUpperCase()}: ${p.model.name}${p.variant.quant ? ' ' + p.variant.quant : ''}, ${p.variant.downloadGB} GB to download. ${p.why}${p.warnings.filter((w) => w.level === 'warn').length ? ' Warnings: ' + p.warnings.filter((w) => w.level === 'warn').map((w) => w.code).join(', ') + '.' : ''}${p.installed ? ' (already installed)' : ''}`);
  return `Model picks for this computer (${res.machine.ramGB} GB RAM${res.machine.gpu ? ', ' + res.machine.gpu.name : ', no dedicated graphics card'}):\n${lines.join('\n')}\n${res.notes.map((n) => n.text).join(' ')}\n\nThe user now sees these picks as cards with an Install button. Do NOT list or invent other model names. In your reply: recommend the RECOMMENDED one in one or two short sentences in the user's language (what it is good at, how big it is, any warning above), mention that the other two are alternatives, and tell the user to press Install on the card. Never say it is installed or downloading: only the user's click starts the download.`;
}

// ───────────────────────────── chat / agent tool ─────────────────────────────
const TOOL = {
  name: 'find_model',
  description: 'Find an AI model for the user to install in Fabro. Call it when the user asks which model to use or install, or asks you to find, choose, suggest or get a model for something (e.g. "find me a model for coding", "which model is fast on my laptop", "un modèle pour des devoirs"). Put the need in your `need` argument in the user\'s own words (keep their language). It checks Hugging Face and this computer and returns one recommended pick plus alternatives, shown to the user as cards with an Install button. Never invent or name models yourself: only talk about the picks it returns. It cannot install anything; the user must press Install.',
  parameters: { type: 'object', properties: {
    need: { type: 'string', description: 'What the user wants the model for, in their words (any language), e.g. "write emails in French, fast on a small laptop"' },
    priority: { type: 'string', enum: ['speed', 'balanced', 'quality'], description: 'Optional: speed if they want fast/light, quality if they want the best their computer can run' },
    max_size_gb: { type: 'number', description: 'Optional: download size limit in GB, only if the user gave one' },
  }, required: ['need'] },
};
async function toolRun(a, ctx = {}) {
  const need = String((a && a.need) || '').trim();
  if (!need) return { content: 'Missing `need`: ask the user what they want the model for.', view: { kind: 'modelpicks', picks: [], notes: [] } };
  const res = await find({ need, constraints: { priority: a.priority, maxSizeGB: Number(a.max_size_gb) > 0 ? Number(a.max_size_gb) : undefined }, useModel: false });
  return { content: toolText(res), view: { kind: 'modelpicks', ...res } };
}

function init(ipcMain) {
  ipcMain.handle('modelfinder:find', (_e, o) => find(o || {}));
}

module.exports = { find, extractCriteria, refineWithModel, parseParams, machineView, assess, toolText, toolRun, TOOL, init, searchQueries, fromHF, fromCatalog };
