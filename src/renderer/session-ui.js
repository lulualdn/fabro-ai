'use strict';
/* Agent session panel (top right of the chat, like Claude's): Progression (the agent's plan or its
   steps), Outputs (artifacts, documents and files it made), and what this session used (uploads,
   connectors, web search, browser, memory, skills, sub-agents). */

const SP_EXT_ICON = { pdf: 'filePdf', docx: 'fileDoc', doc: 'fileDoc', xlsx: 'fileXls', xls: 'fileXls', csv: 'fileXls', pptx: 'filePpt', zip: 'fileZip', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', md: 'file', txt: 'file', html: 'fileCode', js: 'fileCode', ts: 'fileCode', py: 'fileCode', json: 'fileCode', css: 'fileCode' };
const spExt = (p) => (String(p).match(/\.([a-z0-9]{1,5})$/i) || [, ''])[1].toLowerCase();
const spName = (p) => String(p).split(/[\\/]/).pop();
const fileTitle = (p) => spName(p).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function sessionData() {
  const msgs = (S.conv && S.conv.messages) || [];
  const steps = msgs.flatMap((m) => m.steps || []);
  const plan = [...msgs].reverse().find((m) => m.plan && m.plan.length);
  // Outputs
  const arts = [];
  for (const m of msgs) {
    if (!m.artifacts || typeof splitArtifacts !== 'function') continue;
    const segs = splitArtifacts(m.content || '').filter((s) => s.kind === 'artifact');
    segs.forEach((seg) => { const ref = m.artifacts[seg.i]; if (ref && !arts.some((a) => a.id === ref.id)) arts.push({ id: ref.id, v: ref.v, title: seg.title || t('artType_' + seg.type), type: seg.type, body: seg.body }); });
  }
  const files = new Map();
  for (const st of steps) {
    const v = st.view || {};
    if (st.status !== 'done') continue;
    if (st.name === 'create_document' && v.path) files.set(v.path, { path: v.path, doc: true, artifactId: v.artifactId, format: st.args.format });
    else if (st.name === 'write_file' && v.path) files.set(v.path, { path: v.path });
    else if (st.name === 'run_python' && v.created) v.created.forEach((p) => files.set(p, { path: p }));
    else if (st.name === 'delete_file' && v.path) files.delete(v.path);
  }
  // Used in this session
  const uploads = msgs.flatMap((m) => m.attachments || []);
  const mcpSrv = [...new Set(steps.filter((s) => s.name.startsWith('mcp__')).map((s) => s.name.split('__')[1]))];
  const searches = steps.filter((s) => s.name === 'web_search' || s.name === 'browser_search');
  const engine = (searches.find((s) => s.view && s.view.engine) || {}).view;
  const sites = [...new Set(steps.filter((s) => s.name === 'browser_open' || s.name === 'fetch_url').map((s) => fav(s.args.url || '')).filter(Boolean))];
  const skills = [...new Set(steps.filter((s) => s.name === 'load_skill').map((s) => s.args.name))];
  const subs = steps.filter((s) => s.name === 'run_subagent' && !s.parent);
  const cmds = steps.filter((s) => s.name === 'run_command').length;
  const memOn = (S.settings.memory || {}).enabled !== false && S.memories && S.memories.length && !(S.conv && S.conv.ephemeral);
  return { steps, plan: plan && plan.plan, arts, files: [...files.values()], uploads, mcpSrv, searches, engine: engine && engine.engine, sites, skills, subs, cmds, memOn };
}

function spProgress(d) {
  if (d.plan) {
    const done = d.plan.filter((s) => s.status === 'done');
    const firstOpen = d.plan.findIndex((s) => s.status !== 'done');
    // Like Claude: older finished steps fold into one line.
    const fold = S.spUnfold ? 0 : Math.max(0, (firstOpen < 0 ? d.plan.length : firstOpen) - 2);
    const shown = d.plan.slice(fold);
    return `<div class="sp-sec"><div class="sp-h">${esc(t('sp_progress'))}<small>${done.length}/${d.plan.length}</small></div>
      <ol class="sp-plan">
        ${fold ? `<li class="fold" data-action="sp-unfold"><i></i><span>${esc(t('sp_prev', { n: fold }))}</span></li>` : ''}
        ${shown.map((s) => `<li class="${s.status}"><i>${s.status === 'done' ? icon('done', 15) : s.status === 'in_progress' ? spinner(14) : icon('pending', 15)}</i><span>${esc(s.title)}</span></li>`).join('')}
      </ol></div>`;
  }
  const top = d.steps.filter((s) => !s.parent && s.name !== 'update_plan');
  if (!top.length) return `<div class="sp-sec"><div class="sp-h">${esc(t('sp_progress'))}</div><div class="sp-empty">${esc(t('sp_noSteps'))}</div></div>`;
  const fold = S.spUnfold ? 0 : Math.max(0, top.length - 4);
  return `<div class="sp-sec"><div class="sp-h">${esc(t('sp_progress'))}<small>${top.length}</small></div>
    <ol class="sp-plan">
      ${fold ? `<li class="fold" data-action="sp-unfold"><i></i><span>${esc(t('sp_prev', { n: fold }))}</span></li>` : ''}
      ${top.slice(fold).map((s) => `<li class="${s.status === 'running' || s.status === 'asking' ? 'in_progress' : s.status === 'done' ? 'done' : s.status}"><i>${s.status === 'running' || s.status === 'asking' ? spinner(14) : s.status === 'done' ? icon('done', 15) : icon('warning', 15)}</i><span>${esc(stepLabel(s))}</span></li>`).join('')}
    </ol></div>`;
}

function thumb(a) {
  if (a.type === 'html' || a.type === 'svg') return `<div class="sp-thumb live"><iframe tabindex="-1" sandbox="allow-scripts" src="fabro-art://${esc(a.id)}/?v=${a.v || 0}"></iframe></div>`;
  if (a.type === 'code') return `<div class="sp-thumb code"><pre>${esc(String(a.body || '').slice(0, 500))}</pre></div>`;
  const text = String(a.body || '').split(/\n---\n/)[0].slice(0, 700);
  return `<div class="sp-thumb doc ${a.type === 'slides' ? 'slide' : ''}"><div class="md">${md(text, 'thumb-' + a.id)}</div></div>`;
}
function spOutputs(d) {
  const cards = [
    ...d.arts.map((a) => ({ html: `<button class="sp-card" data-action="art-open" data-id="${esc(a.id)}">${thumb(a)}<b>${esc(a.title)}</b><small>${esc(t('sp_artifact'))}</small></button>` })),
    ...d.files.filter((f) => f.doc).map((f) => ({ html: `<button class="sp-card" data-action="${f.artifactId ? 'art-open' : 'open-path'}" data-id="${esc(f.artifactId || '')}" data-path="${esc(f.path)}"><div class="sp-thumb file">${icon(SP_EXT_ICON[spExt(f.path)] || 'file', 34)}<span>${esc(spExt(f.path).toUpperCase())}</span></div><b>${esc(fileTitle(f.path))}</b><small>${esc(t('sp_document'))}</small></button>` })),
  ];
  const list = d.files.filter((f) => !f.doc);
  if (!cards.length && !list.length) return '';
  return `<div class="sp-sec"><div class="sp-h">${esc(t('sp_outputs'))}</div>
    ${cards.length ? `<div class="sp-cards">${cards.map((c) => c.html).join('')}</div>` : ''}
    ${list.length ? `<div class="sp-files">${list.slice(0, 40).map((f) => `<button class="sp-file" data-action="open-path" data-path="${esc(f.path)}" title="${esc(f.path)}">${icon(SP_EXT_ICON[spExt(f.path)] || 'file', 16)}<span>${esc(fileTitle(f.path))}</span><small>${esc(spExt(f.path).toUpperCase())}</small></button>`).join('')}</div>` : ''}
  </div>`;
}
function spUsed(d) {
  const rows = [];
  const r = (ic, label, val, extra = '') => rows.push(`<div class="sp-used"${extra}>${icon(ic, 16)}<span>${esc(label)}</span><small>${val}</small></div>`);
  if (d.uploads.length) r('clip', t('sp_uploads'), `${esc(d.uploads[0].name)}${d.uploads.length > 1 ? ` <em>+${d.uploads.length - 1}</em>` : ''}`);
  if (d.mcpSrv.length) r('plug', t('sp_connectors'), esc(d.mcpSrv.join(', ')));
  if (d.searches.length) r('globe', t('sp_websearch'), `${esc(d.engine === 'searxng' ? 'SearXNG' : d.engine === 'duckduckgo' ? 'DuckDuckGo' : d.engine || '')} · ${d.searches.length}`);
  if (d.sites.length) r('tabs', t('sp_browser'), `${esc(d.sites[0])}${d.sites.length > 1 ? ` <em>+${d.sites.length - 1}</em>` : ''}`, ' data-action="open-workspace-browser" role="button"');
  if (d.memOn) r('bulb', t('sp_memory'), esc(t('sp_memN', { n: S.memories.length })));
  if (d.skills.length) r('book', t('sp_skills'), esc(d.skills.join(', ')));
  if (d.subs.length) r('subagent', t('sp_subagents'), String(d.subs.length));
  if (d.cmds) r('terminal', t('sp_terminal'), esc(t('sp_cmdN', { n: d.cmds })));
  if (!rows.length) return '';
  return `<div class="sp-sec"><div class="sp-h">${esc(t('sp_used'))}</div>${rows.join('')}</div>`;
}

function spVisible() { return S.mode === 'chat' && S.conv && S.conv.agent && S.spOpen !== false && !S.settingsTab; }
let spT = null;
function renderSessionPanel() {
  clearTimeout(spT);
  spT = setTimeout(() => {
    let el = $('#session-panel');
    if (!el) { el = document.createElement('aside'); el.id = 'session-panel'; el.className = 'session-panel'; $('.main').appendChild(el); }
    const show = spVisible();
    $('.main').classList.toggle('with-sp', !!show);
    if (!show) { el.classList.remove('open'); return; }
    const d = sessionData();
    const scroll = el.querySelector('.sp-body') ? el.querySelector('.sp-body').scrollTop : 0;
    el.innerHTML = `<div class="sp-top"><b>${esc(t('sp_title'))}</b><span class="grow"></span>
        <button class="icon-btn xs" data-action="open-workspace" title="${esc(t('ws_title'))}">${icon('expand', 14)}</button>
        <button class="icon-btn xs" data-action="sp-close" title="${esc(t('close'))}">${icon('x', 15)}</button></div>
      <div class="sp-body">${spProgress(d)}${spOutputs(d)}${spUsed(d)}</div>`;
    el.querySelector('.sp-body').scrollTop = scroll;
    requestAnimationFrame(() => el.classList.add('open'));
  }, 60);
}

Object.assign(actions, {
  'sp-close': () => { S.spOpen = false; renderSessionPanel(); renderTopbar(); },
  'sp-toggle': () => { S.spOpen = S.spOpen === false; renderSessionPanel(); renderTopbar(); },
  'sp-unfold': () => { S.spUnfold = true; renderSessionPanel(); },
  'open-workspace-browser': () => openWorkspace('browser'),
});
