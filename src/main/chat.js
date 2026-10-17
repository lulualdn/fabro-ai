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
function agentSystem(base) {
  const os = require('os');
  const folders = ((store.getSettings().agent || {}).folders || []);
  return [base, skills.promptSection(),
    `Computer: ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} · home ${os.homedir()} · default output folder ${require('path').join(os.homedir(), 'Documents', 'Fabro')}`,
    folders.length ? `Folders the user already allowed: ${folders.join(', ')}` : 'No folder allowed yet: using a folder shows the user a permission request.',
  ].filter(Boolean).join('\n\n');
}

const active = new Map();

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
  if (!toolCalls.length && acc.fallback && /<tool_call>/.test(content)) {
    const parsed = parseToolCalls(content);
    if (parsed.calls.length) { acc.push('retract', parsed.raw); content = parsed.rest; toolCalls = parsed.calls; }
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
function parseToolCalls(text) {
  const calls = []; let raw = '';
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    raw += m[0];
    try { const j = JSON.parse(m[1]); if (j.name) calls.push({ id: `fb_${Date.now().toString(36)}_${calls.length}`, name: j.name, args: JSON.stringify(j.arguments || j.parameters || {}) }); } catch {}
  }
  return { calls, raw, rest: text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() };
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
  try {
    be = await resolveBackend(model, out);
    if (be.gen) params = { ...params, ...Object.fromEntries(Object.entries(be.gen).filter(([, v]) => v !== null && v !== '' && v !== undefined)) };
    if (be.inst) engine.acquire(be.inst);
    out({ type: 'status', status: 'generating', backend: be.kind === 'local' ? 'local' : be.provider.kind });
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText = lastUser ? (typeof lastUser.content === 'string' ? lastUser.content : (lastUser.content || []).map((c) => c.text || '').join(' ')) : '';
    let agentMode = !!params.agentMode;
    const buildTools = () => {
      const chatT = tools.schemas(params.tools || []);
      const agentT = params.agent === false ? [] : agent.select({ agentMode, text: userText, used: params.usedTools || [], sub: !!parent }).map(agent.schema);
      return [...chatT, ...agentT];
    };
    let toolSchemas = buildTools();
    out({ type: 'tools_info', count: toolSchemas.length, tokens: agent.estTokens(toolSchemas) });
    const msgs = messages.slice();
    const setSystem = (text) => { const sys = msgs.find((m) => m.role === 'system'); if (sys) sys.content = text; else msgs.unshift({ role: 'system', content: text }); };
    if (parent) setSystem(agentSystem(params.agentPrompt || 'You are Fabro, an AI agent running on the user\'s computer.') + SUB_NOTE);
    else if (agentMode && params.agentPrompt) setSystem(agentSystem(params.agentPrompt));
    const complete = be.protocol === 'anthropic' ? completeAnthropic : completeOpenAI;
    const gkey = meta.convId || reqId;
    if (!convGrants.has(gkey)) convGrants.set(gkey, new Set());
    const ctxBase = { emit: out, convId: meta.convId, grants: convGrants.get(gkey), onAbort: (fn) => ctrl.signal.addEventListener('abort', fn), subOf: parent ? parent.callId : null };
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
        { signal: ctrl.signal, callId, ask: (id, req) => ask(reqId, pid(id), req, out, ctrl.signal), needDeps: (id, dep) => needDeps(reqId, pid(id), dep, out, ctrl.signal), grants: convGrants.get(gkey), description });
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
    for (;;) {
      const r = await complete(be, msgs, params, ctrl.signal, acc, acc.noTools && !acc.fallback ? [] : toolSchemas);
      if (!r.toolCalls.length || steps >= maxSteps()) break;
      steps++;
      msgs.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
      // Sub-agent calls of the same turn run in parallel; everything else runs in order.
      const subCalls = r.toolCalls.filter((c) => c.name === 'run_subagent' && !parent);
      const pre = new Map();
      if (subCalls.length > 1) {
        if (!agentMode) { agentMode = true; out({ type: 'agent_switch', tool: 'run_subagent' }); if (params.agentPrompt) setSystem(agentSystem(params.agentPrompt)); }
        await Promise.all(subCalls.map(async (c) => {
          let args = {}; try { args = JSON.parse(c.args || '{}'); } catch {}
          out({ type: 'tool_start', id: c.id, name: c.name, args, agent: true });
          try { const res = await runAgentTool(c, args); pre.set(c.id, res); out({ type: 'tool_end', id: c.id, name: c.name, view: res.view, refused: res.refused }); }
          catch (e) { if (ctrl.signal.aborted) throw e; pre.set(c.id, { content: `Error: ${e.message}` }); out({ type: 'tool_end', id: c.id, name: c.name, error: e.message, code: e.code }); }
        }));
      }
      for (const c of r.toolCalls) {
        if (pre.has(c.id)) { msgs.push({ role: 'tool', tool_call_id: c.id, content: pre.get(c.id).content }); continue; }
        let args = {}; try { args = JSON.parse(c.args || '{}'); } catch {}
        // Calling any tool other than search / fetch / image switches the conversation to agent mode.
        if (!agentMode && agent.isAgentTool(c.name) && params.agent !== false) {
          agentMode = true;
          out({ type: 'agent_switch', tool: c.name });
          if (params.agentPrompt) setSystem(agentSystem(params.agentPrompt));
        }
        out({ type: 'tool_start', id: c.id, name: c.name, args, agent: agent.isAgentTool(c.name) });
        let result;
        try {
          if (tools.CHAT_TOOLS[c.name]) {
            if (!(params.tools || []).includes(c.name)) throw Object.assign(new Error(`Tool not available here: ${c.name}`), { code: 'UNKNOWN_TOOL' });
            result = await tools.run(c.name, args, { needDeps: parent ? (dep) => parent.needDeps(c.id, dep) : (dep) => needDeps(reqId, c.id, dep, out, ctrl.signal) });
          } else if (agent.get(c.name) && params.agent !== false) {
            result = await runAgentTool(c, args);
          } else throw Object.assign(new Error(`Tool not available here: ${c.name}`), { code: 'UNKNOWN_TOOL' });
          out({ type: 'tool_end', id: c.id, name: c.name, view: result.view, refused: result.refused });
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          result = { content: `Error: ${e.message}` };
          out({ type: 'tool_end', id: c.id, name: c.name, error: e.message, code: e.code });
        }
        msgs.push({ role: 'tool', tool_call_id: c.id, content: result.content });
        if (result.image) {
          if (params.vision) msgs.push({ role: 'user', content: [{ type: 'text', text: `(Image returned by ${c.name})` }, { type: 'image_url', image_url: { url: result.image } }] });
          else msgs[msgs.length - 1].content += '\n(An image was produced but this model cannot see images.)';
        }
      }
      if (agentMode) toolSchemas = buildTools();
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
    out({ type: 'done', stats });
    usage.record({ model: meta.modelLabel || (be.kind === 'local' ? be.model : `${be.provider.name} · ${be.model}`), backend: stats.backend, convId: meta.convId, prompt: stats.promptTokens || 0, completion: stats.completionTokens || 0 });
  } catch (e) {
    if (ctrl.signal.aborted) out({ type: 'done', aborted: true, stats: { totalMs: Date.now() - t0 } });
    else {
      const code = e.code || (e.message === 'NO_MODEL' ? 'NO_MODEL' : /ECONNREFUSED|fetch failed/i.test(e.message) ? 'ENGINE_DOWN' : 'UNKNOWN');
      out({ type: 'error', message: e.message, code, detail: e.detail || '' });
    }
  } finally {
    active.delete(reqId);
    if (be && be.inst) engine.release(be.inst);
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

module.exports = { send, abort, quick, answer, toAnthropic, parseToolCalls };
