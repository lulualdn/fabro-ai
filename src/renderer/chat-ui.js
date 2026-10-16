'use strict';
/* Chat V1: conversation tree (edit → branches), tool steps (web search / fetch), composer options
   (reasoning, tools, response style, ephemeral chat), memory + styles in the system prompt, AI titles. */

// ───────────────────────────── Tree ─────────────────────────────
// conv.nodes = every message (alternatives included), each with parentId; conv.leafId = end of the shown branch.
function treeify(c) {
  if (!c) return c;
  if (!c.nodes) {
    const list = c.messages || [];
    list.forEach((m, i) => { m.parentId = i ? list[i - 1].id : null; });
    c.nodes = list;
    c.leafId = list.length ? list[list.length - 1].id : null;
  }
  c.messages = pathOf(c);
  return c;
}
function pathOf(c) {
  const byId = new Map(c.nodes.map((n) => [n.id, n]));
  const out = [];
  let cur = byId.get(c.leafId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return out.reverse();
}
function addNode(m) {
  const c = S.conv;
  const last = c.messages[c.messages.length - 1];
  m.parentId = m.parentId !== undefined ? m.parentId : last ? last.id : null;
  c.nodes.push(m);
  c.leafId = m.id;
  c.messages = pathOf(c);
  return m;
}
const siblingsOf = (m) => S.conv.nodes.filter((n) => n.parentId === m.parentId && n.role === m.role).sort((a, b) => a.createdAt - b.createdAt);
function deepestLeaf(id) {
  let cur = id;
  for (;;) {
    const kids = S.conv.nodes.filter((n) => n.parentId === cur).sort((a, b) => b.createdAt - a.createdAt);
    if (!kids.length) return cur;
    cur = kids[0].id;
  }
}
function branchNav(m) {
  const sib = siblingsOf(m);
  if (sib.length < 2) return '';
  const i = sib.indexOf(m);
  return `<span class="branch-nav"><button class="icon-btn xs" data-action="branch" data-id="${m.id}" data-dir="-1" ${i <= 0 ? 'disabled' : ''} title="${esc(t('prevVersion'))}">${icon('back', 13)}</button>
    <span class="bn-n">${i + 1}/${sib.length}</span>
    <button class="icon-btn xs" data-action="branch" data-id="${m.id}" data-dir="1" ${i >= sib.length - 1 ? 'disabled' : ''} title="${esc(t('nextVersion'))}">${icon('forward', 13)}</button></span>`;
}

// ───────────────────────────── Tool steps ─────────────────────────────
const fav = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function renderSteps(m) {
  if (!m.steps || !m.steps.length) return '';
  const items = m.steps.map((st) => {
    const run = st.status === 'running';
    const ico = st.name === 'web_search' ? 'search' : 'globe';
    let label;
    if (st.name === 'web_search') label = run ? t('stepSearching', { q: st.args.query || '' }) : t('stepSearched', { q: st.args.query || '', n: (st.view && st.view.sources || []).length });
    else label = run ? t('stepReading', { u: fav(st.args.url || '') }) : t('stepRead', { u: (st.view && st.view.title) || fav(st.args.url || '') });
    const srcs = st.view && st.view.sources && st.view.sources.length ? `<div class="st-srcs">${st.view.sources.slice(0, 8).map((s, i) => `<a class="src" href="${esc(s.url)}" data-action="ext-link" title="${esc(s.snippet || s.title)}"><b>${i + 1}</b><span>${esc(s.title)}</span><small>${esc(fav(s.url))}</small></a>`).join('')}</div>` : '';
    return `<div class="step ${st.status}">
      <span class="step-ico">${run ? spinner(14) : st.status === 'error' ? icon('warning', 14) : icon(ico, 14)}</span>
      <span class="step-label">${esc(label)}${st.error ? ` — <em>${esc(st.error)}</em>` : ''}</span>
      ${srcs}
    </div>`;
  }).join('');
  return `<div class="steps">${items}</div>`;
}
// Sources the answer cited ([1], [2]) as chips under the text.
function citedSources(m) {
  const all = (m.steps || []).flatMap((s) => (s.view && s.view.sources) || []);
  if (!all.length || m.pending) return '';
  const cited = [...new Set([...(m.content || '').matchAll(/\[(\d{1,2})\]/g)].map((x) => +x[1]))].filter((n) => all[n - 1]);
  const list = (cited.length ? cited.map((n) => [n, all[n - 1]]) : all.slice(0, 4).map((s, i) => [i + 1, s]));
  return `<div class="cites">${list.map(([n, s]) => `<a class="cite" href="${esc(s.url)}" data-action="ext-link" title="${esc(s.title)}"><b>${n}</b>${esc(fav(s.url))}</a>`).join('')}</div>`;
}

// ───────────────────────────── Composer options ─────────────────────────────
const BUILTIN_STYLES = ['default', 'concise', 'explanatory', 'formal'];
const STYLE_PROMPTS = {
  concise: 'Answer as briefly as possible: the answer first, no preamble, no recap, short sentences. Use lists only when they help.',
  explanatory: 'Explain thoroughly like a patient teacher: give the reasoning, define terms, use examples and analogies, and check understanding.',
  formal: 'Use a formal, professional register: precise wording, complete sentences, no slang or emoji, clear structure.',
};
function styleList() { return [...BUILTIN_STYLES.map((id) => ({ id, name: t('style_' + id), builtin: true })), ...(S.settings.styles || [])]; }
function activeStyle() { return styleList().find((s) => s.id === S.settings.activeStyle) || styleList()[0]; }
function stylePrompt() {
  const st = activeStyle();
  if (!st || st.id === 'default') return '';
  return st.builtin ? STYLE_PROMPTS[st.id] : `Write in this style:\n${st.prompt}`;
}
const REASONING = ['auto', 'off', 'low', 'medium', 'high'];
function chatTools() {
  const ct = S.settings.chatTools || {};
  return [ct.webSearch !== false && 'web_search', ct.fetch !== false && 'fetch_url'].filter(Boolean);
}
function composerExtras() {
  const r = S.settings.gen.reasoning || 'auto';
  const tools = chatTools();
  const st = activeStyle();
  const chips = [];
  if (tools.includes('web_search')) chips.push(`<button class="c-chip" data-action="tool-toggle" data-key="webSearch" title="${esc(t('webSearchOff'))}">${icon('globe', 14)}<span>${esc(t('webSearch'))}</span></button>`);
  if (st && st.id !== 'default') chips.push(`<button class="c-chip" data-action="style-menu" title="${esc(t('responseStyle'))}">${icon('brush', 14)}<span>${esc(st.name)}</span></button>`);
  if (S.conv && S.conv.ephemeral || S.ephemeralNext) chips.push(`<span class="c-chip ghost">${icon('eyeOff', 14)}<span>${esc(t('ephemeral'))}</span></span>`);
  return `<button class="think-btn ${r === 'off' ? 'off' : r === 'auto' ? '' : 'on'}" data-action="reasoning-menu" title="${esc(t('reasoning'))}: ${esc(t('reason_' + r))}">${icon('brain', 16)}<span>${esc(r === 'auto' ? t('reasoningShort') : t('reason_' + r))}</span></button>${chips.join('')}`;
}

function openPlusMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const ct = S.settings.chatTools || {};
  const tg = (on) => `<span class="pm-switch ${on ? 'on' : ''}"><i></i></span>`;
  $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
    <div class="popover plus-pop" style="left:${r.left}px; bottom:${innerHeight - r.top + 8}px">
      <button class="pm-item" data-action="attach">${icon('clip', 16)}<span class="pm-text"><b>${esc(t('attach'))}</b></span></button>
      <div class="pm-sep"></div>
      <button class="pm-item" data-action="tool-toggle" data-key="webSearch">${icon('globe', 16)}<span class="pm-text"><b>${esc(t('webSearch'))}</b><small>${esc(t('webSearchHint'))}</small></span>${tg(ct.webSearch !== false)}</button>
      <button class="pm-item" data-action="tool-toggle" data-key="fetch">${icon('link', 16)}<span class="pm-text"><b>${esc(t('fetchTool'))}</b><small>${esc(t('fetchHint'))}</small></span>${tg(ct.fetch !== false)}</button>
      <div class="pm-sep"></div>
      <button class="pm-item" data-action="style-menu">${icon('brush', 16)}<span class="pm-text"><b>${esc(t('responseStyle'))}</b><small>${esc(activeStyle().name)}</small></span>${icon('right', 14)}</button>
      ${!S.conv || !S.conv.messages.length ? `<button class="pm-item" data-action="ephemeral-toggle">${icon('eyeOff', 16)}<span class="pm-text"><b>${esc(t('ephemeral'))}</b><small>${esc(t('ephemeralHint'))}</small></span>${tg(!!S.ephemeralNext)}</button>` : ''}
    </div>`;
}
function openReasoningMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const cur = S.settings.gen.reasoning || 'auto';
  $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
    <div class="popover" style="left:${r.left}px; bottom:${innerHeight - r.top + 8}px; min-width:260px">
      <div class="pm-sec">${esc(t('reasoning'))}</div>
      ${REASONING.map((k) => `<button class="pm-item ${cur === k ? 'sel' : ''}" data-action="set-reasoning" data-value="${k}">
        <span class="pm-text"><b>${esc(t('reason_' + k))}</b><small>${esc(t('reasonHint_' + k))}</small></span>${cur === k ? icon('check', 16) : ''}</button>`).join('')}
    </div>`;
}
function openStyleMenu(anchor) {
  const r = (anchor || $('#composer')).getBoundingClientRect();
  const cur = activeStyle().id;
  $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
    <div class="popover" style="left:${r.left}px; bottom:${innerHeight - r.top + 8}px; min-width:280px">
      <div class="pm-sec">${esc(t('responseStyle'))}</div>
      ${styleList().map((s) => `<button class="pm-item ${cur === s.id ? 'sel' : ''}" data-action="set-style" data-value="${esc(s.id)}">
        <span class="pm-text"><b>${esc(s.name)}</b><small>${esc(s.builtin ? t('styleHint_' + s.id) : t('styleLearned'))}</small></span>${cur === s.id ? icon('check', 16) : ''}</button>`).join('')}
      <div class="pm-sep"></div>
      <button class="pm-item" data-action="settings-page" data-page="custom">${icon('plus', 16)}<span class="pm-text"><b>${esc(t('styleCreate'))}</b></span></button>
    </div>`;
}

// ───────────────────────────── System prompt ─────────────────────────────
function systemPrompt() {
  const parts = [t('sysDefault', { date: new Date().toLocaleDateString(S.lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) })];
  const name = typeof userFirstName === 'function' ? userFirstName() : '';
  if (name) parts.push(t('sysName', { n: name }));
  const tools = chatTools();
  if (tools.length) parts.push(t('sysTools'));
  parts.push(t('sysArtifacts'));
  const sp = stylePrompt(); if (sp) parts.push(sp);
  if ((S.settings.memory || {}).enabled !== false && S.memories && S.memories.length && !(S.conv && S.conv.ephemeral)) {
    parts.push(`${t('sysMemory')}\n${S.memories.slice(0, 40).map((m) => `- ${m.text}`).join('\n')}`);
  }
  const custom = (S.settings.gen.systemPrompt || '').trim();
  if (custom) parts.push(custom);
  return parts.join('\n\n');
}

// ───────────────────────────── Edit a message ─────────────────────────────
function startEdit(id) {
  const m = S.conv.nodes.find((x) => x.id === id);
  const el = $(`#m-${CSS.escape(id)} .bubble`);
  if (!m || !el || S.streaming) return;
  el.classList.add('editing');
  el.innerHTML = `<textarea class="edit-ta" rows="1">${esc(m.content || '')}</textarea>
    <div class="edit-bar"><span class="muted small">${esc(t('editHint'))}</span><span class="grow"></span>
    <button class="btn sm" data-action="edit-cancel">${esc(t('cancel'))}</button><button class="btn sm primary" data-action="edit-save" data-id="${esc(id)}">${esc(t('editSend'))}</button></div>`;
  const ta = el.querySelector('textarea');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); actions['edit-save']({ dataset: { id } }); }
    if (e.key === 'Escape') { e.stopPropagation(); renderView(); }
  });
  fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ───────────────────────────── Background: titles + memories ─────────────────────────────
