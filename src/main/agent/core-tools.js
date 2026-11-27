// Core tools of Fabro 1.0: the tool tree (open_tools / use_tool), the task notebook, memory and past conversations.
//
// The tool tree: like a file explorer. The root is always in context (the ~10 starred tools + one line per folder);
// open_tools("web") lists a folder, open_tools("web/research") gives a tool's card and makes it available from the
// next round, open_tools({ query }) searches by words. Two ways to call what was opened, compared by
// scripts/tools-bench.js before either becomes the default (Settings → agent.toolMode):
//   'tree'     (A) the opened tool joins the tool list (calls checked by the engine's schema, the prompt cache is lost)
//   'use_tool' (B) the tool list never changes; the model calls use_tool(name, args) (cache kept, args checked here)
//   'classic'  the previous selection by keywords (default until the bench says otherwise)
const fs = require('fs');
const path = require('path');
const agent = require('./index');
const store = require('../store');

const FOLDERS = [
  ['fichiers', 'files and documents: read, write, search, convert, PDF', ['files', 'filetools']],
  ['web', 'pages, research, downloads, images, the browser', ['web', 'browser']],
  ['code', 'commands, Python, git, tests, processes, previews', ['shell', 'python', 'git', 'code']],
  ['memoire', 'memory, past conversations, notebook, projects', ['memory', 'notebook', 'context', 'projects']],
  ['vision', 'look at images, pages and videos', ['vision']],
  ['diagnostic', 'test sequences and diagnosis', ['diagnostic']],
  ['connaissances', 'knowledge bases, guides, skills', ['knowledge', 'guides', 'skills']],
  ['creation', 'artifacts, documents, images, speech, exports', ['design', 'documents']],
  ['ordinateur', 'use the screen, mouse and keyboard; clipboard', ['computer', 'control', 'desktop']],
  ['pilotage', 'plans, sub-agents, scheduled tasks, notifications, installs', ['plan', 'tasks', 'core', 'install', 'pilotage']],
  ['connecteurs', 'tools of the connected services (MCP)', []],
];
const STAR = ['open_tools', 'ask_user', 'update_plan', 'read_file', 'write_file', 'edit_file', 'web_search', 'read_page', 'run_command', 'memory_search'];
const folderOf = (t) => { if (String(t.category).startsWith('mcp:')) return 'connecteurs'; const f = FOLDERS.find((x) => x[2].includes(t.category)); return f ? f[0] : 'pilotage'; };
const mode = () => ((store.getSettings().agent || {}).toolMode) || 'classic';
const short = (d) => String(d || '').split(/(?<=\.)\s/)[0].slice(0, 140);

function root() {
  const all = agent.all();
  return `Always available: ${STAR.join(', ')}.\nFolders (open_tools("<folder>") to list, open_tools("<folder>/<tool>") for a card):\n${FOLDERS.map(([f, d]) => {
    const n = all.filter((t) => folderOf(t) === f).length; return n ? `- ${f}/ (${n}) ${d}` : '';
  }).filter(Boolean).join('\n')}`;
}

