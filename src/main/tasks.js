// Scheduled tasks: prompts that run by themselves (once, every day, some weekdays, every N minutes).
// A prompt can hold {{variables}}; the AI changes them during a run with set_task_variable, so the next
// run sees the new values (counters, the last price seen, a running list…). Results are saved as a
// conversation and sent as a notification (computer + paired phones).
const { app } = require('electron');
const fs = require('fs'); const path = require('path');
const store = require('./store');
const agent = require('./agent');

let tasks = []; let emit = () => {}; let timer = null; const running = new Set();
const file = () => path.join(app.getPath('userData'), 'tasks.json');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const save = () => { try { fs.writeFileSync(file(), JSON.stringify(tasks, null, 1)); } catch {} emit('tasks:event', { type: 'changed' }); };
const DAYS = { sun: 0, sunday: 0, dim: 0, dimanche: 0, mon: 1, monday: 1, lun: 1, lundi: 1, tue: 2, tuesday: 2, mar: 2, mardi: 2, wed: 3, wednesday: 3, mer: 3, mercredi: 3, thu: 4, thursday: 4, jeu: 4, jeudi: 4, fri: 5, friday: 5, ven: 5, vendredi: 5, sat: 6, saturday: 6, sam: 6, samedi: 6 };

function normWhen(w = {}) {
  const type = ['once', 'daily', 'weekly', 'interval'].includes(w.type) ? w.type : w.days ? 'weekly' : w.every_minutes ? 'interval' : w.date ? 'once' : 'daily';
  const at = /^\d{1,2}:\d{2}$/.test(String(w.time || w.at || '')) ? String(w.time || w.at).padStart(5, '0') : '09:00';
  const days = (Array.isArray(w.days) ? w.days : String(w.days || '').split(/[ ,;]+/)).map((d) => (typeof d === 'number' ? d : DAYS[String(d).toLowerCase().slice(0, 9)] ?? DAYS[String(d).toLowerCase().slice(0, 3)])).filter((d) => d >= 0 && d <= 6);
  return { type, at, days: [...new Set(days)].sort(), date: w.date ? String(w.date) : null, every: Math.max(5, Number(w.every_minutes || w.every) || 60) };
}
// next run after `from` (local time)
function nextRun(t, from = Date.now()) {
  const w = t.when; const [h, m] = w.at.split(':').map(Number);
  if (w.type === 'once') { const d = new Date(w.date && w.date.length > 10 ? w.date : `${w.date || new Date().toISOString().slice(0, 10)}T${w.at}`); return +d > from ? +d : null; }
  if (w.type === 'interval') return Math.max(from + 1000, (t.lastRun || t.createdAt) + w.every * 60000);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
    if (+d <= from) continue;
    if (w.type === 'daily' || w.days.includes(d.getDay())) return +d;
  }
  return null;
}
function describe(t, lang = 'en') {
  const w = t.when; const fr = lang === 'fr';
  const names = fr ? ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (w.type === 'once') return (fr ? 'Une fois, le ' : 'Once, on ') + new Date(nextRun(t, 0) || Date.now()).toLocaleString(lang);
  if (w.type === 'interval') return fr ? `Toutes les ${w.every} min` : `Every ${w.every} min`;
  if (w.type === 'daily') return (fr ? 'Tous les jours à ' : 'Every day at ') + w.at;
  return (fr ? 'Chaque ' : 'Every ') + w.days.map((d) => names[d]).join(fr ? ', ' : ', ') + (fr ? ' à ' : ' at ') + w.at;
}
const view = (t) => ({ ...t, next: t.enabled ? nextRun(t) : null, schedule: describe(t, (store.getSettings().language || 'en').slice(0, 2)) });

function create(o) {
  const t = { id: uid(), title: String(o.title || 'Task').slice(0, 80), prompt: String(o.prompt || '').slice(0, 8000), when: normWhen(o.when || o), vars: o.vars && typeof o.vars === 'object' ? o.vars : {}, enabled: true, createdAt: Date.now(), lastRun: null, runs: [], convId: null, notify: o.notify !== false };
  tasks.push(t); save(); return t;
}
function update(id, patch = {}) {
  const t = tasks.find((x) => x.id === id); if (!t) throw new Error('Task not found');
  if (patch.title != null) t.title = String(patch.title).slice(0, 80);
  if (patch.prompt != null) t.prompt = String(patch.prompt).slice(0, 8000);
  if (patch.when) t.when = normWhen(patch.when);
  if (patch.enabled != null) t.enabled = !!patch.enabled;
  if (patch.vars && typeof patch.vars === 'object') Object.assign(t.vars, patch.vars);
  save(); return t;
}
function remove(id) { tasks = tasks.filter((x) => x.id !== id); save(); return true; }
function setVar(id, name, value) { const t = tasks.find((x) => x.id === id); if (!t) throw new Error('Task not found'); t.vars[String(name).slice(0, 60)] = value; save(); return t.vars; }

