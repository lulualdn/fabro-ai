'use strict';
/* Fabro Anywhere — chat and agent on the phone alone, with no computer.
   The model: Fabro Cloud (free, no account, no key — LLM7's free tier, the most generous anonymous limits:
   several requests at once, streaming, native tool calls) when there is a network, else the model running
   on the phone (WebGPU). The tools run here: web search, reading pages, images, Python, JavaScript, weather,
   date. Everything stays on the phone and syncs to the computer when it's back. */
(function () {
  // Fabro Cloud is a pool of free, account-free, key-free endpoints. Each has its own limits, so together they
  // hold far more than any one: LLM7 (fast, several requests at once, daily token quota per address),
  // OVH AI Endpoints (big models, 2 requests a minute per model — rotated), Pollinations (last resort).
  const P = {
    llm7: { base: 'https://api.llm7.io/v1', name: 'LLM7' },
    ovh: { base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', name: 'OVH' },
    poll: { chat: 'https://text.pollinations.ai/openai', name: 'Pollinations' },
  };
  const CLOUD = P.llm7.base;
  const READER = 'https://r.jina.ai/';
  // best first; tools = native tool calls, vision = understands photos
  const POOL = [
    { id: 'llm7/gpt-oss:20b', name: 'gpt-oss 20B', tools: true },
    { id: 'ovh/gpt-oss-120b', name: 'gpt-oss 120B', tools: true },
    { id: 'ovh/Qwen3.5-397B-A17B', name: 'Qwen3.5 397B', tools: true },
    { id: 'llm7/nemotron-3-nano:30b', name: 'Nemotron 3 Nano', tools: true },
    { id: 'ovh/Meta-Llama-3_3-70B-Instruct', name: 'Llama 3.3 70B', tools: true },
    { id: 'ovh/Qwen3.6-27B', name: 'Qwen3.6 27B', tools: true },
    { id: 'ovh/Mistral-Small-3.2-24B-Instruct-2506', name: 'Mistral Small 3.2', tools: true, vision: true },
    { id: 'ovh/Qwen2.5-VL-72B-Instruct', name: 'Qwen2.5 VL 72B', tools: false, vision: true },
    { id: 'llm7/codestral-latest', name: 'Codestral', tools: true },
    { id: 'ovh/gpt-oss-20b', name: 'gpt-oss 20B (OVH)', tools: true },
    { id: 'poll/openai-fast', name: 'Pollinations', tools: true },
  ];
  const AUTO = { id: 'auto', name: 'Auto', tools: true, vision: true };
  let freeModels = [AUTO, ...POOL];
  const cool = new Map(); // model id or "llm7" → busy until (ms)
  const coolOf = (m) => Math.max(cool.get(m.id) || 0, cool.get(m.id.split('/')[0]) || 0);
  async function refreshModels() {
    // drop the models a provider no longer lists (the pool stays usable if the check fails)
    try {
      const [a, b] = await Promise.all([P.llm7, P.ovh].map((p) => fetch(p.base + '/models', { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      const has = { llm7: a && new Set((a.data || a || []).filter((m) => m.tier !== 'pro').map((m) => m.id)), ovh: b && new Set((b.data || []).map((m) => m.id)) };
      freeModels = [AUTO, ...POOL.filter((m) => { const [pv, id] = [m.id.split('/')[0], m.id.slice(m.id.indexOf('/') + 1)]; return !has[pv] || has[pv].has(id); })];
    } catch {}
    return freeModels;
  }
  // Speech to text in the cloud (Whisper large-v3 turbo at OVH, no account) — no download on the phone.
  async function cloudHear(wav, { lang, prompt } = {}) {
    for (const model of ['whisper-large-v3-turbo', 'whisper-large-v3']) {
      if ((cool.get('stt/' + model) || 0) > Date.now()) continue;
      const fd = new FormData(); fd.append('model', model); fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
      if (lang) fd.append('language', lang); if (prompt) fd.append('prompt', prompt.slice(0, 400));
      const r = await fetch(P.ovh.base + '/audio/transcriptions', { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (r && r.ok) { const j = await r.json(); return String(j.text || '').trim(); }
      if (r && r.status === 429) { cool.set('stt/' + model, Date.now() + 1000 * Number(r.headers.get('ratelimit-reset') || r.headers.get('retry-after') || 30)); continue; }
      if (r) throw new Error('STT HTTP ' + r.status);
    }
    throw Object.assign(new Error('busy'), { busy: true });
  }

  // ───────────────────────────── tools ─────────────────────────────
  const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
  const TOOLS = {
    web_search: fn('web_search', 'Search the web. Use it for anything recent, factual or that you are not sure about. Returns titles, links and snippets.', { query: { type: 'string', description: 'search terms' } }, ['query']),
    fetch_url: fn('fetch_url', 'Read a web page (as text). Use it on a result of web_search to get the details.', { url: { type: 'string' } }, ['url']),
    generate_image: fn('generate_image', 'Create an image from a description. The image is shown to the user automatically.', { prompt: { type: 'string', description: 'detailed visual description, in English' }, width: { type: 'integer' }, height: { type: 'integer' } }, ['prompt']),
    weather: fn('weather', 'Current weather and the next days for a city.', { city: { type: 'string' } }, ['city']),
    get_datetime: fn('get_datetime', 'The current date, time and time zone of the user.', {}),
    run_python: fn('run_python', 'Run Python code (numpy, math, statistics, dates…) to compute or check something exactly. Print the results.', { code: { type: 'string' } }, ['code']),
    run_javascript: fn('run_javascript', 'Run JavaScript (sandboxed, no network, no page access) for a quick calculation or text processing. Return or console.log the result.', { code: { type: 'string' } }, ['code']),
    update_plan: fn('update_plan', 'Agent only: write or update your step-by-step plan for a multi-step task.', { steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['title'] } } }, ['steps']),
  };
  const CHAT_TOOLS = ['web_search', 'fetch_url', 'generate_image', 'weather', 'get_datetime'];
  const AGENT_TOOLS = Object.keys(TOOLS);
  const OFFLINE_TOOLS = ['get_datetime', 'run_javascript', 'run_python'];

  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);
  async function reader(url, ms = 20000) {
    const r = await fetch(READER + url, { headers: { Accept: 'text/plain', 'X-Return-Format': 'markdown' }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  async function webSearch({ query }) {
    const md = await reader('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
    const out = []; const seen = new Set();
    const re = /##\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)([\s\S]*?)(?=\n##\s*\[|$)/g; let m;
    while ((m = re.exec(md)) && out.length < 8) {
      let url = m[2]; const u = url.match(/[?&]uddg=([^&)]+)/); if (u) url = decodeURIComponent(u[1]);
      if (/duckduckgo\.com\/(y\.js|l\/\?)|ad_domain|ad_provider/.test(url) || seen.has(url)) continue; seen.add(url);
      const snippet = m[3].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/!\S*/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      out.push({ title: m[1].trim(), url, snippet });
    }
    if (!out.length) throw new Error('no results');
    return { result: out.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n'), view: { sources: out.map((x) => ({ title: x.title, url: x.url })) } };
  }
  async function fetchUrl({ url }) {
    if (!/^https?:\/\//i.test(url)) throw new Error('http(s) URL needed');
    const md = await reader(url, 25000);
    const title = (md.match(/^Title:\s*(.+)$/m) || [, ''])[1];
    const body = md.split(/Markdown Content:\s*/)[1] || md;
    return { result: clip(body.replace(/\n{3,}/g, '\n\n'), 14000), view: { title, url } };
  }
  async function genImage({ prompt, width = 1024, height = 1024 }) {
    const w = Math.max(256, Math.min(1536, width | 0)), h = Math.max(256, Math.min(1536, height | 0));
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(90000) }); if (!r.ok) throw new Error(`image HTTP ${r.status}`);
    const blob = await r.blob();
    const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    return { result: 'The image was created and is shown to the user. Do not embed it again; describe it in one sentence.', view: { image: data } };
  }
  async function weather({ city }) {
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`, { signal: AbortSignal.timeout(10000) })).json();
    const p = g.results && g.results[0]; if (!p) throw new Error('city not found');
    const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=4`, { signal: AbortSignal.timeout(10000) })).json();
    if (f.error) throw new Error(f.reason || 'weather');
    return { result: JSON.stringify({ place: `${p.name}, ${p.country}`, current: f.current, daily: f.daily, units: { temp: '°C', wind: 'km/h', precipitation: 'mm' }, weather_code: 'WMO codes' }) };
  }
  // JavaScript in a throw-away worker: no DOM, no storage, no network, 8 s at most.
  function runJs({ code }) {
    const src = `self.fetch=undefined;self.XMLHttpRequest=undefined;self.WebSocket=undefined;self.importScripts=undefined;const out=[];const fmt=(v)=>typeof v==='string'?v:(()=>{try{return JSON.stringify(v)}catch{return String(v)}})();console.log=(...a)=>out.push(a.map(fmt).join(' '));console.error=console.warn=console.log;
      self.onmessage=async(e)=>{try{const r=await (async()=>{${'\n'}${String(code)}${'\n'}})();postMessage({ok:true,out:out.join('\\n'),r:r===undefined?undefined:fmt(r)})}catch(err){postMessage({ok:false,out:out.join('\\n'),e:String(err&&err.stack||err)})}}`;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); const wk = new Worker(url);
      const done = (fnc) => { clearTimeout(tm); wk.terminate(); URL.revokeObjectURL(url); fnc(); };
      const tm = setTimeout(() => done(() => reject(new Error('timeout (8 s)'))), 8000);
      wk.onmessage = (e) => done(() => { const m = e.data; const txt = [m.out, m.r != null ? '→ ' + m.r : ''].filter(Boolean).join('\n') || '(no output)'; m.ok ? resolve({ result: clip(txt, 8000), view: { out: txt } }) : reject(new Error(clip((m.out ? m.out + '\n' : '') + m.e, 3000))); });
      wk.onerror = (e) => done(() => reject(new Error(e.message || 'error')));
      wk.postMessage(1);
    });
  }
  // Python (Pyodide), loaded once in its own worker, kept offline by the service worker.
  let py = null, pyN = 0; const pyWait = new Map();
  function pyWorker() {
    if (py) return py;
    py = new Worker('py-worker.js');
    py.onmessage = (e) => { const m = e.data; const w = pyWait.get(m.id); if (!w) return; pyWait.delete(m.id); clearTimeout(w.tm); m.ok ? w.resolve(m) : w.reject(new Error(m.error)); };
    py.onerror = (e) => { for (const [, w] of pyWait) w.reject(new Error(e.message || 'python')); pyWait.clear(); py = null; };
    return py;
  }
  function runPy({ code }) {
    return new Promise((resolve, reject) => {
      const id = ++pyN; const tm = setTimeout(() => { pyWait.delete(id); try { py && py.terminate(); } catch {} py = null; reject(new Error('timeout (60 s)')); }, 60000);
      pyWait.set(id, { resolve: (m) => { const txt = m.out || '(no output)'; resolve({ result: clip(txt, 8000), view: { out: txt, image: m.image } }); }, reject, tm });
      pyWorker().postMessage({ id, code: String(code) });
    });
  }
  const RUN = {
    web_search: webSearch, fetch_url: fetchUrl, generate_image: genImage, weather, run_javascript: runJs, run_python: runPy,
    get_datetime: async () => ({ result: JSON.stringify({ now: new Date().toString(), iso: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) }),
    update_plan: async ({ steps }) => ({ result: 'Plan saved.', view: { steps } }),
  };

  // ───────────────────────────── the loop ─────────────────────────────
  function system({ agent, lang, date, tools, local }) {
    const L = { en: 'English', fr: 'French', es: 'Spanish', de: 'German' }[lang] || 'the user’s language';
    return [
      `You are Fabro, a helpful assistant, answering on the user's phone (Fabro Anywhere). Today is ${date}. Answer in ${L} unless the user writes in another language. Use Markdown.`,
      tools.length ? `You have tools (${tools.join(', ')}). Use them when they make the answer better or up to date — search before stating recent facts, cite sources as [1], [2] matching the search results.` : '',
      agent ? 'Agent mode: for a multi-step task, first call update_plan, then carry out the steps one by one with your tools, update the plan as you go, and finish with a clear summary of what you did and found. Do not ask for permission for each step.' : '',
      'To give the user a document, a web page or a drawing they can open, write it inside <artifact type="html|markdown|svg|code" title="…">…</artifact>.',
      'Tools of the computer (files, terminal, computer control) are not available while the computer is away; say so if the task needs them.',
      local ? 'Be concise.' : '',
    ].filter(Boolean).join('\n\n');
  }

  // OpenAI-compatible streaming call with tools, over the pool: the chosen model first ("auto": best first),
  // a busy or exhausted one is skipped at once (and rested for as long as it says), the next one takes over.
  async function cloudTurn(model, messages, tools, signal, onDelta, needVision) {
    const fits = (m) => (!tools.length || m.tools) && (!needVision || m.vision);
    const chosen = POOL.find((m) => m.id === model);
    let order = [...(chosen && fits(chosen) ? [chosen] : []), ...POOL.filter((m) => m !== chosen && fits(m))];
    if (!order.length) order = POOL.filter((m) => !tools.length || m.tools);
    let res = null, used = null, lastErr = '';
    for (let round = 0; round < 3 && !res; round++) {
      for (const m of order) {
        if (coolOf(m) > Date.now()) continue;
        const [pv] = m.id.split('/'); const api = m.id.slice(pv.length + 1); const p = P[pv];
        const body = { model: api, messages: needVision && !m.vision ? stripImages(messages) : messages, stream: true, temperature: 0.6 };
        if (tools.length) { body.tools = tools.map((n) => TOOLS[n]); body.tool_choice = 'auto'; }
        let r;
        try { r = await fetch(p.chat || p.base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); }
        catch (e) { if (signal.aborted) throw e; lastErr = e.message; cool.set(m.id, Date.now() + 20000); continue; }
        if (r.ok) { res = r; used = m; break; }
        let j = null; try { j = await r.json(); } catch {}
        const after = Number((j && j.error && j.error.retry_after) || r.headers.get('ratelimit-reset') || r.headers.get('retry-after') || (r.status === 429 ? 30 : 15));
        // a daily quota (hours) rests the whole provider; a per-minute limit only this model
        const whole = (j && j.error && /quota|concurrent/i.test(j.error.code || j.error.type || '')) || after > 300;
        cool.set(whole ? pv : m.id, Date.now() + Math.min(after, 86400) * 1000);
        lastErr = (j && j.error && (j.error.message || j.error)) || `HTTP ${r.status}`;
        if (r.status !== 429 && r.status < 500 && r.status !== 404) break;
      }
      if (!res) {
        // everything is resting: wait for the first one to be back (20 s at most), then go round again
        const next = Math.min(...order.map(coolOf)) - Date.now();
        if (next > 20000 || round === 2) break;
        await new Promise((ok, ko) => { const tm = setTimeout(ok, Math.max(500, next)); signal.addEventListener('abort', () => { clearTimeout(tm); ko(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });
      }
    }
    if (!res) throw new Error(/429|quota|limit|busy/i.test(String(lastErr)) || !lastErr ? (window.FAHost ? window.FAHost.t('cloudBusy') : 'Fabro Cloud is busy') : String(lastErr));
    const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '', content = ''; const calls = [];
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        const d = j.choices && j.choices[0] && j.choices[0].delta; if (!d) continue;
        const rr = d.reasoning_content || d.reasoning; if (rr) onDelta('reasoning', rr);
        if (d.content) { content += d.content; onDelta('token', d.content); }
        for (const tc of d.tool_calls || []) { const k = tc.index ?? calls.length; const c = (calls[k] ||= { id: '', name: '', args: '' }); if (tc.id) c.id = tc.id; if (tc.function) { if (tc.function.name) c.name += tc.function.name; if (tc.function.arguments) c.args += tc.function.arguments; } }
      }
    }
    return { content, calls: calls.filter((c) => c && c.name).map((c, k) => ({ ...c, id: c.id || 'call_' + Date.now().toString(36) + k })), model: used.name };
  }
  const stripImages = (msgs) => msgs.map((m) => Array.isArray(m.content) ? { ...m, content: m.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') } : m);
  // The phone's own model (WebLLM): tools described in the prompt, called as <tool_call>{json}</tool_call>.
  async function localTurn(engine, messages, tools, signal, onDelta) {
    const spec = tools.map((n) => `- ${n}: ${TOOLS[n].function.description} Arguments: ${JSON.stringify(TOOLS[n].function.parameters.properties)}`).join('\n');
    const msgs = messages.map((m) => m.role === 'tool' ? { role: 'user', content: `Tool result (${m.name}):\n${m.content}` } : m.tool_calls ? { role: 'assistant', content: (m.content || '') + m.tool_calls.map((c) => `\n<tool_call>{"name":"${c.function.name}","arguments":${c.function.arguments}}</tool_call>`).join('') } : m);
    if (tools.length) msgs[0] = { ...msgs[0], content: msgs[0].content + `\n\nTo use a tool, reply with only:\n<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>\nand wait for the result. Tools:\n${spec}` };
    const stream = await engine.chat.completions.create({ messages: msgs.slice(-16), stream: true, temperature: 0.6, max_tokens: 1200, extra_body: { enable_thinking: false } });
    let raw = '', shown = 0;
    for await (const ch of stream) {
      if (signal.aborted) { try { engine.interruptGenerate(); } catch {} break; }
      raw += (ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content) || '';
      const vis = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/<tool_call>[\s\S]*$/, '').trimStart();
      if (vis.length > shown) { onDelta('token', vis.slice(shown)); shown = vis.length; }
    }
    const calls = [];
    for (const m of raw.matchAll(/<tool_call>\s*(\{[\s\S]*?\})\s*(<\/tool_call>|$)/g)) {
      try { const j = JSON.parse(m[1]); if (j.name && TOOLS[j.name] && tools.includes(j.name)) calls.push({ id: 'call_' + calls.length + Date.now().toString(36), name: j.name, args: JSON.stringify(j.arguments || {}) }); } catch {}
    }
    return { content: raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '').trim(), calls, model: 'local' };
  }

  // history (the conversation's path) → reply, with tool rounds. onEvent mirrors the computer's run events.
  // history: the conversation path (phone app), or messages: OpenAI-format messages already built (the computer's
  // interface, its own system prompt included). allTools: every tool while only the prompt says agent or not.
  async function run({ history, messages, model, agent, allTools, lang, engine, signal, onEvent }) {
    const local = !!engine;
    const online = navigator.onLine !== false;
    let tools = agent || allTools ? AGENT_TOOLS : CHAT_TOOLS;
    if (!online) tools = tools.filter((n) => OFFLINE_TOOLS.includes(n));
    if (local && !agent) tools = tools.filter((n) => n !== 'fetch_url'); // keep small models focused
    if (!local) { const m = POOL.find((x) => x.id === model); if (m && m.tools === false) tools = []; }
    const loop = (m, tl, nv) => loopImpl(m, tl, nv, { model, agent, allTools, engine, signal, onEvent });
    let needVision = false;
    if (messages) {
      const sys = system({ agent, lang, date: new Date().toLocaleDateString(lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), tools, local });
      const out = messages.map((m) => ({ ...m }));
      if (out[0] && out[0].role === 'system') out[0].content = String(out[0].content || '') + '\n\n# On the phone, without the computer\n' + sys; else out.unshift({ role: 'system', content: sys });
      needVision = out.some((m) => Array.isArray(m.content) && m.content.some((x) => x.type === 'image_url'));
      if (local) for (const m of out) if (Array.isArray(m.content)) m.content = m.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
      return loop(out, tools, needVision);
    }
    const msgs = [{ role: 'system', content: system({ agent, lang, date: new Date().toLocaleDateString(lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), tools, local }) }];
    for (const n of history) {
      if (n.pending || (!(n.content || '').trim() && !(n.attachments || []).length)) continue;
      const imgs = (n.attachments || []).filter((a) => a.kind === 'image' && a.data);
      if (n.role === 'user' && imgs.length && !local) { needVision = true; msgs.push({ role: 'user', content: [{ type: 'text', text: n.content || ' ' }, ...imgs.map((a) => ({ type: 'image_url', image_url: { url: a.data } }))] }); }
      else msgs.push({ role: n.role === 'assistant' ? 'assistant' : 'user', content: n.content });
    }
    return loop(msgs, tools, needVision);
  }
  async function loopImpl(msgs, tools, needVision, { model, agent, allTools, engine, signal, onEvent }) {
    const local = !!engine;
    const maxRounds = agent || allTools ? 14 : 5; let used = model;
    for (let round = 0; round < maxRounds; round++) {
      const turn = local ? await localTurn(engine, msgs, tools, signal, (k, x) => onEvent({ type: k, text: x }))
        : await cloudTurn(model, msgs, tools, signal, (k, x) => onEvent({ type: k, text: x }), needVision);
      used = turn.model;
      if (!turn.calls.length || signal.aborted) return { model: used };
      msgs.push({ role: 'assistant', content: turn.content || '', tool_calls: turn.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
      onEvent({ type: 'tool_round' });
      for (const c of turn.calls) {
        let args = {}; try { args = JSON.parse(c.args || '{}'); } catch {}
        onEvent({ type: 'tool_start', id: c.id, name: c.name, args });
        let out;
        try {
          if (!tools.includes(c.name) || !RUN[c.name]) throw new Error('tool not available here');
          out = await RUN[c.name](args);
          onEvent({ type: 'tool_end', id: c.id, view: out.view });
        } catch (e) { out = { result: 'Error: ' + (e && e.message || e) }; onEvent({ type: 'tool_end', id: c.id, error: String(e && e.message || e) }); }
        msgs.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: String(out.result || '') });
      }
    }
    return { model: used };
  }

  window.FAAgent = { run, refreshModels, cloudHear, get models() { return freeModels; }, TOOLS, CLOUD };
})();
