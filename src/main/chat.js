// Streams a chat completion from the active backend:
//  - 'local'    → Fabro's built-in llama.cpp engine (OpenAI-compatible SSE)
//  - 'provider' → an external provider (OpenAI-compatible or Anthropic Messages API)
const store = require('./store');
const engine = require('./engine');
const models = require('./models');
const providers = require('./providers');
const usage = require('./usage');
const tools = require('./tools');
const agent = require('./agent');
const skills = require('./agent/skills');
const code = require('./code');
const prompts = require('./prompts');

// ───────────────────────────── permissions & dependencies (asked in the UI) ─────────────────────────────
const waiting = new Map(); // `${reqId}:${callId}` → resolve
const convGrants = new Map(); // conversation → folders allowed "once" (kept for this app session)
function ask(reqId, callId, req, out, signal) {
  return new Promise((resolve) => {
    const key = `${reqId}:${callId}`;
    waiting.set(key, resolve);
    signal.addEventListener('abort', () => { if (waiting.delete(key)) resolve('deny'); });
    out({ type: 'permission', id: callId, ...req });
  });
}
function needDeps(reqId, callId, dep, out, signal) {
  return new Promise((resolve) => {
    const key = `${reqId}:${callId}`;
    waiting.set(key, resolve);
    signal.addEventListener('abort', () => { if (waiting.delete(key)) resolve(false); });
    out({ type: 'deps_needed', id: callId, dep });
  });
}
function answer(reqId, callId, value) { const k = `${reqId}:${callId}`; const r = waiting.get(k); if (r) { waiting.delete(k); r(value); } return !!r; }

const SUB_NOTE = `\n\nYou are a sub-agent working for the main Fabro agent, not talking to the user. Do the task you were given with your tools, without asking questions (decide reasonably and note assumptions). Finish with a concise, complete report of what you found or did — files you created (full paths), key facts with sources, anything left undone. That report is all the main agent will see.`;
// Code mode: permissions per project — "ask before acting", "accept edits" (default) or "auto".
function codePolicy(tool, base, c) {
  const ps = code.projectSettings(c.root);
  if ((ps.allow || []).includes(tool.name)) return 'always';
  if (base === 'never') return 'never';
  const mode = c.mode || ps.mode || 'edits';
  if (tool.risk === 'read') return 'always';
  if (mode === 'ask') return 'ask';
  if (mode === 'auto') return ['write', 'exec', 'net'].includes(tool.risk) ? 'always' : base;
  if (tool.category === 'files' && tool.risk === 'write') return 'always';
  if (tool.category === 'plan') return 'always';
  return tool.risk === 'net' ? base : 'ask';
}
function codeSection(c) {
  const ins = code.instructions(c.root);
  const cmd = code.detect(c.root);
  return [
    `# Code session\nProject folder: ${c.root}\nRelative paths are inside it and commands run there by default. Work like a careful senior engineer: read the relevant files before changing them, prefer edit_file for small changes, keep the existing style, then run the tests/linter and fix what you broke. Summarize what changed at the end (files and why).`,
    Object.values(cmd).some((v) => v && v !== 'unknown') ? `Project commands (${cmd.kind}): ${['test', 'lint', 'build', 'run'].filter((k) => cmd[k]).map((k) => `${k}: \`${cmd[k]}\``).join(' · ')}` : '',
    c.branch ? `Git branch: ${c.branch}. Commit only when the user asks (git_commit).` : 'Not a git repository.',
    ins ? `# Project instructions (${ins.file}) — follow them\n${ins.text}` : '',
  ].filter(Boolean).join('\n\n');
}

const active = new Map();
const injected = new Map(); // reqId → precisions typed by the user while the answer is being generated
function inject(reqId, text) { if (!active.has(reqId) || !text) return false; const q = injected.get(reqId) || []; q.push(String(text)); injected.set(reqId, q); return true; }
const takeInjected = (reqId, out) => {
  const q = injected.get(reqId); if (!q || !q.length) return null; injected.delete(reqId);
  out({ type: 'precision_used', count: q.length });
  return { role: 'user', content: `[Précision ajoutée par l'utilisateur pendant ta réponse — prends-la en compte pour la suite, sans recommencer ce qui est déjà fait ni t'interrompre]\n${q.join('\n')}` };
};

async function resolveBackend(ref, emit) {
  const s = store.getSettings();
  if (!ref) throw Object.assign(new Error('NO_MODEL'), { code: 'NO_MODEL' });
  if (ref.backend === 'provider') return { ...providers.target(ref), kind: 'provider' };
  if (ref.backend === 'ollama') throw Object.assign(new Error('NO_MODEL'), { code: 'NO_MODEL' }); // pre-0.1.5 ref, migrated at boot
  const m = await models.getLocal(ref.id);
  if (!m) throw Object.assign(new Error('NO_MODEL'), { code: 'NO_MODEL' });
  emit({ type: 'status', status: 'loading' });
  const inst = await engine.ensure(m);
  const prof = (s.modelProfiles || {})[m.id] || {};
  return { kind: 'local', protocol: 'openai', base: `http://127.0.0.1:${inst.port}/v1`, headers: { 'Content-Type': 'application/json' }, model: m.name, inst, gen: prof.gen || null };
}

