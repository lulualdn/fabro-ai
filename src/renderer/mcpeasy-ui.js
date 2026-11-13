'use strict';
/* MCP connectors, made simple: one "Add a connector" button → one dialog (Paste / From another app / Popular),
   every server tested before it is saved; list with status dot, per-server and per-tool switches.
   Public: window.McpEasy = { renderSection(container), openAdd(tab) }.
   Mounted by Settings → Agent (any element with data-mount="mcpeasy"); settings re-renders call mountAll() again. */
(() => {
  const E = (s) => esc(s);
  const ic = (n, s) => icon(n, s);
  const M = (s) => (window.installMsg ? installMsg(s) : String(s == null ? '' : s)); // main-process English → UI language
  const clean = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
  const st = { tab: 'paste', text: '', parsed: null, cards: {}, found: null, sel: new Set(), catalog: null, openCat: null, importing: false, expanded: new Set() };
  let parseSeq = 0; let parseTimer = null;

  // ───────── the section in Settings ─────────
  function statusDot(m) {
    const k = m.status === 'ready' ? 'ok' : m.status === 'error' ? 'err' : m.status === 'auth' ? 'warn' : m.status === 'connecting' ? 'busy' : 'off';
    return `<span class="mc-dot ${k}" aria-hidden="true"></span>`;
  }
  function statusText(m) {
    if (m.status === 'ready') return `${t('mc_ready', { n: m.tools.length })}`;
    if (m.status === 'connecting') return t('mcpConnecting');
    if (m.status === 'auth') return t('mc_needsAuth');
    if (m.status === 'error') return M(m.error) || t('mc_failed');
    return t('mcpOff');
  }
  function plainTool(tool) { return `<li class="mc-tool"><div class="m-text"><b class="mono">${E(tool.name)}</b><small>${E(tool.description || '')}</small></div>${toggleBtn('mc-tool', tool.enabled, `data-id="__ID__" data-tool="${E(tool.name)}"`)}</li>`; }
  function serverRow(m) {
    const open = st.expanded.has(m.id);
    const what = m.tools.length ? m.tools.slice(0, 4).map((x) => x.name).join(', ') + (m.tools.length > 4 ? ` +${m.tools.length - 4}` : '') : '';
    return `<div class="mc-row ${m.status}">
      <div class="mc-main">
        ${statusDot(m)}
        <div class="m-text"><b>${E(m.name)}</b>
          <small class="mc-kind">${E(m.type === 'http' ? t('mc_online') : t('mc_local'))} · <span class="mc-st st-${m.status}">${E(statusText(m))}</span></small>
          ${m.status === 'ready' && what ? `<small class="mc-what">${E(t('mc_canDo'))} ${E(what)}</small>` : ''}
          ${m.note ? `<small class="muted">${E(M(m.note))}</small>` : ''}</div>
        ${m.status === 'auth' ? `<button class="btn sm primary" data-action="mcp-signin" data-id="${E(m.id)}">${E(t('mcpSignIn'))}</button>` : ''}
        ${m.status === 'error' ? `<button class="icon-btn sm" data-action="mcp-retry" data-id="${E(m.id)}" title="${E(t('errRetry'))}">${ic('refresh', 16)}</button>` : ''}
        ${m.tools.length ? `<button class="icon-btn sm ${open ? 'on' : ''}" data-action="mc-expand" data-id="${E(m.id)}" aria-expanded="${open}" title="${E(t('mc_tools'))}">${ic('sliders', 16)}</button>` : ''}
        <button class="icon-btn sm" data-action="mcp-remove" data-id="${E(m.id)}" title="${E(t('delete'))}">${ic('trash', 16)}</button>
        ${toggleBtn('mcp-toggle', m.status !== 'off', `data-id="${E(m.id)}" aria-label="${E(m.name || m.id)}"`)}
      </div>
      ${m.status === 'error' && (m.log || []).length ? `<details class="mc-log"><summary>${E(t('mc_details'))}</summary><pre>${E(m.log.join('\n'))}</pre></details>` : ''}
      ${open ? `<ul class="mc-tools">${m.tools.map((x) => plainTool(x).replace('__ID__', E(m.id))).join('')}</ul>` : ''}
    </div>`;
  }
  function sectionHtml() {
    const list = S.mcp || [];
    return `<div class="st-sec">${E(t('mcpTitle'))}<span class="grow"></span>
        <button class="btn sm" data-action="mc-advanced">${ic('wrench', 14)} ${E(t('mc_advanced'))}</button>
        <button class="btn sm primary" data-action="mc-open">${ic('plus', 14)} ${E(t('mc_add'))}</button></div>
      <p class="muted small st-intro">${E(t('mc_hint'))}</p>
      <div class="mc-list">${list.length ? list.map(serverRow).join('') : `<div class="empty-note">${E(t('mcpEmpty'))}</div>`}</div>`;
  }
  function renderSection(container) { if (container) { container.classList.add('mc-section'); container.innerHTML = sectionHtml(); } }
  function mountAll() { document.querySelectorAll('[data-mount="mcpeasy"]').forEach(renderSection); }

  // ───────── dialog ─────────
  const root = () => document.getElementById('modal-root');
  const dlg = () => root().querySelector('.mc-modal');
  function openAdd(tab) {
    if (tab) st.tab = tab;
    st.catalog = null; st.openCat = null; if (st.text.trim()) doParse();
    root().innerHTML = `<div class="modal-backdrop" data-action="mc-close"></div><div class="modal mc-modal" role="dialog" aria-modal="true" aria-labelledby="mc-title"></div>`;
    paint();
    if (st.tab === 'other') loadFound(); if (st.tab === 'popular') loadCatalog();
    const ta = dlg() && dlg().querySelector('#mc-paste'); if (ta) ta.focus();
  }
  function paint() {
    const m = dlg(); if (!m) return;
    const keepScroll = m.querySelector('.mc-body') ? m.querySelector('.mc-body').scrollTop : 0;
    const focus = document.activeElement && document.activeElement.id;
    const sel = focus === 'mc-paste' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    m.innerHTML = `<div class="mc-head"><h2 id="mc-title">${E(t('mc_add'))}</h2><button class="icon-btn" data-action="mc-close" title="${E(t('close'))}">${ic('x')}</button></div>
      <div class="tabs mc-tabs" role="tablist">${[['paste', 'mc_tabPaste'], ['other', 'mc_tabOther'], ['popular', 'mc_tabPopular']].map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}" data-action="mc-tab" data-tab="${k}">${E(t(l))}</button>`).join('')}</div>
      <div class="mc-body">${st.tab === 'paste' ? pasteTab() : st.tab === 'other' ? otherTab() : popularTab()}</div>`;
    const b = m.querySelector('.mc-body'); if (b) b.scrollTop = keepScroll;
    if (focus === 'mc-paste') { const ta = m.querySelector('#mc-paste'); if (ta) { ta.focus(); if (sel) ta.setSelectionRange(sel[0], sel[1]); } }
  }

  // ── a server card (Paste and Popular) ──
  const card = (d) => st.cards[d.draftId] || (st.cards[d.draftId] = { values: {}, name: d.name, test: null, added: false, prereq: null });
  function needInput(d, n) {
    const c = card(d); const k = `${n.where}:${n.name !== undefined ? n.name : n.index}`;
    if (n.set && c.values[k] === undefined) return `<div class="mc-need ok"><span>${E(M(n.label))}</span><small>${ic('check', 12)} ${E(t('mc_keyFound'))}</small><button class="btn sm" data-action="mc-change" data-draft="${E(d.draftId)}" data-k="${E(k)}">${E(t('mc_change'))}</button></div>`;
    const folder = n.kind === 'folder';
    return `<label class="field mc-need"><span>${E(M(n.label))}${n.required ? '' : ` <small>${E(t('mc_optional'))}</small>`}</span>
      <span class="mc-need-in"><input class="input ${folder ? 'mono' : ''}" type="${n.kind === 'password' ? 'password' : 'text'}" autocomplete="off" spellcheck="false" data-mc-val="${E(k)}" data-draft="${E(d.draftId)}" value="${E(c.values[k] || '')}" placeholder="${E(n.kind === 'password' ? t('mc_pasteKey') : folder ? t('mc_folderPh') : '')}">
      ${folder ? `<button type="button" class="btn sm" data-action="mc-folder" data-draft="${E(d.draftId)}" data-k="${E(k)}">${ic('folder', 14)} ${E(t('mc_browse'))}</button>` : ''}</span></label>`;
  }
  function prereqLine(c) {
    if (!c.prereq) return '';
    return c.prereq.items.map((i) => i.found ? `<p class="mc-pre ok">${ic('check', 13)} ${E(t('mc_found', { p: i.tool }))}</p>` : `<p class="mc-pre bad">${ic('warning', 13)} <span>${E(t('mc_missing', { p: M(i.label) }))} ${E(M(i.help))}</span></p>`).join('');
  }
  function testBox(c) {
    const r = c.test; if (!r) return '';
    if (r.busy) return `<div class="mc-test busy">${spinner(16)} <span>${E(t('mc_testing'))}</span></div>`;
    if (r.ok) {
      const names = r.tools.slice(0, 14).map((x) => `<code>${E(x.name)}</code>`).join(' ');
      return `<div class="mc-test ok"><p>${ic('success', 15)} <b>${E(r.auth && !r.ready ? t('mc_reachAuth') : t('mc_works', { n: r.count }))}</b></p>
        ${r.auth && !r.ready ? `<p class="small muted">${E(M(r.hint))}</p>` : `<p class="mc-names">${names}${r.tools.length > 14 ? ` <span class="muted small">+${r.tools.length - 14}</span>` : ''}</p>`}</div>`;
    }
    return `<div class="mc-test bad"><p>${ic('warning', 15)} <b>${E(M(r.cause || r.error) || t('mc_failed'))}</b></p>${r.hint ? `<p class="small">${E(M(r.hint))}</p>` : ''}
      ${r.stderr ? `<details open><summary>${E(t('mc_details'))}</summary><pre>${E(r.stderr)}</pre></details>` : (r.error && r.error !== r.cause ? `<pre>${E(M(r.error))}</pre>` : '')}</div>`;
  }
  function serverCard(d) {
    const c = card(d);
    if (c.added) return `<div class="card mc-card done"><p>${ic('success', 16)} <b>${E(t('mc_added', { name: c.name }))}</b></p><p class="small muted">${E(c.addedOff ? t('mc_addedOff') : t('mc_addedOn'))}</p></div>`;
    const ready = c.test && c.test.ok && !c.test.busy;
    const needs = (d.needs || []);
    return `<div class="card mc-card" data-draft="${E(d.draftId)}">
      <div class="mc-card-h"><label class="field mc-name"><span>${E(t('mc_name'))}</span><input class="input" data-mc-name="${E(d.draftId)}" value="${E(c.name)}" maxlength="32"></label>
        <span class="chip">${E(d.type === 'http' ? t('mc_online') : t('mc_local'))}</span></div>
      <div class="mc-run"><span class="mc-run-l">${E(d.type === 'http' ? t('mc_connectsTo') : t('mc_willRun'))}</span><code class="mc-cmd">${E(d.command_line)}</code></div>
      ${(d.notes || []).map((n) => `<p class="small muted mc-note">${ic('info', 13)} ${E(M(n))}</p>`).join('')}
      ${needs.length ? `<div class="mc-needs">${needs.map((n) => needInput(d, n)).join('')}</div>` : ''}
      ${prereqLine(c)}
      <p class="mc-warn small">${ic('shield', 14)} ${E(d.type === 'http' ? t('mc_warnHttp') : t('mc_warnRun'))}</p>
      ${testBox(c)}
      <div class="mc-actions">
        <button class="btn" data-action="mc-test" data-draft="${E(d.draftId)}" ${c.test && c.test.busy ? 'disabled' : ''}>${ic('plug', 15)} ${E(ready ? t('mc_testAgain') : t('mc_test'))}</button>
        <button class="btn primary" data-action="mc-save" data-draft="${E(d.draftId)}" ${ready ? '' : 'disabled'} title="${ready ? '' : E(t('mc_testFirst'))}">${ic('check', 15)} ${E(t('mc_addBtn'))}</button>
      </div></div>`;
  }

  // ── tabs ──
  function pasteTab() {
    const p = st.parsed;
    return `<p class="small muted">${E(t('mc_pasteHint'))}</p>
      <textarea id="mc-paste" class="input area mono" rows="5" spellcheck="false" placeholder="${E(t('mc_pastePh'))}" data-mc-paste>${E(st.text)}</textarea>
      ${p && !p.ok && st.text.trim() ? `<p class="mc-err">${ic('warning', 14)} ${E(M((p.errors || [])[0]) || t('mc_noServer'))}</p>` : ''}
      ${p && p.ok ? p.servers.map(serverCard).join('') : ''}`;
  }
  function otherTab() {
    if (!st.found) return `<div class="mc-loading">${spinner(18)} ${E(t('mc_scanning'))}</div>`;
    const apps = st.found;
    if (!apps.length) return `<div class="empty-note">${E(t('mc_noApps'))}</div><p class="small muted">${E(t('mc_noAppsHint'))}</p>`;
    const n = st.sel.size;
    return `<p class="small muted">${ic('shield', 13)} ${E(t('mc_importNote'))}</p>
      ${apps.map((a) => `<div class="mc-app"><div class="mc-app-h"><b>${E(a.app)}</b><small class="mono muted">${E(a.file)}</small></div>
        ${a.error ? `<p class="small si-unmapped">${ic('warning', 13)} ${E(M(a.error))}</p>` : `<div class="list">${a.servers.map((s) => `<label class="list-row mc-imp ${s.already ? 'done' : ''}"><input type="checkbox" data-mc-imp="${E(s.key)}" ${s.already ? 'disabled' : st.sel.has(s.key) ? 'checked' : ''}>
          <span class="m-text"><b>${E(s.name)}${s.scope && s.scope !== 'all projects' ? ` <span class="chip">${E(s.scope)}</span>` : ''}${s.already ? ` <span class="chip ok">${E(t('mc_already'))}</span>` : ''}</b><small class="mono">${E(s.command_line)}</small></span></label>`).join('')}</div>`}</div>`).join('')}
      <div class="mc-actions"><button class="btn primary" data-action="mc-import" ${n && !st.importing ? '' : 'disabled'}>${st.importing ? spinner(14) : ic('download', 15)} ${E(t('mc_importN', { n }))}</button></div>`;
  }
  function popularTab() {
    if (!st.catalog) return `<div class="mc-loading">${spinner(18)} …</div>`;
    return `<p class="small muted">${E(t('mc_popHint'))}</p><div class="list mc-pop">${st.catalog.map((c) => {
      const open = st.openCat === c.id;
      return `<div class="mc-pop-item ${open ? 'open' : ''}"><button class="list-row link-row mc-pop-row" data-action="mc-pick" data-id="${E(c.id)}" aria-expanded="${open}">
        <span class="mc-pop-ico">${ic(c.icon || 'puzzle', 18)}</span>
        <span class="m-text"><b>${E(t('mcc_' + c.id + '_n'))}</b><small>${E(t('mcc_' + c.id))}</small></span>
        ${c.requires ? `<span class="chip">${E(t('mc_needs_' + c.requires))}</span>` : `<span class="chip">${E(t('mc_online'))}</span>`}</button>
        ${open ? `<div class="mc-pop-card">${serverCard(c.server)}${c.link ? `<p class="small muted">${E(t('mc_getKey'))} <a href="${E(c.link)}" data-action="ext-link">${E(c.link.replace(/^https?:\/\//, ''))}</a></p>` : ''}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  // ───────── data ─────────
  async function loadFound() { st.found = null; paint(); try { st.found = await api.mcpeasy.found(); } catch { st.found = []; } st.sel = new Set(); paint(); }
  async function loadCatalog() { if (st.catalog) return; try { st.catalog = await api.mcpeasy.catalog(); } catch { st.catalog = []; } paint(); }
  async function doParse() {
    const seq = ++parseSeq; const text = st.text;
    if (!text.trim()) { st.parsed = null; paint(); return; }
    let r; try { r = await api.mcpeasy.parse(text); } catch (e) { r = { ok: false, errors: [clean(e)], servers: [] }; }
    if (seq !== parseSeq) return;
    st.parsed = r; st.cards = {};
    for (const d of r.servers) { const c = card(d); checkPrereq(d); }
    paint();
  }
  async function checkPrereq(d) {
    const c = card(d);
    try { c.prereq = await api.mcpeasy.prereq({ draftId: d.draftId }); } catch { c.prereq = null; }
    paint();
  }
  const specOf = (draftId, name) => { const c = st.cards[draftId]; return { draftId, name: (c && c.name) || undefined, values: Object.fromEntries(Object.entries((c && c.values) || {}).filter(([, v]) => v !== '')) }; };

  Object.assign(actions, {
    'mc-open': () => openAdd(),
    'mc-close': () => closeModal(),
    'mc-advanced': () => { actions['mcp-add-open'] && actions['mcp-add-open'](); const f = document.querySelector('[data-form="mcp-add"]'); if (f) f.scrollIntoView({ block: 'center' }); },
    'mc-tab': (el) => { st.tab = el.dataset.tab; paint(); if (st.tab === 'other' && !st.found) loadFound(); if (st.tab === 'popular') loadCatalog(); },
    'mc-expand': (el) => { const id = el.dataset.id; if (st.expanded.has(id)) st.expanded.delete(id); else st.expanded.add(id); renderSettings(); },
    'mc-tool': async (el) => { try { S.mcp = await api.mcpeasy.setTool(el.dataset.id, el.dataset.tool, el.dataset.value === 'true'); S.agentTools = await api.agent.tools(); } catch (e) { toast(clean(e), 'err'); } renderSettings(); },
    'mc-pick': (el) => { st.openCat = st.openCat === el.dataset.id ? null : el.dataset.id; const c = (st.catalog || []).find((x) => x.id === st.openCat); if (c) checkPrereq(c.server); paint(); },
    'mc-change': (el) => { const c = st.cards[el.dataset.draft]; if (c) c.values[el.dataset.k] = ''; paint(); },
    'mc-folder': async (el) => { const p = await api.skillimport.pick('folder'); if (!p) return; const c = st.cards[el.dataset.draft]; if (c) { c.values[el.dataset.k] = p; c.test = null; } paint(); },
    'mc-test': async (el) => {
      const id = el.dataset.draft; const c = st.cards[id]; if (!c) return;
      c.test = { busy: true }; paint();
      try { c.test = await api.mcpeasy.test(specOf(id)); } catch (e) { c.test = { ok: false, error: clean(e), cause: clean(e) }; }
      paint();
    },
    'mc-save': async (el) => {
      const id = el.dataset.draft; const c = st.cards[id]; if (!c) return;
      try {
        const r = await api.mcpeasy.add(specOf(id));
        if (!r.ok) { c.test = { ok: false, error: r.error, cause: r.error }; paint(); return; }
        c.added = true; c.name = r.server ? r.server.name : c.name; S.mcp = r.servers; S.agentTools = await api.agent.tools();
        toast(t('mc_added', { name: c.name })); renderSettings(); paint();
      } catch (e) { c.test = { ok: false, error: clean(e), cause: clean(e) }; paint(); }
    },
    'mc-import': async () => {
      st.importing = true; paint();
      try { const r = await api.mcpeasy.import([...st.sel]); S.mcp = r.servers; S.agentTools = await api.agent.tools(); toast(t('mc_imported', { n: r.added.length })); closeModal(); renderSettings(); }
      catch (e) { toast(clean(e), 'err'); }
      st.importing = false;
    },
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches && el.matches('[data-mc-paste]')) { st.text = el.value; clearTimeout(parseTimer); parseTimer = setTimeout(doParse, 350); }
    else if (el.matches && el.matches('[data-mc-val]')) { const c = st.cards[el.dataset.draft]; if (c) { c.values[el.dataset.mcVal] = el.value; if (c.test && !c.test.busy) { c.test = null; const b = dlg(); if (b) { /* keep typing: only refresh buttons */ const card = el.closest('.mc-card'); if (card) { const tb = card.querySelector('.mc-test'); if (tb) tb.remove(); const sv = card.querySelector('[data-action="mc-save"]'); if (sv) sv.disabled = true; } } } } }
    else if (el.matches && el.matches('[data-mc-name]')) { const c = st.cards[el.dataset.mcName]; if (c) c.name = el.value; }
  });
  document.addEventListener('change', (e) => {
    const el = e.target; if (!el.matches || !el.matches('[data-mc-imp]')) return;
    if (el.checked) st.sel.add(el.dataset.mcImp); else st.sel.delete(el.dataset.mcImp);
    paint();
  });

  const prevRender = window.renderSettings;
  if (typeof prevRender === 'function' && !prevRender.__mc) {
    const wrapped = function (...a) { const r = prevRender.apply(this, a); mountAll(); return r; };
    wrapped.__mc = true; window.renderSettings = wrapped;
  }
  window.McpEasy = { renderSection, openAdd };
})();