async function run(id, why = 'schedule') {
  const t = tasks.find((x) => x.id === id); if (!t || running.has(id)) return null;
  running.add(id); emit('tasks:event', { type: 'running', id });
  const chat = require('./chat'); const s = store.getSettings(); const model = t.model || s.selectedModel;
  const started = Date.now(); const now = new Date();
  const vars = { ...t.vars, date: now.toLocaleDateString(s.language || 'en'), time: now.toLocaleTimeString(s.language || 'en', { hour: '2-digit', minute: '2-digit' }), run: (t.runs.length + 1) };
  const prompt = t.prompt.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m0, k) => (vars[k] != null ? (typeof vars[k] === 'object' ? JSON.stringify(vars[k]) : String(vars[k])) : m0));
  const sys = `You are Fabro, running the scheduled task "${t.title}" for the user. Nobody is watching: do the work with your tools, then write the result for the user — it is sent to them as a notification and saved in a conversation. Keep it short and useful.\nTask variables (kept between runs): ${JSON.stringify(t.vars)}. When the task says to remember or change something for the next runs, call set_task_variable. Run #${vars.run}, ${now.toString()}.`;
  let content = '', error = null; const steps = []; const reqId = 'task-' + uid();
  if (!model) error = 'No model selected';
  else await new Promise((res) => {
    chat.send({ reqId, model, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }], params: { ...(s.gen || {}), agentMode: true, tools: ['web_search', 'fetch_url'], agentPrompt: sys, reasoning: 'off' }, meta: { taskId: t.id, unattended: true, modelLabel: 'Fabro · ' + t.title } }, (ev) => {
      if (ev.type === 'token') content += ev.text;
      else if (ev.type === 'retract') content = content.replace(ev.text, '');
      else if (ev.type === 'tool_round' && content && !/\n\n$/.test(content)) content += '\n\n';
      else if (ev.type === 'tool_start' && !ev.parent) steps.push({ id: ev.id, name: ev.name, args: ev.args, status: 'running' });
      else if (ev.type === 'tool_end') { const st = steps.find((x) => x.id === ev.id); if (st) { st.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; st.view = ev.view; } }
      else if (ev.type === 'permission') chat.answer(reqId, ev.id, 'deny'); // nobody to ask: actions that need approval are skipped
      else if (ev.type === 'deps_needed') chat.answer(reqId, ev.id, false);
      else if (ev.type === 'done') res();
      else if (ev.type === 'error') { error = ev.message; res(); }
    });
  });
  // save as a conversation the user (and the phone) can open
  try {
    const mk = () => uid() + uid().slice(0, 3);
    let c = t.convId && await store.getConversation(t.convId).catch(() => null);
    if (!c) { c = { id: mk(), title: '⏰ ' + t.title, createdAt: started, messages: [], agent: true, taskId: t.id }; t.convId = c.id; }
    const msgs = c.messages || [];
    msgs.push({ id: mk(), role: 'user', content: prompt, createdAt: started, attachments: [] });
    msgs.push({ id: mk(), role: 'assistant', content: content.trim() || (error ? '' : '…'), error: error || undefined, steps, model: 'Fabro · ' + t.title, createdAt: Date.now() });
    c.messages = msgs; c.nodes = undefined; c.leafId = undefined; c.updatedAt = Date.now();
    await store.saveConversation(c);
  } catch {}
  t.lastRun = started; t.runs = [{ at: started, ms: Date.now() - started, ok: !error, error, preview: content.trim().slice(0, 400), why }, ...t.runs].slice(0, 30);
  if (t.when.type === 'once' && why === 'schedule') t.enabled = false;
  running.delete(id); save();
  emit('tasks:event', { type: 'ran', id, convId: t.convId });
  if (t.notify) {
    const body = error ? `⚠ ${error}` : content.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    try { require('./desktop').notify('⏰ ' + t.title, body); } catch {}
    try { require('./anywhere').desktopAgentDone({ title: '⏰ ' + t.title, convId: t.convId }); } catch {}
  }
  return t;
}

function tick() {
  const now = Date.now();
  for (const t of tasks) {
    if (!t.enabled || running.has(t.id)) continue;
    // a run missed while the computer was off is done once when Fabro starts (if less than 12 h ago)
    const due = t.nextDue != null ? t.nextDue : nextRun(t, t.lastRun || t.createdAt);
    if (due != null && due <= now && now - due < 12 * 3600e3) { t.nextDue = null; run(t.id).catch(() => {}); }
    else if (due != null && now - due >= 12 * 3600e3) { t.nextDue = nextRun(t, now); }
  }
}

