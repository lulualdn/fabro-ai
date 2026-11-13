// Personal system prompts ("my personal system prompts", Settings › Generation, setting advanced.personalPrompts).
// When the setting is on and a conversation picked one, it replaces the smart prompt for that conversation;
// Fabro still appends the small runtime part the tools need (sysprompt.runtimeSection). Off → nothing changes.
// Each prompt is a plain-text file: dataDir()/sysprompts/<id>.fabroprompt.md = front matter + template body,
// shareable as is (export/import). Template language:
//   {{memory}} {{notes}} {{guides}} {{time}} {{date}} {{weekday}} {{location}} {{user_name}} {{ai_name}}
//   {{language}} {{os}} {{model}} {{tools}} {{skills}} {{project}} {{folders}} {{custom}} {{request}} {{mode}}
//   {{#if agent}}…{{else}}…{{/if}}  {{#unless voice}}…{{/unless}}  (agent, chat, voice, project, sub, code, task,
//   small, vision, files, first + any variable that is not empty)
// Unknown variables are left visible as {{name}} and reported, never an error.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const paths = require('./paths');

const dir = () => paths.inData('sysprompts');
const EXT = '.fabroprompt.md';
const MAX_BODY = 40000;

const VARIABLES = [
  ['memory', 'What Fabro remembers about you (memory)'], ['notes', 'The AI\'s notebook: how you want it to work'],
  ['guides', 'Index of the guides library'], ['time', 'Current time'], ['date', 'Today\'s date'], ['weekday', 'Day of the week'],
  ['location', 'Your city (settings) or time zone'], ['user_name', 'Your name'], ['ai_name', 'The name you gave the assistant'],
  ['language', 'The language you write in'], ['os', 'Operating system'], ['model', 'The model answering'],
  ['tools', 'Tools available right now'], ['skills', 'Installed skills'], ['project', 'Project instructions and files'],
  ['folders', 'Folders the agent may use'], ['custom', 'Your personal instructions (Generation tab)'], ['request', 'Your last message'],
  ['mode', 'chat, agent or voice'],
];
const CONDITIONS = ['agent', 'chat', 'voice', 'project', 'sub', 'code', 'task', 'small', 'vision', 'files', 'first'];
const LANG = { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ru: 'Russian', ar: 'Arabic' };

