// Fabro app: Agents — a team of AI agents with roles that chat with you and with each other.
// Main-process orchestration: agent turns (via the chat engine + tools), group conversations where
// agents reply and can address each other, a watchdog that relaunches an agent that stopped too early,
// agents that plan messages for later, a 30-min background reflection where one agent may proactively
// propose something, and system prompts that improve themselves per role.
module.exports = { activate };

function activate(fabro) {
  const ai = fabro.core('chat');       // the chat engine: ai.send (streamed, tools) and ai.quick (one-shot)
  const store = fabro.store;
  const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Date.now();
  const clamp = (s, n) => String(s ?? '').slice(0, n);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ───────── state ─────────
  let state = fabro.readJSON('state.json', null) || { agents: [], chats: [], scheduled: [], v: 1 };
  const save = () => fabro.writeJSON('state.json', state);
  const agent = (id) => state.agents.find((a) => a.id === id);
  const chatOf = (id) => state.chats.find((c) => c.id === id);
  const agentByName = (name) => state.agents.find((a) => a.name.toLowerCase() === String(name || '').toLowerCase().trim());
  const defaultModel = () => store.getSettings().selectedModel;

  function publicState() {
    return {
      agents: state.agents.map(({ learned, ...a }) => ({ ...a, learnedCount: (learned || []).length })),
      chats: state.chats.map((c) => ({ id: c.id, type: c.type, title: c.title, members: c.members, emoji: c.emoji, updatedAt: c.updatedAt, last: (c.messages[c.messages.length - 1] || {}).text || '' })),
    };
  }
  const emitState = () => fabro.emit('state', publicState());
  function post(chat, msg) {
    const m = { id: uid('m'), ts: now(), ...msg };
    chat.messages.push(m); chat.updatedAt = m.ts;
    if (chat.messages.length > 400) chat.messages = chat.messages.slice(-400);
    save(); fabro.emit('msg', { chatId: chat.id, message: m });
    return m;
  }

  // ───────── prompts ─────────
  const STYLE = [
    'You chat like a real person in a messaging app (think WhatsApp): short, natural, warm, to the point. No corporate tone.',
    'NEVER write your reasoning, plans, or step-by-step thinking. Do not narrate what you are about to do.',
    "For anything that takes more than a few seconds, reply briefly that you're on it (e.g. \"ok je m'y mets, je te préviens quand c'est bon\"), then actually do it with your tools, and send the result when it's done.",
    "Don't ask permission to start. Decide reasonably. Keep messages concise.",
    'You can talk to teammates by addressing them with @Name in a group. If you disagree with someone, say so plainly.',
  ].join('\n');

  function systemFor(a, chat) {
    const mates = (chat && chat.type === 'group') ? state.agents.filter((x) => chat.members.includes(x.id) && x.id !== a.id) : [];
    const roster = mates.length ? `\n\nYour teammates here: ${mates.map((t) => `@${t.name} (${t.role})`).join(', ')}. Address them with @Name to ask for help or to push back.` : '';
    const learned = (a.learned || []).length ? `\n\nWhat you've learned to do well in your role:\n- ${(a.learned || []).join('\n- ')}` : '';
    return `You are ${a.name}, an AI agent on ${store.getSettings().userName || 'the user'}'s team. Your role: ${a.role}.\n${a.prompt || ''}\n\n${STYLE}${roster}${learned}`;
  }
  function historyFor(a, chat, extra) {
    const msgs = [{ role: 'system', content: systemFor(a, chat) }];
    for (const m of chat.messages.slice(-24)) {
      if (m.from === a.id) msgs.push({ role: 'assistant', content: m.text });
      else {
        const who = m.from === 'user' ? (store.getSettings().userName || 'User') : (agent(m.from) ? agent(m.from).name : 'Someone');
        msgs.push({ role: 'user', content: `${who}: ${m.text}` });
      }
    }
    if (extra) msgs.push({ role: 'user', content: extra });
    return msgs;
  }
  const stripReasoning = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*(?:thinking|reasoning|plan)\s*[:\-].*$/gim, '').trim();

  // ───────── one agent turn (streamed, with tools) ─────────
  const typing = new Set();
  const setTyping = (chatId, agentId, on) => { const k = chatId + ':' + agentId; on ? typing.add(k) : typing.delete(k); fabro.emit('typing', { chatId, agentId, on }); };

  async function runTurn(chat, a, { extra, advice } = {}) {
    const reqId = uid('turn');
    setTyping(chat.id, a.id, true);
    let text = '';
    const note = [extra, advice && `(Note from your supervisor: ${advice})`].filter(Boolean).join('\n\n') || undefined;
    try {
      await new Promise((resolve) => {
        ai.send({
          reqId, model: a.model || defaultModel(), messages: historyFor(a, chat, note),
          // agentMode replaces the system message with Fabro's agent prompt, so the persona has to
          // ride along as agentPrompt (its "base"), or the agent would just answer as generic Fabro.
          params: { temperature: 0.7, reasoning: 'off', agentMode: true, agent: true, agentPrompt: systemFor(a, chat), tools: ['webSearch', 'fetch'] },
          meta: { convId: 'agents:' + chat.id, turnId: reqId, agentsApp: true },
        }, (ev) => { if (ev.type === 'token') text += ev.text; else if (ev.type === 'done' || ev.type === 'error') resolve(); });
      });
    } catch (e) { fabro.log('turn', e.message); }
    setTyping(chat.id, a.id, false);
    text = stripReasoning(text);
    if (!text) return null;
    const m = post(chat, { from: a.id, text });
    maybeLearn(a, chat).catch(() => {});
    return m;
  }

  // ───────── watchdog ─────────
  async function watchdog(chat, a, lastText, task) {
    try {
      const v = String(await ai.quick(a.model || defaultModel(), [
        { role: 'system', content: 'You supervise an AI agent. Given the task and what it just replied, decide if the task is actually finished or if the agent stopped too early (said it would do something but did not, or left it incomplete). Reply EXACTLY "DONE" if finished, otherwise ONE short sentence of advice telling it what to do next. Nothing else.' },
        { role: 'user', content: `Request:\n${clamp(task, 1200)}\n\nAgent replied:\n${clamp(lastText, 1200)}` },
      ], { maxTokens: 80, temperature: 0 })).trim();
      return (/^done\b/i.test(v) || v.length < 3) ? null : v.slice(0, 300);
    } catch { return null; }
  }

  // ───────── orchestration ─────────
  const busy = new Set();
  const pending = new Map(); // a message the user sent while the chat was still mid-exchange → run it next
  const mentions = (text) => [...String(text || '').matchAll(/@([\p{L}0-9_-]{2,})/gu)].map((m) => m[1]);
  const shuffle = (x) => { x = x.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

  async function orchestrate(chat, lastUserText) {
    if (busy.has(chat.id)) return; busy.add(chat.id);
    try {
      let order = chat.members.map(agent).filter(Boolean);
      const firstM = mentions(lastUserText).map(agentByName).filter(Boolean).filter((a) => chat.members.includes(a.id));
      if (firstM.length) order = [...firstM, ...order.filter((a) => !firstM.includes(a))];
      else if (chat.type === 'group') order = shuffle(order);

      let turns = 0; const MAX = chat.type === 'group' ? 8 : 3;
      const queue = order.map((a) => ({ a }));
      while (queue.length && turns < MAX) {
        const { a } = queue.shift(); turns++;
        const m = await runTurn(chat, a, {});
        if (!m) continue;
        const advice = await watchdog(chat, a, m.text, lastUserText);
        if (advice && turns < MAX) { turns++; const m2 = await runTurn(chat, a, { advice }); if (m2) m.text = m2.text; }
        if (chat.type === 'group') {
          for (const t of mentions(m.text).map(agentByName).filter(Boolean)) {
            if (turns < MAX && chat.members.includes(t.id) && t.id !== a.id && !queue.find((q) => q.a.id === t.id)) queue.push({ a: t });
          }
        }
        await sleep(300);
      }
    } finally {
      busy.delete(chat.id);
      if (pending.has(chat.id)) { const nx = pending.get(chat.id); pending.delete(chat.id); orchestrate(chat, nx).catch((e) => fabro.log('orchestrate', e.message)); }
    }
  }

  // ───────── self-improvement ─────────
  const learnCount = new Map();
  async function maybeLearn(a, chat) {
    const n = (learnCount.get(a.id) || 0) + 1; learnCount.set(a.id, n);
    if (n % 6 !== 0) return;
    try {
      const note = String(await ai.quick(a.model || defaultModel(), [
        { role: 'system', content: `You help an AI agent get better at its role ("${a.role}"). From its recent chat, write ONE short concrete rule it should follow next time (a user preference, a recurring need, a mistake to avoid). One line, imperative. If nothing useful, reply "-".` },
        { role: 'user', content: chat.messages.slice(-12).map((m) => `${m.from === a.id ? a.name : (m.from === 'user' ? 'User' : (agent(m.from) || {}).name || '?')}: ${m.text}`).join('\n').slice(0, 2000) },
      ], { maxTokens: 60, temperature: 0.3 })).trim().replace(/^[-*]\s*/, '');
      if (note && note !== '-' && note.length > 6) { a.learned = [...new Set([...(a.learned || []), note])].slice(-8); save(); emitState(); }
    } catch {}
  }

  // ───────── background reflection ─────────
  async function reflect() {
    if (!state.agents.length) return null;
    const a = state.agents[Math.floor(Math.random() * state.agents.length)];
    const chat = [...state.chats].filter((c) => c.members.includes(a.id)).sort((x, y) => y.updatedAt - x.updatedAt)[0];
    if (!chat) return null;
    try {
      const out = stripReasoning(await ai.quick(a.model || defaultModel(), [
        { role: 'system', content: `You are ${a.name} (${a.role}). Look at your recent conversation. Is there something genuinely useful you could proactively PROPOSE to the person now (an improvement, a shortcut, setting up something they often ask for, a reminder)? Only if it's clearly worth interrupting them, write the short message you'd send, as yourself, naturally. Otherwise reply EXACTLY "NOTHING".` },
        { role: 'user', content: chat.messages.slice(-14).map((m) => `${m.from === a.id ? 'me' : (m.from === 'user' ? 'them' : (agent(m.from) || {}).name)}: ${m.text}`).join('\n').slice(0, 2000) },
      ], { maxTokens: 160, temperature: 0.6 }));
      if (out && !/^nothing\b/i.test(out) && out.length > 4) { post(chat, { from: a.id, text: out, proactive: true }); fabro.emit('nudge', { chatId: chat.id, agentId: a.id }); return out; }
    } catch {}
    return null;
  }

  // ───────── scheduled messages ─────────
  function tickSchedule() {
    const due = state.scheduled.filter((s) => s.at <= now());
    if (!due.length) return;
    state.scheduled = state.scheduled.filter((s) => s.at > now());
    for (const s of due) { const c = chatOf(s.chatId); const a = agent(s.agentId); if (c && a) post(c, { from: a.id, text: s.text }); }
    save();
  }

  // ───────── handlers ─────────
  fabro.handle('state', () => publicState());
  fabro.handle('messages', (id) => (chatOf(id) ? chatOf(id).messages : []));
  fabro.handle('getAgent', (id) => agent(id) || null);
  fabro.handle('createAgent', (d) => { const a = { id: uid('a'), name: clamp(d.name, 40) || 'Agent', role: clamp(d.role, 200) || 'Assistant', prompt: clamp(d.prompt, 4000), emoji: d.emoji || '🤖', color: d.color || '#6a7bff', model: d.model || null, learned: [], createdAt: now() }; state.agents.push(a); save(); emitState(); return a; });
  fabro.handle('updateAgent', (id, patch) => { const a = agent(id); if (!a) return null; Object.assign(a, { name: clamp(patch.name ?? a.name, 40), role: clamp(patch.role ?? a.role, 200), prompt: clamp(patch.prompt ?? a.prompt, 4000), emoji: patch.emoji ?? a.emoji, color: patch.color ?? a.color, model: patch.model === undefined ? a.model : patch.model }); save(); emitState(); return a; });
  fabro.handle('deleteAgent', (id) => { state.agents = state.agents.filter((a) => a.id !== id); state.chats = state.chats.filter((c) => { c.members = c.members.filter((m) => m !== id); return c.members.length; }); save(); emitState(); return publicState(); });
  fabro.handle('createChat', (d) => { const members = (d.members || []).filter(agent); if (!members.length) throw new Error('Pick at least one agent'); const type = members.length > 1 ? 'group' : 'dm'; const title = clamp(d.title, 60) || (type === 'dm' ? agent(members[0]).name : members.map((m) => agent(m).name).join(', ')); const c = { id: uid('c'), type, members, title, emoji: d.emoji || (type === 'group' ? '👥' : agent(members[0]).emoji), messages: [], createdAt: now(), updatedAt: now() }; state.chats.push(c); save(); emitState(); return { id: c.id }; });
  fabro.handle('deleteChat', (id) => { state.chats = state.chats.filter((c) => c.id !== id); save(); emitState(); return publicState(); });
  fabro.handle('send', async (id, text) => { const c = chatOf(id); if (!c || !String(text || '').trim()) return false; post(c, { from: 'user', text: clamp(text, 8000) }); if (busy.has(c.id)) pending.set(c.id, text); else orchestrate(c, text).catch((e) => fabro.log('orchestrate', e.message)); return true; });
  fabro.handle('idle', () => busy.size === 0 && pending.size === 0); // test/UX hook: no agent turn in flight
  fabro.handle('schedule', (chatId, agentId, inMinutes, text) => { state.scheduled.push({ id: uid('s'), chatId, agentId, at: now() + Math.max(0, inMinutes) * 60000, text: clamp(text, 2000) }); save(); return true; });
  fabro.handle('reflectNow', () => reflect()); // test hook for the background thinker

  const iv1 = setInterval(() => reflect().catch(() => {}), 30 * 60 * 1000);
  const iv2 = setInterval(tickSchedule, 20 * 1000);
  fabro.onCleanup(() => { clearInterval(iv1); clearInterval(iv2); });
  fabro.log('agents app ready:', state.agents.length, 'agents,', state.chats.length, 'chats');
}