// SSE line reader shared by both protocols.
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', event = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      onData(j, event);
    }
  }
}

// ───────────────────────────── OpenAI-compatible ─────────────────────────────
const REASONING_KINDS = ['openai', 'xai', 'openrouter', 'groq', 'deepseek', 'custom', 'lmstudio', 'ollama'];

// One streamed completion. Returns { content, toolCalls }.
async function completeOpenAI(be, messages, params, signal, acc, tools) {
  const body = { model: be.model, messages, stream: true, stream_options: { include_usage: true } };
  const cloudOpenAI = be.kind === 'provider' && be.provider.kind === 'openai';
  if (!cloudOpenAI) { if (params.temperature != null) body.temperature = params.temperature; if (params.topP != null) body.top_p = params.topP; }
  if (params.maxTokens > 0) body[cloudOpenAI ? 'max_completion_tokens' : 'max_tokens'] = params.maxTokens;
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const r = params.reasoning;
  if (be.kind === 'local') {
    body.cache_prompt = true;
    if (r) body.chat_template_kwargs = { enable_thinking: r !== 'off', reasoning_effort: r === 'off' ? 'low' : r };
  } else if (r && REASONING_KINDS.includes(be.provider.kind)) {
    if (r === 'off') { if (be.provider.kind === 'ollama') body.think = false; else if (cloudOpenAI) body.reasoning_effort = 'minimal'; }
    else if (['openai', 'xai', 'openrouter', 'groq'].includes(be.provider.kind)) body.reasoning_effort = r;
    else if (be.provider.kind === 'ollama') body.think = true;
  }
  const post = () => fetch(`${be.base}/chat/completions`, { method: 'POST', headers: be.headers, body: JSON.stringify(body), signal });
  let res;
  try { res = await post(); } catch (e) { if (signal.aborted) throw e; throw be.netErr ? be.netErr(e) : e; }
  // Servers that reject an optional field: retry once without it.
  for (let i = 0; i < 3 && !res.ok && res.status === 400; i++) {
    const txt = await res.text();
    let changed = false;
    if (/stream_options/i.test(txt) && body.stream_options) { delete body.stream_options; changed = true; }
    else if (/tool/i.test(txt) && body.tools) {
      // No native tool calling: describe the tools in the prompt and parse <tool_call> blocks instead.
      body.messages = withToolPrompt(body.messages, body.tools); delete body.tools; delete body.tool_choice; acc.noTools = true; acc.fallback = true; changed = true;
    }
    else if (/reasoning|think|chat_template_kwargs/i.test(txt) && (body.reasoning_effort || body.think !== undefined || body.chat_template_kwargs)) { delete body.reasoning_effort; delete body.think; delete body.chat_template_kwargs; changed = true; }
    if (!changed) throw be.httpErr ? await be.httpErr(new Response(txt, { status: 400 })) : new Error(txt.slice(0, 300));
    res = await post();
  }
  if (!res.ok) throw be.httpErr ? await be.httpErr(res) : new Error(`HTTP ${res.status}`);
  let content = '';
  const calls = [];
  await readSSE(res, (j) => {
    if (j.usage) acc.addUsage(j.usage.prompt_tokens, j.usage.completion_tokens);
    if (j.timings) acc.timings = j.timings;
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    const d = j.choices && j.choices[0] && j.choices[0].delta;
    if (!d) return;
    const rr = d.reasoning_content || d.reasoning;
    if (rr) acc.push('reasoning', rr);
    if (d.content) { content += d.content; acc.push('token', d.content); }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? calls.length;
      const c = (calls[i] ||= { id: '', name: '', args: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function && tc.function.name) c.name += tc.function.name;
      if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
    }
  });
  let toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${i}` }));
  // Thinking that leaked into the answer (<think>…</think> with reasoning off, or a stray </think>).
  if (/<\/think>/.test(content)) {
    const i = content.lastIndexOf('</think>');
    const thought = content.slice(0, i).replace(/<think>/g, '').trim();
    acc.push('retract', content.slice(0, i + 8));
    if (thought) acc.push('reasoning', thought);
    content = content.slice(i + 8).replace(/^\s+/, '');
  }
  // No native call but a call written as text (any common format): run it anyway.
  if (!toolCalls.length && content) {
    const known = (tools || []).map((x) => x.function.name);
    if (known.length && known.some((n) => content.includes(n))) {
      const parsed = parseToolCalls(content, known);
      if (parsed.calls.length) { for (const raw of parsed.raws) acc.push('retract', raw); content = parsed.rest; toolCalls = parsed.calls; acc.textCalls = (acc.textCalls || 0) + 1; }
    }
  }
  return { content, toolCalls };
}

// Fallback for models without native tools (Hermes-style <tool_call> JSON).
function withToolPrompt(messages, tools) {
  const spec = tools.map((t) => `- ${t.function.name}: ${t.function.description.slice(0, 300)}\n  arguments: ${JSON.stringify(t.function.parameters.properties || {}).slice(0, 600)}`).join('\n');
  const add = `\n\nYou can call tools. To call one, reply with ONLY this block (nothing else) and wait for the result:\n<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>\nTools:\n${spec}`;
  const out = messages.map((m) => ({ ...m }));
  const sys = out.find((m) => m.role === 'system');
  if (sys) sys.content = String(sys.content) + add; else out.unshift({ role: 'system', content: add.trim() });
  return out.map((m) => m.role === 'tool' ? { role: 'user', content: `Tool result:\n${m.content}` } : m.tool_calls ? { role: 'assistant', content: (m.content || '') + m.tool_calls.map((c) => `\n<tool_call>{"name":"${c.function.name}","arguments":${c.function.arguments}}</tool_call>`).join('') } : m);
}
// Tool calls written as text. Many models (especially local ones) emit them in their own format instead of
// the native field — or when native calling is off. We accept the common formats, only for known tools:
//   <tool_call>{json}</tool_call> (Hermes/Qwen) · <function=name>{json}|<parameter=k>v</parameter></function> (Qwen3-Coder)
//   [TOOL_CALLS][{…}] (Mistral) · <|python_tag|>{…} (Llama 3) · ```json {"name","arguments"} ``` · a bare JSON call.
function parseToolCalls(text, known = null) {
  const calls = []; const raws = [];
  const ok = (name) => name && (!known || known.includes(name));
  const push = (name, args, raw) => {
    if (!ok(name)) return false;
    calls.push({ id: `fb_${Date.now().toString(36)}_${calls.length}`, name, args: typeof args === 'string' ? args : JSON.stringify(args || {}) });
    raws.push(raw); return true;
  };
  const fromJson = (j, raw) => {
    if (Array.isArray(j)) { let any = false; for (const x of j) any = fromJson(x, raw) || any; return any; }
    if (!j || typeof j !== 'object') return false;
    const f = j.function && typeof j.function === 'object' ? j.function : j;
    let args = f.arguments ?? f.parameters ?? f.args ?? f.input ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep string */ } }
    return push(f.name || j.tool || j.tool_name, args, raw);
  };
  const tryJson = (str, raw) => { try { return fromJson(JSON.parse(str), raw); } catch { const fixed = String(str).trim().replace(/,\s*([}\]])/g, '$1'); try { return fromJson(JSON.parse(fixed), raw); } catch { return false; } } };
  let t = String(text || '');
  for (const m of t.matchAll(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g)) tryJson(m[1], m[0]);
  for (const m of t.matchAll(/<function=([\w.-]+)>\s*([\s\S]*?)\s*(?:<\/function>|$)/g)) {
    const body = m[2].trim();
    if (body.startsWith('{')) { try { push(m[1], JSON.parse(body), m[0]); continue; } catch {} }
    const params = {}; for (const p of body.matchAll(/<parameter=([\w.-]+)>\s*([\s\S]*?)\s*<\/parameter>/g)) { let v = p[2]; try { v = JSON.parse(v); } catch {} params[p[1]] = v; }
    push(m[1], params, m[0]);
  }
  for (const m of t.matchAll(/\[TOOL_CALLS\]\s*(\[[\s\S]*\]|\{[\s\S]*\})/g)) tryJson(m[1], m[0]);
  for (const m of t.matchAll(/<\|python_tag\|>\s*(\{[\s\S]*\})/g)) tryJson(m[1], m[0]);
  if (!calls.length) for (const m of t.matchAll(/```(?:json|tool_call|tool|function)?\s*\n?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/g)) {
    if (/"name"\s*:/.test(m[1]) && /"(arguments|parameters|args|input)"\s*:/.test(m[1])) tryJson(m[1], m[0]);
  }
  if (!calls.length) { const b = t.trim(); if (/^\{[\s\S]*\}$/.test(b) && /"name"\s*:/.test(b) && /"(arguments|parameters)"\s*:/.test(b)) tryJson(b, t); }
  let rest = t; for (const r of raws) rest = rest.replace(r, '');
  return { calls, raw: raws.join(''), raws, rest: rest.replace(/<\/?tool_call>/g, '').trim() };
}

