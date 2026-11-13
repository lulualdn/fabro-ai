// Personal system prompts (Settings › Generation) + the composer "document" button that picks the prompt of a
// conversation. Also builds the structured user context the smart prompt is made from (sysContext()).
// Main side: src/main/sysprompts.js (files, templates), src/main/sysprompt/ (smart prompt).

// What the main process needs to build the system prompt itself (instead of the text the renderer used to write).
function sysContext() {
  const st = S.settings || {};
  const mem = (st.memory || {}).enabled !== false && S.memories && !(S.conv && S.conv.ephemeral) ? S.memories.slice(0, 40).map((m) => m.text) : [];
  return {
    name: (typeof userFirstName === 'function' && userFirstName()) || '',
    aiName: (typeof aiName === 'function' && aiName()) || '',
    useFor: (typeof useForLine === 'function' && useForLine()) || '',
    style: (typeof stylePrompt === 'function' && stylePrompt()) || '',
    memories: mem, custom: ((st.gen || {}).systemPrompt || '').trim(), lang: S.lang,
  };
}
// The personal prompt chosen for the current conversation (only when the setting is on).
function sysPromptId() {
  if (!((S.settings && S.settings.advanced) || {}).personalPrompts) return null;
  return (S.conv && S.conv.sysPrompt) || (S.settings.advanced.defaultPrompt || null);
}

