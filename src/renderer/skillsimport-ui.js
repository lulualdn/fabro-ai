'use strict';
/* Skills: import from a .skill file, a zip, a folder, a link or text, or from other tools on this computer;
   preview dialog; export. Public: window.SkillsImport = { renderSection(container), openFile(path), openLink(), refreshFound() }.
   Mounted by Settings → Agent (any element with data-mount="skillimport"); settings re-renders call mountAll() again. */
(() => {
  const E = (s) => esc(s);
  const ic = (n, s) => icon(n, s);
  const clean = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
  let found = null;        // [{ id, tool, label, name, description, installed, alreadyActive }]
  let scanning = false;
  let pv = null;           // the preview shown in the dialog: { previewId, skills, … }
  let pick = new Set();    // keys selected in a multi-skill preview
  let coll = {};           // key → 'keepBoth' | 'replace'
  let busy = false;

  const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

  // ───────── the section in Settings ─────────
  function sectionHtml() {
    const list = found || [];
    return `<div class="si-zone" data-si-zone tabindex="0" role="button" aria-label="${E(t('si_dropTitle'))}" data-action="si-choose">
        <span class="si-zone-ico">${ic('fileZip', 26)}</span>
        <div class="si-zone-text"><b>${E(t('si_dropTitle'))}</b><small>${E(t('si_dropSub'))}</small></div>
        <div class="si-zone-btns">
          <button class="btn sm" data-action="si-choose">${ic('upload', 14)} ${E(t('si_chooseFile'))}</button>
          <button class="btn sm" data-action="si-folder">${ic('folder', 14)} ${E(t('si_chooseFolder'))}</button>
          <button class="btn sm" data-action="si-link">${ic('link', 14)} ${E(t('si_fromLink'))}</button>
        </div>
      </div>
      <p class="muted small si-claude">${ic('info', 13)} ${E(t('si_claudeHint'))}</p>
      <div class="si-found">
        <div class="si-found-h"><b>${E(t('si_found'))}</b><span class="grow"></span><button class="icon-btn sm" data-action="si-rescan" title="${E(t('si_rescan'))}">${scanning ? spinner(14) : ic('refresh', 15)}</button></div>
        ${list.length ? `<div class="list">${list.map((f) => `<div class="list-row">
            <div class="m-text"><b>${E(f.name)}</b><small>${E(f.description || '')}</small></div>
            <span class="chip">${E(f.label)}</span>
            ${f.installed ? `<span class="chip ok">${ic('check', 13)} ${E(t('si_inFabro'))}</span>` : `<button class="btn sm" data-action="si-import-found" data-id="${E(f.id)}">${ic('download', 14)} ${E(t('si_import'))}</button>`}
          </div>`).join('')}</div>`
          : `<div class="empty-note">${E(found ? t('si_foundNone') : t('si_scanning'))}</div>`}
      </div>`;
  }
  async function renderSection(container) {
    if (!container) return;
    container.classList.add('si-section');
    container.innerHTML = sectionHtml();
    if (found === null && !scanning) { await refreshFound(); }
  }
  async function refreshFound() {
    scanning = true; mountAll();
    try { found = await api.skillimport.found(); } catch { found = []; }
    scanning = false; mountAll();
  }
  function mountAll() {
    const els = document.querySelectorAll('[data-mount="skillimport"]');
    els.forEach((el) => { el.innerHTML = sectionHtml(); el.classList.add('si-section'); });
    if (els.length && found === null && !scanning) refreshFound();
  }

  // ───────── preview dialog ─────────
  function open(html, cls = '') {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-action="si-close"></div><div class="modal si-modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    return root.querySelector('.modal');
  }
  const close = () => { if (pv && pv.previewId) api.skillimport.discard(pv.previewId).catch(() => {}); pv = null; closeModal(); };

  function warnRow(w) {
    return `<li class="si-warn ${w.kind}">${ic(w.kind === 'binary' ? 'error' : 'warning', 14)}<span>${E(w.text)}</span></li>`;
  }
  function skillCard(s, multi) {
    const on = pick.has(s.key);
    const col = coll[s.key] || 'keepBoth';
    const mapped = s.tools.mapped; const un = s.tools.unmapped;
    return `<div class="si-card ${multi && !on ? 'off' : ''}">
      <div class="si-card-h">
        ${multi ? `<label class="si-check"><input type="checkbox" data-si-pick="${E(s.key)}" ${on ? 'checked' : ''}><span class="sr-only">${E(s.name)}</span></label>` : ''}
        <div class="si-card-title"><h3>${E(s.name)}</h3><span class="muted small">${E(t('si_files', { n: s.fileCount }))} · ${kb(s.bytes)}${s.license ? ' · ' + E(s.license) : ''}</span></div>
      </div>
      <p class="si-desc">${E(s.description || t('si_noDesc'))}</p>
      ${s.warnings.length ? `<ul class="si-warns">${s.warnings.map(warnRow).join('')}</ul>` : `<p class="si-ok">${ic('check', 14)} ${E(t('si_nothingRuns'))}</p>`}
      ${s.notes.length ? `<ul class="si-notes">${s.notes.map((n) => `<li>${ic('info', 13)} ${E(n)}</li>`).join('')}</ul>` : ''}
      ${mapped.length || un.length ? `<div class="si-tools"><b>${E(t('si_compatTitle'))}</b>
        ${mapped.length ? `<p class="small muted">${E(t('si_compatMapped'))} ${mapped.map((m) => `<code>${E(m.name)}</code> → <code>${E(m.to)}</code>`).join(', ')}</p>` : ''}
        ${un.length ? `<p class="small si-unmapped">${ic('warning', 13)} ${E(t('si_compatMissing'))} ${un.map((m) => `<code>${E(m.name)}</code>`).join(', ')}</p>` : ''}</div>` : ''}
      <details class="si-files"><summary>${E(t('si_showFiles'))}</summary>
        <ul>${s.files.slice(0, 80).map((f) => `<li class="${f.script ? 'script' : ''} ${f.blocked ? 'blocked' : ''}"><span class="mono">${E(f.path)}</span><small>${kb(f.size)}${f.script ? ' · ' + E(t('si_script')) : ''}${f.blocked ? ' · ' + E(t('si_notInstalled')) : ''}</small></li>`).join('')}${s.files.length > 80 ? `<li class="muted small">… ${s.files.length - 80}</li>` : ''}</ul></details>
      ${s.collision.exists && (!multi || on) ? `<div class="si-coll"><span class="small">${ic('info', 13)} ${E(t('si_exists', { name: s.name }))}</span>
        <div class="seg sm"><button type="button" class="${col === 'keepBoth' ? 'on' : ''}" data-action="si-coll" data-key="${E(s.key)}" data-v="keepBoth">${E(t('si_keepBoth'))}</button><button type="button" class="${col === 'replace' ? 'on' : ''}" data-action="si-coll" data-key="${E(s.key)}" data-v="replace">${E(t('si_replace'))}</button></div></div>` : ''}
    </div>`;
  }
  function renderPreview() {
    if (!pv) return;
    const multi = pv.skills.length > 1;
    const n = multi ? pick.size : 1;
    const m = open(`<div class="si-head"><h2>${E(multi ? t('si_titleMany', { n: pv.skills.length }) : t('si_title'))}</h2><small class="muted">${E(pv.label || '')}</small></div>
      <p class="si-intro small muted">${E(t('si_intro'))}</p>
      <div class="si-body">${pv.skills.map((s) => skillCard(s, multi)).join('')}
        ${(pv.skippedFiles || []).length ? `<p class="small muted">${ic('shield', 13)} ${E(t('si_skipped', { n: pv.skippedFiles.length }))}</p>` : ''}
        ${(pv.errors || []).length ? `<p class="small si-unmapped">${ic('warning', 13)} ${pv.errors.map(E).join(' · ')}</p>` : ''}</div>
      <div class="modal-actions"><button class="btn" data-action="si-close">${E(t('cancel'))}</button>
        <button class="btn primary" data-action="si-install" ${busy || (multi && !n) ? 'disabled' : ''}>${busy ? spinner(14) : ic('plus', 15)} ${E(multi ? t('si_addN', { n }) : t('si_add'))}</button></div>`);
    const b = m.querySelector('.btn.primary'); if (b && !b.disabled) b.focus();
  }
  async function showPreview(source) {
    let r;
    const m = open(`<div class="si-loading">${spinner(22)} <span>${E(t('si_reading'))}</span></div>`, 'si-small');
    try { r = await api.skillimport.preview(source); } catch (e) { r = { ok: false, error: clean(e) }; }
    if (!r.ok) {
      open(`<div class="si-head"><h2>${E(t('si_cantTitle'))}</h2></div><p class="si-err">${ic('warning', 15)} ${E(r.error || '')}</p><p class="small muted">${E(t('si_cantHelp'))}</p><div class="modal-actions"><button class="btn" data-action="si-close">${E(t('close'))}</button></div>`, 'si-small');
      return;
    }
    pv = r; pick = new Set(r.skills.map((s) => s.key)); coll = {}; busy = false;
    renderPreview();
  }
  async function install() {
    if (!pv || busy) return;
    busy = true; renderPreview();
    try {
      const r = await api.skillimport.install(pv.previewId, { select: [...pick], collision: coll, enable: true });
      pv = null; closeModal();
      if (r.ok && r.installed.length) toast(t('si_done', { n: r.installed.length, name: r.installed[0].name }));
      S.skills = await api.skills.list(); S.agentTools = await api.agent.tools();
      refreshFound(); if (S.settingsTab === 'agent') renderSettings();
    } catch (e) { busy = false; toast(clean(e), 'err'); renderPreview(); }
  }

  // ───────── link / text dialog ─────────
  function openLink() {
    const m = open(`<div class="si-head"><h2>${E(t('si_linkTitle'))}</h2></div>
      <p class="small muted">${E(t('si_linkHint'))}</p>
      <textarea class="input area mono" id="si-link-text" rows="5" placeholder="https://github.com/…/tree/main/skills/my-skill"></textarea>
      <p class="small muted">${ic('info', 13)} ${E(t('si_linkNet'))}</p>
      <div class="modal-actions"><button class="btn" data-action="si-close">${E(t('cancel'))}</button><button class="btn primary" data-action="si-link-go">${ic('search', 14)} ${E(t('si_look'))}</button></div>`, 'si-small');
    m.querySelector('textarea').focus();
  }

  // ───────── actions ─────────
  Object.assign(actions, {
    'si-close': () => close(),
    'si-choose': async () => { const p = await api.skillimport.pick('file'); if (p) showPreview({ type: 'file', path: p }); },
    'si-folder': async () => { const p = await api.skillimport.pick('folder'); if (p) showPreview({ type: 'folder', path: p }); },
    'si-link': () => openLink(),
    'si-link-go': () => { const v = (document.getElementById('si-link-text') || {}).value || ''; if (v.trim()) showPreview(v); },
    'si-rescan': () => refreshFound(),
    'si-import-found': (el) => showPreview({ type: 'found', id: el.dataset.id }),
    'si-coll': (el) => { coll[el.dataset.key] = el.dataset.v; renderPreview(); },
    'si-install': () => install(),
    'skill-export': async (el) => { try { const r = await api.skillimport.export(el.dataset.name); if (r) toast(t('si_exported', { f: r.files })); } catch (e) { toast(clean(e), 'err'); } },
    'skill-remove': async (el) => {
      if (!confirm(t('si_removeConfirm', { name: el.dataset.name }))) return;
      try { S.skills = await api.skillimport.remove(el.dataset.name); S.agentTools = await api.agent.tools(); refreshFound(); renderSettings(); } catch (e) { toast(clean(e), 'err'); }
    },
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest && e.target.closest('[data-si-pick]'); if (!c || !pv) return;
    if (c.checked) pick.add(c.dataset.siPick); else pick.delete(c.dataset.siPick);
    renderPreview();
  });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-si-zone]') && e.target === document.activeElement) { e.preventDefault(); actions['si-choose'](e.target, e); } });

  // ───────── drag and drop ─────────
  // On the drop zone: anything. Anywhere else in the window: only a .skill file (everything else keeps its normal meaning).
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  const isSkillName = (f) => /\.skill$/i.test(f.name || '');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    const z = e.target.closest && e.target.closest('[data-si-zone]');
    if (z) { e.preventDefault(); z.classList.add('over'); }
  }, true);
  document.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('[data-si-zone]'); if (z) z.classList.remove('over'); }, true);
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    const z = e.target.closest && e.target.closest('[data-si-zone]');
    const files = [...e.dataTransfer.files];
    if (!z && !(files.length && files.every(isSkillName))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (z) z.classList.remove('over');
    const f = files[0]; const p = f && api.files.pathOf(f);
    if (p) showPreview({ type: 'file', path: p }); else toast(t('si_dropNoPath'), 'err');
  }, true);

  // a .skill opened with Fabro (double-click, "open with", drag on the app icon)
  try { api.on('skillimport:open', (d) => { if (d && d.path) showPreview({ type: 'file', path: d.path }); }); } catch {}

  // Settings re-renders replace the DOM: fill the mount points again.
  const prevRender = window.renderSettings;
  if (typeof prevRender === 'function' && !prevRender.__si) {
    const wrapped = function (...a) { const r = prevRender.apply(this, a); mountAll(); return r; };
    wrapped.__si = true; window.renderSettings = wrapped;
  }

  window.SkillsImport = { renderSection, openFile: (p) => showPreview({ type: 'file', path: p }), openLink, refreshFound };
})();