agent.register({
  name: 'open_tools', category: 'pilotage', risk: 'read', core: true, noMcpWrap: true,
  description: 'Find the right tool, like a file explorer. No argument: the folders. "web": the tools of a folder. "web/read_page": a tool\'s card (when to use it, arguments) and the tool becomes usable. query: search tools by words (5 results).',
  example: 'open_tools({ path: "fichiers" }) then open_tools({ path: "fichiers/convert_file" })',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder ("web") or folder/tool ("web/read_page")' }, query: { type: 'string', description: 'Words to look for, e.g. "pdf to text"' } } },
  summarize: (a) => a.path || a.query || '/',
  async run(a, ctx) {
    const all = agent.all();
    if (a.query) {
      const words = String(a.query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const scored = all.map((t) => { const hay = `${t.name} ${t.description} ${(t.keywords || []).join(' ')}`.toLowerCase(); return { t, s: words.reduce((n, w) => n + (hay.includes(w) ? (t.name.includes(w) ? 3 : 1) : 0), 0) }; })
        .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 5);
      for (const x of scored) agent.openTool(ctx.convId, x.t.name);
      return { content: scored.length ? scored.map((x) => `${folderOf(x.t)}/${x.t.name}: ${short(x.t.description)}`).join('\n') + `\n(These tools are now usable${mode() === 'use_tool' ? ' through use_tool' : ''}.)` : 'Nothing matches. Try other words, or open_tools() for the folders.', view: { kind: 'tools', query: a.query } };
    }
    const p = String(a.path || '').replace(/^\/+|\/+$/g, '');
    if (!p) return { content: root(), view: { kind: 'tools' } };
    const [folder, name] = p.split('/');
    if (name) {
      const t = agent.get(name); if (!t) throw new Error(`No tool "${name}" in ${folder}/. open_tools("${folder}") lists them.`);
      agent.openTool(ctx.convId, t.name);
      return { content: `${agent.card(t)}\n(Now usable${mode() === 'use_tool' ? `: use_tool({ name: "${t.name}", args: {…} })` : ''}.)`, view: { kind: 'tools', tool: t.name } };
    }
    const list = all.filter((t) => folderOf(t) === folder);
    if (!list.length) throw new Error(`No folder "${folder}". Folders: ${FOLDERS.map((f) => f[0]).join(', ')}.`);
    return { content: `${folder}/\n${list.map((t) => `- ${t.name}${STAR.includes(t.name) ? ' ★' : ''}: ${short(t.description)}`).join('\n')}`, view: { kind: 'tools', folder } };
  },
});

agent.register({
  name: 'use_tool', category: 'pilotage', risk: 'read', noMcpWrap: true,
  description: 'Call a tool opened with open_tools: use_tool({ name, args }). The arguments are checked against the tool\'s card.',
  parameters: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] },
  summarize: (a) => a.name,
  async run(a, ctx) {
    if (a.name === 'use_tool' || a.name === 'open_tools') throw new Error('use_tool calls other tools.');
    const r = await agent.execute({ name: String(a.name), args: a.args && typeof a.args === 'object' ? a.args : {} }, ctx);
    return r;
  },
});

// ───────────────────────────── task notebook (kept out of the context) ─────────────────────────────
const notesFile = (convId) => path.join(require('../paths').dataDir(), 'notes', `${String(convId || 'loose').replace(/[^\w-]/g, '_')}.md`);
agent.register({
  name: 'task_notes', category: 'notebook', risk: 'read', categoryCore: true, noMcpWrap: true,
  description: 'Your notebook for this task, kept outside the conversation: what you found, decisions, what is left. Write as you go on long tasks; read it after a pause or when the conversation was compressed. action: read | append | write (replace all).',
  example: 'task_notes({ action: "append", text: "Prices checked at 3 shops: R500E 1 799 €, Tern GSD 4 999 €" })',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['read', 'append', 'write'] }, text: { type: 'string' } }, required: ['action'] },
  summarize: (a) => a.action,
  async run(a, ctx) {
    const f = notesFile(ctx.convId); fs.mkdirSync(path.dirname(f), { recursive: true });
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (a.action === 'read') return { content: cur || '(empty notebook)', view: { kind: 'notes', chars: cur.length } };
    const text = String(a.text || '').trim(); if (!text) throw new Error('text is empty');
    const next = a.action === 'write' ? text : `${cur}${cur ? '\n' : ''}- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${text}`;
    fs.writeFileSync(f, next.slice(-200000));
    return { content: `Saved (${next.length} chars).`, view: { kind: 'notes', chars: next.length } };
  },
});

