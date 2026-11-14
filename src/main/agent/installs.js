// Installs proposed by the AI (wave 3). The model can suggest a skill, an MCP server or a system prompt; nothing is
// installed until the person clicks "Install" on the card (one question, yes / cancel). "Allow everything" never
// skips that card: the question is asked by the tool itself, not by the policy.
// The work is done by the existing modules: skillimport.js, mcpeasy.js, sysprompts.js.
const agent = require('./index');

const short = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const refusedByUser = { content: 'The user declined this install. Do not propose it again unless they ask.', view: { kind: 'refused', reason: 'user' }, refused: true };
const askInstall = async (ctx, card) => (await ctx.ask({ kind: 'install', tool: card.tool, summary: card.title, ...card })) === 'once';

agent.register({
  name: 'propose_skill_install', category: 'install', risk: 'read', core: false, noMcpWrap: true, keywords: ['skill', 'install', 'compétence', 'installer'],
  description: 'Propose to install a skill (a folder with a SKILL.md) from an https link (GitHub repo, folder or file) or a local .skill / .zip / folder path. The user sees a card and decides; nothing is installed without their click. Use it only when a skill would clearly help with what they asked.',
  parameters: { type: 'object', properties: { source: { type: 'string', description: 'https link or local path' }, why: { type: 'string', description: 'One short sentence: what it will be used for' } }, required: ['source'] },
  summarize: (a) => short(a.source, 200),
  async run(a, ctx) {
    const si = require('../skillimport');
    const p = await si.preview(String(a.source || '').trim());
    if (!p || !p.ok || !(p.skills || []).length) return { content: `Could not read a skill there: ${(p && p.error) || 'nothing found'}.`, isError: true };
    const items = p.skills.map((s) => ({ name: s.name, description: short(s.description, 200), warnings: (s.warnings || []).map((w) => short(w.message || w, 160)).slice(0, 4) }));
    const ok = await askInstall(ctx, { tool: 'propose_skill_install', what: 'skill', title: items.map((i) => i.name).join(', '), source: short(a.source, 300), why: short(a.why, 240), items });
    if (!ok) { if (p.previewId) si._previews.delete(p.previewId); return refusedByUser; }
    const r = await si.install(p.previewId, { collision: 'keepBoth' });
    if (!r.ok || !r.installed.length) return { content: `Install failed: ${r.error || 'nothing was installed'}.`, isError: true };
    return { content: `Installed and enabled: ${r.installed.map((i) => i.name).join(', ')}. It is available from the next message.` };
  },
});

agent.register({
  name: 'propose_mcp_install', category: 'install', risk: 'read', core: false, noMcpWrap: true, keywords: ['mcp', 'server', 'connector', 'connecteur', 'install'],
  description: 'Propose to add an MCP server. `definition` is what its documentation gives: a JSON config ({"mcpServers": {...}}), a command line (npx -y …, uvx …, claude mcp add …) or an https URL. The user sees a card and decides. Never put an API key in the definition: if one is needed, the user adds it in Settings.',
  parameters: { type: 'object', properties: { definition: { type: 'string' }, why: { type: 'string', description: 'One short sentence: what it will be used for' } }, required: ['definition'] },
  summarize: (a) => short(a.definition, 200),
  async run(a, ctx) {
    const me = require('../mcpeasy');
    const parsed = me.parse(String(a.definition || ''));
    const s = parsed && parsed.ok && parsed.servers && parsed.servers[0];
    if (!s) return { content: `Could not read a server definition: ${((parsed && parsed.errors) || []).join('; ') || 'unknown format'}.`, isError: true };
    const need = me.missing(s);
    const line = s.url ? s.url : me.commandLine ? me.commandLine(s) : [s.command, ...(s.args || [])].join(' ');
    const ok = await askInstall(ctx, { tool: 'propose_mcp_install', what: 'mcp', title: s.name, source: short(line, 300), why: short(a.why, 240), needs: need.map((n) => short(n.label, 80)) });
    if (!ok) return refusedByUser;
    const r = await me.add(s, { enabled: !need.length, note: 'Proposed by Fabro' });
    if (!r.ok) return { content: `Could not add the server: ${r.error}.`, isError: true };
    return { content: need.length ? `Added "${s.name}", switched off: it still needs ${need.map((n) => n.label).join(', ')}. Tell the user to fill it in Settings › Advanced › Connectors, then switch it on.` : `Added "${s.name}". Its tools are available from the next message.` };
  },
});

agent.register({
  name: 'propose_system_prompt', category: 'install', risk: 'read', core: false, noMcpWrap: true, keywords: ['system prompt', 'prompt système', 'persona', 'instructions'],
  description: 'Propose to save a personal system prompt (standing instructions the user can pick for a chat). The user sees the text on a card and decides. It is saved, not switched on: they choose it from the chat bar.',
  parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, body: { type: 'string', description: 'The instructions, in Markdown' } }, required: ['name', 'body'] },
  summarize: (a) => short(a.name, 80),
  async run(a, ctx) {
    const body = String(a.body || '').trim();
    if (body.length < 20) return { content: 'The prompt is too short to be useful.', isError: true };
    const ok = await askInstall(ctx, { tool: 'propose_system_prompt', what: 'prompt', title: short(a.name, 80), why: short(a.description, 240), text: body.slice(0, 4000) });
    if (!ok) return refusedByUser;
    const p = await require('../sysprompts').save({ name: a.name, description: a.description, body });
    return { content: `Saved the system prompt "${(p && p.name) || a.name}". The user can pick it from the chat bar or in Settings.` };
  },
});