// ───────────────────────────── template engine ─────────────────────────────
function tokenize(src) {
  const out = []; const re = /\{\{\s*(#if|#unless|else|\/if|\/unless)?\s*([\w.-]*)\s*\}\}/g; let i = 0; let m;
  while ((m = re.exec(src))) {
    if (m.index > i) out.push({ t: 'text', v: src.slice(i, m.index) });
    out.push(m[1] ? { t: m[1], v: m[2], raw: m[0] } : { t: 'var', v: m[2], raw: m[0] });
    i = re.lastIndex;
  }
  if (i < src.length) out.push({ t: 'text', v: src.slice(i) });
  return out;
}
function parse(tokens) {
  const root = []; const stack = [{ kids: root }];
  for (const tk of tokens) {
    const top = stack[stack.length - 1];
    const into = top.inElse ? top.node.else : top.kids;
    if (tk.t === '#if' || tk.t === '#unless') { const node = { t: 'if', neg: tk.t === '#unless', cond: tk.v, then: [], else: [], raw: tk.raw }; into.push(node); stack.push({ node, kids: node.then, inElse: false }); }
    else if (tk.t === 'else' && stack.length > 1) top.inElse = true;
    else if ((tk.t === '/if' || tk.t === '/unless') && stack.length > 1) stack.pop();
    else if (tk.t === 'else' || tk.t === '/if' || tk.t === '/unless') into.push({ t: 'text', v: tk.raw, stray: true });
    else into.push(tk);
  }
  return { root, unclosed: stack.length - 1 };
}
function render(body, s, extra = {}) {
  const vars = { ...variables(s), ...extra };
  const unknown = new Set();
  const truthy = (name) => {
    if (name in vars) { const v = vars[name]; return v === true || (typeof v === 'string' ? v.trim() !== '' : !!v); }
    unknown.add(name); return false;
  };
  const walk = (nodes) => nodes.map((n) => {
    if (n.t === 'text') return n.v;
    if (n.t === 'var') { if (!n.v || !(n.v in vars)) { unknown.add(n.v || '(empty)'); return n.raw; } const v = vars[n.v]; return typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v ?? ''); }
    if (n.t === 'if') return walk(truthy(n.cond) !== n.neg ? n.then : n.else);
    return '';
  }).join('');
  const { root, unclosed } = parse(tokenize(String(body || '')));
  const text = walk(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const warnings = unclosed ? [`${unclosed} {{#if}} block(s) not closed with {{/if}}`] : [];
  return { text, unknown: [...unknown], warnings };
}

// The values for a situation (see sysprompt.situation). Missing data gives empty strings.
function variables(s = {}) {
  const P = require('./prompts');
  const d = s.now || new Date(); const lang = s.lang || 'en';
  const user = s.user || {}; const tools = s.tools || [];
  let guides = ''; try { if (tools.some((t) => (t.function || t).name === 'read_guide')) guides = require('./guides').index(s.request || '', 350).lines.join('\n'); } catch {}
  const vars = {
    memory: (user.memories || []).slice(0, 30).map((m) => `- ${m}`).join('\n'),
    notes: (s.notes || []).map((n) => `- ${n.text}`).join('\n'),
    guides,
    time: d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
    date: d.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: d.toLocaleDateString(lang, { weekday: 'long' }),
    location: user.location || '', user_name: user.name || '', ai_name: user.aiName || 'Fabro',
    language: LANG[lang] || lang, os: P.osName(), model: (s.model && s.model.name) || '',
    tools: tools.length ? P.toolList(tools) : '', skills: s.skillsText || '', project: s.projectText || '',
    folders: (s.folders || []).join(', '), custom: user.custom || '', request: s.request || '',
    mode: s.voice ? 'voice' : s.mode || 'chat',
    agent: s.mode === 'agent', chat: s.mode !== 'agent', voice: !!s.voice, sub: !!s.sub, code: !!s.codeText, task: !!s.unattended,
    small: !!(s.model && (s.model.size === 'tiny' || s.model.size === 'small')), vision: !!(s.model && s.model.vision),
    files: !!(s.conv && s.conv.attach && s.conv.attach.files), first: !!(s.conv && s.conv.first),
  };
  return vars;
}

// A starter = the smart prompt written as a template, so people begin from something that works.
function starter() {
  const P = require('./prompts');
  return `{{#if agent}}${P.IDENTITY_AGENT}{{else}}${P.IDENTITY_CHAT}{{/if}}
Now: {{weekday}} {{date}}, {{time}}{{#if location}} · {{location}}{{/if}}. The user writes in {{language}}: answer in {{language}}.
{{#if ai_name}}Your name is {{ai_name}}.{{/if}}

## About the user
{{#if user_name}}The user's name is {{user_name}}.{{/if}}
{{#if memory}}What you remember about the user (use it when relevant, don't recite it):
{{memory}}{{/if}}
{{#if custom}}The user's personal instructions (follow them):
{{custom}}{{/if}}

{{#if notes}}## How this user wants you to work
{{notes}}{{/if}}

{{#if agent}}## Your tools right now
{{tools}}

${P.LOOP}

${P.HONESTY}

${P.EXAMPLE_SHORT}

${P.INFORM}

${P.RECOVERY_SHORT}

{{#if guides}}## Guides (read_guide before that kind of task)
{{guides}}{{/if}}

{{skills}}

## Environment
{{os}}{{#if folders}} · folders you may use: {{folders}}{{/if}}

${P.SAFETY_SHORT}
{{else}}{{#if tools}}## Tools you can call now
{{tools}}
${P.CHAT_TOOLS_RULES}{{/if}}

${P.ARTIFACTS_SHORT}
{{/if}}
{{#if voice}}${P.VOICE}{{/if}}

{{project}}
`;
}

// ───────────────────────────── files ─────────────────────────────
function parseFile(md) {
  const m = String(md).replace(/^﻿/, '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^(\w[\w-]*):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); }
  return { name: meta.name || '', description: meta.description || '', body: m ? md.slice(m[0].length).replace(/^﻿/, '') : String(md) };
}
const serialize = (p) => `---\nname: ${String(p.name || 'Untitled').replace(/\n/g, ' ')}\ndescription: ${String(p.description || '').replace(/\n/g, ' ')}\nformat: fabroprompt/1\n---\n${String(p.body || '').replace(/^\n+/, '')}`;
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'prompt';
const safeId = (id) => String(id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);

async function list() {
  let ents = []; try { ents = await fsp.readdir(dir()); } catch { return []; }
  const out = [];
  for (const f of ents.filter((x) => x.endsWith(EXT))) {
    try { const st = await fsp.stat(path.join(dir(), f)); const p = parseFile(await fsp.readFile(path.join(dir(), f), 'utf8')); out.push({ id: f.slice(0, -EXT.length), name: p.name || f, description: p.description, size: p.body.length, updated: st.mtimeMs }); } catch {}
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
async function get(id) {
  const i = safeId(id); if (!i) return null;
  try { const p = parseFile(await fsp.readFile(path.join(dir(), i + EXT), 'utf8')); return { id: i, ...p, file: path.join(dir(), i + EXT) }; } catch { return null; }
}
async function save(p = {}) {
  const body = String(p.body || '');
  if (body.length > MAX_BODY) throw new Error(`Too long (max ${MAX_BODY} characters).`);
  const name = String(p.name || '').trim().slice(0, 80) || 'Untitled';
  let id = safeId(p.id);
  if (!id) id = `${slug(name)}-${Date.now().toString(36).slice(-4)}`;
  await fsp.mkdir(dir(), { recursive: true });
  const f = path.join(dir(), id + EXT);
  await fsp.writeFile(f + '.tmp', serialize({ name, description: p.description, body })); await fsp.rename(f + '.tmp', f);
  return { id, name, description: p.description || '', body, file: f };
}
async function remove(id) { const i = safeId(id); if (!i) return false; await fsp.rm(path.join(dir(), i + EXT), { force: true }); return true; }
async function importText(text, fileName = '') {
  const p = parseFile(text);
  return save({ name: p.name || path.basename(fileName).replace(/(\.fabroprompt)?\.(md|txt)$/i, '') || 'Imported', description: p.description, body: p.body });
}
async function exportText(id) { const p = await get(id); if (!p) throw new Error('Prompt not found'); return { fileName: `${slug(p.name)}${EXT}`, text: serialize(p) }; }

// Preview for the editor: the situation of the current conversation, as the renderer describes it.
function previewSituation(ctx = {}) {
  const sp = require('./sysprompt');
  let tools = [];
  try {
    const agent = require('./agent');
    tools = ctx.agent ? agent.select({ agentMode: true, text: ctx.request || '' }).map(agent.schema) : require('./tools').schemas(ctx.chatTools || []);
  } catch {}
  return sp.situation({ mode: ctx.agent ? 'agent' : 'chat', voice: !!ctx.voice, tools, userContext: ctx.userContext || null, messages: ctx.request ? [{ role: 'user', content: ctx.request }] : [], model: ctx.model || {}, projectText: ctx.project ? `# Project: ${ctx.project}` : '', folders: ((require('./store').getSettings().agent || {}).folders || []) });
}
function preview({ body, context } = {}) {
  const sp = require('./sysprompt');
  const s = previewSituation(context || {});
  const r = render(body, s);
  const runtime = sp.runtimeSection(s);
  return { text: r.text, runtime, unknown: r.unknown, warnings: r.warnings, tokens: Math.ceil((r.text.length + runtime.length) / 3.3) };
}

function init(ipcMain, _emit, { dialog, getWindow } = {}) {
  if (!ipcMain) return;
  ipcMain.handle('sysprompts:list', () => list());
  // developer view: the last smart prompt built for a conversation (sections, reasons, tokens, text)
  ipcMain.handle('sysprompt:explain', (_e, convId) => require('./sysprompt').lastFor(convId));
  ipcMain.handle('sysprompts:get', (_e, id) => get(id));
  ipcMain.handle('sysprompts:save', (_e, p) => save(p));
  ipcMain.handle('sysprompts:delete', (_e, id) => remove(id));
  ipcMain.handle('sysprompts:starter', () => starter());
  ipcMain.handle('sysprompts:variables', () => ({ variables: VARIABLES, conditions: CONDITIONS }));
  ipcMain.handle('sysprompts:preview', (_e, a) => preview(a));
  ipcMain.handle('sysprompts:importText', (_e, text, name) => importText(text, name));
  ipcMain.handle('sysprompts:export', async (_e, id) => {
    const { fileName, text } = await exportText(id);
    if (!dialog) return { text, fileName };
    const r = await dialog.showSaveDialog(getWindow ? getWindow() : undefined, { defaultPath: path.join(os.homedir(), 'Documents', fileName), filters: [{ name: 'Fabro prompt', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, text); return { file: r.filePath };
  });
  ipcMain.handle('sysprompts:import', async () => {
    if (!dialog) return null;
    const r = await dialog.showOpenDialog(getWindow ? getWindow() : undefined, { properties: ['openFile'], filters: [{ name: 'Fabro prompt', extensions: ['md', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return importText(await fsp.readFile(r.filePaths[0], 'utf8'), r.filePaths[0]);
  });
}

module.exports = { init, render, variables, starter, list, get, save, remove, importText, exportText, preview, parseFile, serialize, VARIABLES, CONDITIONS, EXT };