// ───────────────────────────── Anthropic Messages API ─────────────────────────────
function toAnthropic(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const conv = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    let content = m.content;
    if (m.role === 'tool') { // OpenAI tool result → Anthropic tool_result block in a user turn
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || '') };
      const last = conv[conv.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((c) => c.type === 'tool_result')) last.content.push(block);
      else conv.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) { let input = {}; try { input = JSON.parse(tc.function.arguments || '{}'); } catch {} blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input }); }
      conv.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (Array.isArray(content)) {
      content = content.map((c) => {
        if (c.type === 'text') return { type: 'text', text: c.text };
        const url = c.image_url && c.image_url.url || '';
        const mm = /^data:([^;]+);base64,(.*)$/.exec(url);
        return mm ? { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } } : { type: 'text', text: url };
      });
    }
    const last = conv[conv.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string' && typeof content === 'string') last.content += '\n\n' + content;
    else if (last && last.role === m.role) { // roles must alternate: merge as content blocks
      const toBlocks = (c) => (Array.isArray(c) ? c : [{ type: 'text', text: String(c || ' ') }]);
      last.content = [...toBlocks(last.content), ...toBlocks(content)];
    } else conv.push({ role: m.role, content: content || ' ' });
  }
  return { system, messages: conv };
}

async function completeAnthropic(be, messages, params, signal, acc, tools) {
  const { system, messages: conv } = toAnthropic(messages);
  const body = { model: be.model, max_tokens: params.maxTokens > 0 ? params.maxTokens : 8192, system: system || undefined, messages: conv, stream: true };
  if (tools && tools.length) body.tools = tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  if (params.reasoning && params.reasoning !== 'off') {
    const budget = { low: 2048, medium: 8192, high: 24576 }[params.reasoning] || 4096;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max(body.max_tokens, budget + 4096);
  } else if (params.temperature != null) body.temperature = Math.min(1, params.temperature);
  let res;
  try { res = await fetch(`${be.base}/messages`, { method: 'POST', headers: be.headers, body: JSON.stringify(body), signal }); }
  catch (e) { if (signal.aborted) throw e; throw be.netErr(e); }
  if (!res.ok) throw await be.httpErr(res);
  let content = '';
  const blocks = {};
  await readSSE(res, (j) => {
    if (j.type === 'message_start' && j.message?.usage) acc.addUsage(j.message.usage.input_tokens, 0);
    if (j.type === 'message_delta' && j.usage) acc.addUsage(0, j.usage.output_tokens);
    if (j.type === 'error') throw new Error(j.error?.message || 'Anthropic error');
    if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') blocks[j.index] = { id: j.content_block.id, name: j.content_block.name, args: '' };
    if (j.type !== 'content_block_delta') return;
    if (j.delta.type === 'text_delta') { content += j.delta.text; acc.push('token', j.delta.text); }
    if (j.delta.type === 'thinking_delta') acc.push('reasoning', j.delta.thinking);
    if (j.delta.type === 'input_json_delta' && blocks[j.index]) blocks[j.index].args += j.delta.partial_json;
  });
  return { content, toolCalls: Object.values(blocks) };
}

