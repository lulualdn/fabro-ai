// Fabro Knowledge: guides the AI writes once and then reads level by level, never in one block.
//   1. knowledge_search → cards: title, "when to use this guide" (one sentence), short description, contents
//   2. knowledge_tree   → every entry of a base: id, title, one-line description
//   3. knowledge_read   → the entries it picks (any number), complete; in parts when too long for the context
// Creation only with the user's yes (knowledge_ask; a no is remembered for that topic). knowledge_write takes one big
// structured file, or one section at a time for small models, and says exactly what is wrong when the format is off.
// Built-in bases (src/main/knowledge/*.md, e.g. the design manual) are read-only; the user can read, fix, delete and
// update every base of their own (<data>/knowledge/<id>.md). Every base keeps its sources, licences and dates.
// Web content used to write a base is data, never instructions.
//
// File format:
//   ---
//   title: Roblox Studio
//   when: Use this guide to build games in Roblox Studio.
//   description: Scripting, UI, data stores and publishing, with the traps of each.
//   sources: https://create.roblox.com/docs (CC BY 4.0, 2026-11-20)
//   ---
//   ## [scripting/server] Server scripts
//   > Where game logic runs and why the client can't be trusted.
//   Full explanation, use cases, verified examples (code explained line by line)…
const fs = require('fs');
const path = require('path');
const agent = require('./index');

const BUILTIN = path.join(__dirname, '..', 'knowledge');
const userDir = () => path.join(require('../paths').dataDir(), 'knowledge');
const stateFile = () => path.join(userDir(), '_state.json');
const ID = /^[a-z0-9][a-z0-9-]{1,48}$/;
const SID = /^[a-z0-9][a-z0-9/_-]{0,63}$/;
const PART = 14000;

function parse(text, id) {
  const errors = [];
  const m = String(text).replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { errors: ['The file must start with a header between two "---" lines (title, when, description, sources).'] };
  const meta = {}; for (const l of m[1].split('\n')) { const k = l.match(/^(\w+):\s*(.*)$/); if (k) meta[k[1].toLowerCase()] = k[2].trim(); }
  for (const k of ['title', 'when', 'description']) if (!meta[k]) errors.push(`Header: "${k}:" is missing.`);
  if (meta.when && !/^(use|utilise)/i.test(meta.when)) errors.push('Header: "when:" must be one sentence starting with "Use this guide to…".');
  const entries = []; const seen = new Set();
  const parts = m[2].split(/^## /m).slice(1);
  if (!parts.length) errors.push('No section: each section starts with "## [id] Title".');
  for (const p of parts) {
    const h = p.match(/^\[([^\]]+)\]\s*(.+)\n?([\s\S]*)$/);
    if (!h) { errors.push(`Section "## ${p.split('\n')[0].slice(0, 60)}" must look like "## [some-id] Title".`); continue; }
    const [, sid, title, rest] = h;
    if (!SID.test(sid)) errors.push(`Section id "${sid}": lowercase letters, digits, "-", "_" or "/" only.`);
    if (seen.has(sid)) errors.push(`Section id "${sid}" is used twice.`); seen.add(sid);
    const body = rest.trim(); const desc = (body.match(/^>\s*(.+)$/m) || [])[1] || body.split('\n')[0].slice(0, 160);
    if (body.length < 40) errors.push(`Section "${sid}" is almost empty.`);
    if (body.length > 30000) errors.push(`Section "${sid}" is too long (${body.length} chars, 30 000 max): split it.`);
    entries.push({ id: sid, title: title.trim(), description: desc.trim(), body });
  }
  return { id, meta, entries, errors };
}
function load(id) {
  const user = path.join(userDir(), id + '.md'); const built = path.join(BUILTIN, id + '.md');
  const file = fs.existsSync(user) ? user : fs.existsSync(built) ? built : null; if (!file) return null;
  const b = parse(fs.readFileSync(file, 'utf8'), id); b.builtin = file === built; b.file = file; return b;
}
function all() {
  const ids = new Set();
  for (const d of [BUILTIN, userDir()]) { try { for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) ids.add(f.slice(0, -3)); } catch {} }
  return [...ids].map(load).filter(Boolean);
}
const state = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { allowed: [], declined: [] }; } };
const saveState = (s) => { fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1)); };
const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const fiche = (b) => `[${b.id}] ${b.meta.title}${b.builtin ? ' (built in)' : ''}\n  ${b.meta.when}\n  ${b.meta.description}\n  Contents: ${b.entries.filter((e) => !e.id.includes('/')).map((e) => e.title).slice(0, 14).join(' · ')}`;