let memTimer = null;
function afterAnswer(m) {
  const c = S.conv;
  if (!c || c.ephemeral || !m || m.error || !m.content) return;
  const users = c.messages.filter((x) => x.role === 'user');
  const model = S.settings.selectedModel;
  if (S.settings.autoTitle !== false && users.length === 1 && !c.aiTitle) {
    api.brain.title({ model, user: users[0].content, answer: m.content, lang: S.lang }).then((title) => {
      if (!title || title.length < 2 || !S.conv) return;
      c.title = title; c.aiTitle = true;
      if (S.conv && S.conv.id === c.id) { S.conv.title = title; S.conv.aiTitle = true; persist(); renderTopbar(); reportQuick(); }
      else api.conv.patch(c.id, { title, aiTitle: true }).then(async () => { S.convs = await api.conv.list(); renderRecents(); }).catch(() => {});
    }).catch(() => {});
  }
  const mem = S.settings.memory || {};
  const last = users[users.length - 1];
  if (mem.enabled !== false && mem.auto !== false && last && last.content && last.content.length > 15 &&
      /\b(je|j['’]|mon|ma|mes|moi|i|i['’]m|my|me|mine|yo|mi|ich|mein)\b/i.test(last.content)) {
    clearTimeout(memTimer);
    memTimer = setTimeout(() => {
      if (S.streaming) return;
      api.brain.memories({ model, convId: c.id, userTexts: [last.content], lang: S.lang }).then(async (added) => {
        if (added && added.length) { S.memories = await api.memory.list(); toast(t('memorySaved', { n: added.length })); }
      }).catch(() => {});
    }, S.memDelay ?? 12000);
  }
}