// ───────────────────────────── context budget ─────────────────────────────
// Long agent runs overflow small context windows: shorten old tool results first, then drop the oldest
// exchanges (the system prompt, the first request and the recent steps are always kept).
const estTok = (x) => Math.ceil((typeof x === 'string' ? x : JSON.stringify(x || '')).length / 3.3);
function compact(msgs, schemas, be, ratio = 0.72) {
  const ctx = (be.inst && be.inst.plan && be.inst.plan.ctx) || (be.kind === 'local' ? 8192 : 120000);
  const budget = Math.floor(ctx * ratio) - estTok(schemas);
  const total = () => msgs.reduce((n, m) => n + estTok(m.content) + (m.tool_calls ? estTok(m.tool_calls) : 0) + 4, 0);
  if (total() <= budget) return false;
  const toolIdx = msgs.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, -3)) {
    const c = String(msgs[i].content || '');
    if (c.length > 700) msgs[i].content = c.slice(0, 500) + `\n… [${c.length - 500} characters removed to save memory — call the tool again if you need them]`;
    if (total() <= budget) return true;
  }
  const firstUser = msgs.findIndex((m) => m.role === 'user');
  while (total() > budget) {
    // drop the oldest assistant(+its tool results) block after the first user message
    const i = msgs.findIndex((m, k) => k > firstUser && m.role === 'assistant');
    if (i < 0 || i >= msgs.length - 4) break;
    let j = i + 1; while (j < msgs.length && msgs[j].role === 'tool') j++;
    msgs.splice(i, j - i, ...(msgs[i - 1] && msgs[i - 1].content === '[earlier steps removed]' ? [] : [{ role: 'user', content: '[earlier steps removed]' }]));
  }
  return true;
}