// ───────────────────────────── past conversations ─────────────────────────────
agent.register({
  name: 'chat_search', category: 'memory', risk: 'read', categoryCore: true, noMcpWrap: true, keywords: ['last time', 'déjà', 'already', 'remember', 'souviens', 'conversation', 'previous', 'précédent'],
  description: 'Search the user\'s past conversations (words, not meaning). Returns ids, titles, dates and the matching lines. Then chat_read to read one.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  summarize: (a) => a.query,
  async run(a, ctx) {
    const r = require('../db').searchConversations(String(a.query), 12).filter((x) => x.id !== ctx.convId);
    return { content: r.length ? r.map((x) => `${x.id} · ${x.title || '(untitled)'} · ${new Date(x.updatedAt).toISOString().slice(0, 10)}\n  ${String(x.snippet || '').replace(/\[\[|\]\]/g, '"')}`).join('\n') : 'No past conversation matches.', view: { kind: 'chat_search', n: r.length } };
  },
});
agent.register({
  name: 'chat_read', category: 'memory', risk: 'read', noMcpWrap: true,
  description: 'Read a past conversation found with chat_search, by parts of about 12 000 characters (part 1, 2…).',
  parameters: { type: 'object', properties: { id: { type: 'string' }, part: { type: 'number' } }, required: ['id'] },
  summarize: (a) => a.id,
  async run(a) {
    const A = require('../../anywhere/core.js');
    const c = await store.getConversation(String(a.id)); if (!c) throw new Error('No conversation with this id. Use chat_search first.');
    const text = A.pathOf(c).map((n) => `${n.role === 'user' ? 'User' : 'Fabro'}: ${n.content || ''}`).join('\n\n');
    const size = 12000; const parts = Math.max(1, Math.ceil(text.length / size)); const p = Math.min(parts, Math.max(1, Math.round(Number(a.part) || 1)));
    return { content: `${c.title || ''} (part ${p}/${parts})\n\n${text.slice((p - 1) * size, p * size)}`, view: { kind: 'chat_read', id: a.id, part: p, parts } };
  },
});

// ───────────────────────────── memory (by meaning when an embedding model is installed) ─────────────────────────────
const vecs = new Map(); // memory id → vector
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
async function rankMemories(query, list) {
  const rag = require('../rag');
  try {
    const missing = list.filter((m) => !vecs.has(m.id));
    if (missing.length) { const v = await rag.embed(missing.map((m) => m.text), 'doc'); if (v) missing.forEach((m, i) => vecs.set(m.id, v[i])); }
    const q = await rag.embed([query], 'query');
    if (q && q[0]) return list.map((m) => ({ m, s: vecs.has(m.id) ? cos(q[0], vecs.get(m.id)) : 0 })).sort((x, y) => y.s - x.s).map((x) => x.m);
  } catch {}
  const words = String(query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  return list.map((m) => ({ m, s: words.filter((w) => m.text.toLowerCase().includes(w)).length })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.m);
}
agent.register({
  name: 'memory_search', category: 'memory', risk: 'read', core: true, noMcpWrap: true,
  description: 'Look in what you remember about the user (preferences, facts, projects), by meaning. Use before asking something you may already know.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  summarize: (a) => a.query,
  async run(a) {
    const list = require('../db').listMemories();
    const r = (await rankMemories(String(a.query), list)).slice(0, 8);
    return { content: r.length ? r.map((m) => `- ${m.text}`).join('\n') : 'Nothing remembered about this.', view: { kind: 'memory', n: r.length } };
  },
});
agent.register({
  name: 'memory_save', category: 'memory', risk: 'read', noMcpWrap: true,
  description: 'Remember one lasting fact about the user (a preference, a project, a person), in one short sentence. Not for things only useful in this task (use task_notes).',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  summarize: (a) => String(a.text || '').slice(0, 80),
  async run(a) { const id = require('../db').addMemory(String(a.text), 'agent'); return { content: id ? 'Remembered.' : 'Nothing to remember.', view: { kind: 'memory_saved', text: String(a.text).slice(0, 200) } }; },
});

module.exports = { FOLDERS, STAR, folderOf, mode };