const SysPrompts = (() => {
  const st = { list: null, cur: null, preview: null, vars: null, dirty: false, mount: null };
  const on = () => !!((S.settings.advanced || {}).personalPrompts);
  const load = async () => { st.list = await api.sysprompts.list().catch(() => []); if (!st.vars) st.vars = await api.sysprompts.variables().catch(() => ({ variables: [], conditions: [] })); };
  const ctx = () => ({ agent: !!(S.conv && (S.conv.agent || S.conv.code)), voice: !!(S.voice && S.voice.on), project: S.conv && S.conv.project ? String(S.conv.project) : '', userContext: sysContext(), chatTools: typeof chatTools === 'function' ? chatTools() : [], request: S.conv && S.conv.messages && S.conv.messages.length ? (S.conv.messages.filter((m) => m.role === 'user').pop() || {}).content || '' : '' });

  async function refreshPreview() {
    if (!st.cur || !st.mount) return;
    st.preview = await api.sysprompts.preview({ body: st.cur.body, context: ctx() }).catch((e) => ({ text: String(e.message || e), unknown: [], warnings: [], runtime: '' }));
    const el = st.mount.querySelector('.sp-preview'); if (!el) return;
    const p = st.preview;
    el.innerHTML = `<div class="sp-prev-head"><b>${esc(t('sp_preview'))}</b><small>${esc(t('sp_tokens', { n: p.tokens || 0 }))}</small></div>
      ${(p.unknown || []).length ? `<div class="sp-warn">${icon('warning', 14)} ${esc(t('sp_unknown', { v: p.unknown.map((x) => `{{${x}}}`).join(', ') }))}</div>` : ''}
      ${(p.warnings || []).map((w) => `<div class="sp-warn">${icon('warning', 14)} ${esc(w)}</div>`).join('')}
      <pre class="sp-prev-text">${esc(p.text)}</pre>
      ${p.runtime ? `<div class="sp-runtime"><small>${esc(t('sp_runtime'))}</small><pre>${esc(p.runtime)}</pre></div>` : ''}`;
  }
  const previewSoon = debounce(refreshPreview, 350);

  function editor() {
    const c = st.cur; const v = st.vars || { variables: [], conditions: [] };
    return `<div class="sp-editor">
      <div class="sp-ed-top"><input class="input" data-sp="name" maxlength="80" value="${esc(c.name || '')}" placeholder="${esc(t('sp_name'))}">
        <button class="btn sm primary" data-action="sp-save">${esc(t('save'))}</button>
        ${c.id ? `<button class="btn sm" data-action="sp-export">${icon('download', 14)} ${esc(t('sp_export'))}</button><button class="icon-btn" data-action="sp-delete" title="${esc(t('delete'))}">${icon('trash', 16)}</button>` : ''}
        <button class="icon-btn" data-action="sp-close" title="${esc(t('close'))}">${icon('x', 16)}</button></div>
      <div class="sp-vars">${v.variables.map(([k, d]) => `<button class="c-chip" data-action="sp-insert" data-v="{{${k}}}" title="${esc(d)}">{{${esc(k)}}}</button>`).join('')}
        ${v.conditions.map((k) => `<button class="c-chip ghost" data-action="sp-insert" data-v="{{#if ${k}}}…{{/if}}">#if ${esc(k)}</button>`).join('')}</div>
      <textarea class="input area mono sp-body" data-sp="body" rows="16" spellcheck="false">${esc(c.body || '')}</textarea>
      <div class="sp-preview"></div></div>`;
  }
  function html() {
    const list = st.list || [];
    return `<div class="sp-section">
      <div class="st-row"><div class="st-label"><span>${esc(t('sp_toggle'))}</span><small>${esc(t('sp_toggleHint'))}</small></div>
        <div class="st-control"><button class="switch ${on() ? 'on' : ''}" data-action="set" data-key="advanced.personalPrompts" data-value="${!on()}" role="switch" aria-checked="${on()}"><i></i></button></div></div>
      <div class="st-row"><div class="st-label"><span>${esc(t('sp_location'))}</span><small>${esc(t('sp_locationHint'))}</small></div>
        <div class="st-control"><input class="input" type="text" maxlength="60" data-input="advanced.location" value="${esc((S.settings.advanced || {}).location || '')}" placeholder="${esc(t('sp_locationPh'))}"></div></div>
      ${on() ? `<div class="sp-list">
        ${list.length ? list.map((p) => `<div class="sp-item"><button class="sp-open" data-action="sp-open" data-id="${esc(p.id)}">${icon('file', 16)}<span><b>${esc(p.name)}</b>${p.description ? `<small>${esc(p.description)}</small>` : ''}</span></button></div>`).join('') : `<div class="muted small">${esc(t('sp_empty'))}</div>`}
        <div class="sp-actions"><button class="btn sm" data-action="sp-new">${icon('plus', 14)} ${esc(t('sp_new'))}</button><button class="btn sm" data-action="sp-import">${icon('upload', 14)} ${esc(t('sp_import'))}</button></div>
      </div>${st.cur ? editor() : ''}` : ''}
    </div>`;
  }
  async function renderSection(container) {
    if (!container) return;
    st.mount = container;
    if (!st.list) await load();
    container.innerHTML = html();
    const ta = container.querySelector('[data-sp=body]'); const nm = container.querySelector('[data-sp=name]');
    if (ta) ta.addEventListener('input', () => { st.cur.body = ta.value; st.dirty = true; previewSoon(); });
    if (nm) nm.addEventListener('input', () => { st.cur.name = nm.value; st.dirty = true; });
    if (st.cur) refreshPreview();
  }
  // Settings render their tabs as HTML strings: this placeholder mounts the section once it is in the page.
  function mountPoint() { requestAnimationFrame(() => renderSection(document.querySelector('[data-sp-mount]'))); return '<div data-sp-mount></div>'; }
  const rerender = () => st.mount && document.body.contains(st.mount) && renderSection(st.mount);

  // Composer: a filled document icon when personal prompts are on; opens a small picker.
  function chip() {
    if (!on() || S.mode === 'code') return '';
    const id = sysPromptId(); const p = (st.list || []).find((x) => x.id === id);
    if (!st.list) load().then(() => { if (typeof refreshComposer === 'function') refreshComposer(); });
    return `<button class="c-chip sp-chip ${p ? 'on' : ''}" data-action="sp-pick" title="${esc(t('sp_pickTitle'))}">${icon('file', 14)}<span>${esc(p ? p.name : t('sp_smart'))}</span></button>`;
  }
  function openPicker(anchor) {
    const r = anchor.getBoundingClientRect(); const cur = sysPromptId();
    const item = (id, name, hint) => `<button class="pm-item ${cur === id ? 'sel' : ''}" data-action="sp-choose" data-id="${esc(id || '')}"><span class="pm-text"><b>${esc(name)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>${cur === id ? icon('check', 16) : ''}</button>`;
    $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
      <div class="popover" style="left:${r.left}px; bottom:${innerHeight - r.top + 8}px; min-width:260px">
        <div class="pm-sec">${esc(t('sp_pickTitle'))}</div>
        ${item(null, t('sp_smart'), t('sp_smartHint'))}
        ${(st.list || []).map((p) => item(p.id, p.name, p.description)).join('')}
        <div class="pm-sep"></div>
        <button class="pm-item" data-action="settings-page" data-page="generation">${icon('edit', 16)}<span class="pm-text"><b>${esc(t('sp_manage'))}</b></span></button>
      </div>`;
  }

  Object.assign(actions, {
    'sp-pick': async (el) => { await load(); openPicker(el); },
    'sp-choose': (el) => { const id = el.dataset.id || null; if (!S.conv && typeof newConv === 'function') S.conv = newConv(); if (S.conv) { S.conv.sysPrompt = id; if (S.conv.messages && S.conv.messages.length && typeof persist === 'function') persist(); } closePopover(); refreshComposer(); },
    'sp-new': async () => { st.cur = { id: '', name: t('sp_newName'), body: await api.sysprompts.starter() }; rerender(); },
    'sp-open': async (el) => { st.cur = await api.sysprompts.get(el.dataset.id); rerender(); },
    'sp-close': () => { st.cur = null; rerender(); },
    'sp-insert': (el) => {
      const ta = st.mount && st.mount.querySelector('[data-sp=body]'); if (!ta) return;
      const v = el.dataset.v; const a = ta.selectionStart, b = ta.selectionEnd;
      ta.value = ta.value.slice(0, a) + v + ta.value.slice(b); ta.focus(); ta.selectionStart = ta.selectionEnd = a + v.length;
      st.cur.body = ta.value; previewSoon();
    },
    'sp-save': async () => { const r = await api.sysprompts.save(st.cur).catch((e) => { toast(String(e.message || e), 'err'); return null; }); if (!r) return; st.cur = r; st.dirty = false; await load(); toast(t('sp_saved')); rerender(); },
    'sp-delete': async () => { if (!st.cur || !st.cur.id || !confirm(t('sp_confirmDelete'))) return; await api.sysprompts.delete(st.cur.id); st.cur = null; await load(); rerender(); },
    'sp-export': async () => { if (!st.cur || !st.cur.id) return; const r = await api.sysprompts.export(st.cur.id); if (r && r.file) toast(t('sp_exported')); },
    'sp-import': async () => { const r = await api.sysprompts.import(); if (r) { st.cur = r; await load(); toast(t('sp_imported')); rerender(); } },
  });
  return { renderSection, mountPoint, chip, openPicker, reload: load };
})();