// ───────────────────────────── main entry ─────────────────────────────
async function send({ reqId, model, messages, params = {}, meta = {} }, emit, parent = null) {
  const ctrl = new AbortController();
  active.set(reqId, ctrl);
  if (parent) parent.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  const out = (ev) => emit({ reqId, ...ev });
  const t0 = Date.now();
  let tFirst = null, chars = 0;
  const acc = {
    usage: { prompt: 0, completion: 0, has: false }, timings: null, noTools: false,
    addUsage(p, c) { this.usage.prompt = Math.max(this.usage.prompt, p || 0); this.usage.completion += c || 0; this.usage.has = true; },
    push(type, text) { tFirst = tFirst || Date.now(); if (type === 'token') chars += text.length; out({ type, text }); },
  };
  let be = null;
  const cpFiles = {};
  let cpDone = false;
  const flushCp = () => {
    if (cpDone || parent || !(meta.code && meta.code.root) || !Object.keys(cpFiles).length) return;
    cpDone = true;
    try { const id = code.recordTurn(meta.convId || reqId, meta.turnId || reqId, meta.code.root, cpFiles); out({ type: 'checkpoint', id, files: Object.keys(cpFiles) }); } catch {}
  };
  try {
    be = await resolveBackend(model, out);
    if (be.gen) params = { ...params, ...Object.fromEntries(Object.entries(be.gen).filter(([, v]) => v !== null && v !== '' && v !== undefined)) };
    if (be.inst) engine.acquire(be.inst);
    out({ type: 'status', status: 'generating', backend: be.kind === 'local' ? 'local' : be.provider.kind });
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const txt = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || '').join(' '));
    const userText = lastUser ? txt(lastUser) : '';
    // tools are picked from the last few turns, so "use the browser" after "go to Discord" brings the browser
    const recentText = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-6).map(txt).join(' ').slice(-4000);
    let agentMode = !!params.agentMode;
    const codeCtx = meta.code && meta.code.root ? meta.code : null;
    if (codeCtx) agentMode = true;
    const buildTools = () => {
      const chatT = tools.schemas(params.tools || []);
      const agentT = params.agent === false ? [] : agent.select({ agentMode, text: recentText, used: params.usedTools || [], sub: !!parent, code: !!codeCtx }).map(agent.schema);
      return [...chatT, ...agentT];
    };
    let toolSchemas = buildTools();
    out({ type: 'tools_info', count: toolSchemas.length, tokens: agent.estTokens(toolSchemas) });
    const msgs = messages.slice();
    // Projects: instructions + files (whole when small, else the best passages for this question).
    if (meta.project && !parent) {
      try {
        const ctx = await require('./rag').context(meta.project, userText);
        if (ctx) {
          const p = ctx.project;
          const sec = [`# Project: ${p.name}`, p.description ? p.description : '', p.instructions ? `## Project instructions (follow them)\n${p.instructions}` : '',
            p.files.length ? `## Project files (${p.files.length}): ${p.files.map((f) => f.name).join(', ')}\n${ctx.full ? 'Full content below.' : 'Most relevant excerpts for this message below; use project_search to look for anything else in these files.'}\n${ctx.files}\nCite file names when you use them.` : ''].filter(Boolean).join('\n\n');
          const sys = msgs.find((m) => m.role === 'system');
          if (sys) sys.content = `${sys.content}\n\n${sec}`; else msgs.unshift({ role: 'system', content: sec });
          if (!ctx.full && p.files.length) { params = { ...params, tools: [...new Set([...(params.tools || []), 'project_search'])] }; toolSchemas = buildTools(); }
          out({ type: 'project_ctx', files: p.files.length, full: ctx.full });
        }
      } catch {}
    }
    const setSystem = (text) => { const sys = msgs.find((m) => m.role === 'system'); const keep = sys && (sys.content.match(/\n\n# Project: [\s\S]*$/) || [''])[0]; if (sys) sys.content = text + keep; else msgs.unshift({ role: 'system', content: text }); };
    // Dynamic agent prompt: the exact tools sent this turn, a strict work loop, honesty + recovery rules.
    const folders = ((store.getSettings().agent || {}).folders || []);
    const sysAgent = () => prompts.agentPrompt({ base: params.agentPrompt || '', schemas: toolSchemas, codeSection: codeCtx ? codeSection(codeCtx) : '', folders, skillsSection: skills.promptSection(), sub: !!parent, fallback: !!acc.fallback, defaultOut: require('./agent/files').defaultOut() }) + (params.voiceMode && !parent ? '\n\n' + prompts.VOICE : '') + (parent ? SUB_NOTE : '');
    const toolSig = () => toolSchemas.map((x) => x.function.name).join(',');
    let promptSig = '';
    const applyAgentPrompt = () => { setSystem(sysAgent()); promptSig = toolSig(); };
    if (parent || agentMode) applyAgentPrompt();
    else if (toolSchemas.length) { const sys = msgs.find((m) => m.role === 'system'); const sec = prompts.chatToolsSection(toolSchemas) + (params.voiceMode ? '\n\n' + prompts.VOICE : ''); if (sys) sys.content = sys.content.replace(/(\n\n# Project: [\s\S]*)?$/, (tail) => `\n\n${sec}${tail || ''}`); else msgs.unshift({ role: 'system', content: sec }); }
    const complete = be.protocol === 'anthropic' ? completeAnthropic : completeOpenAI;
    const gkey = meta.convId || reqId;
    if (!convGrants.has(gkey)) convGrants.set(gkey, new Set());
    const src = { n: 0 };
    const ctxBase = { src, taskId: meta.taskId, unattended: !!meta.unattended, emit: out, convId: meta.convId, grants: convGrants.get(gkey), onAbort: (fn) => ctrl.signal.addEventListener('abort', fn), subOf: parent ? parent.callId : null };
    if (codeCtx) {
      ctxBase.projectRoot = codeCtx.root;
      ctxBase.checkpoint = parent && parent.checkpoint ? parent.checkpoint : (p, before) => { if (!(p in cpFiles)) cpFiles[p] = before; };
      ctxBase.policyFor = (tool, base) => codePolicy(tool, base, codeCtx);
      ctxBase.onAlways = async (name) => { const ps = code.projectSettings(codeCtx.root); await code.setProject(codeCtx.root, { allow: [...new Set([...(ps.allow || []), name])] }); };
    }
    let subN = 0;
    // A sub-agent: a nested run with a fresh context. Its steps are forwarded to the UI under the parent
    // call, its permission prompts go through this run (same reqId) so the user answers them in place.
    const spawnSub = (callId) => async ({ description, task }) => {
      const subId = `${reqId}/s${++subN}`;
      const steps = []; let text = ''; let err = null; let tokens = 0;
      const pid = (id) => `${callId}~${id}`;
      await send({ reqId: subId, model, messages: [{ role: 'system', content: '' }, { role: 'user', content: task }],
        params: { ...params, agentMode: true, usedTools: [], maxTokens: params.maxTokens }, meta: { ...meta, modelLabel: meta.modelLabel } },
        (ev) => {
          if (ev.type === 'token') { text += ev.text; out({ type: 'sub_token', parent: callId, text: ev.text }); }
          else if (ev.type === 'retract') text = text.replace(ev.text, '');
          else if (ev.type === 'tool_round') text = '';
          else if (['tool_start', 'tool_end', 'tool_progress'].includes(ev.type)) {
            if (ev.type === 'tool_start') steps.push(ev.name);
            const { reqId: _r, ...rest } = ev; out({ ...rest, id: pid(ev.id), parent: callId });
          } else if (ev.type === 'plan') out({ type: 'plan', steps: ev.steps, sub: callId });
          else if (ev.type === 'done') tokens = (ev.stats && ev.stats.completionTokens) || 0;
          else if (ev.type === 'error') err = ev.message;
        },
        { signal: ctrl.signal, callId, checkpoint: ctxBase.checkpoint, ask: (id, req) => ask(reqId, pid(id), req, out, ctrl.signal), needDeps: (id, dep) => needDeps(reqId, pid(id), dep, out, ctrl.signal), grants: convGrants.get(gkey), description });
      if (ctrl.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORTED' });
      return { text: text.trim() || (err ? `Sub-agent failed: ${err}` : ''), steps: steps.length, tokens, error: err };
    };
    const runAgentTool = (c, args) => {
      const ctx = parent
        ? { ...ctxBase, callId: c.id, ask: (req) => parent.ask(c.id, req), needDeps: (dep) => parent.needDeps(c.id, dep) }
        : { ...ctxBase, callId: c.id, ask: (req) => ask(reqId, c.id, req, out, ctrl.signal), needDeps: (dep) => needDeps(reqId, c.id, dep, out, ctrl.signal), spawnSub: spawnSub(c.id) };
      return agent.execute({ name: c.name, args }, ctx);
    };
    let steps = 0;
    const maxSteps = () => (parent ? 30 : agentMode ? 60 : 12);
    // Runtime guards: a model that gives up, claims work it didn't do, or stops mid-plan is sent back to work.
    const turnTools = []; let lastError = null; let lastPlan = null; let nudges = 0; const guardUsed = {}; const failCount = new Map();
    for (;;) {
      if (!parent) { const pm = takeInjected(reqId, out); if (pm) msgs.push(pm); }
      compact(msgs, toolSchemas, be);
      let r;
      try { r = await complete(be, msgs, params, ctrl.signal, acc, acc.noTools && !acc.fallback ? [] : toolSchemas); }
      catch (e) {
        // The local engine crashed or restarted mid-task (out of memory, update…): reload it and retry once.
        if (ctrl.signal.aborted || be.kind !== 'local' || !/fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(e.message) || acc.engineRetry) throw e;
        acc.engineRetry = true;
        out({ type: 'status', status: 'loading' });
        engine.release(be.inst);
        const m = await models.getLocal(model.id); const inst = await engine.ensure(m);
        be.inst = inst; be.base = `http://127.0.0.1:${inst.port}/v1`; engine.acquire(inst);
        compact(msgs, toolSchemas, be, 0.5);
        r = await complete(be, msgs, params, ctrl.signal, acc, acc.noTools && !acc.fallback ? [] : toolSchemas);
      }
      if (!r.toolCalls.length) {
        // The user added a precision while this answer was streaming: one more round so the model can address it.
        if (!parent && !ctrl.signal.aborted && (injected.get(reqId) || []).length && (acc.precisionRounds = (acc.precisionRounds || 0) + 1) <= 3) {
          if (r.content) msgs.push({ role: 'assistant', content: r.content });
          out({ type: 'precision_round' });
          continue;
        }
        const nudge = nudges < 3 && !ctrl.signal.aborted && !(acc.noTools && !acc.fallback) && steps < maxSteps()
          ? prompts.guard({ text: r.content, schemas: toolSchemas, turnTools, lastError, plan: lastPlan, used: guardUsed, agentMode, userText }) : null;
        if (!nudge) break;
        nudges++;
        if (r.content) { msgs.push({ role: 'assistant', content: r.content }); out({ type: 'retract', text: r.content }); }
        msgs.push({ role: 'user', content: nudge });
        out({ type: 'guard', text: nudge });
        continue;
      }
      if (steps >= maxSteps()) break;
      steps++;
      msgs.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
      // Sub-agent calls of the same turn run in parallel; everything else runs in order.
      const subCalls = r.toolCalls.filter((c) => c.name === 'run_subagent' && !parent);
      const pre = new Map();
      if (subCalls.length > 1) {
        if (!agentMode) { agentMode = true; out({ type: 'agent_switch', tool: 'run_subagent' }); applyAgentPrompt(); }
        await Promise.all(subCalls.map(async (c) => {
          let args = {}; try { args = JSON.parse(c.args || '{}'); } catch {}
          out({ type: 'tool_start', id: c.id, name: c.name, args, agent: true });
          try { const res = await runAgentTool(c, args); pre.set(c.id, res); turnTools.push({ name: c.name, ok: !res.refused }); out({ type: 'tool_end', id: c.id, name: c.name, view: res.view, refused: res.refused }); }
          catch (e) { if (ctrl.signal.aborted) throw e; pre.set(c.id, { content: `Error: ${e.message}` }); out({ type: 'tool_end', id: c.id, name: c.name, error: e.message, code: e.code }); }
        }));
      }
      for (const c of r.toolCalls) {
        if (pre.has(c.id)) { msgs.push({ role: 'tool', tool_call_id: c.id, content: pre.get(c.id).content }); continue; }
        let args = {}, badArgs = null; try { args = JSON.parse(c.args || '{}'); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be a JSON object'); } catch (e) { args = {}; badArgs = e.message; }
        // Calling any tool other than search / fetch / image switches the conversation to agent mode.
        if (!agentMode && agent.isAgentTool(c.name) && params.agent !== false) {
          agentMode = true;
          out({ type: 'agent_switch', tool: c.name });
          applyAgentPrompt();
        }
        out({ type: 'tool_start', id: c.id, name: c.name, args, agent: agent.isAgentTool(c.name) });
        let result;
        try {
          const known = toolSchemas.map((x) => x.function.name);
          if (!known.includes(c.name) && !agent.get(c.name) && !tools.CHAT_TOOLS[c.name]) throw Object.assign(new Error(`There is no tool named "${c.name}". Available tools: ${known.join(', ')}. Call one of these.`), { code: 'UNKNOWN_TOOL' });
          if (badArgs) { const sc = toolSchemas.find((x) => x.function.name === c.name); throw Object.assign(new Error(`Your arguments for ${c.name} were not valid JSON (${badArgs}). Call it again with a JSON object matching: ${JSON.stringify((sc && sc.function.parameters) || {}).slice(0, 800)}`), { code: 'BAD_ARGS' }); }
          if (tools.CHAT_TOOLS[c.name]) {
            if (!(params.tools || []).includes(c.name)) throw Object.assign(new Error(`Tool not available here: ${c.name}`), { code: 'UNKNOWN_TOOL' });
            result = await tools.run(c.name, args, { src, emit: out, callId: c.id, signal: ctrl.signal, project: meta.project, needDeps: parent ? (dep) => parent.needDeps(c.id, dep) : (dep) => needDeps(reqId, c.id, dep, out, ctrl.signal) });
          } else if (agent.get(c.name) && params.agent !== false) {
            result = await runAgentTool(c, args);
          } else throw Object.assign(new Error(`Tool not available here: ${c.name}`), { code: 'UNKNOWN_TOOL' });
          out({ type: 'tool_end', id: c.id, name: c.name, view: result.view, refused: result.refused });
          turnTools.push({ name: c.name, ok: !result.refused, sig: c.name + ':' + (c.args || '') }); lastError = null;
          const same = turnTools.slice(-3).filter((x) => x.sig === c.name + ':' + (c.args || '')).length;
          if (same >= 3 && typeof result.content === 'string') result.content += '\n\n[Fabro runtime] You made this exact call 3 times in a row and got the same result. Stop repeating it: use what you already have, or do the next step of the task.';
          if (c.name === 'update_plan' && Array.isArray(args.steps)) lastPlan = args.steps;
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          const sig = c.name + ':' + (c.args || '');
          const nFail = (failCount.get(sig) || 0) + 1; failCount.set(sig, nFail);
          result = { content: `Error: ${e.message}\n${nFail >= 2 ? `(This exact call failed ${nFail} times. Do NOT repeat it: change the arguments or use another tool/approach.)` : '(Fix the cause and try again, or try another approach. Don\'t invent a result.)'}` };
          out({ type: 'tool_end', id: c.id, name: c.name, error: e.message, code: e.code });
          turnTools.push({ name: c.name, ok: false }); lastError = { name: c.name, error: e.message };
        }
        msgs.push({ role: 'tool', tool_call_id: c.id, content: result.content });
        if (result.image) {
          if (params.vision) msgs.push({ role: 'user', content: [{ type: 'text', text: `(Image returned by ${c.name})` }, { type: 'image_url', image_url: { url: result.image } }] });
          else msgs[msgs.length - 1].content += '\n(An image was produced but this model cannot see images.)';
        }
      }
      if (agentMode) { toolSchemas = buildTools(); if (toolSig() !== promptSig) applyAgentPrompt(); }
      out({ type: 'tool_round' });
    }
    const elapsed = (Date.now() - (tFirst || t0)) / 1000;
    const completion = (acc.usage.has && acc.usage.completion) || (acc.timings && acc.timings.predicted_n) || Math.round(chars / 4);
    const stats = {
      promptTokens: (acc.usage.has && acc.usage.prompt) || (acc.timings && acc.timings.prompt_n) || null,
      completionTokens: completion,
      tokPerSec: +((acc.timings && acc.timings.predicted_per_second) || completion / Math.max(elapsed, 0.01)).toFixed(1),
      firstTokenMs: tFirst ? tFirst - t0 : null,
      totalMs: Date.now() - t0,
      backend: be.kind === 'local' ? 'local' : be.provider.kind,
      tools: steps || undefined, noTools: acc.noTools || undefined,
    };
    flushCp();
    out({ type: 'done', stats });
    usage.record({ model: meta.modelLabel || (be.kind === 'local' ? be.model : `${be.provider.name} · ${be.model}`), backend: stats.backend, convId: meta.convId, prompt: stats.promptTokens || 0, completion: stats.completionTokens || 0 });
  } catch (e) {
    flushCp();
    if (ctrl.signal.aborted) out({ type: 'done', aborted: true, stats: { totalMs: Date.now() - t0 } });
    else {
      const code = e.code || (e.message === 'NO_MODEL' ? 'NO_MODEL' : /ECONNREFUSED|fetch failed/i.test(e.message) ? 'ENGINE_DOWN' : 'UNKNOWN');
      out({ type: 'error', message: e.message, code, detail: e.detail || '' });
    }
  } finally {
    active.delete(reqId); injected.delete(reqId);
    if (be && be.inst) engine.release(be.inst);
    flushCp(); // Code mode: this turn's checkpoint (files as they were before the agent changed them)
  }
}

// One-shot, non-streamed helper for background jobs (titles, memory extraction, style learning).
function quick(model, messages, params = {}) {
  return new Promise((resolve, reject) => {
    let text = '';
    send({ reqId: 'bg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), model, messages, params: { temperature: 0.2, maxTokens: 400, reasoning: 'off', ...params }, meta: { modelLabel: 'Fabro · background' } }, (ev) => {
      if (ev.type === 'token') text += ev.text;
      if (ev.type === 'done') resolve(text.trim());
      if (ev.type === 'error') reject(Object.assign(new Error(ev.message), { code: ev.code }));
    });
  });
}

function abort(reqId) { const c = active.get(reqId); if (c) c.abort(); return true; }

module.exports = { send, abort, inject, quick, answer, toAnthropic, parseToolCalls };
