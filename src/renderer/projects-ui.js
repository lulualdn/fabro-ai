'use strict';
/* Projects: spaces with instructions and files shared by all their conversations. Files are indexed
   locally (keywords always, meaning with a local embedding model, optional reranker). */

S.prj = { list: null, current: null, rag: null, editing: null, embed: null, chats: [] };

async function prjLoad() {
  [S.prj.list, S.prj.rag] = await Promise.all([api.projects.list(), api.projects.ragStatus()]);
  if (S.mode === 'projects') renderView();
}
async function prjOpen(id) {
  const p = await api.projects.get(id);
  if (!p) { toast(t('loadFailed'), 'err'); return; }
  S.prj.current = p; S.prj.editing = null;
  S.prj.chats = await api.conv.list({ project: id });
  if (!S.prj.rag) S.prj.rag = await api.projects.ragStatus();
  S.mode = 'projects'; S.conv = null; navTo('projects', null);
  vt(() => { renderSidebar(); renderView(); });
}

function renderProjectsPage() {
  if (S.prj.current) return prjView();
  if (!S.prj.list) { prjLoad(); return `<div class="cx-loading">${spinner(24)}</div>`; }
  const L = S.prj.list;
  return `<div class="page prj-page">
    <div class="page-head"><h1>${esc(t('nav_projects'))}</h1><button class="btn primary" data-action="prj-new">${icon('plus', 16)} ${esc(t('prj_new'))}</button></div>
    ${S.prj.creating ? prjForm() : ''}
    ${L.length ? `<div class="prj-grid">${L.map((p, i) => `<button class="prj-card" style="--i:${i}" data-action="prj-open" data-id="${esc(p.id)}">
        <div class="prj-ico">${icon('folder', 20)}</div><b>${esc(p.name)}</b>${p.description ? `<p>${esc(p.description)}</p>` : ''}
        <small>${esc(t('prj_counts', { f: p.files, c: p.chats }))} · ${esc(relTime(p.updated))}</small></button>`).join('')}</div>`
      : !S.prj.creating ? `<div class="prj-empty">${icon('folder', 34)}<h2>${esc(t('prj_emptyT'))}</h2><p>${esc(t('prj_emptyB'))}</p><button class="btn primary" data-action="prj-new">${icon('plus', 16)} ${esc(t('prj_new'))}</button></div>` : ''}
  </div>`;
}
function prjForm(p = {}) {
  return `<form class="prj-form" data-form="prj-save">
    <label class="pf-field"><span>${esc(t('prj_name'))}</span><input class="input" name="name" value="${esc(p.name || '')}" placeholder="${esc(t('prj_namePh'))}" required maxlength="80" autofocus></label>
    <label class="pf-field"><span>${esc(t('prj_desc'))}</span><input class="input" name="description" value="${esc(p.description || '')}" placeholder="${esc(t('prj_descPh'))}" maxlength="200"></label>
    <div class="pf-actions"><button type="button" class="btn sm" data-action="prj-cancel">${esc(t('cancel'))}</button><button class="btn sm primary" type="submit">${esc(t(p.id ? 'save' : 'prj_create'))}</button></div>
  </form>`;
}
function prjView() {
  const p = S.prj.current; const r = S.prj.rag || {};
  const files = p.files || [];
  const indexing = files.some((f) => ['pending', 'reading'].includes(f.status));
  const st = (f) => f.status === 'indexed' ? `<small>${esc(t('prj_chunks', { n: f.chunks }))}</small>` : f.status === 'error' ? `<small class="err-txt" title="${esc(f.error || '')}">${esc(f.error === 'UNSUPPORTED' ? t('prj_unsupported') : t('prj_fileErr'))}</small>` : `<small>${spinner(11)} ${esc(t('prj_reading'))}</small>`;
  const ext = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return `<div class="prj-view">
    <div class="prj-main">
      <button class="link prj-back" data-action="prj-back">${icon('back', 14)} ${esc(t('nav_projects'))}</button>
      ${S.prj.editing === 'meta' ? prjForm(p) : `<div class="prj-title"><h1>${esc(p.name)}</h1><button class="icon-btn sm" data-action="prj-edit-meta" title="${esc(t('edit'))}">${icon('edit', 16)}</button><button class="icon-btn sm" data-action="prj-delete" title="${esc(t('delete'))}">${icon('trash', 16)}</button></div>${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}`}
      <div class="prj-composer">${renderComposer()}</div>
      <div class="prj-chats">${S.prj.chats.length ? S.prj.chats.map((c) => `<button class="prj-chat" data-action="open-conv" data-id="${esc(c.id)}">${icon(c.agent ? 'agentBadge' : 'chat', 15)}<span>${esc(c.title || t('untitled'))}</span><small>${esc(relTime(c.updatedAt))}</small></button>`).join('') : `<div class="muted small prj-nochat">${esc(t('prj_noChats'))}</div>`}</div>
    </div>
    <aside class="prj-side">
      <section class="prj-box"><div class="prj-h">${icon('book', 15)}<b>${esc(t('prj_instr'))}</b><span class="grow"></span>${S.prj.editing === 'instr' ? '' : `<button class="link" data-action="prj-edit-instr">${esc(t(p.instructions ? 'edit' : 'prj_add'))}</button>`}</div>
        ${S.prj.editing === 'instr' ? `<form data-form="prj-instr"><textarea class="input area" name="instr" rows="8" placeholder="${esc(t('prj_instrPh'))}">${esc(p.instructions || '')}</textarea><div class="pf-actions"><button type="button" class="btn sm" data-action="prj-cancel-edit">${esc(t('cancel'))}</button><button class="btn sm primary" type="submit">${esc(t('save'))}</button></div></form>`
          : p.instructions ? `<div class="prj-instr">${esc(p.instructions)}</div>` : `<p class="muted small">${esc(t('prj_instrHint'))}</p>`}</section>
      <section class="prj-box prj-drop" id="prj-drop"><div class="prj-h">${icon('file', 15)}<b>${esc(t('prj_files'))}</b><small>${files.length || ''}</small><span class="grow"></span><button class="link" data-action="prj-add-files">${icon('plus', 13)} ${esc(t('prj_add'))}</button></div>
        ${files.length ? `<div class="prj-files">${files.map((f) => `<div class="prj-file ${f.status}">${icon(SP_EXT_ICON[ext(f.name)] || 'file', 16)}<span title="${esc(f.name)}">${esc(f.name)}</span>${st(f)}<button class="icon-btn xs" data-action="prj-rm-file" data-id="${esc(f.id)}" title="${esc(t('delete'))}">${icon('x', 13)}</button></div>`).join('')}</div>`
          : `<p class="muted small">${esc(t('prj_filesHint'))}</p>`}
        <div class="prj-kn">${r.embed ? `${icon('sparkle', 13)} <span>${esc(t('prj_semantic', { m: r.embed.name }))}${r.rerank ? ' · ' + esc(t('prj_rerank')) : ''}</span>${S.prj.embed ? ` <small>${esc(t('prj_embedding', { d: S.prj.embed.done, n: S.prj.embed.total }))}</small>` : ''}`
          : `${icon('search', 13)} <span>${esc(t('prj_keywordsOnly'))}</span> <button class="link" data-action="prj-get-embed">${esc(t('prj_getEmbed'))}</button>`}${indexing ? ` ${spinner(11)}` : ''}</div>
      </section>
    </aside>
  </div>`;
}
function afterProjectsRender() {
  if (!S.prj.current) return;
  bindComposer();
  const dz = $('#prj-drop');
  if (dz && !dz._b) {
    dz._b = true;
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault(); dz.classList.remove('over');
      const paths = [...(e.dataTransfer.files || [])].map((f) => api.projects.pathOf(f)).filter(Boolean);
      if (paths.length) { S.prj.current = await api.projects.addFiles(S.prj.current.id, paths); renderView(); }
    });
  }
}
const prjRefresh = debounce(async () => {
  if (!S.prj.current) return;
  S.prj.current = await api.projects.get(S.prj.current.id);
  if (S.mode === 'projects') { const sc = $('.prj-side') && $('.prj-side').scrollTop; const side = $('.prj-side'); if (side) { const tmp = document.createElement('div'); tmp.innerHTML = prjView(); side.innerHTML = tmp.querySelector('.prj-side').innerHTML; side.scrollTop = sc || 0; afterProjectsRender(); } }
}, 150);
api.on('projects:file', ({ pid }) => { if (S.prj.current && S.prj.current.id === pid) prjRefresh(); });
api.on('projects:embed', ({ pid, done, total }) => { if (S.prj.current && S.prj.current.id === pid) { S.prj.embed = done >= total ? null : { done, total }; prjRefresh(); } });

