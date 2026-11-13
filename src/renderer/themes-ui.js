/* Theme settings: a gallery of live previews (drawn with each theme's own tokens — no screenshots), import / export,
   duplicate + edit a few colours, and the keyboard-navigation switch.
   window.Themes.renderSection(container) is what the settings screen calls in "Mon compte → Apparence";
   Themes.openGallery() shows the same thing in a dialog (command palette, /themes) until then. */
(function () {
  'use strict';
  const T = window.Themes; if (!T || typeof S === 'undefined') return;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const wantDark = () => { const th = S.settings.theme; return th === 'dark' || th === 'halloween' || (th !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); };
  const baseLabel = (m) => t(m.base === 'both' ? 'th_baseBoth' : m.base === 'dark' ? 'th_baseDark' : 'th_baseLight');

  function preview(m) {
    const pv = T.previewVars(m.id, wantDark());
    const cli = pv.layout === 'cli';
    const lines = cli
      ? `<span class="pv-line you">you › <i>${esc(t('th_pvChat'))}</i></span><span class="pv-line bot">fabro › ${esc(t('th_pvReply'))}</span><span class="pv-line dim">└ 2 steps</span>`
      : `<span class="pv-bubble">${esc(t('th_pvChat'))}</span><span class="pv-line bot">${esc(t('th_pvReply'))}</span><span class="pv-line bot short"></span>`;
    return `<span class="thm-pv ${cli ? 'cli' : ''}" aria-hidden="true" data-vars='${esc(JSON.stringify(pv.vars))}'>
      <span class="pv-sb"><span class="pv-brand">${typeof logo === 'function' ? logo(11) : ''}<b>fabro</b></span><i class="pv-row on"></i><i class="pv-row"></i><i class="pv-row"></i></span>
      <span class="pv-main ${pv.texLayer === 'under' ? 'tex' : ''}">${lines}<span class="pv-comp"><i></i><em></em></span></span>
    </span>`;
  }
  const applyVars = (host) => $$('.thm-pv', host).forEach((el) => { let v = {}; try { v = JSON.parse(el.dataset.vars); } catch {} for (const k of Object.keys(v)) el.style.setProperty(k, v[k]); el.removeAttribute('data-vars'); });

  function card(m, cur) {
    const mine = !T.isBuiltin(m.id);
    return `<div class="thm-item">
      <button class="thm-card ${cur ? 'on' : ''}" role="radio" aria-checked="${cur}" tabindex="${cur ? 0 : -1}" data-thm="use" data-id="${esc(m.id)}" aria-describedby="thm-d-${esc(m.id)}">
        ${preview(m)}
        <span class="thm-meta"><b>${esc(T.label(m))}</b><small id="thm-d-${esc(m.id)}">${esc(baseLabel(m))}${cur ? ' · ' + esc(t('th_current')) : ''}</small></span>
      </button>
      <span class="thm-acts">
        <button class="link-btn" data-thm="export" data-id="${esc(m.id)}">${esc(t('th_export'))}</button>
        <button class="link-btn" data-thm="dup" data-id="${esc(m.id)}">${esc(t('th_dup'))}</button>
        ${mine ? `<button class="link-btn" data-thm="edit" data-id="${esc(m.id)}">${esc(t('th_edit'))}</button><button class="link-btn danger" data-thm="del" data-id="${esc(m.id)}">${esc(t('th_del'))}</button>` : ''}
      </span>
    </div>`;
  }

  // a small editor: the five colours that carry a theme, per mode; everything else is derived (and kept readable)
  const EDIT = ['bg', 'panel', 'elev', 'text', 'accent'];
  function editor(m) {
    const modes = m.base === 'both' ? ['light', 'dark'] : [m.base];
    return `<form class="thm-edit card" data-thm-form="${esc(m.id)}" aria-label="${esc(t('th_editTitle', { n: T.label(m) }))}">
      <h3 class="st-sec">${esc(t('th_editTitle', { n: T.label(m) }))}</h3>
      <label class="field"><span>${esc(t('th_ename'))}</span><input class="input" name="name" maxlength="40" value="${esc(T.label(m))}"></label>
      ${modes.map((md) => `<fieldset class="thm-colors"><legend>${esc(t(md === 'dark' ? 'th_dark' : 'th_light'))}</legend>${EDIT.map((k) => {
        const v = (m.palette && m.palette[md] && m.palette[md][k]) || '#808080';
        return `<label><input type="color" name="${md}.${k}" value="${esc(/^#[0-9a-f]{6}$/i.test(v) ? v : '#808080')}"><span>${esc(t('th_c_' + k))}</span></label>`; }).join('')}</fieldset>`).join('')}
      <div class="thm-edit-actions"><button type="button" class="btn ghost" data-thm="edit-cancel">${esc(t('th_cancel'))}</button><button type="submit" class="btn primary">${esc(t('th_save'))}</button></div>
    </form>`;
  }

  T.renderSection = function (el, opts) {
    if (!el) return;
    opts = opts || {};
    if (el._thmAbort) el._thmAbort.abort();
    const ac = el._thmAbort = new AbortController();
    const cur = T.current();
    const all = T.all(), mine = all.filter((m) => !T.isBuiltin(m.id)), built = all.filter((m) => T.isBuiltin(m.id));
    const keys = T.keysMode();
    const warn = opts.warn || '';
    el.innerHTML = `<div class="thm-sec">
      <h3 class="st-sec">${esc(t('th_title'))}</h3>
      <p class="st-intro">${esc(t('th_intro'))}</p>
      <div class="thm-grid" role="radiogroup" aria-label="${esc(t('th_title'))}">${built.map((m) => card(m, m.id === cur)).join('')}</div>
      ${mine.length ? `<h3 class="st-sec">${esc(t('th_mine'))}</h3><div class="thm-grid" role="radiogroup" aria-label="${esc(t('th_mine'))}">${mine.map((m) => card(m, m.id === cur)).join('')}</div>` : ''}
      <div class="thm-tools">
        <button class="btn" data-thm="import">${esc(t('th_import'))}</button>
        <input type="file" accept=".json,.fabrotheme.json,application/json" hidden data-thm="file">
        <small class="muted">${esc(t('th_safety'))}</small>
      </div>
      <div class="thm-warn" role="status" aria-live="polite">${warn ? esc(warn) : ''}</div>
      <div class="thm-edit-slot"></div>
      <div class="st-row"><div class="st-label"><span>${esc(t('th_keys'))}</span><small>${esc(t('th_keysHint'))}</small></div>
        <div class="st-control"><div class="seg" role="radiogroup" aria-label="${esc(t('th_keys'))}">${[['auto', 'th_keysAuto'], ['on', 'th_keysOn'], ['off', 'th_keysOff']].map(([v, k]) => `<button role="radio" aria-checked="${keys === v}" class="${keys === v ? 'on' : ''}" data-thm="keys" data-v="${v}">${esc(t(k))}</button>`).join('')}</div></div></div>
    </div>`;
    applyVars(el);
    const again = (o) => T.renderSection(el, o);
    const sig = { signal: ac.signal };
    const refocus = (sel) => { const n = $(sel, el); if (n) n.focus(); };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-thm]'); if (!b || !el.contains(b)) return;
      const id = b.dataset.id, a = b.dataset.thm;
      if (a === 'use') { await T.set(id); again(); refocus(`.thm-card[data-id="${CSS.escape(id)}"]`); }
      else if (a === 'import') $('[data-thm="file"]', el).click();
      else if (a === 'export') { T.exportFile(id); toast(t('th_exported')); }
      else if (a === 'dup') { const d = await T.duplicate(id); if (d) { toast(t('th_dupDone', { n: T.label(d) })); again(); } }
      else if (a === 'del') { await T.remove(id); toast(t('th_deleted')); again(); }
      else if (a === 'edit') { const m = T.get(id); if (m) { $('.thm-edit-slot', el).innerHTML = editor(m); $('.thm-edit-slot input', el).focus(); } }
      else if (a === 'edit-cancel') $('.thm-edit-slot', el).innerHTML = '';
      else if (a === 'keys') { await T.setKeys(b.dataset.v); again(); refocus(`[data-thm="keys"][data-v="${b.dataset.v}"]`); }
    }, sig);
    $('[data-thm="file"]', el).addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      if (f.size > 70 * 1024) { again({ warn: t('th_importFail', { e: 'too_big' }) }); return; }
      const r = await T.import(await f.text());
      if (!r.ok) { again({ warn: t('th_importFail', { e: (r.errors || []).join(', ') }) }); return; }
      const w = (r.warnings || []).filter((x) => x !== 'no_marker');
      toast(w.length ? t('th_importedWarn', { n: T.label(r.theme), w: w.slice(0, 4).join(', ') }) : t('th_imported', { n: T.label(r.theme) }));
      again();
    }, sig);
    el.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-thm-form]'); if (!f) return; e.preventDefault();
      const m = JSON.parse(JSON.stringify(T.get(f.dataset.thmForm))); if (!m) return;
      const fd = new FormData(f);
      m.name = String(fd.get('name') || '').trim() || m.name;
      m.palette = m.palette || {};
      for (const [k, v] of fd.entries()) { const [md, key] = k.split('.'); if (key && m.palette[md] !== undefined || (key && (md === 'light' || md === 'dark'))) { m.palette[md] = m.palette[md] || {}; m.palette[md][key] = v; } }
      const r = await T.update(m); if (r.ok) again();
    }, sig);
    // radio-group arrows: move between cards (Enter/Space applies)
    el.addEventListener('keydown', (e) => {
      const c = e.target.closest && e.target.closest('.thm-card'); if (!c || !/^Arrow/.test(e.key)) return;
      const grid = c.closest('.thm-grid'), cards = $$('.thm-card', grid), i = cards.indexOf(c);
      const n = cards[(i + (/Right|Down/.test(e.key) ? 1 : cards.length - 1)) % cards.length];
      e.preventDefault(); cards.forEach((x) => { x.tabIndex = -1; }); n.tabIndex = 0; n.focus();
    }, sig);
  };

  T.openGallery = function () {
    const root = $('#modal-root'); if (!root) return;
    root.innerHTML = `<div class="modal-backdrop" data-thm-close></div>
      <div class="modal thm-modal" role="dialog" aria-modal="true" aria-labelledby="thm-dlg"><div class="thm-dlg-head"><h2 id="thm-dlg">${esc(t('th_title'))}</h2>
        <button class="icon-btn" data-thm-close aria-label="${esc(t('close'))}">${icon('x', 18)}</button></div><div class="thm-dlg-body"></div></div>`;
    root.addEventListener('click', (e) => { if (e.target.closest('[data-thm-close]')) closeModal(); }, { once: false });
    const body = $('.thm-dlg-body', root);
    T.renderSection(body);
    const first = $('.thm-card.on', body) || $('.thm-card', body); if (first) first.focus();
  };

  // reachable from the command palette and /themes until the rebuilt settings screen calls renderSection itself
  if (window.fabro && fabro.commands) fabro.commands.register('themes', { description: t('th_title'), builtin: true, run: () => T.openGallery() });
  else window.addEventListener('DOMContentLoaded', () => window.fabro && fabro.commands.register('themes', { description: t('th_title'), builtin: true, run: () => T.openGallery() }));
  // keep an open gallery in step with the theme and the light/dark mode
  T.onChange(() => { const b = $('.thm-dlg-body'); if (b && b.isConnected) { const f = document.activeElement; if (!b.contains(f)) T.renderSection(b); } });
})();
