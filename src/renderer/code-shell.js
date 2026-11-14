// Fabro Code, new shell. In Code mode the app looks like a workbench, not like the chat:
//   · no project open → "What are we building?": describe it, Fabro makes the folder, opens it and starts;
//   · project open → the app sidebar steps aside; a bar (project, branch, preview, terminal, new session) and a side
//     panel with three tabs (files, changes, sessions). On a phone-sized window the panel is a drawer.
// It replaces three functions of code-ui.js (cxWelcome, renderCodeView, cxSide) and wraps renderView / cxRenderTree;
// everything else (tree, terminal, viewer, git) is code-ui.js as before. Hook in app.js: sbAuto.
(() => {
  const side0 = cxSide; const tree0 = cxRenderTree; const view0 = renderView;
  const KINDS = ['site', 'app', 'script', 'game'];
  const part = (html, sel) => { const tp = document.createElement('template'); tp.innerHTML = html; const el = tp.content.querySelector(sel); return el ? el.outerHTML : ''; };
  const sessions = () => S.convs.filter((c) => c.codeRoot && c.codeRoot === S.cx.root);

  window.cxWelcome = function () {
    const rec = S.cx.recent || []; const cm = currentModel();
    const coder = cm && /coder|code|devstral|codestral/i.test(cm.label + ' ' + (cm.id || ''));
    return `<div class="cs-home">
      <h1>${esc(t('cs_title'))}</h1>
      <form class="cs-new" data-form="cs-create">
        <textarea class="cs-what" name="what" rows="3" placeholder="${esc(t('cs_ph'))}" aria-label="${esc(t('cs_title'))}">${esc(S.cx.draftNew || '')}</textarea>
        <div class="cs-new-row">
          <div class="cs-kinds">${KINDS.map((k) => `<button type="button" class="chip-btn" data-action="cs-kind" data-k="${k}">${esc(t('cs_k_' + k))}</button>`).join('')}</div>
          <button class="btn primary" type="submit" ${S.cx.creating ? 'disabled' : ''}>${S.cx.creating ? spinner(14) : icon('plus', 16)} ${esc(t('cs_create'))}</button>
        </div>
      </form>
      <div class="cs-alt"><button class="btn" data-action="cx-open">${icon('folderOpen', 16)} ${esc(t('cx_openFolder'))}</button><button class="link" data-action="cs-empty">${esc(t('cs_empty'))}</button></div>
      <p class="cs-where">${esc(t('cs_where'))}</p>
      ${rec.length ? `<div class="cs-recent"><div class="cs-h">${esc(t('cx_recent'))}</div><div class="cs-grid">${rec.slice(0, 9).map((r) => `<button class="cs-proj" data-action="cx-open-recent" data-root="${esc(r.root)}" title="${esc(r.root)}">${icon('folder', 18)}<b>${esc(r.name)}</b>${r.kind && r.kind !== 'unknown' ? `<em>${esc(r.kind)}</em>` : ''}</button>`).join('')}</div></div>` : ''}
      ${!coder ? `<div class="cxw-model">${icon('sparkle', 18)}<div><b>${esc(t('cx_modelTitle'))}</b><small>${esc(t('cx_modelBody'))}</small></div><button class="btn sm" data-action="cx-get-coder">${icon('download', 14)} ${esc(t('cx_modelGet'))}</button></div>` : ''}
    </div>`;
  };

  function bar() {
    const i = S.cx.info || {}; const g = S.cx.git || {}; const n = Object.keys(g.files || {}).length;
    return `<button class="cs-menu icon-btn sm" data-action="cs-side" aria-label="${esc(t('cs_files'))}">${icon('panel', 17)}</button>
      <button class="icon-btn sm" data-action="home" title="${esc(t('cs_back'))}" aria-label="${esc(t('cs_back'))}">${icon('back', 17)}</button>
      <button class="cs-pill" data-action="cx-switch" title="${esc(S.cx.root)}">${icon('folder', 15)}<b>${esc(i.name || '')}</b>${icon('down', 12)}</button>
      ${g.repo ? `<button class="cs-pill dim" data-action="cx-branch" title="${esc(t('cx_branch'))}">${icon('git', 14)}<span>${esc(g.branch || 'HEAD')}</span>${n ? `<em>${n}</em>` : ''}</button>` : ''}
      <span class="grow"></span>
      ${S.cx.devUrl ? `<button class="cs-pill" data-action="cx-preview-url">${icon('play', 14)}<span>${esc(t('cx_preview'))}</span></button>` : ''}
      <button class="icon-btn sm ${S.cx.term.open ? 'on' : ''}" data-action="cx-term-toggle" title="${esc(t('cs_term'))}" aria-label="${esc(t('cs_term'))}">${icon('terminal', 17)}</button>
      <button class="icon-btn sm" data-action="new-chat" title="${esc(t('cx_newSession'))}" aria-label="${esc(t('cx_newSession'))}">${icon('edit', 17)}</button>`;
  }

  window.cxSide = function () {
    const tab = S.cx.sideTab || 'files'; const html = side0(); const n = Object.keys((S.cx.git || {}).files || {}).length; const ses = sessions();
    const tabBtn = (id, label, count) => `<button class="cs-tab ${tab === id ? 'on' : ''}" data-action="cs-tab" data-tab="${id}" role="tab" aria-selected="${tab === id}">${esc(label)}${count ? `<em>${count}</em>` : ''}</button>`;
    const body = tab === 'changes' ? part(html, '.cx-changes')
      : tab === 'sessions' ? `<div class="cs-sessions"><button class="btn sm" data-action="new-chat">${icon('plus', 14)} ${esc(t('cx_newSession'))}</button>${ses.length ? ses.map(recentItem).join('') : `<p class="muted">${esc(t('cs_noSession'))}</p>`}</div>`
      : part(html, '.cx-tree');
    return `<div class="cs-tabs" role="tablist">${tabBtn('files', t('cs_files'))}${tabBtn('changes', t('cs_changes'), n)}${tabBtn('sessions', t('cs_sessions'), ses.length)}</div>${body}`;
  };

  window.renderCodeView = function () {
    if (!S.cx.root) return cxWelcome();
    const hasMsgs = S.conv && S.conv.messages.length;
    return `<div class="cx cs ${S.cx.sideOpen ? 'side-open' : ''}">
      <aside class="cx-side" id="cx-side">${cxSide()}</aside>
      <button class="cs-scrim" data-action="cs-side" aria-label="${esc(t('close'))}"></button>
      <div class="cx-main">
        <div class="cs-bar" id="cs-bar">${bar()}</div>
        <div class="cx-chat">${hasMsgs ? `<div class="scroller" id="scroller"><div class="thread">${S.conv.messages.map(renderMessage).join('')}</div></div>` : cxStart()}</div>
        <div class="dock">${renderComposer()}</div>
        <div class="cx-term ${S.cx.term.open ? 'open' : ''}" id="cx-term" style="--th:${S.cx.term.h}px">${cxTerm()}</div>
      </div>
    </div>`;
  };
  const drawBar = () => { const b = $('#cs-bar'); if (b) b.innerHTML = bar(); };
  window.cxRenderTree = function () { tree0(); drawBar(); };
  window.renderView = function () {
    const r = document.documentElement.classList;
    r.toggle('code-mode', S.mode === 'code'); r.toggle('code-open', S.mode === 'code' && !!S.cx.root);
    return view0.apply(this, arguments);
  };

  async function create(what) {
    if (S.cx.creating) return;
    S.cx.creating = true; S.cx.draftNew = what; renderView();
    try {
      const i = await api.code.create({ name: what });
      S.cx.recent = null; S.cx.draftNew = '';
      if (!(await cxOpen(i.root))) return;
      S.conv = null; S.cx.sideTab = 'files';
      vt(() => { renderSidebar(); renderView(); });
      if (what) sendPrompt(t('cs_first', { what }));
    } catch (e) { toast(cleanErr(e), 'err'); } finally { S.cx.creating = false; if (!S.cx.root) renderView(); }
  }
  document.addEventListener('submit', (e) => {
    const f = e.target.closest && e.target.closest('form[data-form="cs-create"]'); if (!f) return;
    e.preventDefault(); e.stopPropagation();
    const what = f.what.value.trim(); if (!what) { f.what.focus(); return; }
    create(what);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.classList && e.target.classList.contains('cs-what')) { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  Object.assign(actions, {
    'cs-kind': (el) => { const ta = $('.cs-what'); if (!ta) return; ta.value = t('cs_k_' + el.dataset.k + '_p'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); },
    'cs-empty': () => create(''),
    'cs-tab': (el) => { S.cx.sideTab = el.dataset.tab; cxRenderTree(); },
    'cs-side': () => { S.cx.sideOpen = !S.cx.sideOpen; const c = $('.cx.cs'); if (c) c.classList.toggle('side-open', !!S.cx.sideOpen); },
  });
  // after the terminal is toggled, the bar button follows
  const tg = actions['cx-term-toggle']; actions['cx-term-toggle'] = (...a) => { tg(...a); drawBar(); };
})();