function relTime(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  const rtf = new Intl.RelativeTimeFormat(S.lang, { numeric: 'auto' });
  if (d < 60) return rtf.format(0, 'second'); if (d < 3600) return rtf.format(-Math.round(d / 60), 'minute');
  if (d < 86400) return rtf.format(-Math.round(d / 3600), 'hour'); if (d < 86400 * 30) return rtf.format(-Math.round(d / 86400), 'day');
  return new Date(ts).toLocaleDateString(S.lang, { day: 'numeric', month: 'short' });
}

Object.assign(actions, {
  'prj-new': () => { S.prj.creating = true; renderView(); setTimeout(() => $('.prj-form input') && $('.prj-form input').focus(), 30); },
  'prj-cancel': () => { S.prj.creating = false; if (S.prj.editing === 'meta') S.prj.editing = null; renderView(); },
  'prj-open': (el) => prjOpen(el.dataset.id),
  'prj-back': () => { S.prj.current = null; S.prj.list = null; renderView(); },
  'prj-edit-meta': () => { S.prj.editing = 'meta'; renderView(); },
  'prj-edit-instr': () => { S.prj.editing = 'instr'; renderView(); setTimeout(() => $('[name=instr]') && $('[name=instr]').focus(), 30); },
  'prj-cancel-edit': () => { S.prj.editing = null; renderView(); },
  'prj-add-files': async () => { S.prj.current = await api.projects.addFiles(S.prj.current.id); renderView(); },
  'prj-rm-file': async (el) => { S.prj.current = await api.projects.removeFile(S.prj.current.id, el.dataset.id); renderView(); },
  'prj-delete': async () => { if (!confirm(t('prj_deleteConfirm', { n: S.prj.current.name }))) return; await api.projects.delete(S.prj.current.id); S.prj.current = null; S.prj.list = null; S.convs = await api.conv.list(); renderSidebar(); renderView(); },
  'prj-get-embed': () => { openSettings('models'); setTimeout(() => { const b = $('[data-action=dl-catalog][data-id="embeddinggemma-300m"]'); if (b) b.scrollIntoView({ block: 'center' }); }, 400); },
  'open-project': (el) => prjOpen(el.dataset.id),
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="prj-save"],[data-form="prj-instr"]'); if (!f) return;
  e.preventDefault();
  if (f.dataset.form === 'prj-save') {
    const cur = S.prj.editing === 'meta' && S.prj.current ? S.prj.current : {};
    const { files, ...rest } = cur;
    const saved = await api.projects.save({ ...rest, name: f.name.value.trim(), description: f.description.value.trim() });
    S.prj.creating = false; S.prj.editing = null;
    if (cur.id) { S.prj.current = saved; renderView(); } else prjOpen(saved.id);
  } else {
    const { files, ...rest } = S.prj.current;
    S.prj.current = await api.projects.save({ ...rest, instructions: f.instr.value.trim() });
    S.prj.editing = null; renderView();
  }
});
