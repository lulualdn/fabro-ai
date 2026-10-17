'use strict';
/* Fabro Anywhere — the phone app. Pairs with a computer by reading its circular code, keeps conversations
   offline (IndexedDB), talks to the computer's models through an end-to-end encrypted session (relay first,
   then a direct WebRTC channel), queues messages while the computer is away, syncs both ways, and can answer
   with a small model running in the browser (WebGPU) when the computer can't be reached. */
(function () {
  const A = window.FabroAnywhere;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  let markPath = null; // the Fabro propeller, read from icons/mark.svg at start

  // ───────────────────────────── i18n ─────────────────────────────
  const LANGS = ['en', 'fr', 'es', 'de'];
  let lang = 'en';
  const t = (k, v = {}) => String((FA_I18N[lang] || FA_I18N.en)[k] ?? FA_I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');

  // ───────────────────────────── storage ─────────────────────────────
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('fabro-anywhere', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('convs', { keyPath: 'id' }); };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(store, mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const tr = db.transaction(store, mode); const st = tr.objectStore(store); const out = fn(st); tr.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); tr.onerror = () => rej(tr.error); }); },
    get(store, key) { return this.tx(store, 'readonly', (s) => s.get(key)); },
    put(store, val, key) { return this.tx(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))); },
    del(store, key) { return this.tx(store, 'readwrite', (s) => s.delete(key)); },
    all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); },
    clear(store) { return this.tx(store, 'readwrite', (s) => s.clear()); },
  };
  const kv = { get: (k) => DB.get('kv', k), set: (k, v) => DB.put('kv', v, k), del: (k) => DB.del('kv', k) };

  // ───────────────────────────── state ─────────────────────────────
  const S = {
    view: 'welcome', identity: null, link: null,
    settings: { lang: 'auto', theme: 'system', model: null, localFallback: true, localModel: null, agent: false },
    convs: new Map(), metas: [], cur: null, drawer: false,
    conn: { state: 'off', info: null, err: '' }, models: [],
    outbox: [], tombstones: [], runs: new Map(), asks: new Map(),
    draft: '', atts: [], sheet: null, local: { status: 'none', progress: 0, text: '' }, voice: null, installEvt: null,
  };
  let relay = null, session = null, connecting = null, retryT = 0, retryN = 0, pingT = 0;

  const saveSettings = () => kv.set('settings', S.settings);
  async function saveConv(c) { S.convs.set(c.id, c); await DB.put('convs', c); }
  const curConv = () => (S.cur ? S.convs.get(S.cur) : null);

  // ───────────────────────────── toasts ─────────────────────────────
  function toast(msg, kind = '') {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
    $('#toast-root').appendChild(el); setTimeout(() => el.classList.add('out'), 3200); setTimeout(() => el.remove(), 3600);
  }

  // ───────────────────────────── connection ─────────────────────────────
  const rpcWait = new Map(); let rpcN = 0;
  function rpc(m, p = {}, timeout = 60000) {
    if (!session) return Promise.reject(new Error(t('offline')));
    const id = 'r' + (++rpcN);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { rpcWait.delete(id); reject(new Error(t('timeout'))); }, timeout);
      rpcWait.set(id, { resolve, reject, timer });
      session.send({ t: 'req', id, m, p }).then((ok) => { if (!ok) { clearTimeout(timer); rpcWait.delete(id); reject(new Error(t('offline'))); } });
    });
  }
  function relayUrls() {
    const custom = S.settings.customRelay;
    const base = (S.link && S.link.relays && S.link.relays.length) ? S.link.relays : A.DEFAULT_RELAYS;
    return [...new Set([...base, ...(custom ? [custom] : [])])];
  }
  function ensureRelay() {
    if (relay) return relay;
    relay = new A.Relay(relayUrls(), { onState: () => { if (S.conn.state === 'off' || S.conn.state === 'connecting') render(); } });
    return relay;
  }
  function setConn(state, extra = {}) { S.conn = { ...S.conn, state, ...extra }; renderHeader(); if (S.view === 'main') renderComposer(); }
  async function connect(force) {
    if (!S.link) return;
    if (connecting && !force) return connecting;
    clearTimeout(retryT);
    connecting = (async () => {
      setConn('connecting', { err: '' });
      ensureRelay();
      // wait for at least one relay
      for (let i = 0; i < 40 && !relay.up(); i++) await sleep(250);
      try {
        let s = null;
        s = await A.phoneConnect({
          relay, link: S.link, ice: S.link.ice || A.STUN,
          onMessage: onMessage,
          onRevoked: () => { forget(true); toast(t('revoked'), 'err'); },
          onState: (st, ss) => { if (session === ss || session === s) setConn(st === 'direct' ? 'direct' : st === 'relay' ? 'relay' : S.conn.state); },
        });
        if (session) session.close();
        session = s; retryN = 0;
        setConn(s.via === 'direct' ? 'direct' : 'relay');
        clearInterval(pingT); pingT = setInterval(() => { if (session) session.send({ t: '_ping' }); if (session && now() - session.alive > 75000) dropped(); }, 25000);
        await afterConnect();
      } catch (e) {
        if (String(e.message) === 'revoked') { await forget(true); toast(t('revoked'), 'err'); return; }
        setConn('off', { err: relay.up() ? t('pcAway') : t('noNet') });
        scheduleRetry();
      } finally { connecting = null; }
    })();
    return connecting;
  }
  function scheduleRetry() {
    clearTimeout(retryT);
    if (document.hidden) return;
    const ms = [4000, 8000, 15000, 30000, 60000][Math.min(retryN++, 4)];
    retryT = setTimeout(() => connect(), ms);
  }
  function dropped() {
    if (session) { session.close(); session = null; }
    for (const [, w] of rpcWait) { clearTimeout(w.timer); w.reject(new Error(t('offline'))); } rpcWait.clear();
    setConn('off', { err: t('pcAway') });
    scheduleRetry();
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function afterConnect() {
    try {
      const info = await rpc('hello', { visible: !document.hidden, name: deviceName() });
      S.conn.info = info; S.models = info.models || [];
      if (info.pcName && S.link.pcName !== info.pcName) { S.link.pcName = info.pcName; await kv.set('link', S.link); }
      if (!S.settings.model || !S.models.some((m) => refKey(m.ref) === refKey(S.settings.model))) { if (S.settings.model !== 'phone') S.settings.model = info.model || (S.models[0] && S.models[0].ref) || null; }
      renderHeader();
      await syncNow();
      await flushOutbox();
      ensurePush(false);
    } catch (e) { console.warn('afterConnect', e); }
  }
  function onMessage(m) {
    if (!m) return;
    if (m.t === 'bye') { dropped(); return; }
    if (m.t === 'res') { const w = rpcWait.get(m.id); if (w) { rpcWait.delete(m.id); clearTimeout(w.timer); m.ok ? w.resolve(m.r) : w.reject(new Error(m.e || 'error')); } return; }
    if (m.t === 'ev') {
      if (m.k === 'run') return onRunEvents(m);
      if (m.k === 'run.done') return onRunDone(m);
      if (m.k === 'ask') return onAsk(m);
      if (m.k === 'toast') { toast(`${m.title || ''} — ${m.body || ''}`); syncNow(); return; }
    }
  }
  const refKey = (r) => !r ? '' : r === 'phone' ? 'phone' : r.backend === 'provider' ? `p:${r.provider}:${r.model}` : r.backend === 'local' ? `l:${r.id}` : `${r.backend}:${r.id || r.name}`;
  function deviceName() {
    const ua = navigator.userAgent;
    const m = ua.match(/\(([^)]+)\)/); const p = m ? m[1] : '';
    if (/iPhone/.test(ua)) return 'iPhone'; if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) { const d = p.split(';').map((x) => x.trim()).find((x) => x && !/Android|Linux|wv|U$|^K$/.test(x)); return d || 'Android'; }
    return 'Phone';
  }
  const platform = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : (navigator.platform || 'web'));

  // ───────────────────────────── sync ─────────────────────────────
  const strip = (c) => { const { dirty, ...rest } = c; return rest; };
  async function syncNow() {
    if (!session) return;
    const have = {}; for (const c of S.convs.values()) if (!c.partial) have[c.id] = c.updatedAt || 0;
    const push = [...S.convs.values()].filter((c) => c.dirty && !c.ephemeral).map(strip);
    const full = S.cur && (!S.convs.has(S.cur) || S.convs.get(S.cur).partial) ? [S.cur] : [];
    const r = await rpc('sync', { have, push, full, deleted: S.tombstones }, 90000);
    S.tombstones = []; await kv.set('tombstones', []);
    for (const c of push) { const l = S.convs.get(c.id); if (l) { l.dirty = false; await saveConv(l); } }
    const gone = new Set(r.deleted || []);
    for (const id of gone) if (S.convs.has(id)) { S.convs.delete(id); await DB.del('convs', id); if (S.cur === id) S.cur = null; }
    for (const c of r.convs || []) {
      const l = S.convs.get(c.id);
      const merged = l && !l.partial ? A.mergeConv(l, c) : c;
      merged.dirty = !!(l && l.dirty && hasNewer(l, c));
      await saveConv(merged);
    }
    S.metas = (r.metas || []).filter((m) => !gone.has(m.id)); await kv.set('metas', S.metas);
    render();
  }
  const hasNewer = (local, remote) => { const ids = new Set(A.nodesOf(remote).map((n) => n.id)); return A.nodesOf(local).some((n) => !ids.has(n.id)); };
  async function openConv(id) {
    S.cur = id; S.drawer = false; S.view = 'main';
    render();
    const c = S.convs.get(id);
    if ((!c || c.partial) && session) {
      try { const full = await rpc('conv.get', { id }); await saveConv(full); render(); } catch (e) { toast(e.message, 'err'); }
    }
    scrollChat(true);
  }

  // ───────────────────────────── sending ─────────────────────────────
  function newConv() { const c = { id: A.uid() + A.uid().slice(0, 4), title: '', createdAt: now(), updatedAt: now(), nodes: [], leafId: null, agent: !!S.settings.agent, origin: 'phone' }; return c; }
  async function send(text, atts = []) {
    text = (text || '').trim();
    if (!text && !atts.length) return;
    let c = curConv();
    if (!c || c.partial) { c = newConv(); S.cur = c.id; }
    const node = { id: A.uid(), role: 'user', content: text, attachments: atts, createdAt: now(), updatedAt: now(), parentId: c.leafId || null };
    c.nodes = [...A.nodesOf(c), node]; delete c.messages; c.leafId = node.id; c.updatedAt = now(); c.dirty = true;
    if (!c.title) c.title = text.replace(/\s+/g, ' ').slice(0, 64) || t('photo');
    await saveConv(c);
    S.draft = ''; S.atts = []; render(); scrollChat(true);
    return dispatch(c, node);
  }
  async function dispatch(c, node) {
    const usePhone = S.settings.model === 'phone' || (!session && S.settings.localFallback && !!localInfo() && S.local.status !== 'unsupported');
    if (usePhone) return runLocal(c, node);
    if (!session) { S.outbox.push({ convId: c.id, nodeId: node.id }); await kv.set('outbox', S.outbox); render(); connect(); return; }
    try {
      const res = await rpc('run', { conv: strip(c), nodeId: node.id, model: S.settings.model && S.settings.model !== 'phone' ? S.settings.model : null, agent: !!c.agent });
      c.dirty = false;
      if (res.already) { await syncNow(); return; }
      const asst = { id: res.nodeId, role: 'assistant', content: '', reasoning: '', steps: [], model: res.model, pending: true, createdAt: now(), parentId: node.id };
      c.nodes = [...A.nodesOf(c), asst]; c.leafId = asst.id;
      await saveConv(c);
      S.runs.set(res.runId, { convId: c.id, nodeId: asst.id });
      render(); scrollChat(true);
    } catch (e) {
      S.outbox.push({ convId: c.id, nodeId: node.id }); await kv.set('outbox', S.outbox);
      toast(e.message, 'err'); render();
    }
  }
  async function flushOutbox() {
    if (!session || !S.outbox.length) return;
    const list = S.outbox.splice(0); await kv.set('outbox', S.outbox);
    for (const q of list) {
      const c = S.convs.get(q.convId); if (!c) continue;
      const node = A.nodesOf(c).find((n) => n.id === q.nodeId); if (!node) continue;
      if (A.nodesOf(c).some((n) => n.parentId === node.id && n.role === 'assistant')) continue;
      await dispatch(c, node);
    }
  }
  const queued = (nodeId) => S.outbox.some((q) => q.nodeId === nodeId);

  // run events from the computer
  let paintT = 0;
  function onRunEvents(m) {
    const c = S.convs.get(m.convId); if (!c) return;
    let n = A.nodesOf(c).find((x) => x.id === m.nodeId);
    if (!n) { n = { id: m.nodeId, role: 'assistant', content: '', reasoning: '', steps: [], pending: true, createdAt: now(), parentId: c.leafId }; c.nodes = [...A.nodesOf(c), n]; c.leafId = n.id; S.runs.set(m.runId, { convId: c.id, nodeId: n.id }); }
    for (const ev of m.evs || []) {
      if (ev.type === 'token') n.content = (n.content || '') + ev.text;
      else if (ev.type === 'reasoning') n.reasoning = (n.reasoning || '') + ev.text;
      else if (ev.type === 'tool_start') (n.steps = n.steps || []).push({ id: ev.id, name: ev.name, status: 'running', parent: ev.parent, args: ev.args });
      else if (ev.type === 'tool_end') { const st = (n.steps || []).find((x) => x.id === ev.id); if (st) { st.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; st.view = ev.view; } }
      else if (ev.type === 'tool_round') { if (n.content && !/\n\n$/.test(n.content)) n.content += '\n\n'; }
      else if (ev.type === 'retract') n.content = '';
      else if (ev.type === 'agent_switch') c.agent = true;
    }
    n.runId = m.runId;
    if (S.cur === c.id && S.view === 'main') { cancelAnimationFrame(paintT); paintT = requestAnimationFrame(() => { paintMessage(n); scrollChat(); }); }
    if (S.voice && S.voice.convId === c.id) S.voice.feed(n.content || '');
  }
  async function onRunDone(m) {
    S.runs.delete(m.runId);
    for (const [k, v] of S.asks) if (v.runId === m.runId) S.asks.delete(k);
    if (m.conv) {
      const l = S.convs.get(m.conv.id);
      const merged = l ? A.mergeConv(l, m.conv) : m.conv;
      merged.dirty = !!(l && l.dirty && hasNewer(l, m.conv));
      await saveConv(merged);
      if (S.cur === merged.id) render();
      const last = A.pathOf(merged).slice(-1)[0];
      if (S.voice && S.voice.convId === merged.id) S.voice.done(last ? last.content || '' : '', last && last.error);
      if (document.hidden && last) localNotify(merged.title || 'Fabro', (last.error ? '⚠ ' + last.error : last.content || '').replace(/[#*_`>]/g, '').slice(0, 140), merged.id);
    }
  }
  function onAsk(m) {
    S.asks.set(m.ask.id, { ...m.ask, runId: m.runId, convId: m.convId });
    if (S.cur === m.convId) render();
    if (document.hidden) localNotify(t('askTitle'), m.ask.summary || '', m.convId);
  }
  async function answerAsk(id, value) {
    const a = S.asks.get(id); if (!a) return;
    S.asks.delete(id); render();
    try { await rpc('run.answer', { runId: a.runId, callId: id, value }); } catch (e) { toast(e.message, 'err'); }
  }
  async function stopRun() {
    const c = curConv(); if (!c) return;
    for (const [runId, r] of S.runs) if (r.convId === c.id) rpc('run.abort', { runId }).catch(() => {});
    if (S.localRun) S.localRun.abort();
  }
  const busy = (c) => !!c && A.pathOf(c).some((n) => n.pending);

  // ───────────────────────────── phone model (WebGPU) ─────────────────────────────
  const LOCAL_MODELS = [
    { id: 'qwen3-0.6b', name: 'Qwen3 0.6B', f16: 'Qwen3-0.6B-q4f16_1-MLC', f32: 'Qwen3-0.6B-q4f32_1-MLC', size: '≈ 0.5 GB' },
    { id: 'qwen3-1.7b', name: 'Qwen3 1.7B', f16: 'Qwen3-1.7B-q4f16_1-MLC', f32: 'Qwen3-1.7B-q4f32_1-MLC', size: '≈ 1.2 GB' },
  ];
  const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
  let engine = null;
  const localInfo = () => LOCAL_MODELS.find((m) => m.id === (S.settings.localModel || {}).id);
  async function webgpu() {
    if (!navigator.gpu) return null;
    try { const ad = await navigator.gpu.requestAdapter(); return ad ? { f16: ad.features.has('shader-f16') } : null; } catch { return null; }
  }
  async function loadLocal(model, { download = false } = {}) {
    const gpu = await webgpu();
    if (!gpu) { S.local = { status: 'unsupported', progress: 0, text: t('noWebgpu') }; renderSheet(); return false; }
    const mid = gpu.f16 ? model.f16 : model.f32;
    S.local = { status: 'loading', progress: 0, text: '' }; renderSheet(); renderHeader();
    try {
      const webllm = await import(WEBLLM);
      engine = await webllm.CreateMLCEngine(mid, { initProgressCallback: (p) => { S.local.progress = p.progress || 0; S.local.text = p.text || ''; renderSheet(); } });
      S.settings.localModel = { id: model.id, mid }; await saveSettings();
      S.local = { status: 'ready', progress: 1, text: '' };
    } catch (e) {
      engine = null;
      S.local = { status: download ? 'error' : 'none', progress: 0, text: String(e && e.message || e).slice(0, 200) };
    }
    renderSheet(); renderHeader(); render();
    return S.local.status === 'ready';
  }
  async function removeLocal() {
    try { if (engine) await engine.unload(); } catch {}
    engine = null;
    try { const webllm = await import(WEBLLM); const m = S.settings.localModel; if (m && m.mid && webllm.deleteModelAllInfoInCache) await webllm.deleteModelAllInfoInCache(m.mid); } catch {}
    for (const k of await caches.keys()) if (/webllm/i.test(k)) await caches.delete(k);
    S.settings.localModel = null; if (S.settings.model === 'phone') S.settings.model = null; await saveSettings();
    S.local = { status: 'none', progress: 0, text: '' }; renderSheet(); renderHeader();
  }
  async function runLocal(c, node) {
    if (S.local.status !== 'ready') { const m = localInfo(); if (!m || !(await loadLocal(m))) { toast(t('localUnavailable'), 'err'); return; } }
    const m = localInfo();
    const asst = { id: A.uid(), role: 'assistant', content: '', reasoning: '', steps: [], model: `${m.name} · ${t('onPhone')}`, pending: true, createdAt: now(), parentId: node.id, origin: 'phone-local' };
    c.nodes = [...A.nodesOf(c), asst]; c.leafId = asst.id; await saveConv(c); render(); scrollChat(true);
    const msgs = [{ role: 'system', content: t('localSystem', { d: new Date().toLocaleDateString(lang) }) + ' /no_think' }];
    for (const x of A.pathOf({ ...c, leafId: node.id })) if (!x.pending && (x.content || '').trim()) msgs.push({ role: x.role === 'assistant' ? 'assistant' : 'user', content: x.content });
    let aborted = false; S.localRun = { abort: () => { aborted = true; try { engine.interruptGenerate(); } catch {} } };
    try {
      const stream = await engine.chat.completions.create({ messages: msgs.slice(-14), stream: true, temperature: 0.7, max_tokens: 1024, extra_body: { enable_thinking: false } });
      let raw = '';
      for await (const ch of stream) {
        raw += (ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content) || '';
        asst.content = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();
        if (S.cur === c.id) { cancelAnimationFrame(paintT); paintT = requestAnimationFrame(() => { paintMessage(asst); scrollChat(); }); }
        if (S.voice && S.voice.convId === c.id) S.voice.feed(asst.content);
        if (aborted) break;
      }
    } catch (e) { asst.error = String(e && e.message || e); }
    S.localRun = null;
    asst.pending = false; asst.updatedAt = now(); c.updatedAt = now(); c.dirty = true;
    await saveConv(c); render();
    if (S.voice && S.voice.convId === c.id) S.voice.done(asst.content, asst.error);
    if (session) syncNow().catch(() => {});
  }

  // ───────────────────────────── notifications ─────────────────────────────
  const urlB64 = (s) => A.unb64u(s);
  async function ensurePush(ask) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !S.conn.info || !S.conn.info.vapid) return false;
    if (Notification.permission === 'denied') return false;
    if (Notification.permission !== 'granted') { if (!ask) return false; if ((await Notification.requestPermission()) !== 'granted') return false; }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const key = S.conn.info.vapid;
      if (sub && sub.options && sub.options.applicationServerKey && A.b64u(new Uint8Array(sub.options.applicationServerKey)) !== key) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
      await rpc('push.sub', { sub: sub.toJSON() });
      S.settings.notify = true; await saveSettings();
      return true;
    } catch (e) { console.warn('push', e); if (ask) toast(t('pushFailed'), 'err'); return false; }
  }
  async function disablePush() {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
    try { await rpc('push.sub', { sub: null }); } catch {}
    S.settings.notify = false; await saveSettings();
  }
  async function localNotify(title, body, convId) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { const reg = await navigator.serviceWorker.ready; reg.showNotification(title, { body, tag: convId, data: { convId }, icon: 'icons/icon-192.png', badge: 'icons/badge.png' }); } catch {}
  }

  // ───────────────────────────── pairing ─────────────────────────────
  let scan = null;
  async function startScan() {
    S.view = 'scan'; render();
    const video = $('#scan-video');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch { S.view = 'code'; render(); toast(t('noCamera'), 'err'); return; }
    video.srcObject = stream; await video.play().catch(() => {});
    const worker = new Worker('scan-worker.js');
    const cv = document.createElement('canvas'); const side = 520; cv.width = side; cv.height = side; const g = cv.getContext('2d', { willReadFrequently: true });
    let busyW = false, stopped = false;
    scan = { stop() { stopped = true; worker.terminate(); stream.getTracks().forEach((x) => x.stop()); scan = null; } };
    worker.onmessage = async (e) => {
      busyW = false;
      if (stopped) return;
      if (e.data && e.data.ok) { navigator.vibrate && navigator.vibrate(40); $('.scan-ring') && $('.scan-ring').classList.add('hit'); scan.stop(); await pairWith(e.data.data27); }
    };
    const tick = () => {
      if (stopped) return;
      if (!busyW && video.videoWidth) {
        const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw, vh);
        g.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, side, side);
        const im = g.getImageData(0, 0, side, side);
        busyW = true; worker.postMessage({ data: im.data.buffer, width: side, height: side }, [im.data.buffer]);
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
  function stopScan() { if (scan) scan.stop(); }
  async function pairWith(data27) {
    const payload = A.unpackPayload(data27 instanceof Uint8Array ? data27 : new Uint8Array(data27));
    if (!payload) { toast(t('badCode'), 'err'); S.view = 'welcome'; render(); return; }
    S.view = 'pairing'; S.pairErr = ''; render();
    if (!S.identity) { S.identity = await A.genKeys(); await kv.set('identity', S.identity.jwk); }
    const urls = A.relaysFor(payload.flags, S.settings.customRelay);
    if (relay) relay.close();
    relay = new A.Relay(urls, {});
    for (let i = 0; i < 40 && !relay.up(); i++) await sleep(250);
    try {
      const link = await A.phonePair({ relay, identity: S.identity, payload, name: deviceName(), platform: platform(), timeout: 45000 });
      link.relays = link.relays && link.relays.length ? link.relays : urls;
      S.link = link; await kv.set('link', link);
      S.view = 'paired'; render();
      connect(true);
    } catch (e) {
      S.pairErr = String(e.message) === 'timeout' ? t('pairTimeout') : t('pairFailed');
      S.view = 'pairing'; render();
    }
  }
  async function forget(remote) {
    if (session && !remote) { try { await rpc('unpair', {}, 5000); } catch {} }
    if (session) { try { await session.send({ t: 'bye' }); } catch {} session.close(); session = null; }
    if (relay) { relay.close(); relay = null; }
    S.link = null; S.conn = { state: 'off', info: null, err: '' };
    await kv.del('link');
    S.view = 'welcome'; render();
  }

  // ───────────────────────────── photos ─────────────────────────────
  async function addPhotos(files) {
    for (const f of [...files].slice(0, 4)) {
      if (!/^image\//.test(f.type)) continue;
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }).catch(() => null);
      URL.revokeObjectURL(url); if (!img) continue;
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      S.atts.push({ kind: 'image', name: f.name || 'photo.jpg', type: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.85) });
    }
    renderComposer();
  }

  // ───────────────────────────── voice ─────────────────────────────
  // Microphone with simple voice-activity detection → 16 kHz WAV (what the computer's Whisper expects).
  const Mic = {
    stream: null, ctx: null, proc: null, rec: null, pre: [], speaking: false, voiced: 0, silent: 0, floor: 0.008,
    async start(onUtterance, onLevel, opts = {}) {
      this.onUtterance = onUtterance; this.onLevel = onLevel; this.vad = opts.vad !== false;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
      const mute = this.ctx.createGain(); mute.gain.value = 0;
      src.connect(this.proc); this.proc.connect(mute); mute.connect(this.ctx.destination);
      const frameMs = (2048 / this.ctx.sampleRate) * 1000;
      if (!this.vad) this.rec = [];
      this.proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0); let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        const rms = Math.sqrt(sum / d.length); this.onLevel && this.onLevel(rms);
        const copy = new Float32Array(d);
        if (!this.vad) { this.rec.push(copy); return; }
        if (this.paused) return;
        const thr = Math.max(0.012, this.floor * 3);
        if (!this.speaking) {
          this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03;
          this.pre.push(copy); if (this.pre.length > 10) this.pre.shift();
          if (rms > thr) { if (++this.voiced >= 3) { this.speaking = true; this.rec = [...this.pre]; this.silent = 0; } } else this.voiced = 0;
        } else {
          this.rec.push(copy);
          if (rms < thr * 0.7) this.silent += frameMs; else this.silent = 0;
          const dur = this.rec.length * frameMs;
          if (this.silent > 800 || dur > 30000) {
            this.speaking = false; this.voiced = 0; this.pre = [];
            const chunks = this.rec; this.rec = null;
            if (dur - this.silent > 350) this.onUtterance(wav(chunks, this.ctx.sampleRate));
          }
        }
      };
    },
    finish() { const chunks = this.rec || []; const rate = this.ctx ? this.ctx.sampleRate : 48000; this.stop(); return wav(chunks, rate); },
    stop() {
      try { this.proc && (this.proc.onaudioprocess = null); this.ctx && this.ctx.close(); } catch {}
      if (this.stream) this.stream.getTracks().forEach((x) => x.stop());
      Object.assign(this, { stream: null, ctx: null, proc: null, rec: null, pre: [], speaking: false, voiced: 0, silent: 0, paused: false });
    },
  };
  function wav(chunks, rate) {
    const n = chunks.reduce((a, c) => a + c.length, 0); const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const ratio = rate / 16000, len = Math.floor(n / ratio), pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) pcm[i] = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)])) * 0x7fff;
    const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf); const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    new Int16Array(buf, 44).set(pcm); return new Uint8Array(buf);
  }
  const pcVoice = () => !!(session && S.conn.info && S.conn.info.voice && S.conn.info.voice.ready);
  async function transcribe(wavBytes) {
    if (pcVoice()) { const r = await rpc('voice.stt', { wav: A.b64u(wavBytes).replace(/-/g, '+').replace(/_/g, '/'), lang }, 120000); return (r && r.text) || ''; }
    throw new Error(t('noStt'));
  }
  // Browser speech recognition (fallback when the computer's voice isn't available).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function browserListen() {
    return new Promise((resolve, reject) => {
      const r = new SR(); r.lang = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' }[lang]; r.interimResults = false; r.maxAlternatives = 1;
      let got = ''; r.onresult = (e) => { got = e.results[0][0].transcript; }; r.onerror = (e) => reject(new Error(e.error)); r.onend = () => resolve(got); r.start();
      Mic._sr = r;
    });
  }
  // Speaker: sentence by sentence, from the computer's Piper voice, else the phone's own voice.
  const Speaker = {
    q: [], playing: false, gen: 0, audio: null,
    say(text) { const clean = speakable(text); if (!clean) return; const g = this.gen; const job = { text: clean, wav: pcVoice() ? rpc('voice.tts', { text: clean }, 60000).catch(() => null) : null }; this.q.push(job); if (!this.playing) this.next(g); },
    async next(g) {
      if (g !== this.gen) return; const job = this.q.shift(); if (!job) { this.playing = false; this.onIdle && this.onIdle(); return; }
      this.playing = true;
      const r = job.wav ? await job.wav : null;
      if (g !== this.gen) return;
      if (r && r.wav) {
        const bytes = A.unb64u(r.wav.replace(/\+/g, '-').replace(/\//g, '_'));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        this.audio = new Audio(url);
        await new Promise((res) => { this.audio.onended = res; this.audio.onerror = res; this.audio.play().catch(res); });
        URL.revokeObjectURL(url);
      } else if ('speechSynthesis' in window) {
        await new Promise((res) => { const u = new SpeechSynthesisUtterance(job.text); u.lang = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' }[lang]; u.onend = res; u.onerror = res; speechSynthesis.speak(u); });
      }
      this.next(g);
    },
    stop() { this.gen++; this.q = []; this.playing = false; try { this.audio && this.audio.pause(); } catch {} try { speechSynthesis.cancel(); } catch {} },
  };
  const speakable = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>|~]/g, '').replace(/\s+/g, ' ').trim();

  // Voice mode: listen → transcribe → ask → speak, hands-free, until closed.
  function openVoice() {
    if (!S.cur) { const c = newConv(); S.cur = c.id; saveConv(c); }
    const V = S.voice = { phase: 'listening', user: '', ai: '', convId: S.cur, spoken: 0, level: 0, err: '' };
    V.feed = (text) => {
      V.ai = text; V.phase = 'speaking';
      // speak complete sentences as they arrive
      const done = text.slice(V.spoken); const m = done.match(/^[\s\S]*?[.!?…:](\s|$)/g);
      if (m) { const chunk = m.join(''); V.spoken += chunk.length; Speaker.say(chunk); }
      paintVoice();
    };
    V.done = (text, err) => {
      if (err) { V.err = err; V.phase = 'listening'; paintVoice(); return; }
      const rest = (text || '').slice(V.spoken); if (rest.trim()) Speaker.say(rest); V.spoken = (text || '').length;
      Speaker.onIdle = () => { if (S.voice === V) { V.phase = 'listening'; Mic.paused = false; paintVoice(); } };
      if (!Speaker.playing) Speaker.onIdle();
    };
    renderVoice();
    const heard = async (bytes) => {
      if (S.voice !== V) return;
      Mic.paused = true; V.phase = 'thinking'; paintVoice();
      try {
        const text = await transcribe(bytes);
        if (!text.trim()) { Mic.paused = false; V.phase = 'listening'; paintVoice(); return; }
        V.user = text; V.ai = ''; V.spoken = 0; paintVoice();
        await send(text);
      } catch (e) { V.err = e.message; Mic.paused = false; V.phase = 'listening'; paintVoice(); }
    };
    if (pcVoice() || !SR) {
      Mic.start(heard, (lv) => { V.level = lv; const o = $('.vx-orb'); if (o) o.style.setProperty('--lv', Math.min(1, lv * 14).toFixed(2)); }).catch((e) => { V.err = t('noMic'); paintVoice(); });
    } else {
      const loop = async () => {
        while (S.voice === V) {
          if (V.phase !== 'listening') { await sleep(300); continue; }
          try { const text = await browserListen(); if (S.voice !== V) return; if (text.trim()) { V.phase = 'thinking'; V.user = text; V.ai = ''; V.spoken = 0; paintVoice(); await send(text); } } catch (e) { V.err = e.message; paintVoice(); await sleep(1500); }
        }
      };
      loop();
    }
  }
  function closeVoice() { Mic.stop(); Speaker.stop(); try { Mic._sr && Mic._sr.abort(); } catch {} S.voice = null; $('#vx') && $('#vx').remove(); render(); }
  // Dictation into the composer.
  async function dictate(btn) {
    if (S.dictating) {
      S.dictating = false; btn.classList.remove('rec');
      const bytes = Mic.finish();
      try { const text = await transcribe(bytes); if (text) { S.draft = (S.draft ? S.draft + ' ' : '') + text; renderComposer(); $('#prompt') && $('#prompt').focus(); } } catch (e) { toast(e.message, 'err'); }
      return;
    }
    if (!pcVoice()) {
      if (!SR) { toast(t('noStt'), 'err'); return; }
      btn.classList.add('rec');
      try { const text = await browserListen(); if (text) { S.draft = (S.draft ? S.draft + ' ' : '') + text; renderComposer(); } } catch (e) { toast(e.message, 'err'); }
      btn.classList.remove('rec'); return;
    }
    try { await Mic.start(() => {}, null, { vad: false }); S.dictating = true; btn.classList.add('rec'); } catch { toast(t('noMic'), 'err'); }
  }

  // ───────────────────────────── rendering ─────────────────────────────
  const ICON = {
    menu: '<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    send: '<path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>',
    mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    photo: '<path d="M4 7h3l2-2.5h6L17 7h3v12H4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><circle cx="12" cy="13" r="3.6" stroke="currentColor" stroke-width="2" fill="none"/>',
    gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>',
    x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>',
    back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 18.5h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    agent: '<rect x="4" y="7" width="16" height="12" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="9.5" cy="13" r="1.5" fill="currentColor"/><circle cx="14.5" cy="13" r="1.5" fill="currentColor"/><path d="M12 7V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M10 20.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="2" fill="none"/>',
  };
  const ic = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
  const logo = (s = 28, cls = '') => `<svg class="logo ${cls}" width="${s}" height="${s}" viewBox="0 0 100 100" aria-hidden="true">${markPath ? `<path class="prop" fill-rule="evenodd" d="${markPath}"/>` : '<circle class="prop" cx="50" cy="50" r="30"/>'}</svg>`;

  function md(text) {
    try { return DOMPurify.sanitize(marked.parse(String(text || ''), { breaks: true, gfm: true }), { FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] }); } catch { return esc(text); }
  }
  function render() {
    const app = $('#app');
    document.documentElement.lang = lang;
    if (!S.link && !['scan', 'code', 'pairing', 'paired'].includes(S.view)) S.view = 'welcome';
    if (S.view === 'welcome') app.innerHTML = welcomeView();
    else if (S.view === 'scan') app.innerHTML = scanView();
    else if (S.view === 'code') app.innerHTML = codeView();
    else if (S.view === 'pairing') app.innerHTML = pairingView();
    else if (S.view === 'paired') app.innerHTML = pairedView();
    else { app.innerHTML = mainView(); renderHeader(); renderComposer(); }
    renderSheet();
  }
  function welcomeView() {
    return `<main class="welcome">
      <div class="w-hero">${logo(84, 'spin-in')}<h1>Fabro Anywhere</h1><p>${esc(t('tagline'))}</p></div>
      <ol class="w-steps"><li>${esc(t('step1'))}</li><li>${esc(t('step2'))}</li></ol>
      <div class="w-actions">
        <button class="btn primary lg" data-act="scan">${ic('eye', 20)} ${esc(t('pair'))}</button>
        <button class="btn ghost" data-act="code">${ic('keyboard', 18)} ${esc(t('typeCode'))}</button>
      </div>
      ${installHint()}
      <footer class="w-foot"><a href="../">${esc(t('about'))}</a> · <a href="../privacy.html">${esc(t('privacy'))}</a></footer>
    </main>`;
  }
  function installHint() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return '';
    if (S.installEvt) return `<button class="btn ghost sm" data-act="install">${ic('plus', 16)} ${esc(t('install'))}</button>`;
    if (/iPhone|iPad/.test(navigator.userAgent)) return `<p class="hint">${esc(t('installIos'))}</p>`;
    return '';
  }
  const scanView = () => `<main class="scan">
      <video id="scan-video" playsinline muted></video>
      <div class="scan-shade"><div class="scan-ring"></div></div>
      <div class="scan-top"><button class="icon-btn light" data-act="scan-close" aria-label="${esc(t('close'))}">${ic('x')}</button></div>
      <div class="scan-bottom"><p>${esc(t('scanHint'))}</p><button class="btn ghost light" data-act="code">${ic('keyboard', 18)} ${esc(t('typeCode'))}</button></div>
    </main>`;
  const codeView = () => `<main class="welcome">
      <div class="w-hero">${logo(56)}<h1>${esc(t('typeCode'))}</h1><p>${esc(t('codeHint'))}</p></div>
      <form class="code-form" data-form="code"><input id="code-in" class="input big mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-…" aria-label="${esc(t('typeCode'))}">
      <button class="btn primary lg" type="submit">${esc(t('pairBtn'))}</button></form>
      <button class="btn ghost" data-act="home">${ic('back', 18)} ${esc(t('back'))}</button>
    </main>`;
  const pairingView = () => `<main class="welcome">
      <div class="w-hero">${S.pairErr ? logo(64) : `<div class="spinner-big">${logo(72, 'spin')}</div>`}<h1>${esc(S.pairErr ? t('pairFailedT') : t('pairing'))}</h1><p>${esc(S.pairErr || t('pairingHint'))}</p></div>
      ${S.pairErr ? `<div class="w-actions"><button class="btn primary lg" data-act="scan">${esc(t('retry'))}</button><button class="btn ghost" data-act="home">${esc(t('back'))}</button></div>` : ''}
    </main>`;
  const pairedView = () => `<main class="welcome">
      <div class="w-hero"><div class="ok-badge">${ic('check', 40)}</div><h1>${esc(t('pairedT', { n: S.link.pcName || 'PC' }))}</h1><p>${esc(t('pairedB'))}</p></div>
      <div class="w-actions">
        ${'PushManager' in window ? `<button class="btn primary lg" data-act="notify-on">${ic('bell', 20)} ${esc(t('notifyOn'))}</button>` : ''}
        <button class="btn ${'PushManager' in window ? 'ghost' : 'primary lg'}" data-act="start">${esc(t('start'))}</button>
      </div>
      ${installHint()}
    </main>`;

  function mainView() {
    return `<div class="shell ${S.drawer ? 'drawer-open' : ''}">
      <aside class="drawer" aria-label="${esc(t('chats'))}">
        <div class="d-head">${logo(26)}<b>Fabro</b><span class="grow"></span><button class="icon-btn" data-act="settings" aria-label="${esc(t('settings'))}">${ic('gear')}</button></div>
        <button class="btn primary new-chat" data-act="new">${ic('plus', 18)} ${esc(t('newChat'))}</button>
        <nav class="d-list">${convList()}</nav>
      </aside>
      <div class="scrim" data-act="drawer-close"></div>
      <section class="main">
        <header class="top" id="top"></header>
        <div class="chat" id="chat">${chatBody()}</div>
        <div class="composer-wrap" id="composer"></div>
      </section>
    </div>`;
  }
  function allConvs() {
    const map = new Map();
    for (const m of S.metas) map.set(m.id, { ...m, partial: true });
    for (const c of S.convs.values()) map.set(c.id, { id: c.id, title: c.title, updatedAt: c.updatedAt, agent: c.agent, dirty: c.dirty });
    return [...map.values()].filter((c) => !S.tombstones.includes(c.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  function convList() {
    const list = allConvs();
    if (!list.length) return `<p class="muted pad">${esc(t('noChats'))}</p>`;
    return list.slice(0, 300).map((c) => `<button class="d-item ${c.id === S.cur ? 'on' : ''}" data-act="open" data-id="${esc(c.id)}">
      ${c.agent ? `<span class="d-ic">${ic('agent', 15)}</span>` : ''}<span class="d-t">${esc(c.title || t('untitled'))}</span>${c.dirty ? '<span class="dot" title=""></span>' : ''}</button>`).join('');
  }
  function renderHeader() {
    const el = $('#top'); if (!el) return;
    const st = S.conn.state;
    const label = st === 'direct' ? t('direct') : st === 'relay' ? t('viaRelay') : st === 'connecting' ? t('connecting') : S.settings.model === 'phone' || (localInfo() && S.settings.localFallback) ? t('phoneModel') : t('offlineShort');
    const c = curConv();
    el.innerHTML = `<button class="icon-btn" data-act="drawer" aria-label="${esc(t('chats'))}">${ic('menu')}</button>
      <button class="pc-chip" data-act="model">
        <span class="pc-dot ${st}"></span>
        <span class="pc-txt"><b>${esc(modelLabel())}</b><small>${esc((S.link && S.link.pcName) || 'PC')} · ${esc(label)}</small></span>
      </button>
      <span class="grow"></span>
      <button class="icon-btn" data-act="voice" aria-label="${esc(t('voiceMode'))}">${ic('wave')}</button>`;
  }
  function modelLabel() {
    if (S.settings.model === 'phone') { const m = localInfo(); return m ? `${m.name} · ${t('onPhone')}` : t('onPhone'); }
    const m = S.models.find((x) => refKey(x.ref) === refKey(S.settings.model));
    return m ? m.label : (S.conn.info ? t('defaultModel') : 'Fabro');
  }
  function chatBody() {
    const c = curConv();
    if (!c) {
      const meta = S.cur && S.metas.find((m) => m.id === S.cur);
      if (meta) return `<div class="empty">${logo(48)}<p>${esc(session ? t('loading') : t('notDownloaded'))}</p></div>`;
      return `<div class="empty">${logo(64, 'spin-in')}<h2>${esc(t('hello'))}</h2><p class="muted">${esc(S.link ? t('helloSub', { n: S.link.pcName || 'PC' }) : '')}</p>
        <div class="sugs">${[t('sug1'), t('sug2'), t('sug3')].map((s) => `<button class="sug" data-act="sug">${esc(s)}</button>`).join('')}</div></div>`;
    }
    const path = A.pathOf(c);
    return `<div class="msgs">${path.map(msgHtml).join('')}</div>`;
  }
  function msgHtml(m) {
    if (m.role === 'user') {
      const imgs = (m.attachments || []).filter((a) => a.kind === 'image' && a.data).map((a) => `<img src="${esc(a.data)}" alt="${esc(a.name || '')}" class="att-img">`).join('');
      const files = (m.attachments || []).filter((a) => a.kind !== 'image').map((a) => `<span class="att-file">${esc(a.name || 'file')}</span>`).join('');
      return `<div class="msg user" id="m-${esc(m.id)}">${imgs || files ? `<div class="atts">${imgs}${files}</div>` : ''}${m.content ? `<div class="bubble">${esc(m.content)}</div>` : ''}${queued(m.id) ? `<div class="queued">${esc(t('queued'))}</div>` : ''}</div>`;
    }
    return `<div class="msg ai" id="m-${esc(m.id)}">${aiInner(m)}</div>`;
  }
  function aiInner(m) {
    const steps = (m.steps || []).filter((s) => !s.parent);
    const asks = [...S.asks.values()].filter((a) => a.runId === m.runId || (m.pending && a.convId === S.cur));
    return `${m.reasoning ? `<details class="think"><summary>${esc(t('thinking'))}</summary><div>${esc(m.reasoning)}</div></details>` : ''}
      ${steps.length ? `<div class="steps">${steps.map((s) => `<span class="step ${s.status}">${s.status === 'running' ? '<i class="pulse"></i>' : s.status === 'error' ? '⚠' : '✓'} ${esc(toolName(s.name))}</span>`).join('')}</div>` : ''}
      ${asks.map((a) => `<div class="ask"><b>${esc(t('askTitle'))}</b><p>${esc(a.summary || a.tool || '')}</p>${a.detail ? `<pre>${esc(String(a.detail).slice(0, 600))}</pre>` : ''}<div class="ask-btns"><button class="btn primary sm" data-act="ask" data-id="${esc(a.id)}" data-v="once">${esc(t('allow'))}</button><button class="btn sm" data-act="ask" data-id="${esc(a.id)}" data-v="deny">${esc(t('deny'))}</button></div></div>`).join('')}
      <div class="md">${m.content ? md(m.content) : m.pending ? `<span class="typing">${logo(22, 'spin')}</span>` : ''}</div>
      ${m.error ? `<div class="err">⚠ ${esc(m.error)}</div>` : ''}
      ${!m.pending ? `<div class="meta">${esc(m.model || '')}</div>` : ''}`;
  }
  const toolName = (n) => ({ web_search: t('t_search'), fetch_url: t('t_fetch'), generate_image: t('t_image'), run_subagent: t('t_sub'), update_plan: t('t_plan') }[n] || String(n || '').replace(/_/g, ' '));
  function paintMessage(m) {
    const el = $(`#m-${CSS.escape(m.id)}`);
    if (!el) { const box = $('#chat'); if (box) box.innerHTML = chatBody(); return; }
    el.innerHTML = aiInner(m);
  }
  function scrollChat(force) {
    const el = $('#chat'); if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (force || near) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }
  function renderComposer() {
    const el = $('#composer'); if (!el) return;
    const c = curConv();
    const running = busy(c);
    const ph = S.conn.state === 'off' && !(localInfo() && S.settings.localFallback) && S.settings.model !== 'phone' ? t('phOffline') : t('placeholder');
    const vision = S.settings.model === 'phone' ? false : (S.models.find((x) => refKey(x.ref) === refKey(S.settings.model)) || {}).vision !== false;
    const kept = $('#prompt') ? $('#prompt').value : S.draft;
    el.innerHTML = `${S.conn.state === 'off' && S.link ? `<div class="banner">${esc(S.conn.err || t('pcAway'))} <button class="link" data-act="reconnect">${esc(t('retry'))}</button></div>` : ''}
      ${S.atts.length ? `<div class="c-atts">${S.atts.map((a, i) => `<span class="c-att"><img src="${esc(a.data)}" alt=""><button data-act="att-rm" data-i="${i}" aria-label="${esc(t('remove'))}">${ic('x', 14)}</button></span>`).join('')}</div>` : ''}
      <form class="composer" data-form="send">
        <textarea id="prompt" rows="1" placeholder="${esc(ph)}" aria-label="${esc(t('placeholder'))}">${esc(kept)}</textarea>
        <div class="c-row">
          <label class="icon-btn ${vision ? '' : 'dim'}" aria-label="${esc(t('addPhoto'))}">${ic('photo')}<input type="file" accept="image/*" multiple hidden id="photo-in"></label>
          <button type="button" class="chip ${c && c.agent || (!c && S.settings.agent) ? 'on' : ''}" data-act="agent">${ic('agent', 16)} ${esc(t('agent'))}</button>
          <span class="grow"></span>
          <button type="button" class="icon-btn ${S.dictating ? 'rec' : ''}" data-act="dictate" aria-label="${esc(t('dictate'))}">${ic('mic')}</button>
          ${running ? `<button type="button" class="send stop" data-act="stop" aria-label="${esc(t('stop'))}">${ic('stop', 18)}</button>` : `<button type="submit" class="send" aria-label="${esc(t('send'))}">${ic('send', 20)}</button>`}
        </div>
      </form>`;
    const ta = $('#prompt'); fit(ta);
  }
  const fit = (ta) => { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };

  // sheets (settings, model picker)
  function renderSheet() {
    const root = $('#sheet-root'); if (!root) return;
    if (!S.sheet) { root.innerHTML = ''; return; }
    const body = S.sheet === 'settings' ? settingsSheet() : S.sheet === 'model' ? modelSheet() : '';
    const keepScroll = $('.sheet-body') ? $('.sheet-body').scrollTop : 0;
    root.innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="sheet-body">${body}</div></div>`;
    $('.sheet-body').scrollTop = keepScroll;
  }
  function modelSheet() {
    const cur = refKey(S.settings.model);
    const pc = S.models.map((m) => `<button class="opt ${cur === refKey(m.ref) ? 'on' : ''}" data-act="pick-model" data-k="${esc(refKey(m.ref))}"><span class="opt-ic">${ic('pc', 18)}</span><span class="opt-t"><b>${esc(m.label)}</b><small>${esc([m.provider, m.vision ? t('vision') : ''].filter(Boolean).join(' · ') || t('onPc'))}</small></span>${cur === refKey(m.ref) ? ic('check', 18) : ''}</button>`).join('');
    const lm = localInfo();
    return `<h2>${esc(t('model'))}</h2>
      ${S.models.length ? pc : `<p class="muted">${esc(session ? t('noModels') : t('modelsOffline'))}</p>`}
      <div class="sep"></div>
      ${lm ? `<button class="opt ${cur === 'phone' ? 'on' : ''}" data-act="pick-model" data-k="phone"><span class="opt-ic">${ic('phone', 18)}</span><span class="opt-t"><b>${esc(lm.name)}</b><small>${esc(t('onPhone'))} · ${esc(S.local.status === 'ready' ? t('ready') : t('loadsWhenUsed'))}</small></span>${cur === 'phone' ? ic('check', 18) : ''}</button>`
        : `<button class="opt" data-act="settings">${ic('phone', 18)}<span class="opt-t"><b>${esc(t('localTitle'))}</b><small>${esc(t('localHint'))}</small></span></button>`}`;
  }
  function settingsSheet() {
    const st = S.conn.state; const info = S.conn.info || {};
    const lm = localInfo();
    const loc = S.local;
    const pushOk = 'PushManager' in window;
    const notifyOn = pushOk && Notification.permission === 'granted' && S.settings.notify;
    return `<h2>${esc(t('settings'))}</h2>
      <div class="card pc-card">${ic('pc', 26)}<div><b>${esc((S.link && S.link.pcName) || 'PC')}</b><small>${esc(st === 'direct' ? t('direct') : st === 'relay' ? t('viaRelay') : st === 'connecting' ? t('connecting') : t('offlineShort'))}${info.version ? ' · Fabro ' + esc(info.version) : ''}</small></div></div>
      <div class="set-row"><span>${ic('bell', 18)} ${esc(t('notifications'))}</span>${pushOk ? `<button class="switch ${notifyOn ? 'on' : ''}" data-act="${notifyOn ? 'notify-off' : 'notify-on'}" role="switch" aria-checked="${notifyOn}"><i></i></button>` : `<small class="muted">${esc(t('noPush'))}</small>`}</div>
      ${pushOk && /iPhone|iPad/.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? `<p class="hint">${esc(t('iosPush'))}</p>` : ''}
      <h3>${esc(t('localTitle'))}</h3>
      <p class="muted small">${esc(t('localExplain'))}</p>
      ${loc.status === 'loading' ? `<div class="progress"><i style="width:${Math.round(loc.progress * 100)}%"></i></div><p class="muted small">${esc(loc.text.slice(0, 120))}</p>`
        : loc.status === 'unsupported' ? `<p class="err small">${esc(t('noWebgpu'))}</p>`
        : lm ? `<div class="set-row"><span>${esc(lm.name)} <small class="muted">${esc(lm.size)}</small></span><button class="btn sm" data-act="local-rm">${ic('trash', 15)} ${esc(t('remove'))}</button></div>
               <div class="set-row"><span>${esc(t('localFallback'))}</span><button class="switch ${S.settings.localFallback ? 'on' : ''}" data-act="local-fallback" role="switch" aria-checked="${!!S.settings.localFallback}"><i></i></button></div>`
        : LOCAL_MODELS.map((m) => `<button class="opt" data-act="local-get" data-id="${m.id}"><span class="opt-ic">${ic('phone', 18)}</span><span class="opt-t"><b>${esc(m.name)}</b><small>${esc(m.size)} · ${esc(t('download'))}</small></span></button>`).join('')}
      ${loc.status === 'error' ? `<p class="err small">${esc(loc.text)}</p>` : ''}
      <h3>${esc(t('display'))}</h3>
      <div class="set-row"><span>${esc(t('language'))}</span><select class="input sm" data-change="lang">${['auto', ...LANGS].map((l) => `<option value="${l}" ${S.settings.lang === l ? 'selected' : ''}>${l === 'auto' ? t('auto') : { en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch' }[l]}</option>`).join('')}</select></div>
      <div class="set-row"><span>${esc(t('theme'))}</span><select class="input sm" data-change="theme">${['system', 'light', 'dark'].map((v) => `<option value="${v}" ${S.settings.theme === v ? 'selected' : ''}>${esc(t('theme_' + v))}</option>`).join('')}</select></div>
      <h3>${esc(t('advanced'))}</h3>
      <label class="field"><span>${esc(t('customRelay'))}</span><input class="input" data-change="relay" placeholder="wss://…" value="${esc(S.settings.customRelay || '')}"></label>
      <p class="muted small">${esc(t('relayHint'))}</p>
      <div class="sep"></div>
      <button class="btn danger" data-act="unpair">${esc(t('unpair'))}</button>
      <p class="muted small center">Fabro Anywhere · <a href="../privacy.html">${esc(t('privacy'))}</a></p>`;
  }
  function renderVoice() {
    let el = $('#vx'); if (!el) { el = document.createElement('div'); el.id = 'vx'; el.className = 'vx'; document.body.appendChild(el); }
    el.innerHTML = `<div class="vx-top"><span>${esc(t('voiceMode'))}</span><button class="icon-btn light" data-act="voice-close" aria-label="${esc(t('close'))}">${ic('x')}</button></div>
      <div class="vx-mid"><div class="vx-orb">${logo(120, 'vx-prop')}</div><p class="vx-phase"></p></div>
      <div class="vx-sub"><p class="vx-user"></p><p class="vx-ai"></p><p class="vx-err err"></p></div>`;
    paintVoice();
  }
  function paintVoice() {
    const V = S.voice; const el = $('#vx'); if (!V || !el) return;
    el.dataset.phase = V.phase;
    $('.vx-phase', el).textContent = t('vx_' + V.phase);
    $('.vx-user', el).textContent = V.user ? `“${V.user}”` : '';
    $('.vx-ai', el).textContent = speakable(V.ai).slice(-280);
    $('.vx-err', el).textContent = V.err || '';
  }

  // ───────────────────────────── events ─────────────────────────────
  const acts = {
    scan: () => startScan(),
    'scan-close': () => { stopScan(); S.view = S.link ? 'main' : 'welcome'; render(); },
    code: () => { stopScan(); S.view = 'code'; render(); setTimeout(() => $('#code-in') && $('#code-in').focus(), 50); },
    home: () => { S.view = S.link ? 'main' : 'welcome'; render(); },
    install: async () => { if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice.catch(() => {}); S.installEvt = null; render(); } },
    'notify-on': async () => { const ok = await ensurePush(true); if (S.view === 'paired') { S.view = 'main'; render(); } else renderSheet(); if (ok) toast(t('notifyReady')); },
    'notify-off': async () => { await disablePush(); renderSheet(); },
    start: () => { S.view = 'main'; render(); },
    new: () => { S.cur = null; S.drawer = false; render(); setTimeout(() => $('#prompt') && $('#prompt').focus(), 50); },
    open: (el) => openConv(el.dataset.id),
    drawer: () => { S.drawer = true; $('.shell') && $('.shell').classList.add('drawer-open'); },
    'drawer-close': () => { S.drawer = false; $('.shell') && $('.shell').classList.remove('drawer-open'); },
    settings: () => { S.drawer = false; $('.shell') && $('.shell').classList.remove('drawer-open'); S.sheet = 'settings'; renderSheet(); },
    model: () => { S.sheet = 'model'; renderSheet(); if (session) rpc('models').then((l) => { S.models = l; renderSheet(); }).catch(() => {}); },
    'sheet-close': () => { S.sheet = null; renderSheet(); },
    'pick-model': async (el) => {
      const k = el.dataset.k;
      S.settings.model = k === 'phone' ? 'phone' : (S.models.find((m) => refKey(m.ref) === k) || {}).ref || null;
      await saveSettings(); S.sheet = null; renderSheet(); renderHeader(); renderComposer();
      if (k === 'phone' && S.local.status !== 'ready') loadLocal(localInfo());
    },
    sug: (el) => { S.draft = el.textContent; renderComposer(); $('#prompt').focus(); },
    agent: async () => { const c = curConv(); if (c) { c.agent = !c.agent; c.updatedAt = now(); c.dirty = true; await saveConv(c); } else { S.settings.agent = !S.settings.agent; await saveSettings(); } renderComposer(); },
    dictate: (el) => dictate(el),
    stop: () => stopRun(),
    ask: (el) => answerAsk(el.dataset.id, el.dataset.v),
    'att-rm': (el) => { S.atts.splice(+el.dataset.i, 1); renderComposer(); },
    reconnect: () => { retryN = 0; connect(true); },
    voice: () => openVoice(),
    'voice-close': () => closeVoice(),
    'local-get': (el) => { const m = LOCAL_MODELS.find((x) => x.id === el.dataset.id); if (m) loadLocal(m, { download: true }); },
    'local-rm': () => removeLocal(),
    'local-fallback': async () => { S.settings.localFallback = !S.settings.localFallback; await saveSettings(); renderSheet(); },
    unpair: async () => { if (!confirm(t('unpairQ'))) return; S.sheet = null; await forget(false); },
    delete: async (el) => {
      const id = el.dataset.id; if (!confirm(t('deleteQ'))) return;
      S.convs.delete(id); await DB.del('convs', id); S.metas = S.metas.filter((m) => m.id !== id);
      if (session) rpc('conv.delete', { id }).catch(() => { S.tombstones.push(id); kv.set('tombstones', S.tombstones); });
      else { S.tombstones.push(id); await kv.set('tombstones', S.tombstones); }
      if (S.cur === id) S.cur = null; render();
    },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = acts[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    if (f.dataset.form === 'send') { const ta = $('#prompt'); const v = ta.value; if (busy(curConv())) return; send(v, S.atts.slice()); }
    if (f.dataset.form === 'code') { A.parseTextCode($('#code-in').value).then((d) => { if (d) pairWith(d); else toast(t('badCode'), 'err'); }); }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'prompt') { S.draft = e.target.value; fit(e.target); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'prompt' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); e.target.form.requestSubmit(); }
    if (e.key === 'Escape') { if (S.voice) closeVoice(); else if (S.sheet) { S.sheet = null; renderSheet(); } }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'photo-in') { await addPhotos(e.target.files); return; }
    const k = e.target.dataset.change; if (!k) return;
    if (k === 'lang') { S.settings.lang = e.target.value; await saveSettings(); applyLang(); render(); }
    if (k === 'theme') { S.settings.theme = e.target.value; await saveSettings(); applyTheme(); }
    if (k === 'relay') { const v = e.target.value.trim(); if (v && !/^wss:\/\//.test(v) && !/^ws:\/\/(127\.0\.0\.1|localhost)/.test(v)) { toast('wss://…', 'err'); return; } S.settings.customRelay = v; await saveSettings(); if (relay) { relay.close(); relay = null; } if (session) { session.close(); session = null; } connect(true); }
  });
  // long-press a conversation to delete it
  let lpT = 0;
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest('.d-item'); if (!el) return; lpT = setTimeout(() => { lpT = 0; if (confirm(t('deleteQ'))) acts.delete({ dataset: { id: el.dataset.id } }); }, 650); });
  document.addEventListener('pointerup', () => clearTimeout(lpT)); document.addEventListener('pointercancel', () => clearTimeout(lpT));
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('.d-item')) e.preventDefault(); });

  document.addEventListener('visibilitychange', () => {
    if (session) session.send({ t: 'req', id: 'v' + now(), m: 'state', p: { visible: !document.hidden } });
    if (!document.hidden && S.link && !session) { retryN = 0; connect(); }
  });
  addEventListener('online', () => { if (S.link && !session) { retryN = 0; connect(true); } });
  addEventListener('pagehide', () => { if (session) session.send({ t: 'bye' }); });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.view === 'welcome' || S.view === 'paired') render(); });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open' && e.data.convId) openConv(e.data.convId); });

  function applyLang() {
    const pref = S.settings.lang;
    if (pref && pref !== 'auto') lang = pref;
    else { lang = 'en'; for (const l of navigator.languages || [navigator.language]) { const b = String(l).slice(0, 2); if (LANGS.includes(b)) { lang = b; break; } } }
  }
  function applyTheme() {
    const v = S.settings.theme;
    try { localStorage.setItem('fa-theme', JSON.stringify(v === 'system' ? null : v)); } catch {}
    document.documentElement.dataset.theme = v === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v;
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme(); });

  // ───────────────────────────── boot ─────────────────────────────
  (async () => {
    try { const svg = await (await fetch('icons/mark.svg')).text(); const m = svg.match(/ d="([^"]+)"/); if (m) markPath = m[1]; } catch {}
    try {
      const [settings, idJwk, link, outbox, tombstones, metas, convs] = await Promise.all([kv.get('settings'), kv.get('identity'), kv.get('link'), kv.get('outbox'), kv.get('tombstones'), kv.get('metas'), DB.all('convs')]);
      Object.assign(S.settings, settings || {});
      if (idJwk) S.identity = await A.importPriv(idJwk);
      S.link = link || null; S.outbox = outbox || []; S.tombstones = tombstones || []; S.metas = metas || [];
      for (const c of convs || []) S.convs.set(c.id, c);
    } catch (e) { console.error(e); }
    applyLang(); applyTheme();
    const q = new URLSearchParams(location.search);
    if (q.get('c')) S.cur = q.get('c');
    S.view = S.link ? 'main' : 'welcome';
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (S.link) connect();
    // the phone model loads on demand (first use); the WebGPU check is cheap
    if (S.settings.localModel) S.local = { status: 'idle', progress: 0, text: '' };
    window.__fa = { S, send, connect, syncNow, pairWith, rpc, decode: A.decodeRingCode }; // tests & debugging
  })();
})();