// ───────────────────────────── Sidebar full-text search ─────────────────────────────
const runSearch = debounce(async () => {
  const q = S.sbQuery.trim();
  if (!q) { S.sbResults = null; renderRecents(); return; }
  S.sbResults = await api.conv.search(q).catch(() => []);
  renderRecents();
}, 180);
function renderSearchResults(el) {
  const res = S.sbResults || [];
  el.innerHTML = res.length ? `<div class="sb-section"><span>${esc(t('searchResults'))}</span></div>${res.map((c, i) => `<div class="recent sr ${S.conv && S.conv.id === c.id ? 'active' : ''}" style="--i:${i}" data-action="open-conv" data-id="${c.id}" title="${esc(c.title || t('untitled'))}">
      <span class="r-title">${esc(c.title || t('untitled'))}</span>
      ${c.snippet ? `<span class="r-snip">${esc(c.snippet).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>')}</span>` : ''}</div>`).join('')}`
    : `<div class="sb-empty">${esc(t('noResults'))}</div>`;
}

Object.assign(actions, {
  'plus-menu': (el) => openPlusMenu(el),
  'reasoning-menu': (el) => openReasoningMenu(el),
  'style-menu': (el) => openStyleMenu(el.closest('.popover') ? $('#composer [data-action=plus-menu]') : el),
  'set-reasoning': async (el) => { await saveSettings({ gen: { reasoning: el.dataset.value } }); closePopover(); refreshComposer(); },
  'set-style': async (el) => { await saveSettings({ activeStyle: el.dataset.value }); closePopover(); refreshComposer(); },
  'tool-toggle': async (el) => {
    const k = el.dataset.key; const cur = (S.settings.chatTools || {})[k] !== false;
    await saveSettings({ chatTools: { [k]: !cur } });
    if (el.closest('.popover')) openPlusMenu($('#composer [data-action=plus-menu]')); else closePopover();
    refreshComposer();
  },
  'ephemeral-toggle': () => { S.ephemeralNext = !S.ephemeralNext; closePopover(); renderView(); },
  'edit-msg': (el) => startEdit(el.dataset.id),
  'edit-cancel': () => renderView(),
  'edit-save': (el) => {
    const id = el.dataset.id;
    const ta = $(`#m-${CSS.escape(id)} .edit-ta`);
    const text = ta ? ta.value.trim() : '';
    const orig = S.conv.nodes.find((x) => x.id === id);
    if (!orig || !text) return renderView();
    if (text === (orig.content || '').trim()) return renderView();
    S.conv.messages = pathOf(S.conv);
    addNode({ id: uid(), role: 'user', content: text, attachments: orig.attachments || [], createdAt: Date.now(), parentId: orig.parentId });
    generate();
  },
  'branch': (el) => {
    if (S.streaming) return;
    const m = S.conv.nodes.find((x) => x.id === el.dataset.id);
    const sib = siblingsOf(m); const i = sib.indexOf(m) + (+el.dataset.dir);
    if (!sib[i]) return;
    S.conv.leafId = deepestLeaf(sib[i].id);
    S.conv.messages = pathOf(S.conv);
    S.code.clear(); renderView(); persist();
  },
});
