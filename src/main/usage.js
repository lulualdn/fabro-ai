// Token usage history: per day, per model, per conversation (usage.json in userData).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'usage.json');
let data = null, timer = null;

function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { data = {}; }
  data.days ||= {}; data.models ||= {}; data.convs ||= {};
  return data;
}
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { fs.writeFileSync(file() + '.tmp', JSON.stringify(data)); fs.renameSync(file() + '.tmp', file()); } catch {}
  }, 800);
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const add = (o, p, c, extra = {}) => { o.prompt = (o.prompt || 0) + (p || 0); o.completion = (o.completion || 0) + (c || 0); o.requests = (o.requests || 0) + 1; Object.assign(o, extra); return o; };

// rec = { model, backend, convId, prompt, completion, ms }
function record(rec) {
  load();
  const day = (data.days[dayKey()] ||= { prompt: 0, completion: 0, requests: 0, models: {} });
  add(day, rec.prompt, rec.completion);
  add(day.models[rec.model] ||= {}, rec.prompt, rec.completion);
  add(data.models[rec.model] ||= {}, rec.prompt, rec.completion, { backend: rec.backend, last: Date.now() });
  if (rec.convId) add(data.convs[rec.convId] ||= {}, rec.prompt, rec.completion, { last: Date.now() });
  // keep 400 days
  const keys = Object.keys(data.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete data.days[k];
  save();
}

function summary(days = 30) {
  load();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    const v = data.days[k] || { prompt: 0, completion: 0, requests: 0, models: {} };
    out.push({ day: k, prompt: v.prompt, completion: v.completion, requests: v.requests, models: v.models });
  }
  const models = Object.entries(data.models).map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion));
  const total = Object.values(data.days).reduce((a, v) => ({ prompt: a.prompt + v.prompt, completion: a.completion + v.completion, requests: a.requests + v.requests }), { prompt: 0, completion: 0, requests: 0 });
  return { days: out, models, total };
}
function forConv(id) { load(); return data.convs[id] || null; }
function clear() { data = { days: {}, models: {}, convs: {} }; save(); return true; }

module.exports = { record, summary, forConv, clear };
