'use strict';
// context_list / context_read / context_pin: the model looks at the exact older messages of the conversation when
// they were summarised to save memory (src/main/context). Offered by chat.js only once a conversation has a summary
// (or is long), so they cost nothing in short chats.
const agent = require('./index');
const context = require('../context');

const noConv = { content: 'This conversation has no saved messages to look at.', view: { kind: 'context' } };

agent.register({
  name: 'context_list', category: 'context', risk: 'read', noMcpWrap: true,
  description: 'List the messages of this conversation with a one-line description each (id, who, size, summarised or not). Use it when the summary of the earlier part is not enough, then context_read the message you need.',
  parameters: { type: 'object', properties: { from: { type: 'number', description: 'Index to start from (0 = first message)' }, limit: { type: 'number', description: 'How many (default 40)' } } },
  summarize: () => '',
  async run(a, ctx) {
    if (!ctx.convId) return noConv;
    const rows = context.list(ctx.convId, { from: Math.max(0, Number(a.from) || 0), limit: Math.max(1, Math.min(80, Number(a.limit) || 40)) });
    if (!rows.length) return noConv;
    const txt = rows.map((r) => `#${r.id} · ${r.role} · ~${r.tokens} tokens${r.summarised ? ' · summarised' : ''}${r.pinned ? ' · pinned' : ''} — ${r.about}`).join('\n');
    return { content: `${txt}\n\nRead one in full with context_read({"id":"…"}).`, view: { kind: 'context', n: rows.length } };
  },
});

agent.register({
  name: 'context_read', category: 'context', risk: 'read', noMcpWrap: true,
  description: 'Read one earlier message of this conversation exactly as it was written (ids come from context_list or from the summary). Long messages come in parts: pass offset to read further.',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Message id, e.g. "m3k2x"' }, offset: { type: 'number', description: 'Character to start from' } }, required: ['id'] },
  summarize: (a) => String(a.id || ''),
  async run(a, ctx) {
    if (!ctx.convId) return noConv;
    const r = context.read(ctx.convId, a.id, { offset: Math.max(0, Number(a.offset) || 0) });
    if (!r) return { content: `No message "${a.id}" in this conversation. Call context_list to see the ids.`, view: { kind: 'context' } };
    const more = r.offset + r.text.length < r.total ? `\n\n[${r.total - r.offset - r.text.length} more characters: context_read with offset ${r.offset + r.text.length}]` : '';
    return { content: `#${r.id} (${r.role}):\n${r.text}${more}`, view: { kind: 'context', id: r.id } };
  },
});

agent.register({
  name: 'context_pin', category: 'context', risk: 'read', noMcpWrap: true,
  description: 'Keep one message of this conversation word for word in future summaries (for example the brief the user gave at the start). unpin:true removes it.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, unpin: { type: 'boolean' } }, required: ['id'] },
  summarize: (a) => String(a.id || ''),
  async run(a, ctx) {
    if (!ctx.convId) return noConv;
    const ok = context.pin(ctx.convId, a.id, !a.unpin);
    return { content: ok ? (a.unpin ? `#${a.id} is no longer pinned.` : `#${a.id} will be kept word for word.`) : `No message "${a.id}". Call context_list to see the ids.`, view: { kind: 'context' } };
  },
});

module.exports = { NAMES: ['context_list', 'context_read', 'context_pin'] };
