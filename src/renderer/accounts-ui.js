'use strict';
/* Accounts: the picker / unlock screen (accounts.html, before the app starts), the create / edit dialog,
   the switcher in the sidebar's user menu, and a self-contained "My account" block for Settings.
   Public: window.Accounts = { renderSection(container), openCreate(), openManager(), avatar(acc, size),
   current(), list(), switchTo(id), lock(), models(), linkModel(id), unlinkModel(id) }. */
(() => {
  const PICKER = document.body.classList.contains('acc-page');
  const COLORS = { coral: '#d9663f', amber: '#c98a1f', moss: '#4f8a4c', teal: '#2a8580', sky: '#3a74b8', rose: '#c0547a', slate: '#56657a', sand: '#9c7d4f' };
  let lang = 'en';
  const tt = (k, v) => { const d = I18N[lang] || I18N.en; let s = d[k] ?? I18N.en[k] ?? k; if (v) s = s.replace(/\{(\w+)\}/g, (_, x) => v[x] ?? ''); return s; };
  const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => (typeof icon === 'function' ? icon(n, s) : '');
  const bytes = (b) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; b = b || 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b.toFixed(b < 10 && i > 1 ? 1 : 0)} ${u[i]}`; };
  const secs = (ms) => { const s = Math.ceil(ms / 1000); return s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`; };
  const note = (msg, kind) => { if (typeof toast === 'function') toast(msg, kind); };
  const errText = (e) => { const m = String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); return m === 'NAME_REQUIRED' ? tt('acc_errName') : m === 'ACCOUNT_LIMIT' ? tt('acc_errLimit') : tt('acc_err', { e: m }); };
  let ICONS = ['initial', 'star', 'sun', 'moon', 'rocket', 'bulb', 'book', 'brush', 'globe', 'zap', 'flask', 'home'];
  let MAX = 5;
  let me = null, all = [];

  function avatar(a, size = 40, extra = '') {
    if (!a) return '';
    const c = COLORS[a.color] || COLORS.coral;
    const inner = a.picture ? `<img src="${E(a.picture)}" alt="">`
      : a.icon && a.icon !== 'initial' ? ic(a.icon, Math.round(size * 0.48))
        : `<b>${E((a.name || '?').trim().charAt(0).toUpperCase())}</b>`;
    return `<span class="acc-av ${extra}" style="--acc-c:${c};--acc-s:${size}px" aria-hidden="true">${inner}</span>`;
  }

  // ───────────────────────── create / edit form (picker and app) ─────────────────────────
  function lookPicker(sel) {
    return `<div class="acc-field"><span class="acc-label">${E(tt('acc_look'))}</span>
      <div class="acc-icons" role="radiogroup">${ICONS.map((i) => `<button type="button" class="acc-ic ${sel.icon === i ? 'on' : ''}" data-acc-icon="${i}" role="radio" aria-checked="${sel.icon === i}" title="${E(i === 'initial' ? tt('acc_initial') : i)}">${i === 'initial' ? `<b>${E((sel.name || 'A').trim().charAt(0).toUpperCase() || 'A')}</b>` : ic(i, 18)}</button>`).join('')}</div></div>
      <div class="acc-field"><span class="acc-label">${E(tt('acc_color'))}</span>
      <div class="acc-colors" role="radiogroup">${Object.entries(COLORS).map(([k, v]) => `<button type="button" class="acc-sw ${sel.color === k ? 'on' : ''}" data-acc-color="${k}" style="--acc-c:${v}" role="radio" aria-checked="${sel.color === k}" title="${k}"></button>`).join('')}</div></div>`;
  }
  function createForm(o = {}) {
    const sel = { name: o.name || '', icon: o.icon || 'initial', color: o.color || Object.keys(COLORS)[all.length % 8] };
    return `<form class="acc-form" data-acc-form="create" autocomplete="off">
      <div class="acc-form-head">${avatar({ ...sel, name: sel.name || '?' }, 64, 'acc-preview')}<div><h2>${E(tt('acc_newTitle'))}</h2><p class="acc-sub">${E(tt('acc_newSub'))}</p></div></div>
      <label class="acc-field"><span class="acc-label">${E(tt('acc_name'))}</span><input class="input acc-in" name="name" maxlength="32" placeholder="${E(tt('acc_namePh'))}" value="${E(sel.name)}" required></label>
      ${lookPicker(sel)}
      <input type="hidden" name="icon" value="${sel.icon}"><input type="hidden" name="color" value="${sel.color}">
      <label class="acc-check"><input type="checkbox" name="usePw"> <span>${E(tt('acc_pwToggle'))}</span></label>
      <div class="acc-pw-box" hidden>
        <label class="acc-field"><span class="acc-label">${E(tt('acc_pwNew'))}</span><input class="input acc-in" type="password" name="pw" autocomplete="new-password"></label>
        <label class="acc-field"><span class="acc-label">${E(tt('acc_pwRepeat'))}</span><input class="input acc-in" type="password" name="pw2" autocomplete="new-password"></label>
        <p class="acc-honest">${ic('shield', 15)}<span>${E(tt('acc_pwHonest'))}</span></p>
      </div>
      <p class="acc-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="btn" data-acc="cancel">${E(tt('acc_cancel'))}</button><button class="btn primary" type="submit">${E(tt('acc_create'))}</button></div>
    </form>`;
  }
  // live behaviour shared by both forms: icon / colour choice, preview, password box
  function wireLook(form) {
    const preview = () => {
      const p = form.querySelector('.acc-preview'); if (!p) return;
      const nm = (form.elements.name && form.elements.name.value) || (me && me.name) || '?';
      p.outerHTML = avatar({ name: nm, icon: form.elements.icon.value, color: form.elements.color.value, picture: form.dataset.picture || null }, 64, 'acc-preview');
      form.querySelectorAll('.acc-ic[data-acc-icon="initial"] b').forEach((b) => { b.textContent = nm.trim().charAt(0).toUpperCase() || 'A'; });
    };
    form.addEventListener('click', (e) => {
      const i = e.target.closest('[data-acc-icon]'), c = e.target.closest('[data-acc-color]');
      if (i) { form.elements.icon.value = i.dataset.accIcon; form.querySelectorAll('[data-acc-icon]').forEach((b) => { b.classList.toggle('on', b === i); b.setAttribute('aria-checked', b === i); }); preview(); form.dispatchEvent(new Event('acc-look')); }
      if (c) { form.elements.color.value = c.dataset.accColor; form.querySelectorAll('[data-acc-color]').forEach((b) => { b.classList.toggle('on', b === c); b.setAttribute('aria-checked', b === c); }); preview(); form.dispatchEvent(new Event('acc-look')); }
    });
    if (form.elements.name) form.elements.name.addEventListener('input', preview);
    const use = form.elements.usePw, box = form.querySelector('.acc-pw-box');
    if (use && box) use.addEventListener('change', () => { box.hidden = !use.checked; if (use.checked) form.elements.pw.focus(); });
  }
  async function submitCreate(form) {
    const f = form.elements, err = form.querySelector('.acc-error'); err.textContent = '';
    const name = f.name.value.trim(); if (!name) { err.textContent = tt('acc_errName'); f.name.focus(); return null; }
    let pw = '';
    if (f.usePw.checked) { pw = f.pw.value; if (!pw || pw !== f.pw2.value) { err.textContent = tt('acc_pwMismatch'); f.pw2.focus(); return null; } }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try { return await api.accounts.create({ name, icon: f.icon.value, color: f.color.value, password: pw || undefined }); }
    catch (e) { err.textContent = errText(e); return null; } finally { btn.disabled = false; }
  }

  // ───────────────────────── picker (accounts.html) ─────────────────────────
  const P = { view: 'grid', id: null, msg: '', wait: 0 };
  function pickerHTML() {
    const a = all.find((x) => x.id === P.id);
    if (P.view === 'unlock' && a) return `<div class="acc-stage acc-unlock">
        ${avatar(a, 112, 'acc-big')}<h1 class="acc-name">${E(a.name)}</h1>
        <form class="acc-pw-form" data-acc-form="unlock" autocomplete="off">
          <input class="input acc-in acc-pw-in" type="password" name="pw" placeholder="${E(tt('acc_password'))}" aria-label="${E(tt('acc_password'))}" ${P.wait ? 'disabled' : ''} autofocus>
          <button class="btn primary" type="submit" ${P.wait ? 'disabled' : ''}>${E(tt('acc_open'))}</button>
        </form>
        <p class="acc-error" role="alert">${E(P.msg)}</p>
        <div class="acc-links"><button class="acc-link" data-acc="back">${ic('back', 15)} ${E(tt('acc_back'))}</button><button class="acc-link" data-acc="forgot">${E(tt('acc_forgot'))}</button></div>
      </div>`;
    if (P.view === 'forget' && a) return `<div class="acc-stage acc-forget">
        ${avatar(a, 72)}<h1 class="acc-title">${E(tt('acc_forgotTitle', { name: a.name }))}</h1>
        <p class="acc-body">${E(tt('acc_forgotBody'))}</p>
        <form data-acc-form="forget" class="acc-forget-form" autocomplete="off"><label class="acc-field"><span class="acc-label">${E(tt('acc_typeName', { name: a.name }))}</span><input class="input acc-in" name="typed" autofocus></label>
        <p class="acc-error" role="alert">${E(P.msg)}</p>
        <div class="modal-actions"><button type="button" class="btn" data-acc="back">${E(tt('acc_cancel'))}</button><button class="btn danger" type="submit">${E(tt('acc_deleteFor', { name: a.name }))}</button></div></form>
      </div>`;
    if (P.view === 'create') return `<div class="acc-stage acc-card">${createForm()}</div>`;
    return `<div class="acc-stage">
        <h1 class="acc-title">${E(tt('acc_who'))}</h1><p class="acc-sub">${E(tt('acc_whoSub'))}</p>
        <div class="acc-grid">${all.map((x, i) => `<button class="acc-tile" data-acc="pick" data-id="${x.id}" style="--i:${i}">${avatar(x, 96)}<span class="acc-tile-name">${E(x.name)}</span>${x.hasPassword ? `<span class="acc-tile-lock" title="${E(tt('acc_locked'))}">${ic('lock', 13)}</span>` : ''}</button>`).join('')}
        ${all.length < MAX ? `<button class="acc-tile acc-tile-add" data-acc="new" style="--i:${all.length}"><span class="acc-av acc-av-add" style="--acc-s:96px">${ic('plus', 34)}</span><span class="acc-tile-name">${E(tt('acc_add'))}</span></button>` : ''}</div>
      </div>`;
  }
  function renderPicker() {
    const root = document.getElementById('acc-root');
    root.innerHTML = pickerHTML();
    const f = root.querySelector('[data-acc-form="create"]'); if (f) { wireLook(f); f.elements.name.focus(); }
    const fi = root.querySelector('[autofocus]:not([disabled])'); if (fi) fi.focus();
    if (P.wait) { clearTimeout(P.timer); P.timer = setTimeout(() => { P.wait = Math.max(0, P.wait - 1000); P.msg = P.wait ? tt('acc_wait', { t: secs(P.wait) }) : ''; renderPicker(); }, 1000); }
  }
  async function pick(id) {
    const a = all.find((x) => x.id === id); if (!a) return;
    if (!a.hasPassword) { document.body.classList.add('acc-leaving'); await api.accounts.open(id).catch(() => document.body.classList.remove('acc-leaving')); return; }
    Object.assign(P, { view: 'unlock', id, msg: '', wait: 0 }); renderPicker();
  }
  async function initPicker() {
    const r = await api.accounts.list();
    all = r.accounts; MAX = r.max; ICONS = r.icons || ICONS;
    for (const l of [...(r.langs || []), r.locale || '', navigator.language]) { const c = String(l).slice(0, 2).toLowerCase(); if (I18N[c]) { lang = c; break; } }
    document.documentElement.lang = lang;
    const theme = () => { document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; };
    theme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
    // straight to the password: the only account, or the one just switched to
    const q = new URLSearchParams(location.search), a = all.find((x) => x.id === q.get('pick'));
    if (a && a.hasPassword && (all.length === 1 || q.get('direct') === '1')) { P.view = 'unlock'; P.id = a.id; }
    renderPicker();
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-acc]'); if (!b) return;
      const act = b.dataset.acc;
      if (act === 'pick') pick(b.dataset.id);
      if (act === 'new') { P.view = 'create'; renderPicker(); }
      if (act === 'back' || act === 'cancel') { Object.assign(P, { view: P.view === 'forget' ? 'unlock' : 'grid', msg: '' }); renderPicker(); }
      if (act === 'forgot') { Object.assign(P, { view: 'forget', msg: '' }); renderPicker(); }
    });
    document.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-acc-form]'); if (!f) return; e.preventDefault();
      if (f.dataset.accForm === 'create') { const a2 = await submitCreate(f); if (a2) { all = (await api.accounts.list()).accounts; P.view = 'grid'; renderPicker(); } }
      if (f.dataset.accForm === 'unlock') {
        const btn = f.querySelector('button'); btn.disabled = true;
        const r2 = await api.accounts.unlock(P.id, f.elements.pw.value).catch((er) => ({ ok: false, error: er }));
        if (r2.ok) { document.body.classList.add('acc-leaving'); return; }
        P.wait = r2.wait || 0;
        P.msg = r2.wait ? tt('acc_wait', { t: secs(r2.wait) }) : r2.left != null && r2.left <= 2 ? tt('acc_wrongLeft', { n: r2.left }) : r2.error ? errText(r2.error) : tt('acc_wrong');
        renderPicker();
        const card = document.querySelector('.acc-pw-form'); if (card && !P.wait) { card.classList.remove('acc-shake'); void card.offsetWidth; card.classList.add('acc-shake'); }
      }
      if (f.dataset.accForm === 'forget') {
        const r3 = await api.accounts.forget(P.id, f.elements.typed.value).catch((er) => ({ ok: false, error: er }));
        if (!r3.ok) { P.msg = r3.confirm ? tt('acc_typeName', { name: (all.find((x) => x.id === P.id) || {}).name }) : errText(r3.error); renderPicker(); return; }
        all = (await api.accounts.list()).accounts; Object.assign(P, { view: 'grid', id: null, msg: '' }); renderPicker();
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && P.view !== 'grid') { Object.assign(P, { view: P.view === 'forget' ? 'unlock' : 'grid', msg: '' }); renderPicker(); } });
  }

  // ───────────────────────── in the app ─────────────────────────
  async function refresh() {
    try { const r = await api.accounts.list(); all = r.accounts; MAX = r.max; ICONS = r.icons || ICONS; me = all.find((a) => a.id === r.current) || null; if (r.fallback && !refresh.warned) { refresh.warned = true; const st = await api.accounts.status(); note(tt('acc_fallback', { e: st.error || '' }), 'err'); } }
    catch { try { me = await api.accounts.current(); all = me ? [me] : []; } catch { me = null; } } // a phone may only ask who it is
    decorateSidebar();
    return me;
  }
  // the sidebar avatar shows the account's picture / icon / colour
  function decorateSidebar() {
    const av = document.querySelector('#sidebar .sb-user .avatar'); if (!av || !me) return;
    av.classList.add('acc-sb'); av.style.setProperty('--acc-c', COLORS[me.color] || COLORS.coral);
    const keep = [...av.children].filter((c) => c.classList.contains('av-dot') || c.classList.contains('av-spin'));
    av.innerHTML = me.picture ? `<img src="${E(me.picture)}" alt="">` : me.icon && me.icon !== 'initial' ? ic(me.icon, 16) : E((me.name || '?').charAt(0).toUpperCase());
    keep.forEach((k) => av.appendChild(k));
  }
  function switching(a) {
    const o = document.createElement('div'); o.className = 'acc-switching';
    o.innerHTML = `<div>${avatar(a, 88)}<p>${E(tt('acc_switching', { name: a.name }))}</p></div>`;
    document.body.appendChild(o); requestAnimationFrame(() => o.classList.add('show'));
  }
  async function switchTo(id) {
    const a = all.find((x) => x.id === id); if (!a || (me && a.id === me.id)) return;
    switching(a);
    try { await api.accounts.switch(id); } catch (e) { document.querySelector('.acc-switching')?.remove(); note(errText(e), 'err'); }
  }
  async function lock() { if (me) switching(me); await api.accounts.lock(); }

  // user menu: other accounts, add, lock, my account
  function menuHTML() {
    if (!me) return '';
    const others = all.filter((a) => a.id !== me.id);
    return `<div class="acc-menu">
      <div class="acc-menu-me">${avatar(me, 34)}<span><b>${E(me.name)}</b><small>${E(tt('acc_accounts'))} · ${all.length}/${MAX}</small></span></div>
      ${others.map((a) => `<button class="pm-item acc-menu-item" data-action="acc-switch" data-id="${a.id}">${avatar(a, 22)}<span class="pm-text"><b>${E(tt('acc_switchTo', { name: a.name }))}</b></span>${a.hasPassword ? ic('lock', 13) : ''}</button>`).join('')}
      <button class="pm-item" data-action="acc-manage">${ic('user', 16)}<span class="pm-text"><b>${E(tt('acc_manage'))}</b></span></button>
      ${all.length < MAX ? `<button class="pm-item" data-action="acc-new">${ic('plus', 16)}<span class="pm-text"><b>${E(tt('acc_add'))}</b></span></button>` : ''}
      ${me.hasPassword || others.length ? `<button class="pm-item" data-action="acc-lock">${ic('lock', 16)}<span class="pm-text"><b>${E(tt('acc_lock'))}</b><small>${E(tt('acc_lockHint'))}</small></span></button>` : ''}
      <div class="pm-sep"></div></div>`;
  }

  function modal(html, cls = '') {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-action="acc-close"></div><div class="modal acc-modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    return root.querySelector('.modal');
  }
  const close = () => (typeof closeModal === 'function' ? closeModal() : (document.getElementById('modal-root').innerHTML = ''));

  function openCreate() {
    const m = modal(createForm(), 'acc-create-modal');
    const f = m.querySelector('form'); wireLook(f); f.elements.name.focus();
    f.addEventListener('click', (e) => { if (e.target.closest('[data-acc="cancel"]')) close(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const a = await submitCreate(f); if (!a) return;
      await refresh();
      const m2 = modal(`<div class="acc-done">${avatar(a, 72)}<h2>${E(tt('acc_created', { name: a.name }))}</h2>
        <div class="modal-actions"><button class="btn" data-action="acc-close">${E(tt('acc_later'))}</button><button class="btn primary" data-action="acc-switch" data-id="${a.id}">${E(tt('acc_switchNow'))}</button></div></div>`, 'acc-small');
      m2.querySelector('.btn.primary').focus();
    });
  }
  function openManager() { const m = modal(`<div class="acc-manager"></div><div class="modal-actions"><button class="btn" data-action="acc-close">${E(tt('acc_close'))}</button></div>`, 'acc-manage-modal'); renderSection(m.querySelector('.acc-manager')); }

  // ───────────────────────── "My account" block (Settings) ─────────────────────────
  async function renderSection(container) {
    if (!container) return;
    await refresh();
    if (!me) { container.innerHTML = ''; return; }
    const st = { pw: null, msg: '' };
    const c = await api.accounts.counts().catch(() => ({}));
    const draw = () => {
      const chips = [['acc_nConv', c.conversations], ['acc_nProj', c.projects], ['acc_nMem', c.memories], ['acc_nArt', c.artifacts], ['acc_nTask', c.tasks], ['acc_nModel', c.models]]
        .filter(([, n]) => n != null).map(([k, n]) => `<span class="acc-chip">${E(tt(k, { n }))}</span>`).join('');
      container.innerHTML = `<section class="acc-section">
        <form class="acc-me" data-acc-form="edit" autocomplete="off" data-picture="${E(me.picture || '')}">
          <div class="acc-form-head">${avatar(me, 64, 'acc-preview')}
            <div class="acc-me-name"><label class="acc-field"><span class="acc-label">${E(tt('acc_name'))}</span><input class="input acc-in" name="name" maxlength="32" value="${E(me.name)}"></label>
            <div class="acc-photo-row"><button type="button" class="btn sm" data-acc="photo">${ic('image', 14)} ${E(tt('acc_photo'))}</button>${me.picture ? `<button type="button" class="btn sm" data-acc="photo-clear">${E(tt('acc_photoRemove'))}</button>` : ''}</div></div></div>
          ${lookPicker(me)}
          <input type="hidden" name="icon" value="${E(me.icon)}"><input type="hidden" name="color" value="${E(me.color)}">
        </form>
        <div class="acc-block"><h3>${E(tt('acc_holds'))}</h3><div class="acc-chips">${chips}</div><p class="acc-hint">${E(tt('acc_disk', { s: bytes(c.bytes) }))} · ${E(tt('acc_tasksNote'))}</p></div>
        <div class="acc-block"><h3>${ic(me.hasPassword ? 'lock' : 'unlock', 15)} ${E(tt('acc_pwSection'))}</h3>
          <p class="acc-hint">${E(tt(me.hasPassword ? 'acc_pwOn' : 'acc_pwNone'))}</p>
          ${st.pw ? `<form class="acc-pw-edit" data-acc-form="pw" autocomplete="off">
              ${me.hasPassword ? `<label class="acc-field"><span class="acc-label">${E(tt('acc_pwCurrent'))}</span><input class="input acc-in" type="password" name="cur" autocomplete="current-password"></label>` : ''}
              ${st.pw !== 'remove' ? `<label class="acc-field"><span class="acc-label">${E(tt('acc_pwNew'))}</span><input class="input acc-in" type="password" name="pw" autocomplete="new-password"></label>
              <label class="acc-field"><span class="acc-label">${E(tt('acc_pwRepeat'))}</span><input class="input acc-in" type="password" name="pw2" autocomplete="new-password"></label>` : ''}
              <p class="acc-error" role="alert">${E(st.msg)}</p>
              <div class="modal-actions"><button type="button" class="btn" data-acc="pw-cancel">${E(tt('acc_cancel'))}</button><button class="btn ${st.pw === 'remove' ? 'danger' : 'primary'}" type="submit">${E(tt(st.pw === 'remove' ? 'acc_pwRemove' : 'acc_save'))}</button></div>
            </form>`
          : `<div class="acc-row">${me.hasPassword ? `<button class="btn sm" data-acc="pw-change">${E(tt('acc_pwChange'))}</button><button class="btn sm" data-acc="pw-remove">${E(tt('acc_pwRemove'))}</button>` : `<button class="btn sm" data-acc="pw-set">${ic('lock', 14)} ${E(tt('acc_pwSet'))}</button>`}</div>`}
          <p class="acc-honest">${ic('shield', 15)}<span>${E(tt('acc_pwHonest'))}</span></p></div>
        <div class="acc-block acc-danger"><h3>${E(tt('acc_deleteSection'))}</h3><p class="acc-hint">${E(tt('acc_deleteHint'))}</p>
          ${st.del ? `<form data-acc-form="del" autocomplete="off"><p class="acc-body">${E(tt('acc_deleteBody'))}</p>
            <label class="acc-field"><span class="acc-label">${E(tt('acc_typeName', { name: me.name }))}</span><input class="input acc-in" name="typed"></label>
            ${me.hasPassword ? `<label class="acc-field"><span class="acc-label">${E(tt('acc_password'))}</span><input class="input acc-in" type="password" name="pw"></label>` : ''}
            <p class="acc-error" role="alert">${E(st.msg)}</p>
            <div class="modal-actions"><button type="button" class="btn" data-acc="del-cancel">${E(tt('acc_cancel'))}</button><button class="btn danger" type="submit">${E(tt('acc_deleteFor', { name: me.name }))}</button></div></form>`
          : `<button class="btn sm danger-ghost" data-acc="del">${ic('trash', 14)} ${E(tt('acc_deleteBtn'))}</button>`}</div>
      </section>`;
      const f = container.querySelector('[data-acc-form="edit"]'); wireLook(f);
      const save = async () => { try { me = await api.accounts.update({ name: f.elements.name.value, icon: f.elements.icon.value, color: f.elements.color.value }); await refresh(); if (typeof renderSidebar === 'function') renderSidebar(); } catch (e) { note(errText(e), 'err'); } };
      f.addEventListener('acc-look', save);
      f.elements.name.addEventListener('change', () => { if (f.elements.name.value.trim()) save(); else f.elements.name.value = me.name; });
      const pf = container.querySelector('input[type=password]'); if (pf) pf.focus();
    };
    container.onclick = async (e) => {
      const b = e.target.closest('[data-acc]'); if (!b) return;
      const a = b.dataset.acc;
      if (a === 'photo') { try { me = await api.accounts.pickPicture(); await refresh(); draw(); } catch (er) { note(errText(er), 'err'); } }
      if (a === 'photo-clear') { me = await api.accounts.clearPicture(); await refresh(); draw(); }
      if (a === 'pw-set' || a === 'pw-change') { st.pw = 'set'; st.msg = ''; draw(); }
      if (a === 'pw-remove') { st.pw = 'remove'; st.msg = ''; draw(); }
      if (a === 'pw-cancel') { st.pw = null; draw(); }
      if (a === 'del') { st.del = true; st.msg = ''; draw(); }
      if (a === 'del-cancel') { st.del = false; draw(); }
    };
    container.onsubmit = async (e) => {
      const f = e.target.closest('[data-acc-form]'); if (!f) return; e.preventDefault();
      const el = f.elements;
      if (f.dataset.accForm === 'pw') {
        const next = st.pw === 'remove' ? '' : el.pw.value;
        if (st.pw !== 'remove' && (!next || next !== el.pw2.value)) { st.msg = tt('acc_pwMismatch'); draw(); return; }
        const r = await api.accounts.setPassword({ current: el.cur ? el.cur.value : '', next }).catch((er) => ({ ok: false, error: er }));
        if (!r.ok) { st.msg = r.wait ? tt('acc_wait', { t: secs(r.wait) }) : r.error ? errText(r.error) : tt('acc_wrong'); draw(); return; }
        note(tt(next ? 'acc_pwSaved' : 'acc_pwRemoved')); st.pw = null; st.msg = ''; await refresh(); draw();
      }
      if (f.dataset.accForm === 'del') {
        const r = await api.accounts.delete({ confirm: el.typed.value, password: el.pw ? el.pw.value : '' }).catch((er) => ({ ok: false, error: er }));
        if (!r.ok) { st.msg = r.confirm ? tt('acc_typeName', { name: me.name }) : r.wait ? tt('acc_wait', { t: secs(r.wait) }) : r.error ? errText(r.error) : tt('acc_wrong'); draw(); return; }
        switching({ ...me, name: '…' });
      }
    };
    draw();
  }

  // ───────────────────────── models (for the future "My models" section) ─────────────────────────
  const models = () => api.accounts.models();            // { mine: [{id,name,sizeBytes,sharedWith}], others: [{id,name,sizeBytes}] }
  const linkModel = async (id) => { const m = await api.accounts.linkModel(id); if (typeof refreshModels === 'function') refreshModels().catch(() => {}); return m; };
  const unlinkModel = async (id) => { const r = await api.accounts.unlinkModel(id); if (typeof refreshModels === 'function') refreshModels().catch(() => {}); return r; };

  window.Accounts = { renderSection, openCreate, openManager, avatar, current: () => me, list: () => all, refresh, switchTo, lock, models, linkModel, unlinkModel, colors: COLORS };

  if (PICKER) { initPicker(); return; }

  // app wiring (globals of app.js)
  Object.defineProperty(window, '__accLang', { get: () => lang });
  const syncLang = () => { if (typeof S !== 'undefined' && S.lang) lang = S.lang; };
  if (typeof actions === 'object') Object.assign(actions, {
    'acc-switch': (el) => { close(); document.getElementById('popover-root').innerHTML = ''; switchTo(el.dataset.id); },
    'acc-manage': () => { document.getElementById('popover-root').innerHTML = ''; syncLang(); openManager(); },
    'acc-new': () => { document.getElementById('popover-root').innerHTML = ''; syncLang(); openCreate(); },
    'acc-lock': () => { document.getElementById('popover-root').innerHTML = ''; lock(); },
    'acc-close': () => close(),
  });
  if (typeof openUserMenu === 'function') {
    const base = openUserMenu;
    // eslint-disable-next-line no-global-assign
    openUserMenu = function (anchor) { base(anchor); syncLang(); const pop = document.querySelector('#popover-root .popover'); if (pop && me && !window.FABRO_REMOTE) pop.insertAdjacentHTML('afterbegin', menuHTML()); };
  }
  if (typeof renderSidebar === 'function') {
    const base = renderSidebar;
    // eslint-disable-next-line no-global-assign
    renderSidebar = function (...a) { const r = base.apply(this, a); decorateSidebar(); return r; };
  }
  api.on('accounts:event', (e) => {
    syncLang();
    if (e && e.type === 'modelKept') note(tt('acc_modelKept', { n: e.sharedWith }));
    if (e && e.type === 'models' && typeof refreshModels === 'function') refreshModels().catch(() => {});
  });
  refresh();
})();
