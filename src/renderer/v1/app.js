'use strict';
// Fabro v1 interface: one screen, one field. Built on the same main-process API as before (preload.js → window.api);
// none of the old interface's markup, styles or display code is used. Settings live in settings.js; the mod API
// (window.Fabro) in fabro.js. What isn't rebuilt yet opens in the full (previous) interface from Settings → Advanced.
(function () {
  const A = window.FabroAnywhere; // conversation tree helpers (nodesOf, pathOf) and the pairing ring code
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const uid = () => Math.random().toString(36).slice(2, 10) + now().toString(36);
  const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' Go' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : Math.max(1, Math.round(b / 1e3)) + ' ko');

  let lang = 'fr';
  const t = (k, v = {}) => String((V1_I18N[lang] || V1_I18N.en)[k] ?? V1_I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');

  // ───────────────────────────── icons (one set, 1.5 stroke) ─────────────────────────────
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>', code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>', clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>', chev: '<path d="M9 6l6 6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', file: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/>',
    back: '<path d="M15 6l-6 6 6 6"/>', pc: '<rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M9 19.5h6M12 15.5v4"/>', cloud: '<path d="M7 18a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.5A3.8 3.8 0 0117 18z"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/>', lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', redo: '<path d="M4 12a8 8 0 0113.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 01-13.7 5.6L4 15M4 20v-5h5"/>', pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 003 3h6a3 3 0 003-3V7M12 12v5"/>', left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', big: '<path d="M4 20l6-6M14 4h6v6M20 4l-7 7"/>',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  let MARK = '';
  const mark = () => `<svg viewBox="0 0 100 100" aria-hidden="true">${MARK}</svg>`;

  // ───────────────────────────── state ─────────────────────────────
  const S = {
    info: {}, settings: {}, installed: { local: [] }, provModels: [], memories: [], convs: [], conv: null,
    streaming: null, asks: new Map(), pending: [], later: [], view: 'chat', open: new Set(), update: null, private: false,
  };
  const v1set = () => S.settings.v1 || {};
  async function saveSettings(patch) { S.settings = { ...S.settings, ...patch }; await api.settings.set(patch); }

  function toast(msg, kind = '') {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
    $('#toast-root').appendChild(el); setTimeout(() => el.classList.add('out'), 2800); setTimeout(() => el.remove(), 3200);
  }

  // ───────────────────────────── models ─────────────────────────────
  const refKey = (r) => !r ? '' : r.backend === 'provider' ? `p:${r.provider}:${r.model}` : r.backend === 'local' ? `l:${r.id}` : `${r.backend}:${r.id || r.name}`;
  function allModels() {
    const l = (S.installed.local || []).filter((m) => !m.role).map((m) => ({ ref: { backend: 'local', id: m.id }, label: m.name, sub: [m.quant || 'GGUF', m.sizeBytes ? fmtBytes(m.sizeBytes) : ''].filter(Boolean).join(' · '), vision: !!m.vision, local: true }));
    const p = (S.provModels || []).map((m) => ({ ref: m.ref, label: m.label, sub: m.providerName || '', vision: !!m.vision, local: !!m.local, provider: m.providerName }));
    return [...l, ...p];
  }
  function currentModel() {
    const sel = S.settings.selectedModel; const list = allModels();
    return (sel && list.find((m) => refKey(m.ref) === refKey(sel))) || null;
  }
  async function refreshModels() {
    try { S.installed = await api.models.installed(); } catch {}
    try { S.provModels = await api.providers.models(); } catch {}
    renderSide(); renderComposer();
  }

  // ───────────────────────────── conversations ─────────────────────────────
  function newConv() { return { id: uid(), title: '', mode: 'chat', nodes: [], leafId: null, messages: [], createdAt: now(), updatedAt: now(), ephemeral: S.private }; }
  function addNode(m) {
    const c = S.conv; const last = c.messages[c.messages.length - 1];
    m.parentId = m.parentId !== undefined ? m.parentId : last ? last.id : null;
    c.nodes.push(m); c.leafId = m.id; c.messages = A.pathOf(c); return m;
  }
  let persistT = 0;
  function persist() {
    clearTimeout(persistT);
    persistT = setTimeout(async () => {
      const c = S.conv; if (!c || !c.messages.length || c.ephemeral) return;
      const { messages, ...rest } = c;
      await api.conv.save({ ...rest, updatedAt: now(), nodes: c.nodes.map(({ pending, status, ...m }) => ({ ...m, attachments: (m.attachments || []).map(({ url, ...a }) => a) })) });
      S.convs = await api.conv.list().catch(() => S.convs); renderSide();
    }, 350);
  }
  async function openConv(id) {
    if (S.streaming && S.conv && S.conv.id !== id) { /* keeps streaming in the background */ }
    const c = await api.conv.get(id).catch(() => null); if (!c) return toast('?', 'err');
    c.nodes = c.nodes || []; c.messages = A.pathOf(c); S.conv = c; S.view = 'chat'; S.private = false;
    renderAll(); scrollChat(true); Fabro._emit('conv', { id: c.id });
  }
  function newChat() { S.conv = null; S.view = 'chat'; S.pending = []; renderAll(); setTimeout(() => { const ta = $('.composer textarea'); if (ta) ta.focus(); }, 30); }

  // ───────────────────────────── sending ─────────────────────────────
  function buildMessages() {
    const out = [{ role: 'system', content: '' }]; // built in the main process from userContext (src/main/sysprompt)
    for (const m of S.conv.messages) {
      if (m.pending || (m.role === 'assistant' && m.error && !m.content)) continue;
      if (m.role === 'assistant') {
        const pr = (m.precisions || []).filter((p) => p.used).map((p) => p.text); const u = out[out.length - 1];
        if (pr.length && u && u.role === 'user') { const add = `\n\n[Précisions ajoutées pendant la réponse]\n${pr.join('\n')}`; if (typeof u.content === 'string') u.content += add; else if (u.content[0]) u.content[0].text += add; }
        out.push({ role: 'assistant', content: m.content, id: m.id, digest: m.digest }); continue;
      }
      const texts = (m.attachments || []).filter((a) => a.kind === 'text').map((a) => `File: ${a.name}\n\`\`\`${a.ext || ''}\n${a.text}\n\`\`\``)
        .concat((m.attachments || []).filter((a) => (a.kind === 'file' || a.kind === 'audio') && a.path).map((a) => `Attached file: ${a.name} (${a.ext}, ${fmtBytes(a.size || 0)}${a.pages ? `, ${a.pages} pages` : ''}), saved in your workspace at ${a.path}. ${a.kind === 'audio' ? 'Transcribe it with convert_file (to: "transcript").' : a.text ? `Its text${a.chars > a.text.length ? ` (first ${a.text.length} of ${a.chars} chars)` : ''}:\n${a.text}` : 'Use convert_file to read it.'}`));
      const content = [...texts, m.content].filter(Boolean).join('\n\n');
      const imgs = (m.attachments || []).filter((a) => a.kind === 'image' && a.data);
      if (imgs.length) out.push({ role: 'user', id: m.id, content: [{ type: 'text', text: content || ' ' }, ...imgs.map((a) => ({ type: 'image_url', image_url: { url: a.data } }))] });
      else out.push({ role: 'user', id: m.id, content });
    }
    return out;
  }
  function userContext() {
    const st = S.settings; const mem = (st.memory || {}).enabled !== false && !(S.conv && S.conv.ephemeral) ? S.memories.slice(0, 40).map((m) => m.text) : [];
    return { name: st.userName || '', aiName: (st.aiName || '').trim(), useFor: '', style: '', memories: mem, custom: ((st.gen || {}).systemPrompt || '').trim(), lang };
  }
  function agentPrompt() {
    const c = userContext();
    return [c.name ? `The user's name is ${c.name}.` : '', `Interface language: ${lang}. Today: ${new Date().toLocaleDateString(lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
      c.memories.length ? `What you know about the user:\n${c.memories.slice(0, 30).map((x) => `- ${x}`).join('\n')}` : '', c.custom].filter(Boolean).join('\n\n');
  }
  async function send(text, opts = {}) {
    text = String(text || '').trim(); const atts = S.pending.splice(0);
    if (!text && !atts.length) return;
    // /command: a mod's command, or one of Fabro's
    const cm = text.match(/^\/([a-z0-9-]+)\s*([\s\S]*)$/);
    if (cm) {
      const mod = Fabro._command(cm[1]); if (mod) { try { await mod.run(cm[2], { lang }); } catch (e) { toast(String(e.message || e), 'err'); } renderComposer(); return; }
      if (cm[1] === 'tache' || cm[1] === 'task') { opts.agent = true; text = cm[2]; }
      if (cm[1] === 'cherche' || cm[1] === 'research') { opts.agent = true; text = `Recherche approfondie : lis plusieurs pages et cite tes sources.\n\n${cm[2]}`; }
      if (cm[1] === 'prive' || cm[1] === 'private') { S.private = true; S.conv = null; renderAll(); return; }
      if (cm[1] === 'code') return openCode();
      if (!text) return;
    }
    const model = currentModel();
    if (!model) { S.pending = atts; toast(t('noModel'), 'err'); openModelMenu(); return; }
    if (!S.conv) S.conv = newConv();
    if (opts.agent) S.conv.agent = true;
    if (atts.some((a) => a.kind === 'file' || a.kind === 'audio')) S.conv.agent = true;
    addNode({ id: uid(), role: 'user', content: text, attachments: atts, createdAt: now() });
    if (!S.conv.title) S.conv.title = (text || (atts[0] && atts[0].name) || '').replace(/\s+/g, ' ').slice(0, 64);
    persist(); // shows in the list at once
    Fabro._emit('send', { text, convId: S.conv.id });
    generate(model, opts);
  }
  // tasks running now, kept in settings: after a close or a crash, Fabro offers to resume them
  function markRunning(c, on) {
    const v = { ...(S.settings.v1 || {}) }; const list = (v.running || []).filter((x) => x.id !== c.id);
    if (on && !c.ephemeral) list.push({ id: c.id, title: c.title || '', at: now() });
    v.running = list.slice(-10); saveSettings({ v1: v });
  }
  function generate(model, opts = {}) {
    const c = S.conv; markRunning(c, true);
    const msg = addNode({ id: uid(), role: 'assistant', content: '', reasoning: '', steps: [], model: model.label, pending: true, createdAt: now(), status: 'loading' });
    const reqId = uid(); S.streaming = { reqId, msg, convId: c.id, big: !!opts.big };
    clearInterval(S.saveT); S.saveT = setInterval(() => { if (S.streaming && S.conv && S.conv.id === c.id) persist(); }, 8000); // a crash keeps what was done
    renderAll(); scrollChat(true);
    const usedTools = [...new Set(c.messages.flatMap((x) => (x.steps || []).map((st) => st.name)))];
    const gen = S.settings.gen || {}; const ct = S.settings.chatTools || {};
    api.chat.send({ reqId, model: model.ref, messages: buildMessages(),
      params: { ...gen, tools: [ct.webSearch !== false && 'web_search', ct.fetch !== false && 'fetch_url', ct.images !== false && 'generate_image'].filter(Boolean), agentMode: !!c.agent,
        agentPrompt: agentPrompt(), userContext: userContext(), vision: !!model.vision, usedTools, agent: (S.settings.agent || {}).enabled !== false, artifactCheck: (S.settings.design || {}).autoCheck !== false },
      meta: { allowAll: v1set().ask === 'never' || !!c.allowAll, convId: c.id, turnId: msg.id, project: c.project || null, code: c.code ? { root: c.code.root, mode: 'edits' } : null, modelLabel: model.provider ? `${model.provider} · ${model.label}` : model.label } });
  }
  function onChatEvent(ev) {
    const st = S.streaming; if (!st || ev.reqId !== st.reqId) return;
    const m = st.msg;
    switch (ev.type) {
      case 'status': m.status = ev.status; break;
      case 'reasoning': m.reasoning = (m.reasoning || '') + ev.text; m.status = 'thinking'; break;
      case 'token': m.content += ev.text; m.status = ''; break;
      case 'retract': m.content = ''; break;
      case 'tool_round': case 'precision_round': if (m.content && !/\n\n$/.test(m.content)) m.content += '\n\n'; break;
      case 'tool_start': m.steps.push({ id: ev.id, name: ev.name, args: ev.args, status: 'running', parent: ev.parent }); m.status = ''; break;
      case 'tool_end': { const s = m.steps.find((x) => x.id === ev.id); if (s) { s.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; s.view = ev.view; if (ev.error) s.error = ev.error; } break; }
      case 'plan': if (!ev.sub) m.plan = ev.steps; break;
      case 'agent_switch': S.conv && (S.conv.agent = true); break;
      case 'permission': S.asks.set(ev.id, { kind: 'perm', reqId: ev.reqId, ...ev }); renderCards(); notifyHidden(t('wants', { s: ev.summary || ev.tool })); break;
      case 'deps_needed': S.asks.set(ev.id, { kind: 'deps', reqId: ev.reqId, id: ev.id, dep: ev.dep }); renderCards(); break;
      case 'precision_used': for (const p of m.precisions || []) if (!ev.text || p.text === ev.text) p.used = true; break;
      case 'done': m.stats = ev.stats; m.digest = ev.digest; return finish();
      case 'error': m.error = ev.message || 'Error'; m.code = ev.code; return finish();
      default: break;
    }
    paintSoon(m);
  }
  function finish() {
    const st = S.streaming; if (!st) return; S.streaming = null;
    clearInterval(S.saveT);
    const conv = S.conv && S.conv.id === st.convId ? S.conv : null; if (conv) markRunning(conv, false);
    const m = st.msg; m.pending = false; delete m.status; m.content = (m.content || '').trim();
    if (!m.content && !m.error && !m.steps.some((x) => x.view && (x.view.image || x.view.kind === 'artifact'))) m.error = t('empty');
    for (const [k, a] of S.asks) if (a.reqId === st.reqId) S.asks.delete(k);
    if (S.conv && S.conv.id === st.convId) { persist(); renderMain(); }
    renderSide(); renderComposer(); renderCards();
    notifyHidden((m.error || m.content || '').replace(/[#*_`>]/g, '').slice(0, 140));
    Fabro._emit('done', { convId: st.convId, id: m.id });
    // a plan with steps left is not "done": go on, twice at most, then let the user decide
    if (conv && !m.error && m.plan && m.plan.some((x) => x.status !== 'done') && (conv.autoGo || 0) < 2 && !S.later.some((x) => x.convId === conv.id)) {
      conv.autoGo = (conv.autoGo || 0) + 1; toast(t('planLeft'));
      return setTimeout(() => send(t('planMsg', { s: m.plan.filter((x) => x.status !== 'done').map((x) => x.title).join(' ; ') })), 400);
    }
    const i = S.later.findIndex((x) => x.convId === st.convId);
    if (i >= 0 && S.conv && S.conv.id === st.convId) { const [x] = S.later.splice(i, 1); S.pending = x.atts; send(x.text); }
  }
  function notifyHidden(body) { if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return; try { new Notification(S.conv ? S.conv.title || 'Fabro' : 'Fabro', { body }); } catch {} }
  function stop() { if (S.streaming) api.chat.abort(S.streaming.reqId); }
  async function answer(id, value) {
    const a = S.asks.get(id); if (!a) return; S.asks.delete(id); renderCards();
    await api.chat.answer(a.reqId, id, a.kind === 'deps' ? value === 'once' : value).catch(() => {});
  }

  // ───────────────────────────── attachments, voice ─────────────────────────────
  const TEXT_EXT = /\.(txt|md|csv|tsv|json|js|ts|jsx|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|html|css|scss|xml|yml|yaml|toml|ini|sh|ps1|bat|sql|lua|luau|log)$/i;
  const readAs = (f, how) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r[how](f); });
  async function addFiles(files) {
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase(); const base = { name: f.name, size: f.size, type: f.type, ext };
      try {
        if (f.type.startsWith('image/')) S.pending.push({ ...base, kind: 'image', data: await readAs(f, 'readAsDataURL') });
        else if ((TEXT_EXT.test(f.name) || f.type.startsWith('text/')) && f.size < 2e6) S.pending.push({ ...base, kind: 'text', text: await readAs(f, 'readAsText') });
        else {
          const tmp = { ...base, kind: 'file', loading: true }; S.pending.push(tmp); renderComposer();
          const p = api.files.pathOf(f);
          Object.assign(tmp, await api.files.ingest(p ? { path: p, name: f.name } : { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }), { loading: false });
        }
      } catch { toast(f.name, 'err'); }
    }
    renderComposer();
  }
  let rec = null;
  async function dictate() {
    if (rec) return rec.stop();
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); } catch { return toast('Micro', 'err'); }
    const ac = new AudioContext(); const src = ac.createMediaStreamSource(stream); const proc = ac.createScriptProcessor(4096, 1, 1); const chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); src.connect(proc); proc.connect(ac.destination);
    $('.composer').classList.add('rec');
    rec = { async stop() {
      rec = null; proc.disconnect(); src.disconnect(); stream.getTracks().forEach((x) => x.stop()); const rate = ac.sampleRate; ac.close(); $('.composer').classList.remove('rec');
      const n = chunks.reduce((a, c) => a + c.length, 0); if (n < rate / 2) return;
      const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      const len = Math.floor(n * 16000 / rate); const pcm = new Int16Array(len); for (let i = 0; i < len; i++) pcm[i] = Math.max(-1, Math.min(1, all[Math.floor(i * rate / 16000)])) * 0x7fff;
      const buf = new ArrayBuffer(44 + len * 2), dv = new DataView(buf); const w = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * 2, true); new Int16Array(buf, 44).set(pcm);
      try { const r = await api.voice.stt(new Uint8Array(buf), { lang }); const text = typeof r === 'string' ? r : (r && r.text) || ''; const ta = $('.composer textarea'); if (text) { ta.value = (ta.value ? ta.value + ' ' : '') + text.trim(); ta.dispatchEvent(new Event('input')); ta.focus(); } } catch (e) { toast(String(e.message || e), 'err'); }
    } };
  }

  // ───────────────────────────── rendering ─────────────────────────────
  marked.setOptions({ gfm: true, breaks: true });
  // pictures Fabro saved (web_images → fabro-img:<id>): <img src="fabro-img:…">, ![…](fabro-img:…) or a stray
  // <photo fabro-img:…> become a real <img>, loaded from the main process once and cached
  const fimg = new Map();
  function loadFimg(id) {
    if (fimg.has(id)) return; fimg.set(id, null);
    api.iui.img('fabro-img:' + id).then((u) => { if (!u || !/^data:image\//.test(u)) return; fimg.set(id, u); document.querySelectorAll(`img[data-fimg="${id}"]`).forEach((im) => { im.src = u; }); }).catch(() => {});
  }
  function md(text, sources) {
    let src = String(text || '')
      .replace(/!\[([^\]]*)\]\(fabro-img:([a-f0-9]{8,40})\)/g, (x, alt, id) => `<img data-fimg="${id}" alt="${esc(alt)}">`)
      .replace(/<img\b[^>]*?src=["']fabro-img:([a-f0-9]{8,40})["'][^>]*>/g, (x, id) => { const alt = (x.match(/alt=["']([^"']*)/) || [])[1] || ''; return `<img data-fimg="${id}" alt="${esc(alt)}">`; })
      .replace(/<photo\b[^>]*?fabro-img:([a-f0-9]{8,40})[^>]*>/g, (x, id) => `<img data-fimg="${id}" alt="">`);
    let h = DOMPurify.sanitize(marked.parse(src));
    h = h.replace(/<img data-fimg="([a-f0-9]{8,40})"/g, (x, id) => { loadFimg(id); const u = fimg.get(id); return u ? `<img class="fimg" src="${u}" data-fimg="${id}"` : `<img class="fimg" data-fimg="${id}"`; });
    h = h.replace(/\[(\d{1,2})\](?![^<]*<\/a>)(?![^<]*<\/code>)/g, (x, n) => { const s = sources && sources[n - 1]; return s ? `<a class="cite" href="${esc(s.url)}"><cite>${n}</cite></a>` : `<cite>${n}</cite>`; });
    return h;
  }
  const STEP = {
    fr: { web_search: 'Cherche sur le web', fetch_url: 'Lit une page', read_page: 'Lit une page', research: 'Fait une recherche', generate_image: 'Crée une image', read_file: 'Lit un fichier', write_file: 'Écrit un fichier', edit_file: 'Modifie un fichier', run_command: 'Lance une commande', run_python: 'Calcule', update_plan: 'Met à jour le plan', create_artifact: 'Crée un artefact', edit_artifact: 'Modifie un artefact', list_files: 'Parcourt des fichiers', memory_save: 'Retient', memory_search: 'Se souvient', chat_search: 'Cherche dans tes conversations', computer: 'Utilise l’écran', see_images: 'Regarde des images', convert_file: 'Lit un fichier', browser_search: 'Cherche dans le navigateur', web_images: 'Cherche des images', list_dir: 'Parcourt le dossier', research: 'Fait une recherche', knowledge_search: 'Consulte ses notes', workshop: 'Travaille dans l’atelier Linux', run_test_sequence: 'Lance les tests', diagnose: 'Diagnostique', task_notes: 'Prend des notes' },
    en: { web_search: 'Searches the web', fetch_url: 'Reads a page', read_page: 'Reads a page', research: 'Researches', generate_image: 'Makes an image', read_file: 'Reads a file', write_file: 'Writes a file', edit_file: 'Edits a file', run_command: 'Runs a command', run_python: 'Computes', update_plan: 'Updates the plan', create_artifact: 'Makes an artifact', edit_artifact: 'Edits an artifact', list_files: 'Browses files', memory_save: 'Remembers', memory_search: 'Recalls', chat_search: 'Searches your chats', computer: 'Uses the screen', see_images: 'Looks at pictures', convert_file: 'Reads a file', browser_search: 'Searches in the browser', web_images: 'Looks for pictures', list_dir: 'Browses the folder', research: 'Researches', knowledge_search: 'Checks its notes', workshop: 'Works in the Linux workshop', run_test_sequence: 'Runs the tests', diagnose: 'Diagnoses', task_notes: 'Takes notes' },
  };
  const stepName = (s) => (STEP[lang] || STEP.en)[s.name] || String(s.name).replace(/^mcp__/, '').replace(/_/g, ' ');
  // a path inside the open project is shown relative to it (Fabro Code), others by their last parts
  const stepArg = (s) => {
    const a = s.args || {}; let v = a.query || a.url || a.path || a.command || a.title || '';
    const root = S.conv && S.conv.code && S.conv.code.root;
    if (root && typeof v === 'string') { const r = root.replace(/[\\/]+$/, ''); v = v.split(r + '/').join('').split(r + '\\').join('').split(r).join('.'); }
    if ((a.path && v === a.path) && v.length > 60) v = '…/' + v.split(/[\\/]/).slice(-2).join('/');
    return v;
  };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  function sourcesOf(n) { const out = []; for (const s of n.steps || []) if (s.view && Array.isArray(s.view.sources)) for (const x of s.view.sources) if (x && x.url && !out.some((y) => y.url === x.url)) out.push({ url: x.url, title: x.title || x.url }); return out; }
  function planHtml(n) {
    const p = n.plan; if (!p || !p.length) return '';
    const done = p.filter((x) => x.status === 'done').length; const pct = Math.round(done / p.length * 100);
    const title = (S.conv && S.conv.title) || t('plan');
    return `<div class="task"><div class="task-h">${ic('list')}<b>${esc(title)}</b><span class="pct">${done} / ${p.length}</span></div><div class="bar"><i style="width:${pct}%"></i></div>
      <ul class="plan">${p.map((x) => `<li class="${esc(x.status)}"><span class="pdot"></span><span>${esc(x.title)}</span></li>`).join('')}</ul></div>`;
  }
  function stepsHtml(n) {
    const st = (n.steps || []).filter((s) => !s.parent && s.name !== 'update_plan'); if (!st.length) return '';
    const live = n.pending && st.some((s) => s.status === 'running'); const last = st[st.length - 1]; const open = S.open.has(n.id);
    return `<div class="steps${live ? ' live' : ''}${open ? ' open' : ''}"><button data-act="steps" data-id="${esc(n.id)}" aria-expanded="${open}"><span class="dot"></span>${st.length === 1 ? t('steps1') : t('stepsN', { n: st.length })} · ${esc(stepName(last))}${ic('chev')}</button>
      <ol>${st.map((s) => `<li class="${esc(s.status)}"><span>${esc(stepName(s))}${stepArg(s) ? ' · ' + esc(String(stepArg(s)).slice(0, 100)) : ''}</span></li>`).join('')}</ol></div>`;
  }
  function artsHtml(n) {
    const seen = new Set();
    return (n.steps || []).filter((s) => s.view && s.view.kind === 'artifact' && s.view.artifactId && !seen.has(s.view.artifactId) && seen.add(s.view.artifactId)).map((s) => `<div class="art"><span class="ic">${ic('file')}</span><div class="grow">${esc(s.view.title || t('artifact'))}<small>${esc(s.view.type || '')}</small></div><button class="btn" data-act="art" data-id="${esc(s.view.artifactId)}">${t('openArt')}</button><button class="ib" data-act="share-art" data-id="${esc(s.view.artifactId)}" title="${t('share')}">${ic('share')}</button></div>`).join('');
  }
  function aiInner(n) {
    const src = sourcesOf(n);
    const imgs = (n.steps || []).map((s) => s.view && s.view.image).filter((x) => x && /^(data:image|file:|https:)/.test(x));
    const status = n.pending && !n.content ? (n.status === 'loading' ? t('loadingModel') : n.status === 'queued' ? t('queued') : n.status === 'thinking' ? t('thinking') + '…' : n.status === 'looking' ? t('looking') : '') : '';
    const v = Fabro._view();
    let body = n.content ? md(n.content, src) : '';
    if (n.pending) body += '<span class="caret"></span>';
    let html = `${planHtml(n)}${stepsHtml(n)}${status ? `<div class="status">${esc(status)}</div>` : ''}<div class="md">${body}</div>
      ${imgs.map((u) => `<div class="gen"><img src="${esc(u)}" alt="" data-tint></div>`).join('')}${artsHtml(n)}
      ${n.error ? `<div class="err">${esc(n.error)}</div>` : ''}
      ${!n.pending && src.length ? `<div class="sources">${src.slice(0, 8).map((s, i) => `<a href="${esc(s.url)}"><cite>${i + 1}</cite><span>${esc(host(s.url))}</span></a>`).join('')}</div>` : ''}
      ${n.pending ? '' : `<div class="meta">${versions(n)}<button data-act="copy" data-id="${esc(n.id)}">${t('copy')}</button><button class="mi" data-act="redo" data-id="${esc(n.id)}" title="${t('retry')}">${ic('redo')}</button><button class="mi" data-act="fork" data-id="${esc(n.id)}" title="${t('fork')}">${ic('fork')}</button><button class="mi" data-act="big" data-id="${esc(n.id)}" title="${t('bigModel')}">${ic('big')}</button><span>${esc(n.model || '')}</span><span class="slot-message" data-slot="message"></span></div>`}`;
    if (v && typeof v.message === 'function') { try { html = v.message(n, html) || html; } catch (e) { console.error('[mod view]', e); } }
    return html;
  }
  function siblingsOf(n) { return S.conv ? S.conv.nodes.filter((x) => x.parentId === n.parentId && x.role === n.role).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [n]; }
  function versions(n) {
    const sib = siblingsOf(n); if (sib.length < 2) return '';
    const i = sib.findIndex((x) => x.id === n.id);
    return `<span class="ver"><button data-act="ver" data-id="${esc(n.id)}" data-d="-1" ${i <= 0 ? 'disabled' : ''} title="${t('prev')}">${ic('left')}</button><span class="mono">${i + 1}/${sib.length}</span><button data-act="ver" data-id="${esc(n.id)}" data-d="1" ${i >= sib.length - 1 ? 'disabled' : ''} title="${t('next')}">${ic('right')}</button></span>`;
  }
  function msgHtml(n) {
    if (n.role === 'user' && S.editing === n.id) return `<div class="msg you editing" data-n="${esc(n.id)}"><textarea class="edit-in" rows="3">${esc(n.content || '')}</textarea><div class="edit-acts"><button class="btn ghost" data-act="edit-cancel">${t('cancel')}</button><button class="btn pri" data-act="edit-send" data-id="${esc(n.id)}">${t('resend')}</button></div></div>`;
    if (n.role === 'user') {
      const atts = (n.attachments || []).map((a) => a.kind === 'image' && a.data ? `<img src="${esc(a.data)}" alt="" data-tint>` : `<span class="file">${ic('file')}${esc(a.name || '')}</span>`).join('');
      return `<div class="msg you" data-n="${esc(n.id)}">${atts ? `<div class="atts">${atts}</div>` : ''}${n.content ? `<div class="q">${esc(n.content)}</div>` : ''}<div class="umeta">${versions(n)}<button class="mi" data-act="edit" data-id="${esc(n.id)}" title="${t('edit')}">${ic('pen')}</button></div></div>`;
    }
    return `<div class="msg ai${n.pending ? ' pending' : ''}" data-n="${esc(n.id)}"><div class="mk">${mark()}</div><div class="body">${aiInner(n)}</div></div>`;
  }
  let paintQ = null;
  function paintSoon(n) { paintQ = n; requestAnimationFrame(() => { if (!paintQ) return; const m = paintQ; paintQ = null; const el = $(`.msg[data-n="${CSS.escape(m.id)}"] .body`); if (el) { el.innerHTML = aiInner(m); scrollChat(); } else renderMain(); }); }
  let stick = true;
  function scrollChat(force) { const s = $('.scroll'); if (!s) return; if (force || stick) s.scrollTop = s.scrollHeight; }

  function groups() {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const w0 = d0.getTime() - 6 * 864e5;
    const l = (S.convs || []).filter((c) => c.mode !== 'code' || true).map((c) => ({ id: c.id, title: c.title, at: c.updatedAt || 0, busy: !!(S.streaming && S.streaming.convId === c.id) }));
    return [[t('today'), l.filter((x) => x.at >= d0)], [t('week'), l.filter((x) => x.at < d0 && x.at >= w0)], [t('older'), l.filter((x) => x.at < w0).slice(0, 80)]].filter((g) => g[1].length);
  }
  function renderSide() {
    const el = $('.side'); if (!el) return;
    const cm = currentModel(); const g = groups(); const name = (S.settings.userName || '').trim();
    const u = S.update;
    el.innerHTML = `<div class="brand">${mark()}<b>Fabro</b></div>
      <div class="nav"><button data-act="new">${ic('plus')}${t('newChat')}<span class="k">Ctrl N</span></button><button data-act="search">${ic('search')}${t('search')}<span class="k">Ctrl K</span></button><button data-act="code">${ic('code')}${t('code')}</button></div>
      <div class="convs">${g.length ? g.map(([h, l]) => `<div class="grp">${h}</div>${l.map((c) => `<button data-act="open" data-id="${esc(c.id)}" class="${S.conv && c.id === S.conv.id ? 'on' : ''}">${c.busy ? '<i class="run"></i>' : ''}<span>${esc(c.title || '…')}</span></button>`).join('')}`).join('') : `<div class="grp">${t('today')}</div><div class="empty">${t('noChats')}</div>`}</div>
      <div class="slot-sidebar" data-slot="sidebar"></div>
      ${u && u.state === 'ready' && u.version ? `<div class="upd-line"><span class="grow">${esc(t('update', { v: u.version }))}</span><button class="btn" data-act="update">${t('updateGo')}</button></div>` : ''}
      ${u && (u.state === 'downloading' || u.state === 'launching') ? `<div class="upd-line"><span class="grow">${t('updating')}</span><span class="mono">${u.progress ? Math.round(u.progress * 100) + ' %' : ''}</span></div>` : ''}
      ${u && u.state === 'error' && u.code ? `<div class="upd-line"><span class="grow">${t('updateErr')}</span><button class="btn" data-act="update">${t('retry')}</button></div>` : ''}
      <div class="me"><button class="who" data-act="profiles" title="${t('profiles')}"><span class="av">${esc((name || 'F')[0].toUpperCase())}</span>${esc(name || 'Fabro')}</button><button class="model" data-act="model" title="${t('model')}">${esc(cm ? cm.label : t('model'))}</button></div>`;
    Fabro._paint('sidebar');
  }
  function renderTop() {
    const el = $('.top'); if (!el) return;
    const c = S.conv;
    el.innerHTML = S.view === 'settings'
      ? `<button class="chip" data-act="back">${ic('back')}${t('close')}</button><span class="sp"></span>`
      : `<span class="title">${c ? esc(c.title || '') : ''}</span>${c && c.agent ? '' : ''}${S.private || (c && c.ephemeral) ? `<span class="sub">${ic('lock')}</span><span class="sub">${t('private')}</span>` : ''}<span class="sp"></span>
         ${c && c.messages.length && !c.ephemeral ? `<button class="ib" data-act="share-conv" title="${t('share')}">${ic('share')}</button>` : ''}<button class="ib" data-act="settings" title="${t('settings')}">${ic('gear')}</button>`;
  }
  function renderMain() {
    const el = $('.body-area'); if (!el) return;
    $('.dock').style.display = S.view === 'settings' ? 'none' : '';
    if (S.view === 'settings') { el.innerHTML = '<div class="settings"><div class="col" id="settings"></div></div>'; V1Settings.render($('#settings')); return; }
    if (S.view === 'code' && !S.conv) { $('.dock').style.display = 'none'; return V1Code.home(el); }
    const c = S.conv;
    if (c && c.code && !c.messages.length) {
      el.innerHTML = `${V1Code.bar(c)}<div class="home"><div class="slot-c"></div></div>`; $('.slot-c', el).appendChild(composer()); V1Code.start();
    } else if (!c || !c.messages.length) {
      el.innerHTML = `<div class="home"><h1>${t('homeH')}</h1><p class="subt">${t('homeSub')}</p><div class="slot-c"></div><div class="sugg">${['s1', 's2', 's3', 's4'].map((k) => `<button data-act="sugg">${esc(t(k))}</button>`).join('')}</div></div>`;
      $('.slot-c', el).appendChild(composer());
    } else {
      el.innerHTML = `${c.code ? V1Code.bar(c) : ''}<div class="scroll"><div class="col">${c.messages.map(msgHtml).join('')}</div></div>`;
      if (c.code) V1Code.start();
      const sc = $('.scroll', el); sc.addEventListener('scroll', () => { stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80; tintSoon(); }, { passive: true });
      $('.dock .slot-c2').appendChild(composer());
      Fabro._paint('message');
    }
    renderComposer(); renderCards(); tintSoon();
  }
  function renderCards() {
    const el = $('.cards'); if (!el) return;
    const stopped = S.streaming ? [] : (v1set().running || []).filter((x) => !S.conv || x.id === S.conv.id).slice(-2);
    el.innerHTML = stopped.map((x) => `<div class="card">${ic('list')}<div class="grow">${esc(t('resumeQ', { t: x.title || '…' }))}<small>${t('resumeSub')}</small></div><div class="acts"><button class="btn" data-act="resume-no" data-id="${esc(x.id)}">${t('dismiss')}</button><button class="btn pri" data-act="resume" data-id="${esc(x.id)}">${t('resume')}</button></div></div>`).join('') + [...S.asks.entries()].map(([id, a]) => a.kind === 'deps'
      ? `<div class="card">${ic('dl')}<div class="grow">${esc(t('installQ', { d: a.dep }))}</div><div class="acts"><button class="btn" data-act="ask" data-id="${esc(id)}" data-v="deny">${t('deny')}</button><button class="btn pri" data-act="ask" data-id="${esc(id)}" data-v="once">${t('install')}</button></div></div>`
      : `<div class="card">${ic('pc')}<div class="grow">${esc(t('wants', { s: a.summary || a.tool }))}${a.reason ? `<small>${esc(a.reason)}</small>` : ''}</div><div class="acts"><button class="btn" data-act="ask" data-id="${esc(id)}" data-v="deny">${t('deny')}</button>${a.risk !== 'danger' ? `<button class="btn" data-act="ask" data-id="${esc(id)}" data-v="always">${t('always')}</button>` : ''}<button class="btn pri" data-act="ask" data-id="${esc(id)}" data-v="once">${t('allow')}</button></div></div>`).join('');
    Fabro._paint('above-chat');
  }
  let compEl = null;
  const SLASH = () => [['tache', 'list', t('cmdTask')], ['cherche', 'search', t('cmdResearch')], ['code', 'code', t('cmdCode')], ['prive', 'lock', t('cmdPrivate')], ...Fabro.commands.list().map((c) => [c.name, 'plus', c.title || c.name])];
  function composer() {
    if (compEl) return compEl;
    const d = document.createElement('div'); d.className = 'composer glass'; d.dataset.drop = t('drop');
    d.innerHTML = `<div class="slash glass"></div><div class="att"></div><div class="row">
      <label class="ib" title="${t('attach')}">${ic('clip')}<input type="file" multiple class="sr" data-act="files"></label>
      <textarea rows="1" placeholder="${t('ask')}" aria-label="${t('ask')}"></textarea><div class="wave">${'<i></i>'.repeat(28)}</div>
      <span data-slot="composer"></span>
      <button class="ib mic" data-act="mic" title="${t('dictate')}">${ic('mic')}</button><button class="ib send" data-act="send" disabled>${ic('up')}</button></div>
      <div class="hint"><span>${t('hintKeys')}</span><button class="mdl" data-act="model"></button></div>`;
    const ta = $('textarea', d);
    ta.addEventListener('input', () => { ta.style.height = '36px'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; renderComposer(); });
    ta.addEventListener('focus', () => d.classList.add('focus')); ta.addEventListener('blur', () => setTimeout(() => d.classList.remove('focus'), 120));
    ta.addEventListener('keydown', (e) => {
      if (d.classList.contains('cmd') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); slashSel = Math.max(0, slashSel + (e.key === 'ArrowDown' ? 1 : -1)); renderComposer(); return; }
      if (d.classList.contains('cmd') && (e.key === 'Tab' || (e.key === 'Enter' && !/\s/.test(ta.value)))) { e.preventDefault(); const it = slashItems()[slashSel]; if (it) { ta.value = '/' + it[0] + ' '; renderComposer(); } return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    $$('.wave i', d).forEach((i, n) => { i.style.animationDelay = (n * 53 % 900) + 'ms'; });
    ['dragenter', 'dragover'].forEach((k) => d.addEventListener(k, (e) => { e.preventDefault(); d.classList.add('drop'); }));
    ['dragleave', 'drop'].forEach((k) => d.addEventListener(k, (e) => { e.preventDefault(); d.classList.remove('drop'); if (k === 'drop' && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); }));
    compEl = d; setTimeout(() => Fabro._paint('composer'), 0); return d;
  }
  let slashSel = 0;
  const slashItems = () => { const ta = $('.composer textarea'); const q = ta ? ta.value.slice(1).toLowerCase() : ''; return SLASH().filter((x) => x[0].startsWith(q)); };
  function renderComposer() {
    const d = compEl; if (!d) return;
    const ta = $('textarea', d); const busy = !!(S.streaming && S.conv && S.streaming.convId === S.conv.id);
    d.classList.toggle('busy', busy); ta.placeholder = busy ? t('askMore') : t('ask');
    const has = !!ta.value.trim() || S.pending.length > 0; d.classList.toggle('has', has);
    const cmd = /^\/[a-z0-9-]*$/i.test(ta.value); d.classList.toggle('cmd', cmd);
    if (cmd) { const it = slashItems(); slashSel = Math.min(slashSel, Math.max(0, it.length - 1)); $('.slash', d).innerHTML = it.map((x, i) => `<button class="${i === slashSel ? 'sel' : ''}" data-act="slash" data-c="${esc(x[0])}">${ic(x[1])}${esc(x[2])}<span class="k">/${esc(x[0])}</span></button>`).join(''); if (!it.length) d.classList.remove('cmd'); }
    const sendB = $('.send', d); sendB.disabled = !busy && !has; sendB.innerHTML = busy && !has ? ic('stop') : ic('up'); sendB.title = busy && !has ? t('stop') : t('send');
    $('.att', d).innerHTML = S.pending.map((a, i) => a.kind === 'image' ? `<span class="img"><img src="${esc(a.data)}" alt=""><button data-act="unatt" data-i="${i}">×</button></span>` : `<span>${ic('file')}${esc(a.name)}${a.loading ? '…' : ''}<button data-act="unatt" data-i="${i}">×</button></span>`).join('');
    const cm = currentModel(); $('.mdl', d).textContent = cm ? cm.label : t('model');
  }
  function submit() {
    const ta = $('.composer textarea'); const busy = !!(S.streaming && S.conv && S.streaming.convId === S.conv.id);
    const v = ta.value.trim();
    if (busy && !v && !S.pending.length) return stop();
    if (!v && !S.pending.length) return;
    ta.value = ''; ta.style.height = '36px';
    if (busy) {
      // during an answer: the instruction joins the running turn when the engine allows it, else it waits
      const m = S.streaming.msg; (m.precisions = m.precisions || []).push({ text: v, used: false });
      api.chat.inject(S.streaming.reqId, v).then((ok) => { if (!ok) { S.later.push({ convId: S.conv.id, text: v, atts: S.pending.splice(0) }); toast(t('later')); } }).catch(() => {});
      renderComposer(); return;
    }
    send(v);
  }
  function renderAll() { renderSide(); renderTop(); renderMain(); }

  // ── reflections: the glass edges take the color of the pictures near them (average color, computed once) ──
  const tints = new WeakMap();
  function colorOf(img) {
    if (tints.has(img)) return tints.get(img);
    if (!img.complete || !img.naturalWidth) { img.addEventListener('load', tintSoon, { once: true }); return null; }
    try { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const c = `${r / 64 | 0},${gg / 64 | 0},${b / 64 | 0}`; tints.set(img, c); return c; } catch { tints.set(img, null); return null; }
  }
  let tintT = 0;
  function tintSoon() { cancelAnimationFrame(tintT); tintT = requestAnimationFrame(tint); }
  function tint() {
    if (document.documentElement.classList.contains('eco')) return;
    const imgs = $$('img[data-tint]').filter((i) => i.offsetParent);
    for (const g of $$('.glass')) {
      const r = g.getBoundingClientRect(); let tl = 'transparent', tr = 'transparent', tb = 'transparent';
      for (const im of imgs) {
        const q = im.getBoundingClientRect(); if (q.bottom < 0 || q.top > innerHeight) continue; const col = colorOf(im); if (!col) continue;
        const gap = Math.max(0, q.top - r.bottom, r.top - q.bottom, q.left - r.right, r.left - q.right); const near = Math.max(0, 1 - gap / 220); if (!near) continue;
        if (q.left >= r.right - 4) tr = `rgba(${col},${0.55 * near})`; else if (q.right <= r.left + 4) tl = `rgba(${col},${0.55 * near})`; else tb = `rgba(${col},${0.6 * near})`;
      }
      g.style.setProperty('--tl', tl); g.style.setProperty('--tr', tr); g.style.setProperty('--tb', tb);
    }
  }

  // ───────────────────────────── sheets ─────────────────────────────
  function sheet(html, cls = '') { $('#sheet-root').innerHTML = html ? `<div class="back" data-act="close"></div><div class="sheet glass ${cls}" role="dialog" aria-modal="true">${html}</div>` : ''; }
  const head = (title) => `<h2>${title}<button class="ib" data-act="close" aria-label="${t('close')}">${ic('x')}</button></h2>`;
  function openModelMenu() {
    const sel = refKey(S.settings.selectedModel); const list = allModels();
    const row = (m) => `<button class="opt ${refKey(m.ref) === sel ? 'on' : ''}" data-act="pick" data-k="${esc(refKey(m.ref))}">${ic(m.local ? 'pc' : 'cloud')}<span class="grow">${esc(m.label)}<small>${esc(m.sub || '')}</small></span>${refKey(m.ref) === sel ? `<span class="ck">${ic('check')}</span>` : ''}</button>`;
    sheet(`${head(t('model'))}${list.some((m) => m.local) ? `<h3>${t('local')}</h3>${list.filter((m) => m.local).map(row).join('')}` : ''}
      ${list.some((m) => !m.local) ? `<h3>${t('online')}</h3>${list.filter((m) => !m.local).map(row).join('')}` : ''}
      <button class="opt" data-act="legacy" data-page="models">${ic('plus')}<span class="grow">${t('installModel')}</span></button>`);
  }
  let searchT = 0;
  function openSearch() {
    sheet(`${head(t('search'))}<input class="in" id="q" placeholder="${t('searchPh')}" style="width:100%;margin:6px 0 8px"><div id="qres"></div>`);
    const q = $('#q'); q.focus();
    q.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(async () => {
      const v = q.value.trim(); const box = $('#qres'); if (!box) return;
      if (!v) { box.innerHTML = ''; return; }
      const r = await api.conv.search(v).catch(() => []);
      box.innerHTML = (r || []).slice(0, 30).map((x) => `<button class="opt" data-act="open" data-id="${esc(x.id || x.convId)}"><span class="grow">${esc(x.title || '…')}<small>${esc(String(x.snippet || x.text || '').replace(/<[^>]+>/g, '').slice(0, 140))}</small></span></button>`).join('') || `<p class="lead">${t('noResult')}</p>`;
    }, 180); });
  }
  async function openArtifact(id) {
    const a = await api.artifacts.get(id).catch(() => null); if (!a) return;
    const v = (a.versions || [])[a.versions.length - 1] || {}; const content = String(v.content || '');
    const html = /^(html|svg|page|slides|web)$/.test(a.type) || /^\s*<(!doctype|html|svg)/i.test(content);
    sheet(`${head(esc(a.title || t('artifact')))}<div class="viewer">${html ? '<iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>' : `<pre>${esc(content)}</pre>`}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn" data-act="share-art" data-id="${esc(a.id)}">${ic('share')}${t('share')}</button></div>`, 'wide');
    if (html) $('.viewer iframe').srcdoc = content;
  }
  function openCode() { S.conv = null; S.view = 'code'; renderAll(); }

  // ───────────────────────────── events ─────────────────────────────
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
    const a = el.dataset.act;
    if (a === 'close') return sheet('');
    if (a === 'new') return newChat();
    if (a === 'open') { sheet(''); return openConv(el.dataset.id); }
    if (a === 'search') return openSearch();
    if (a === 'code') return openCode();
    if (a === 'settings') { S.view = 'settings'; return renderAll(); }
    if (a === 'back') { S.view = 'chat'; return renderAll(); }
    if (a === 'model') return openModelMenu();
    if (a === 'pick') { const m = allModels().find((x) => refKey(x.ref) === el.dataset.k); if (m) await saveSettings({ selectedModel: m.ref }); sheet(''); renderSide(); renderComposer(); return; }
    if (a === 'legacy') return api.ui.switch('legacy', el.dataset.page || '');
    if (a === 'send') return submit();
    if (a === 'mic') return dictate();
    if (a === 'unatt') { S.pending.splice(+el.dataset.i, 1); return renderComposer(); }
    if (a === 'slash') { const ta = $('.composer textarea'); ta.value = '/' + el.dataset.c + ' '; ta.focus(); return renderComposer(); }
    if (a === 'sugg') { const ta = $('.composer textarea'); ta.value = el.textContent; ta.dispatchEvent(new Event('input')); ta.focus(); return; }
    if (a === 'ask') return answer(el.dataset.id, el.dataset.v);
    if (a === 'steps') { const id = el.dataset.id; S.open.has(id) ? S.open.delete(id) : S.open.add(id); el.parentElement.classList.toggle('open'); return; }
    if (a === 'copy') { const n = S.conv && S.conv.nodes.find((x) => x.id === el.dataset.id); if (n) { await navigator.clipboard.writeText(n.content || ''); el.textContent = t('copied'); setTimeout(() => { el.textContent = t('copy'); }, 1200); } return; }
    if (a === 'redo') { if (S.streaming) return; const c = S.conv; const n = c.nodes.find((x) => x.id === el.dataset.id); if (!n) return; c.leafId = n.parentId; c.messages = A.pathOf(c); const m = currentModel(); if (m) generate(m); return; }
    if (a === 'art') return openArtifact(el.dataset.id);
    if (a === 'big') {
      if (S.streaming) return; const big = allModels().find((x) => refKey(x.ref) === refKey(v1set().bigModel));
      if (!big) { S.view = 'settings'; renderAll(); return toast(t('bigSetSub')); }
      const c = S.conv; const n = c.nodes.find((x) => x.id === el.dataset.id); if (!n) return;
      c.leafId = n.role === 'assistant' ? n.parentId : n.id; c.messages = A.pathOf(c); toast(t('bigWhere', { m: big.label })); return generate(big, { big: true });
    }
    if (a === 'resume') {
      const id = el.dataset.id; const v = { ...(S.settings.v1 || {}) }; v.running = (v.running || []).filter((x) => x.id !== id); await saveSettings({ v1: v });
      await openConv(id); return send(t('resumeMsg'), { agent: true });
    }
    if (a === 'resume-no') { const v = { ...(S.settings.v1 || {}) }; v.running = (v.running || []).filter((x) => x.id !== el.dataset.id); await saveSettings({ v1: v }); return renderCards(); }
    if (a === 'ver') {
      const c = S.conv; const n = c && c.nodes.find((x) => x.id === el.dataset.id); if (!n || S.streaming) return;
      const sib = siblingsOf(n); const to = sib[sib.findIndex((x) => x.id === n.id) + Number(el.dataset.d)]; if (!to) return;
      let leaf = to; for (;;) { const kids = c.nodes.filter((x) => x.parentId === leaf.id).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)); if (!kids.length) break; leaf = kids[0]; }
      c.leafId = leaf.id; c.messages = A.pathOf(c); persist(); return renderMain();
    }
    if (a === 'edit') { S.editing = el.dataset.id; renderMain(); const ta = $('.edit-in'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    if (a === 'edit-cancel') { S.editing = null; return renderMain(); }
    if (a === 'edit-send') {
      const c = S.conv; const n = c && c.nodes.find((x) => x.id === el.dataset.id); const v = (($('.edit-in') || {}).value || '').trim(); S.editing = null;
      if (!n || !v || S.streaming) return renderMain();
      c.leafId = n.parentId; c.messages = A.pathOf(c);
      addNode({ id: uid(), role: 'user', content: v, attachments: n.attachments || [], createdAt: now(), parentId: n.parentId || null });
      const m = currentModel(); if (m) generate(m); return;
    }
    if (a === 'fork') {
      const c = S.conv; if (!c) return; const upTo = A.pathOf({ ...c, leafId: el.dataset.id });
      const f = { ...newConv(), title: (c.title || '') + ' ↳', nodes: upTo.map(({ pending, ...x }) => x), leafId: el.dataset.id, agent: !!c.agent };
      f.messages = A.pathOf(f); S.conv = f; persist(); toast(t('forked')); renderAll(); return;
    }
    if (a === 'share-conv') return window.V1Share && V1Share.open({ kind: 'conv', id: S.conv.id });
    if (a === 'share-art') return window.V1Share && V1Share.open({ kind: 'artifact', id: el.dataset.id });
    if (a === 'update') return api.updater.install();
    if (a.startsWith('set:')) return V1Settings.action(a.slice(4), el, e);
  });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-act=files]')) { addFiles([...e.target.files]); e.target.value = ''; } else if (e.target.dataset.set) V1Settings.change(e.target); });
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(); const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'n') { e.preventDefault(); newChat(); }
    if (mod && k === 'k') { e.preventDefault(); openSearch(); }
    if (k === 'escape' && $('#sheet-root').innerHTML) sheet('');
  });
  document.addEventListener('paste', (e) => { const f = [...(e.clipboardData && e.clipboardData.files || [])]; if (f.length && document.activeElement && document.activeElement.closest('.composer')) { e.preventDefault(); addFiles(f); } });
  addEventListener('resize', tintSoon);

  // ───────────────────────────── theme ─────────────────────────────
  function applyTheme() {
    const th = S.settings.theme; const sys = matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = th === 'dark' || th === 'halloween' || (th !== 'light' && sys);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('eco', !!v1set().eco);
    document.documentElement.classList.toggle('reduce', !!v1set().reduceMotion);
    api.win.theme(dark).catch(() => {}); Fabro._emit('theme', { dark });
  }

  // ───────────────────────────── start ─────────────────────────────
  window.V1 = {
    S, t, esc, ic, toast, sheet, head, refKey, allModels, refreshModels, saveSettings, applyTheme, renderAll, renderSide, send, openModelMenu,
    get lang() { return lang; }, current: () => (S.conv ? { id: S.conv.id, title: S.conv.title, messages: S.conv.messages.map(({ role, content }) => ({ role, content })) } : null),
  };
  (async () => {
    try { const svg = await (await fetch('mark.svg')).text(); MARK = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''); } catch {}
    [S.info, S.settings] = await Promise.all([api.info().catch(() => ({})), api.settings.get().catch(() => ({}))]);
    const want = S.settings.language && S.settings.language !== 'auto' ? S.settings.language : (navigator.language || 'fr').slice(0, 2);
    lang = V1_I18N[want] ? want : 'en'; document.documentElement.lang = lang;
    const plat = S.info.platform || navigator.platform;
    if (/darwin|mac/i.test(plat)) document.documentElement.classList.add('mac'); else document.documentElement.style.setProperty('--winbar', '138px');
    applyTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    $('#app').innerHTML = '<aside class="side glass"></aside><main class="main"><div class="top"></div><div class="body-area"></div><div class="dock"><div class="slot-above-chat" data-slot="above-chat"></div><div class="cards"></div><div class="slot-c2" style="width:100%;display:flex;justify-content:center"></div></div></main>';
    S.convs = await api.conv.list().catch(() => []);
    renderAll();
    refreshModels();
    api.memory.list().then((m) => { S.memories = m || []; }).catch(() => {});
    api.on('chat:event', onChatEvent);
    api.on('updater:status', (s) => { S.update = s; renderSide(); });
    api.on('app:command', ({ cmd }) => { if (cmd === 'new-chat') newChat(); });
    api.on('anywhere:event', async () => { S.convs = await api.conv.list().catch(() => S.convs); renderSide(); });
    api.on('models:progress', () => { clearTimeout(V1._mp); V1._mp = setTimeout(refreshModels, 800); });
    // Fabro Anywhere asks what the interface would send (system prompt context) for a phone's run
    api.on('anywhere:ask', ({ id, name }) => { if (name === 'context') { const m = currentModel(); api.anywhere.reply(id, { system: `You are ${(S.settings.aiName || '').trim() || 'Fabro'}, a helpful assistant running on the user's own computer. Today is ${new Date().toDateString()}. Answer in the user's language.\n\n${agentPrompt()}`, userContext: userContext(), agentPrompt: agentPrompt(), tools: ['web_search', 'fetch_url'], gen: S.settings.gen || {}, model: m ? m.ref : S.settings.selectedModel, lang, agentEnabled: (S.settings.agent || {}).enabled !== false }); } else api.anywhere.reply(id, null); });
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    Fabro._emit('ready', { version: 1 });
  })();
})();
