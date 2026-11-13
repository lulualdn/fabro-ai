// The AI's notebook (how the user wants it to work): see, edit, delete. Mounted by a settings screen with
// Notebook.renderSection(container). Main side: src/main/notebook.js (IPC notebook:*).
const Notebook = (() => {
  let mount = null; let editing = null;
  const KIND = (k) => t('nb_kind_' + (k || 'other'));
  async function renderSection(container) {
    if (!container) return; mount = container;
    const notes = await api.notebook.list().catch(() => []);
    container.innerHTML = `<div class="nb-section">
      <p class="muted small">${esc(t('nb_intro'))}</p>
      ${notes.length ? `<ul class="nb-list">${notes.map((n) => `<li class="nb-item" data-id="${esc(n.id)}">
        ${editing === n.id ? `<textarea class="input area nb-edit" rows="2" maxlength="220">${esc(n.text)}</textarea>
          <div class="nb-row"><button class="btn sm primary" data-action="nb-save" data-id="${esc(n.id)}">${esc(t('save'))}</button><button class="btn sm" data-action="nb-cancel">${esc(t('cancel'))}</button></div>`
        : `<div class="nb-text">${esc(n.text)}</div><div class="nb-meta"><span class="nb-kind">${esc(KIND(n.kind))}</span><small>${esc(n.updated || n.created || '')}${n.trigger ? ' · ' + esc(n.trigger) : ''}</small>
          <span class="grow"></span><button class="icon-btn" data-action="nb-edit" data-id="${esc(n.id)}" title="${esc(t('edit'))}">${icon('edit', 15)}</button><button class="icon-btn" data-action="nb-delete" data-id="${esc(n.id)}" title="${esc(t('delete'))}">${icon('trash', 15)}</button></div>`}
      </li>`).join('')}</ul>` : `<div class="muted small nb-empty">${esc(t('nb_empty'))}</div>`}
      <div class="nb-add"><input class="input" maxlength="220" data-nb="new" placeholder="${esc(t('nb_addPh'))}"><button class="btn sm" data-action="nb-add">${icon('plus', 14)} ${esc(t('nb_add'))}</button></div>
    </div>`;
  }
  const re = () => mount && renderSection(mount);
  const err = (e) => toast(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err');
  Object.assign(actions, {
    'nb-edit': (el) => { editing = el.dataset.id; re(); },
    'nb-cancel': () => { editing = null; re(); },
    'nb-save': async (el) => { const ta = mount.querySelector('.nb-edit'); try { await api.notebook.update(el.dataset.id, { text: ta.value }); editing = null; re(); } catch (e) { err(e); } },
    'nb-delete': async (el) => { await api.notebook.delete(el.dataset.id); re(); },
    'nb-add': async () => { const i = mount.querySelector('[data-nb=new]'); if (!i.value.trim()) return; try { await api.notebook.add(i.value.trim()); re(); } catch (e) { err(e); } },
  });
  return { renderSection };
})();