function init(e) {
  emit = e;
  try { tasks = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { tasks = []; }
  clearInterval(timer); timer = setInterval(tick, 20000); setTimeout(tick, 5000);
}

// ── tools for the AI ──
const whenSchema = { type: 'object', description: 'When to run. Weekly example: {type:"weekly", days:["mon","thu"], time:"15:00"}. Once: {type:"once", date:"2026-10-20", time:"08:00"}. Daily: {type:"daily", time:"07:30"}. Repeating: {type:"interval", every_minutes:60}.',
  properties: { type: { type: 'string', enum: ['once', 'daily', 'weekly', 'interval'] }, time: { type: 'string', description: 'HH:MM, local time' }, days: { type: 'array', items: { type: 'string' }, description: 'weekly: mon, tue, wed, thu, fri, sat, sun' }, date: { type: 'string', description: 'once: YYYY-MM-DD' }, every_minutes: { type: 'integer' } }, required: ['type'] };
const kw = ['tâche', 'tache', 'planifi', 'programm', 'rappel', 'rappelle', 'remind', 'schedule', 'every', 'chaque', 'tous les', 'toutes les', 'demain', 'tomorrow', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'variable', 'task'];
agent.register({ name: 'schedule_task', category: 'tasks', risk: 'read', keywords: kw,
  description: 'Schedule a message/task that runs by itself later or repeatedly (once, daily, on some weekdays at a time, or every N minutes). The prompt is what you will be asked at each run; it can contain {{variables}} (and {{date}}, {{time}}, {{run}}) replaced by their current values. Results reach the user as a notification and a saved conversation.',
  parameters: { type: 'object', properties: { title: { type: 'string' }, prompt: { type: 'string', description: 'Instruction for each run, e.g. "Check the price of X on site Y. Last price was {{last_price}}. Tell me if it dropped, then set last_price."' }, when: whenSchema, vars: { type: 'object', description: 'Initial values of the {{variables}}' } }, required: ['title', 'prompt', 'when'] },
  summarize: (a) => `${a.title} · ${JSON.stringify(a.when || {})}`,
  async run(a) { const t = create(a); const v = view(t); return { content: `Scheduled "${t.title}" (id ${t.id}): ${v.schedule}. Next run: ${v.next ? new Date(v.next).toString() : 'none'}.`, view: { kind: 'task', id: t.id, title: t.title, schedule: v.schedule, next: v.next } }; } });
agent.register({ name: 'list_tasks', category: 'tasks', risk: 'read', keywords: kw, description: 'List the scheduled tasks with their schedule, variables and last result.', parameters: { type: 'object', properties: {} },
  async run() { return { content: tasks.length ? tasks.map((t) => { const v = view(t); return `- ${t.id} · ${t.title} · ${v.schedule} · ${t.enabled ? 'on' : 'off'} · next ${v.next ? new Date(v.next).toLocaleString() : '—'} · vars ${JSON.stringify(t.vars)}`; }).join('\n') : 'No scheduled tasks.' }; } });
agent.register({ name: 'update_task', category: 'tasks', risk: 'read', keywords: kw, description: 'Change a scheduled task (title, prompt, schedule, enabled, variables).', parameters: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' }, when: whenSchema, enabled: { type: 'boolean' }, vars: { type: 'object' } }, required: ['id'] },
  async run(a) { const t = update(a.id, a); return { content: `Updated "${t.title}": ${view(t).schedule}.` }; } });
agent.register({ name: 'delete_task', category: 'tasks', risk: 'write', keywords: kw, description: 'Delete a scheduled task.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, summarize: (a) => a.id,
  async run(a) { remove(a.id); return { content: 'Deleted.' }; } });
agent.register({ name: 'set_task_variable', category: 'tasks', risk: 'read', core: true,
  description: 'Set a variable of a scheduled task (kept for its next runs). Inside a scheduled run the task id is optional.', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, value: {} }, required: ['name', 'value'] },
  summarize: (a) => `${a.name} = ${JSON.stringify(a.value)}`.slice(0, 120),
  async run(a, ctx) { const id = a.id || ctx.taskId; if (!id) return { content: 'No task id: pass id (see list_tasks).' }; const v = setVar(id, a.name, a.value); return { content: `Saved. Variables now: ${JSON.stringify(v)}` }; } });

module.exports = { init, list: () => tasks.map(view), create, update, remove, run, setVar, nextRun, normWhen, describe };
