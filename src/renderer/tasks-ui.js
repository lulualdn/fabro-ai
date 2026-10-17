'use strict';
/* Scheduled tasks page: what runs by itself, when, its variables and its last results. */
async function loadTasks() { try { S.tasks = await api.tasks.list(); } catch { S.tasks = []; } if (S.mode === 'tasks') renderView(); }
api.on('tasks:event', (e) => { if (e.type === 'running') (S.tasksRunning ||= new Set()).add(e.id); if (e.type === 'ran' && S.tasksRunning) S.tasksRunning.delete(e.id); loadTasks(); if (e.type === 'ran') api.conv.list().then((l) => { S.convs = l; renderRecents && renderRecents(); }).catch(() => {}); });
function renderTasksPage() {
  if (!S.tasks) { loadTasks(); return `<div class="page"><div class="muted">${esc(t('loading'))}</div></div>`; }
  const run = S.tasksRunning || new Set();
  const when = (n) => n ? new Date(n).toLocaleString(S.lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  return `<div class="page tasks-page">
    <header class="pg-head"><div class="pg-ico">${icon('tasks', 22)}</div><div><h1>${esc(t('nav_tasks'))}</h1><p>${esc(t('tk_lead'))}</p></div></header>
    ${!S.tasks.length ? `<div class="tk-empty">${logo(40)}<p>${esc(t('tk_empty'))}</p><button class="btn primary" data-action="tk-example">${esc(t('tk_try'))}</button></div>` : ''}
    <div class="tk-list">${S.tasks.map((k) => `<article class="tk ${k.enabled ? '' : 'off'}">
      <div class="tk-top"><div class="tk-t"><b>${esc(k.title)}</b><small>${icon('tasks', 13)} ${esc(k.schedule)} · ${esc(t('tk_next'))} ${esc(k.enabled ? when(k.next) : '—')}</small></div>
        <button class="pm-switch ${k.enabled ? 'on' : ''}" data-action="tk-toggle" data-id="${k.id}" title="${esc(t('tk_enabled'))}"><i></i></button></div>
      <p class="tk-prompt">${esc(k.prompt)}</p>
      ${Object.keys(k.vars || {}).length ? `<div class="tk-vars">${Object.entries(k.vars).map(([n, v]) => `<span><code>{{${esc(n)}}}</code> ${esc(typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 80)}</span>`).join('')}</div>` : ''}
      ${k.runs && k.runs[0] ? `<div class="tk-last ${k.runs[0].ok ? '' : 'err'}"><small>${esc(t('tk_last'))} · ${esc(when(k.runs[0].at))}</small><div class="md">${k.runs[0].ok ? md(k.runs[0].preview || '', 'tk' + k.id) : esc(k.runs[0].error || '')}</div></div>` : ''}
      <div class="tk-act">
        <button class="btn sm" data-action="tk-run" data-id="${k.id}" ${run.has(k.id) ? 'disabled' : ''}>${run.has(k.id) ? spinner(14) : icon('play', 14)} ${esc(t(run.has(k.id) ? 'tk_running' : 'tk_run'))}</button>
        ${k.convId ? `<button class="btn sm" data-action="tk-open" data-id="${k.convId}">${icon('chat', 14)} ${esc(t('tk_results'))}</button>` : ''}
        <span class="grow"></span>
        <button class="icon-btn sm" data-action="tk-del" data-id="${k.id}" title="${esc(t('delete'))}">${icon('trash', 15)}</button>
      </div></article>`).join('')}</div>
  </div>`;
}
Object.assign(actions, {
  'tk-toggle': async (el) => { const k = S.tasks.find((x) => x.id === el.dataset.id); await api.tasks.update(k.id, { enabled: !k.enabled }); loadTasks(); },
  'tk-run': async (el) => { (S.tasksRunning ||= new Set()).add(el.dataset.id); renderView(); await api.tasks.run(el.dataset.id); },
  'tk-del': async (el) => { await api.tasks.remove(el.dataset.id); loadTasks(); },
  'tk-open': (el) => openConv(el.dataset.id),
  'tk-example': () => { S.mode = 'chat'; newChat(); setTimeout(() => { const ta = $('#prompt'); if (ta) { ta.value = t('tk_example'); S._draft = ta.value; ta.focus(); updateSendState(); } }, 100); },
});
