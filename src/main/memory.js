// Memory planning: "this model will use 9.2 / 12 GB of video memory" before loading,
// and the automatic GPU / RAM split used by the engine.
const fs = require('fs');
const gguf = require('./gguf');

const GB = 2 ** 30;
const KV_BYTES = { f16: 2, q8_0: 34 / 32, q4_0: 18 / 32 };
const shapeCache = new Map();

function shapeOf(file) {
  if (!file) return null;
  if (shapeCache.has(file)) return shapeCache.get(file);
  let s = null;
  try { s = gguf.summarize(file); } catch { s = null; }
  shapeCache.set(file, s);
  return s;
}

function fileBytes(model) {
  let n = 0;
  for (const p of [...(model.parts || [model.path]), model.mmproj].filter(Boolean)) { try { n += fs.statSync(p).size; } catch {} }
  return n || model.sizeBytes || 0;
}

// opts: { ctx, gpuLayers (-1 auto), kvType, cpuMoe ('auto'|'on'|'off') }
function plan(model, opts, specs) {
  const shape = shapeOf(model.path) || {};
  const weights = fileBytes(model) / GB;
  const layers = shape.layers || 32;
  const ctx = Math.min(opts.ctx || 8192, shape.ctxTrain || Infinity);
  const kvB = KV_BYTES[opts.kvType] || 2;
  let kv = shape.layers ? (layers * ctx * (shape.headsKv || 8) * ((shape.keyLen || 128) + (shape.valLen || 128)) * kvB) / GB : ctx / 8192 * 1.0;
  if (shape.window) kv *= 0.4;               // sliding-window layers keep a short cache
  const compute = 0.3 + (ctx * (shape.emb || 4096) * 4 * 3) / GB / 4;
  const moe = !!shape.moe || /\bA\d+B\b|moe|gpt-oss/i.test(model.name || model.file || '');
  const total = weights + kv + compute;
  const budget = specs.gpuBudgetGB || 0;
  const gpu = specs.accel !== 'cpu' && budget > 0;

  let ngl = 0, cpuMoe = false, mode = 'cpu';
  if (gpu && opts.gpuLayers !== 0) {
    if (opts.gpuLayers > 0) { ngl = Math.min(opts.gpuLayers, layers + 1); mode = ngl > layers ? 'gpu' : 'split'; }
    else if (total <= budget) { ngl = 999; mode = 'gpu'; }
    else if (moe && opts.cpuMoe !== 'off' && weights * 0.12 + kv + compute <= budget) { ngl = 999; cpuMoe = true; mode = 'moe'; }
    else {
      const per = weights / (layers + 1);
      ngl = Math.max(0, Math.floor((budget - kv - compute) / per));
      mode = ngl > 0 ? 'split' : 'cpu';
    }
  }
  if (opts.cpuMoe === 'on' && moe && gpu) { cpuMoe = true; ngl = 999; mode = 'moe'; }

  const frac = mode === 'gpu' ? 1 : mode === 'moe' ? 1 : Math.min(1, ngl / (layers + 1));
  let vram = 0, ram = 0;
  if (mode === 'cpu') ram = total;
  else if (mode === 'moe') { vram = weights * 0.12 + kv + compute; ram = weights * 0.88; }
  else { vram = weights * frac + kv * frac + compute; ram = weights * (1 - frac) + kv * (1 - frac); }
  if (specs.unified) { ram = 0; vram = total; }

  const fits = specs.unified ? total <= budget * 1.05
    : vram <= budget * 1.02 && ram <= (specs.ramBudgetGB || 0) + (mode === 'cpu' ? 0 : 2);
  return {
    weightsGB: +weights.toFixed(2), kvGB: +kv.toFixed(2), computeGB: +compute.toFixed(2), totalGB: +total.toFixed(2),
    vramGB: +vram.toFixed(2), ramGB: +ram.toFixed(2), budgetGB: budget, ramBudgetGB: specs.ramBudgetGB,
    mode, ngl, cpuMoe, layers, ctx, moe, fits, shape,
  };
}

module.exports = { plan, shapeOf };
