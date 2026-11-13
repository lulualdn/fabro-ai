// The guides library: built-in guides (read only) and the ones the AI or the user wrote on this computer
// (view, edit, delete). Mounted by a settings screen with Guides.renderSection(container). Main: src/main/guides.js.
const Guides = (() => {
  let mount = null; let open = null; let filter = '';
  async function renderSection(container) {
    if (!container) return; mount = container;
    const all = await api.guides.list().catch(() => []);
    const q = filter.toLowerCase();
    const shown = all.filter((g) => !q || `${g.name} ${g.title} ${g.when} ${(g.keywords || []).join(' ')}`.toLowerCase().includes(q));
    const mine = shown.filter((g) => g.source === 'user'); const builtin = shown.filter((g) => g.source !== 'user');
    const item = (g) => `<button class="gd-item ${open && open.name === g.name ? 'sel' : ''}" data-action="gd-open" data-name="${esc(g.name)}">${icon('book', 15)}<span><b>${esc(g.title)}</b><small>${esc(g.when)}</small></span></button>`;
    container.innerHTML = `<div class="gd-section">
      <p class="muted small">${esc(t('gd_intro'))}</p>
      <div class="gd-top"><input class="input" data-gd="filter" value="${esc(filter)}" placeholder="${esc(t('gd_search'))}"><button class="btn sm" data-action="gd-new">${icon('plus', 14)} ${esc(t('gd_new'))}</button></div>
      <div class="gd-cols"><div class="gd-list">
        <div class="pm-sec">${esc(t('gd_mine'))} (${mine.length})</div>${mine.map(item).join('') || `<div class="muted small">${esc(t('gd_mineEmpty'))}</div>`}
        <div class="pm-sec">${esc(t('gd_builtin'))} (${builtin.length})</div>${builtin.map(item).join('')}
      </div>${open ? viewer() : ''}</div></div>`;
    const f = container.querySelector('[data-gd=filter]');
    f.addEventListener('input', debounce(() => { filter = f.value; renderSection(mount).then(() => { const n = mount.querySelector('[data-gd=filter]'); n.focus(); n.selectionStart = n.value.length; }); }, 250));
  }
  function viewer() {
    const g = open; const edit = g.source === 'user' || g.isNew;
    return `<div class="gd-view">
      ${edit ? `<input class="input" data-gd="title" value="${esc(g.title || '')}" placeholder="${esc(t('gd_title'))}">
        <input class="input" data-gd="when" value="${esc(g.when || '')}" placeholder="${esc(t('gd_when'))}">
        <input class="input" data-gd="keywords" value="${esc((g.keywords || []).join(', '))}" placeholder="${esc(t('gd_keywords'))}">
        <textarea class="input area mono" data-gd="body" rows="14">${esc(g.body || '')}</textarea>
        <div class="nb-row"><button class="btn sm primary" data-action="gd-save">${esc(t('save'))}</button>${g.isNew ? '' : `<button class="btn sm" data-action="gd-delete">${icon('trash', 14)} ${esc(t('delete'))}</button>`}<button class="btn sm" data-action="gd-close">${esc(t('close'))}</button></div>`
      : `<div class="gd-head"><b>${esc(g.title)}</b><button class="icon-btn" data-action="gd-close">${icon('x', 15)}</button></div><small class="muted">${esc(t('gd_builtinHint'))}</small><pre class="gd-body">${esc(g.body || '')}</pre>`}
    </div>`;
  }
  const re = () => mount && renderSection(mount);
  const val = (k) => (mount.querySelector(`[data-gd=${k}]`) || {}).value || '';
  Object.assign(actions, {
    'gd-open': async (el) => { open = await api.guides.get(el.dataset.name); re(); },
    'gd-close': () => { open = null; re(); },
    'gd-new': () => { open = { isNew: true, source: 'user', title: '', when: '', keywords: [], body: '' }; re(); },
    'gd-save': async () => {
      try { const g = await api.guides.save({ name: open.isNew ? val('title') : open.name, title: val('title'), when: val('when'), keywords: val('keywords').split(','), body: val('body') }); open = await api.guides.get(g.name); toast(t('gd_saved')); re(); }
      catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
    },
    'gd-delete': async () => { if (!confirm(t('gd_confirmDelete'))) return; await api.guides.delete(open.name); open = null; re(); },
  });
  return { renderSection };
})();
