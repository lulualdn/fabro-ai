// Planning tools for agent mode: a visible task list (Progression panel) and sub-agents.
const agent = require('./index');

const STATUSES = new Set(['pending', 'in_progress', 'done']);

agent.register({
  name: 'update_plan', category: 'plan', risk: 'read', categoryCore: true, noMcpWrap: true,
  description: 'Show the user your plan for a multi-step task as a checklist, and keep it current: call it once at the start with every step, then again each time a step starts or finishes (send the full list each time). Exactly one step should be in_progress while you work. Skip it for tasks of one or two steps.',
  parameters: {
    type: 'object',
    properties: { steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', description: 'Short step, in the user\'s language' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['title', 'status'] } } },
    required: ['steps'],
  },
  summarize: (a) => `${(a.steps || []).filter((s) => s.status === 'done').length}/${(a.steps || []).length}`,
  async run(a, ctx) {
    const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 30)
      .map((s) => ({ title: String((s && s.title) || '').slice(0, 160), status: STATUSES.has(s && s.status) ? s.status : 'pending' }))
      .filter((s) => s.title);
    ctx.emit({ type: 'plan', steps, sub: ctx.subOf || undefined });
    const done = steps.filter((s) => s.status === 'done').length;
    return { content: `Plan updated (${done}/${steps.length} done). Keep working.`, view: { kind: 'plan', steps } };
  },
});

agent.register({
  name: 'run_subagent', category: 'plan', risk: 'read', categoryCore: true, topLevelOnly: true,
  description: 'Delegate a self-contained piece of work to a sub-agent that has the same tools as you (files, terminal, browser, documents…) and its own fresh context. Use it for independent subtasks — research a topic, explore a folder, draft one document, check one site — especially several in parallel (call it several times in the same turn). The sub-agent does not see this conversation: put every detail it needs in `task`. It returns its final report to you; the user does not see it unless you relay it.',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '3-6 word label shown to the user' },
      task: { type: 'string', description: 'Complete, standalone instructions and what to report back' },
    },
    required: ['description', 'task'],
  },
  summarize: (a) => a.description || '',
  async run(a, ctx) {
    if (!ctx.spawnSub) throw new Error('Sub-agents are not available here');
    const r = await ctx.spawnSub({ description: String(a.description || '').slice(0, 80), task: String(a.task || '') });
    return { content: r.text || '(The sub-agent returned nothing.)', view: { kind: 'subagent', report: (r.text || '').slice(0, 6000), steps: r.steps, tokens: r.tokens, error: r.error } };
  },
});

module.exports = {};