agent.register({
  name: 'knowledge_search', category: 'knowledge', risk: 'read', core: true, noMcpWrap: true,
  description: 'Look for a knowledge base before a specialised task (a tool, a framework, a kind of work). Returns cards: title, when to use it, description, contents. Then knowledge_tree on the right base.',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  summarize: (a) => a.query || 'all',
  async run(a) {
    const list = all(); const q = words(a.query || '');
    const ranked = q.length ? list.map((b) => { const hay = words(`${b.meta.title} ${b.meta.when} ${b.meta.description} ${b.entries.map((e) => e.title).join(' ')}`); return { b, s: q.filter((w) => hay.some((h) => h.startsWith(w))).length }; }).filter((x) => x.s).sort((x, y) => y.s - x.s).map((x) => x.b) : list;
    return { content: ranked.length ? ranked.slice(0, 6).map(fiche).join('\n\n') + '\n\nNext: knowledge_tree({ base })' : `No knowledge base for this.${list.length ? ` Bases: ${list.map((b) => b.id).join(', ')}.` : ''}`, view: { kind: 'knowledge', n: ranked.length } };
  },
});
agent.register({
  name: 'knowledge_tree', category: 'knowledge', risk: 'read', noMcpWrap: true,
  description: 'Every entry of a knowledge base: id, title, one-line description. Pick the ids you need, then knowledge_read.',
  parameters: { type: 'object', properties: { base: { type: 'string' } }, required: ['base'] },
  summarize: (a) => a.base,
  async run(a) {
    const b = load(String(a.base)); if (!b) throw new Error(`No base "${a.base}". knowledge_search lists them.`);
    return { content: `${b.meta.title}: ${b.meta.when}\n${b.entries.map((e) => `${'  '.repeat(e.id.split('/').length - 1)}- ${e.id} · ${e.title} · ${e.description}`).join('\n')}${b.meta.sources ? `\nSources: ${b.meta.sources}` : ''}\n\nNext: knowledge_read({ base: "${b.id}", ids: [...] })`, view: { kind: 'knowledge', base: b.id } };
  },
});
agent.register({
  name: 'knowledge_read', category: 'knowledge', risk: 'read', noMcpWrap: true,
  description: 'Read entries of a knowledge base in full (description, use cases, explained examples). Ask for as many ids as you need; long reads come in parts (part 1, 2…).',
  parameters: { type: 'object', properties: { base: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, part: { type: 'number' } }, required: ['base', 'ids'] },
  summarize: (a) => `${a.base}: ${(a.ids || []).join(', ')}`,
  async run(a) {
    const b = load(String(a.base)); if (!b) throw new Error(`No base "${a.base}".`);
    const want = (a.ids || []).map(String); const found = b.entries.filter((e) => want.includes(e.id) || want.some((w) => e.id.startsWith(w + '/')));
    const missing = want.filter((w) => !b.entries.some((e) => e.id === w || e.id.startsWith(w + '/')));
    if (!found.length) throw new Error(`None of these ids exist in ${b.id}. knowledge_tree({ base: "${b.id}" }) lists them.`);
    const text = found.map((e) => `## [${e.id}] ${e.title}\n${e.body}`).join('\n\n');
    const parts = Math.max(1, Math.ceil(text.length / PART)); const p = Math.min(parts, Math.max(1, Math.round(Number(a.part) || 1)));
    return { content: `${text.slice((p - 1) * PART, p * PART)}${parts > 1 ? `\n\n(Part ${p}/${parts}${p < parts ? ` · next: part ${p + 1}` : ''})` : ''}${missing.length ? `\n(Not found: ${missing.join(', ')})` : ''}`, view: { kind: 'knowledge', base: b.id, ids: found.map((e) => e.id) } };
  },
});
agent.register({
  name: 'knowledge_ask', category: 'knowledge', risk: 'read', noMcpWrap: true,
  description: 'Ask the user for permission to create a knowledge base, when this is the second time you do this kind of task or your memory shows a habit, and no base fits. Never ask again for a topic the user refused.',
  parameters: { type: 'object', properties: { topic: { type: 'string', description: 'e.g. "Roblox Studio"' }, reason: { type: 'string', description: 'Why now, in one sentence' } }, required: ['topic'] },
  summarize: (a) => a.topic,
  async run(a, ctx) {
    const topic = String(a.topic).trim(); const key = words(topic).join('-'); const s = state();
    if (s.declined.includes(key)) return { content: `The user already said no for "${topic}". Do not ask again; go on without a base.` };
    if (s.allowed.includes(key)) return { content: `Already allowed: create it with knowledge_write.` };
    const fr = /^fr/.test(require('../store').getSettings().language || 'fr');
    const q = fr ? `M’autorises-tu à créer une base de connaissances pour que je maîtrise ce genre de tâches ? (${topic})` : `May I create a knowledge base so I master this kind of task? (${topic})`;
    const d = ctx.ask ? await ctx.ask({ tool: 'knowledge_ask', risk: 'write', summary: q, reason: a.reason || '' }) : 'deny';
    if (d === 'once' || d === 'always') { s.allowed.push(key); saveState(s); return { content: `Yes. Create the base with knowledge_write: read the official docs first (read_page / research), keep sources, licences and dates, verify the examples.` }; }
    s.declined.push(key); saveState(s);
    return { content: 'The user said no. Do not create it and do not ask again for this topic.' };
  },
});
agent.register({
  name: 'knowledge_write', category: 'knowledge', risk: 'write', noMcpWrap: true,
  description: 'Write a knowledge base (after knowledge_ask said yes): one structured file (header + "## [id] Title" sections), or one section at a time with section. Each entry: full description, use cases, really useful examples; for code, examples explained. Precise: versions, traps, verified examples. Keep the sources with licence and date; copy from docs only when the licence allows it.',
  example: 'knowledge_write({ base: "roblox-studio", content: "---\\ntitle: Roblox Studio\\nwhen: Use this guide to build games in Roblox Studio.\\ndescription: …\\nsources: https://create.roblox.com/docs (CC BY 4.0, 2026-11-20)\\n---\\n## [scripting/server] Server scripts\\n> …\\n…" })',
  parameters: { type: 'object', properties: { base: { type: 'string', description: 'id: lowercase, digits, dashes' }, content: { type: 'string' }, section: { type: 'string', description: 'Only replace or add this section (content = "## [id] Title\\n…")' } }, required: ['base', 'content'] },
  summarize: (a) => `${a.base}${a.section ? ' / ' + a.section : ''}`,
  async run(a) {
    const id = String(a.base); if (!ID.test(id)) throw new Error('base: lowercase letters, digits and dashes, 2 to 49 characters.');
    const s = state(); const prev = load(id);
    if (prev && prev.builtin) throw new Error(`"${id}" is built into Fabro and read-only. Use another id to make your own version.`);
    if (!prev && !s.allowed.some((k) => id.includes(k) || k.includes(id.replace(/-/g, '')) || words(id).some((w) => k.includes(w)))) throw new Error('No permission yet: ask with knowledge_ask first.');
    let text = String(a.content);
    if (a.section) {
      if (!prev) throw new Error('This base does not exist yet: write its full file first (header and at least one section).');
      const sec = parse(`---\ntitle: x\nwhen: Use this\ndescription: x\n---\n${text.startsWith('## ') ? text : `## [${a.section}] ${a.section}\n${text}`}`, id);
      if (sec.errors.length) throw new Error('Section format: ' + sec.errors.join(' '));
      const raw = fs.readFileSync(prev.file, 'utf8'); const head = raw.match(/^---\n[\s\S]*?\n---\n?/)[0];
      const keep = prev.entries.filter((e) => e.id !== sec.entries[0].id).concat(sec.entries);
      text = head + keep.map((e) => `## [${e.id}] ${e.title}\n${e.body}`).join('\n\n') + '\n';
    }
    const b = parse(text, id);
    if (b.errors.length) throw new Error(`Not saved. Fix: ${b.errors.slice(0, 8).join(' ')}`);
    fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(path.join(userDir(), id + '.md'), text);
    return { content: `Saved "${b.meta.title}": ${b.entries.length} entries. Readable with knowledge_tree({ base: "${id}" }).`, view: { kind: 'knowledge', base: id, written: true } };
  },
});

// ── design fingerprints: what was made recently, so the next design doesn't repeat it (see the design manual) ──
const histFile = () => path.join(userDir(), '_design-history.json');
agent.register({
  name: 'design_history', category: 'knowledge', risk: 'read', noMcpWrap: true, keywords: ['design', 'page', 'site', 'landing', 'app', 'slides', 'logo', 'affiche', 'poster'],
  description: 'The fingerprints of your last designs (colors, fonts, layout) so the next one does not repeat them, unless the user wants the same brand. add: record the one you just made.',
  parameters: { type: 'object', properties: { add: { type: 'object', description: '{ what, colors: ["#hex"…], fonts: [...], layout: "one line" }' } } },
  summarize: (a) => (a.add ? 'add' : 'read'),
  async run(a) {
    let h = []; try { h = JSON.parse(fs.readFileSync(histFile(), 'utf8')); } catch {}
    if (a.add) { h = [{ at: new Date().toISOString().slice(0, 10), what: String(a.add.what || '').slice(0, 80), colors: (a.add.colors || []).slice(0, 8), fonts: (a.add.fonts || []).slice(0, 4), layout: String(a.add.layout || '').slice(0, 160) }, ...h].slice(0, 30); fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(histFile(), JSON.stringify(h, null, 1)); return { content: 'Recorded.' }; }
    return { content: h.length ? `Recent designs (avoid repeating these unless asked):\n${h.slice(0, 10).map((x) => `- ${x.at} ${x.what}: ${x.colors.join(' ')} · ${x.fonts.join(', ')} · ${x.layout}`).join('\n')}` : 'No design recorded yet.' };
  },
});

// For the system prompt: one compact line per base (small models have a tight budget).
const promptLine = () => { const l = all(); return l.length ? l.slice(0, 12).map((b) => `${b.id} (${b.meta.when.replace(/^Use this guide to /i, '').replace(/\.$/, '')})`).join('; ') : ''; };

// IPC for the interface: read, fix, delete, update every base
function register(h) {
  h('knowledge:list', () => all().map((b) => ({ id: b.id, title: b.meta.title, when: b.meta.when, entries: b.entries.length, builtin: b.builtin, sources: b.meta.sources || '' })));
  h('knowledge:get', (id) => { const b = load(String(id)); return b ? { id: b.id, builtin: b.builtin, text: fs.readFileSync(b.file, 'utf8') } : null; });
  h('knowledge:save', (id, text) => { if (!ID.test(String(id))) throw new Error('bad id'); const b = parse(String(text), id); if (b.errors.length) return { ok: false, errors: b.errors }; fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(path.join(userDir(), id + '.md'), String(text)); return { ok: true }; });
  h('knowledge:delete', (id) => { const f = path.join(userDir(), String(id) + '.md'); if (fs.existsSync(f)) fs.unlinkSync(f); return true; });
}

module.exports = { parse, load, all, promptLine, register };
