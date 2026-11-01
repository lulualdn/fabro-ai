'use strict';
/* Fabro Anywhere — "the computer, in the phone". The computer's own interface (the same bundle, sandboxed
   frame) also runs when the computer is away, or when there is none (guest): its api.* calls are answered
   here instead. Conversations live on the phone (the same store the sync uses: everything goes to the
   computer when it's back); chat and agent run on Fabro Cloud (free, no account) or the phone's model;
   what the computer last answered (settings, specs, lists…) is kept and shown; actions only the computer
   can do say so. */
(function () {
  const H = () => window.FAHost;
  const CACHE_KEY = 'pc-cache', LOCAL_SET = 'pc-settings-local', QUEUE = 'pc-settings-queue';
  let cache = null, localSet = null;
  const runs = new Map();
  let emit = () => {};

  // read-only answers of the computer worth keeping (no arguments, or simple ones)
  const CACHEABLE = /^(app:info|settings:get|system:specs|models:(catalog|libraries|plans)|engine:status|memory:list|mods:(list|commands)|skills:list|tasks:list|projects:list|artifacts:list|providers:view|mcp:view|deps:status|hotkey:status|usage:summary|agent:tools|code:recent|login:get|images:status|computer:status|runtime:status|localapi:status|crash:list)$/;
  const key = (ch, args) => ch + (args && args.length ? JSON.stringify(args).slice(0, 200) : '');
  async function load() { if (!cache) { cache = (await H().kv.get(CACHE_KEY).catch(() => null)) || {}; localSet = (await H().kv.get(LOCAL_SET).catch(() => null)) || {}; } }
  async function remember(ch, args, r) {
    if (!CACHEABLE.test(ch)) return;
    await load(); cache[key(ch, args)] = r;
    clearTimeout(remember.t); remember.t = setTimeout(() => H().kv.set(CACHE_KEY, cache).catch(() => {}), 800);
  }

  const POOL = () => (window.FAAgent ? FAAgent.models.filter((m) => m.id !== 'auto') : []);
  const CLOUD_ID = 'fabro-cloud';
  const cloudModels = () => POOL().map((m) => ({ ref: { backend: 'provider', provider: CLOUD_ID, model: m.id }, label: m.name, provider: CLOUD_ID, providerName: 'Fabro Cloud', kind: 'fabro', local: false, free: true, vision: !!m.vision }));
  const isCloudRef = (r) => r && r.backend === 'provider' && r.provider === CLOUD_ID;

  // what the interface sees when nothing was kept (a guest that never paired a computer)
  function defaults(ch) {
    const lang = H().lang || 'en';
    switch (ch) {
      case 'app:info': return { version: 'Anywhere', platform: 'remote', remote: true, userName: '', e2e: false, packaged: true, locale: lang };
      case 'settings:get': return merge(bundleDefaults(), { onboarded: true, language: lang, theme: H().settings.theme === 'halloween' ? 'halloween' : 'system', autoUpdate: false, freeCloud: true, devMode: false });
      case 'system:specs': return { platform: 'remote', arch: '', os: 'Fabro Anywhere', cpu: { model: '', threads: 0 }, ramGB: 0, gpus: [], accel: 'cpu', gpuBudgetGB: 0, ramBudgetGB: 0, lowPower: true };
      case 'models:catalog': return { items: [], recommended: null, specs: defaults('system:specs') };
      case 'engine:status': return { state: 'idle', loaded: [] };
      case 'providers:view': return { free: { on: true, models: POOL() }, enabled: false, presets: [], list: [] };
      case 'anywhere:status': return { enabled: false, devices: [] };
      case 'hotkey:status': return { ok: false, remote: true };
      case 'mcp:view': return { servers: [] };
      case 'usage:summary': return { total: {}, days: [], models: [] };
      case 'login:get': return false;
      default:
        if (/:(list|recent|commands|libraries|tools|search|browsers)$/.test(ch)) return [];
        if (/:(status|view|plans|summary|info|state|policy)$/.test(ch)) return {};
        return undefined;
    }
  }
  let bundleRef = null;
  const bundleDefaults = () => JSON.parse(JSON.stringify((bundleRef && bundleRef.settingsDefaults) || { engine: { ctx: 8192 }, gen: { temperature: 0.7, topP: 0.95, maxTokens: 4096, reasoning: 'auto' }, agent: { enabled: true, folders: [], permissions: {}, disabledTools: [] }, chatTools: { webSearch: true, fetch: true }, memory: { enabled: true, auto: true }, styles: [], activeStyle: 'default', providers: { enabled: false, list: [] }, mods: { enabled: {} }, mcp: { servers: [] }, skills: { disabled: [], extraDirs: [] }, computer: { enabled: false }, hotkey: { enabled: false } }));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function merge(a, b) { const o = { ...a }; for (const k of Object.keys(b || {})) o[k] = k !== 'selectedModel' && isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; }
  // what only arranges the computer's own window, or asks nothing back
  const NOOP = { 'window:theme': null, 'window:buttons': null, 'window:devtools': null, 'browser:bounds': null, 'mods:webBounds': null, 'mods:webHide': null, 'link:ready': true, 'hotkey:apply': { ok: false }, 'mods:ready': true, 'quick:report': null };
  const NEEDS = (ch) => { (window.__faNeeds ||= []).push(ch); throw new Error('NEEDS_COMPUTER:' + ch); }; // __faNeeds: tests

  async function settings() {
    await load();
    const base = merge(merge(defaults('settings:get'), cache['settings:get'] || {}), localSet);
    // the computer's own models can't run without it: Fabro Cloud answers
    if (!isCloudRef(base.selectedModel)) base.selectedModel = { backend: 'provider', provider: CLOUD_ID, model: (POOL()[0] || { id: 'llm7/gpt-oss:20b' }).id };
    base.onboarded = true; base.freeCloud = true;
    return base;
  }


  function mergeSys(msgs, extra) {
    const out = msgs.map((m) => ({ ...m }));
    if (out[0] && out[0].role === 'system') out[0].content = String(out[0].content || '') + '\n\n' + extra; else out.unshift({ role: 'system', content: extra });
    return out;
  }
  async function chatSend(p) {
    const reqId = p.reqId; const ctl = new AbortController(); runs.set(reqId, ctl);
    const ev = (e) => emit('chat:event', { reqId, ...e });
    const model = isCloudRef(p.model) ? p.model.model : 'auto';
    const params = p.params || {};
    (async () => {
      ev({ type: 'status', status: 'generating', backend: 'fabro' });
      try {
        const lm = H().localEngine && navigator.onLine === false ? H().localEngine() : null; // offline: the phone's model
        let messages = p.messages || [];
        // voice mode: how to talk (emotions, sound effects, interruptions), from the computer's own instructions
        if (params.voiceMode && bundleRef && bundleRef.voicePrompt) messages = mergeSys(messages, bundleRef.voicePrompt);
        const out = await FAAgent.run({ messages, model, agent: !!params.agentMode, allTools: params.agent !== false, lang: H().lang, engine: lm, signal: ctl.signal, onEvent: (e) => ev(e) });
        ev({ type: 'done', stats: { backend: 'fabro', model: out && out.model } });
      } catch (e) {
        if (e && e.name === 'AbortError') ev({ type: 'done', stats: { aborted: true } });
        else ev({ type: 'error', message: String(e && e.message || e), code: 'CLOUD' });
      }
      runs.delete(reqId);
    })();
    return true;
  }

  async function call(ch, args = []) {
    await load();
    if (ch in NOOP) return NOOP[ch];
    const L = H().local;
    switch (ch) {
      case 'settings:get': return settings();
      case 'settings:set': {
        const patch = args[0] || {}; Object.assign(localSet, patch); await H().kv.set(LOCAL_SET, localSet);
        const q = (await H().kv.get(QUEUE).catch(() => null)) || {}; await H().kv.set(QUEUE, { ...q, ...patch });
        return settings();
      }
      case 'conv:list': return L.list();
      case 'conv:get': return L.get(args[0]);
      case 'conv:save': return L.save(args[0]);
      case 'conv:delete': return L.del(args[0]);
      case 'conv:patch': { const c = await L.get(args[0]); return L.save({ ...c, ...(args[1] || {}), updatedAt: Date.now() }); }
      case 'conv:search': { const q = String(args[0] || '').toLowerCase(); return (await L.list()).filter((c) => (c.title || '').toLowerCase().includes(q)); }
      case 'providers:models': return cloudModels();
      case 'providers:free': return defaults('providers:view');
      case 'models:installed': return { local: [], downloads: [] };
      case 'chat:send': return chatSend(args[0] || {});
      case 'chat:abort': { const c = runs.get(args[0]); if (c) c.abort(); return true; }
      case 'chat:inject': case 'chat:answer': return false;
      case 'voice:status': { H().prepareVoice && H().prepareVoice(); return { runtime: true, whisper: 'phone', whisperReady: true, engine: 'phone', kokoro: false, voice: null, voices: [], sizes: {}, vocab: '' }; }
      case 'voice:install': return call('voice:status');
      case 'voice:stt': return { text: await H().hear(args[0], { ...(args[1] || {}), local: true }) };
      case 'voice:tts': {
        const text = String(args[0] || '');
        const w = H().tts ? await H().tts(text, args[1] || {}).catch(() => null) : null; // Piper on the phone
        if (w) return w;
        return { sys: true }; // not downloaded yet: the frame asks for the system voice when it's this piece's turn
      }
      case 'voice:sys': { const tx = String(args[0] || ''); if (!tx) { try { speechSynthesis.cancel(); } catch {} return true; } await H().speak(tx, { single: true }); return true; } // spoken now, answers when done; empty: stop
      case 'voice:setVoice': case 'voice:setWhisper': case 'voice:setVocab': return call('voice:status');
      case 'app:notify': { const o = args[0] || {}; if (document.hidden) H().notify(o.title || 'Fabro', o.body || ''); return true; }
      case 'updater:check': return null;
      case 'brain:title': case 'brain:memories': case 'brain:style': return null;
      case 'app:info': return { ...(cache['app:info'] || defaults('app:info')), remote: true, localMode: true };
    }
    const k = key(ch, args);
    if (k in cache) return cache[k];
    const d = defaults(ch);
    if (d !== undefined) return d;
    NEEDS(ch);
  }

  // back online: the settings changed meanwhile go to the computer
  async function flush(rpcCall) {
    const q = await H().kv.get(QUEUE).catch(() => null);
    if (!q || !Object.keys(q).length) return;
    if (isCloudRef(q.selectedModel) === false) delete q.selectedModel;
    try { await rpcCall('settings:set', [q]); await H().kv.set(QUEUE, {}); localSet = {}; await H().kv.set(LOCAL_SET, {}); } catch {}
  }

  window.FALocal = { call, remember, flush, setEmit: (fn) => { emit = fn; }, setBundle: (b) => { bundleRef = b; }, CACHEABLE };
})();
