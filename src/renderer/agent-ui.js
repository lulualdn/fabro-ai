'use strict';
/* Agent mode UI: automatic switch, tool steps (files, terminal, browser, documents, Python, MCP, skills),
   permission cards, on-demand dependencies, and the workspace panel with the live browser. */

const AGENT_ICONS = { design: 'brush', files: 'folder', shell: 'terminal', browser: 'globe', documents: 'file', python: 'code', skills: 'book', mcp: 'puzzle', plan: 'plan', subagent: 'subagent', git: 'git', code: 'flask', image: 'image', computer: 'monitor' };
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
function catOf(name) {
  if (name.startsWith('mcp__')) return 'mcp';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('computer_')) return 'computer';
  if (['list_dir', 'read_file', 'write_file', 'edit_file', 'delete_file', 'search_files'].includes(name)) return 'files';
  if (name === 'run_command') return 'shell';
  if (name === 'create_document') return 'documents';
  if (['design_guide', 'create_artifact', 'check_artifact', 'find_library', 'find_images'].includes(name)) return 'design';
  if (name === 'run_python') return 'python';
  if (name === 'load_skill') return 'skills';
  if (name === 'update_plan') return 'plan';
  if (name === 'run_subagent') return 'subagent';
  if (name.startsWith('git_')) return 'git';
  if (name === 'run_tests' || name === 'run_lint') return 'code';
  if (name === 'generate_image') return 'image';
  return 'mcp';
}
const state0 = () => S.browser || {};
const cuTarget = (a, p = '') => (a[p + 'element'] != null ? `[${a[p + 'element']}]` : a[p + 'x'] != null ? `${Math.round(a[p + 'x'])}, ${Math.round(a[p + 'y'])}` : '');
function stepLabel(st) {
  const a = st.args || {}, v = st.view || {}, run = st.status === 'running' || st.status === 'asking';
  const k = (key, vars) => t((run ? 'ag_run_' : 'ag_done_') + key, vars);
  switch (st.name) {
    case 'list_dir': return k('list', { p: base(a.path) });
    case 'read_file': return k('read', { f: base(a.path) });
    case 'write_file': return k(v.created ? 'create' : 'write', { f: base(a.path) });
    case 'edit_file': return k('edit', { f: base(a.path) });
    case 'delete_file': return k('delete', { f: base(a.path) });
    case 'search_files': return k('search', { q: a.query || '' });
    case 'run_command': return k('cmd', { c: String(a.command || '').slice(0, 80) });
    case 'create_document': return k('doc', { f: `${a.title || ''}.${a.format === 'slides' ? 'pdf' : a.format || ''}` });
    case 'run_python': return k('py');
    case 'load_skill': return k('skill', { n: a.name || '' });
    case 'browser_open': return k('open', { u: fav(a.url || '') });
    case 'browser_search': return k('bsearch', { q: a.query || '' });
    case 'browser_extract': return k('extract', { p: v.title || fav(state0().url || '') });
    case 'browser_find': return k('find', { q: a.text || '' });
    case 'browser_select': return k('select', { o: a.option || '' });
    case 'browser_wait': return k('wait');
    case 'browser_tabs': return k('tabs');
    case 'update_plan': { const st0 = a.steps || []; return t('ag_plan', { d: st0.filter((x) => x.status === 'done').length, n: st0.length }); }
    case 'run_subagent': return k('sub', { d: a.description || '' });
    case 'generate_image': return k('img', { p: String(a.prompt || '').slice(0, 70) });
    case 'run_tests': return k('tests');
    case 'run_lint': return k('lint');
    case 'git_status': return k('gitstatus');
    case 'git_diff': return k('gitdiff');
    case 'git_commit': return k('gitcommit', { m: String(a.message || '').split('\n')[0].slice(0, 60) });
    case 'browser_read': return k('readpage');
    case 'browser_click': return k('click', { l: v.label || `#${a.id ?? ''}` });
    case 'browser_type': return k('type', { l: v.label || `#${a.id}` });
    case 'browser_key': return k('key', { k: a.key });
    case 'browser_scroll': return k('scroll');
    case 'browser_zoom': return k('zoom', { z: Math.round((a.factor || 1) * 100) });
    case 'browser_screenshot': return a.selector ? `${k('shot')} · ${a.selector}` : k('shot');
    case 'create_pdf': return `PDF · ${a.title || ''}`;
    case 'design_guide': return `${t('ag_k_guide')} · ${a.kind || ''}`;
    case 'create_artifact': return `${t('artType_' + (a.type || 'html'))} · ${a.title || ''}`;
    case 'check_artifact': return `👁 ${a.artifact || ''}`;
    case 'find_library': return `📦 ${a.need || ''}`;
    case 'find_images': return `🖼 ${a.query || ''}`;
    case 'inspect_document': return `👁 ${a.artifact || base(a.path || '')}`;
    case 'read_artifact': return `${a.artifact || ''}`;
    case 'edit_artifact': return `✎ ${a.artifact || ''} · ${(a.edits || []).length}`;
    case 'generate_speech': return `🔊 ${a.title || String(a.text || '').slice(0, 50)}`;
    case 'browser_download_images': return `⬇ ${a.selector || 'images'}`;
    case 'import_files': return `📥 ${a.why || ''}`;
    case 'wait': return `⏳ ${a.seconds || 1} s${a.reason ? ' · ' + a.reason : ''}`;
    case 'browser_back': return k('back');
    case 'browser_script': return k('script');
    case 'computer_look': return k('cu_look');
    case 'computer_zoom': return k('cu_zoom');
    case 'computer_click': return k(a.button === 'right' ? 'cu_rclick' : a.clicks === 2 ? 'cu_dclick' : 'cu_click', { l: v.target || cuTarget(a) });
    case 'computer_drag': return k('cu_drag', { l: v.from || cuTarget(a) || '…', d: v.target || cuTarget(a, 'to_') || '…' });
    case 'computer_type': return k('cu_type', { t: String(a.text || '').slice(0, 50) });
    case 'computer_key': return k('cu_key', { k: a.keys || '' });
    case 'computer_scroll': return k('cu_scroll');
    case 'computer_actions': return k('cu_actions', { n: (a.actions || []).length });
    case 'computer_open_app': return k('cu_open', { a: a.name || base(a.path_or_url || '') });
    case 'computer_window': return k('cu_window', { w: a.window || '' });
    default: if (st.name.startsWith('mcp__')) { const [, srv, tool] = st.name.split('__'); return `${srv} · ${tool}`; } return st.name;
  }
}
function questionCard(st) {
  const p = st.perm;
  return `<div class="perm-card q-card"><div class="pc-head">${icon('chat', 16)}<b>${esc(p.question || p.summary || '')}</b></div>
    ${(p.options || []).length ? `<div class="q-opts">${p.options.map((o) => `<button class="btn sm" data-action="perm" data-id="${esc(st.id)}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
    <form class="q-own" data-form="q-own" data-id="${esc(st.id)}"><input class="input" placeholder="${esc(t('q_own'))}"><button class="btn sm primary" type="submit">${esc(t('send'))}</button></form>
    <button class="link small" data-action="perm" data-id="${esc(st.id)}" data-v="deny">${esc(t('q_skip'))}</button></div>`;
}
function permCard(st, m) {
  const p = st.perm;
  if (p.kind === 'question') return questionCard(st);
  const danger = p.risk === 'danger';
  const title = p.reason === 'folder' ? t('perm_folder') : p.reason === 'computer_use' ? t('perm_computer') : danger ? t('perm_danger') : t('perm_' + (catOf(p.tool) || 'mcp'));
  return `<div class="perm-card ${danger ? 'danger' : ''}">
    <div class="pc-head">${icon(danger ? 'warning' : 'shield', 16)}<b>${esc(title)}</b></div>
    <pre class="pc-what">${esc(p.summary || '')}</pre>
    ${p.reason && p.reason !== 'folder' ? `<div class="pc-why">${esc(t('perm_why_' + (p.reason === 'danger_command' ? 'cmd' : p.reason === 'delete' ? 'delete' : p.reason === 'outside_project' ? 'outside' : p.reason === 'computer_use' ? 'computer' : p.reason === 'run_program' ? 'program' : 'sensitive'), { r: p.reason }))}</div>` : ''}
    <div class="pc-actions">
      <button class="btn sm primary" data-action="perm" data-id="${esc(st.id)}" data-v="once">${esc(t(p.reason === 'computer_use' ? 'perm_cu_allow' : 'perm_once'))}</button>
      ${p.reason === 'computer_use' ? `<button class="btn sm" data-action="perm" data-id="${esc(st.id)}" data-v="cu-always">${esc(t('perm_cu_always'))}</button>` : ''}
      ${!danger ? `<button class="btn sm" data-action="perm" data-id="${esc(st.id)}" data-v="always">${esc(t(p.reason === 'folder' ? 'perm_always_folder' : p.project ? 'perm_always_project' : 'perm_always'))}</button>` : ''}
      <button class="btn sm" data-action="perm" data-id="${esc(st.id)}" data-v="deny">${esc(t('perm_deny'))}</button>
    </div></div>`;
}
function depsCard(st) {
  const d = st.deps;
  return `<div class="deps-card">
    <div class="pc-head">${icon('download', 16)}<b>${esc(t('deps_title_' + d.dep))}</b></div>
    <p>${esc(t('deps_body_' + d.dep))}</p>
    ${d.installing ? `<div class="bar"><i style="width:${Math.round((d.p || 0) * 100)}%"></i></div><small class="muted">${esc(t('deps_installing', { p: Math.round((d.p || 0) * 100) }))}</small>`
      : d.error ? `<div class="pf-error">${icon('warning', 14)} ${esc(d.error)}</div>` : ''}
    <div class="pc-actions">${d.installing ? '' : `<button class="btn sm primary" data-action="deps-install" data-id="${esc(st.id)}">${icon('download', 14)} ${esc(t('installDeps'))}</button><button class="btn sm" data-action="deps-skip" data-id="${esc(st.id)}">${esc(t('cancel'))}</button>`}</div>
  </div>`;
}
// What a step produced for the user (a file, a document, audio, an image): stays visible under a folded tool summary.
let STEP_NO_OUT = false;
function isDeliverable(st) {
  const v = st.view || {};
  if (st.status !== 'done') return false;
  if ((st.name === 'write_file' || st.name === 'edit_file') && v.path && S.conv && S.conv.code) return true;
  if (['create_document', 'create_pdf', 'edit_artifact', 'generate_speech'].includes(st.name) && v.path) return true;
  if (['create_artifact', 'edit_artifact'].includes(st.name) && v.kind === 'artifact') return true;
  return st.name === 'generate_image' && !!v.image;
}
function stepOutputs(steps) { return steps.filter(isDeliverable).map((st) => stepDetail(st, true)).join(''); }
function stepDetail(st, force) {
  const v = st.view || {};
  if (STEP_NO_OUT && !force && isDeliverable(st)) return '';
  if (st.name === 'run_command') {
    const out = st.live != null ? st.live : v.out || '';
    return `<div class="term"><div class="term-head">$ ${esc(st.args.command || '')}${v.code != null ? `<span class="${v.code === 0 ? 'ok-txt' : 'err-txt'}">exit ${v.code}</span>` : ''}</div>${out ? `<pre>${esc(out.slice(-4000))}</pre>` : ''}</div>`;
  }
  if (st.name === 'run_python') {
    const out = st.live != null ? st.live : v.out || '';
    return `<details class="py"><summary>${esc(t('ag_code'))}</summary><pre class="code-mini">${esc(st.args.code || '')}</pre></details>${out ? `<div class="term"><pre>${esc(out.slice(-4000))}</pre></div>` : ''}${v.image ? `<img class="step-img" src="${v.image}" alt="">` : ''}`;
  }
  if ((st.name === 'write_file' || st.name === 'edit_file') && v.path && S.conv && S.conv.code) return cxFileCard(st);
  if ((st.name === 'run_tests' || st.name === 'run_lint') && v.command) return `<div class="term"><div class="term-head">$ ${esc(v.command)}<span class="${v.code === 0 ? 'ok-txt' : 'err-txt'}">${st.name === 'run_tests' ? esc([v.passed != null ? t('cx_passed', { n: v.passed }) : '', v.failed ? t('cx_failed', { n: v.failed }) : ''].filter(Boolean).join(' · ') || 'exit ' + v.code) : esc(t('cx_probN', { n: v.count || 0 }))}</span></div>${st.live ? `<pre>${esc(st.live.slice(-3000))}</pre>` : ''}</div>`;
  if ((st.name === 'write_file' || st.name === 'edit_file') && v.path) {
    return `<div class="file-chip" data-action="reveal-path" data-path="${esc(v.path)}">${icon('file', 13)}<span>${esc(v.path)}</span>${v.add != null ? `<b class="add">+${v.add}</b><b class="del">−${v.del}</b>` : ''}</div>
      ${v.before != null ? `<details class="diff"><summary>${esc(t('ag_diff'))}</summary><pre>${esc(v.before).split('\n').map((l) => `<span class="dl">- ${l}</span>`).join('\n')}\n${esc(v.after).split('\n').map((l) => `<span class="al">+ ${l}</span>`).join('\n')}</pre></details>` : ''}`;
  }
  // an artifact made or changed by the agent: its card (picture of page 1), and in the details what the check saw
  if (v.kind === 'artifact' && v.artifactId) {
    const card = artCardFor({ id: v.artifactId, type: v.type || 'html', title: v.title, v: v.v || 0, check: v.qa ? (v.qa.ok ? 'ok' : v.qa.errors) : null });
    return force || !v.shot ? card : card + `<img class="step-img" src="${v.shot}" alt="" data-action="shot-open" title="${esc(t('open'))}">`;
  }
  // what the AI looked at (pages of a document, a page element…) is shown too
  const seen = v.shot || (v.kind === 'shot' && v.image) ? `<img class="step-img" src="${v.shot || v.image}" alt="" data-action="shot-open" title="${esc(t('open'))}">` : '';
  if (seen && !v.path) return seen;
  if (st.name === 'generate_speech' && v.path) {
    return `<div class="doc-chip">${icon('waveform', 16)}<span><b>${esc(base(v.path))}</b><small>${esc(v.seconds || 0)} s · ${esc(v.voice || '')}</small></span>
      <audio controls preload="none" src="${esc('file://' + encodeURI(v.path.replace(/\\/g, '/')).replace(/^file:\/\/(?!\/)/, 'file:///'))}"></audio>
      <button class="icon-btn sm" data-action="reveal-path" data-path="${esc(v.path)}" title="${esc(t('ag_reveal'))}">${icon('folder', 15)}</button></div>`;
  }
  if (['create_document', 'create_pdf', 'edit_artifact', 'inspect_document'].includes(st.name) && v.path) {
    return `<div class="doc-chip">${icon('file', 16)}<span><b>${esc(base(v.path))}</b><small>${esc(v.path)}</small></span>
      <button class="btn sm" data-action="open-path" data-path="${esc(v.path)}">${esc(t('open'))}</button>
      <button class="icon-btn sm" data-action="reveal-path" data-path="${esc(v.path)}" title="${esc(t('ag_reveal'))}">${icon('folder', 15)}</button>
      ${v.artifactId ? `<button class="icon-btn sm" data-action="art-open" data-id="${esc(v.artifactId)}" title="${esc(t('artEdit'))}">${icon('edit', 15)}</button>` : ''}</div>${seen}`;
  }
  if (st.name === 'browser_screenshot' && v.image) return `<img class="step-img" src="${v.image}" alt="">`;
  if (st.name === 'generate_image') {
    if (st.status === 'running') return `<div class="gen-wait" style="--r:${(st.args.aspect === 'portrait' || st.args.aspect === 'tall') ? '3/4' : st.args.aspect === 'wide' ? '16/9' : st.args.aspect === 'landscape' ? '4/3' : '1/1'}"><div class="gen-shimmer"></div><span>${st.pct ? Math.round(st.pct * 100) + ' %' : esc(t('img_preparing'))}</span><i style="width:${Math.round((st.pct || 0) * 100)}%"></i></div>`;
    if (v.image) return `<figure class="gen-img"><img src="${v.image}" alt="${esc(v.prompt || '')}" data-action="gen-open" data-path="${esc(v.path)}">
      <figcaption><span>${esc(v.model || '')} · ${v.width}×${v.height} · ${Math.round((v.ms || 0) / 1000)} s</span><span class="grow"></span>
      <button class="icon-btn sm" data-action="open-path" data-path="${esc(v.path)}" title="${esc(t('open'))}">${icon('expand', 15)}</button>
      <button class="icon-btn sm" data-action="reveal-path" data-path="${esc(v.path)}" title="${esc(t('ag_reveal'))}">${icon('folder', 15)}</button></figcaption></figure>`;
  }
  if (st.name === 'browser_search' && v.sources && v.sources.length) return srcChips(v);
  return '';
}
// A sub-agent: its own steps nested under it, then its report (collapsed).
function subagentBlock(st, m) {
  const kids = (m.steps || []).filter((x) => x.parent === st.id);
  const run = st.status === 'running' || st.status === 'asking' || kids.some((k) => k.status === 'asking');
  const v = st.view || {};
  const open = run || kids.some((k) => k.status === 'asking');
  return `<details class="sub-block" ${open ? 'open' : ''}><summary>${esc(t((run ? 'sub_working' : 'sub_steps') + (kids.length === 1 ? '_1' : ''), { n: kids.length }))}${v.tokens ? ` · ${v.tokens} tokens` : ''}</summary>
    <div class="sub-steps">${kids.map((k) => renderAgentStep(k, m)).join('')}${run && st.subText ? `<div class="sub-live">${esc(st.subText.slice(-400))}</div>` : ''}</div>
    ${v.report ? `<div class="sub-report md">${md(v.report, 'sub-' + st.id)}</div>` : ''}</details>`;
}
function renderAgentStep(st, m) {
  if (st.name === 'web_search' || st.name === 'fetch_url') return renderChatStep(st);
  const cat = catOf(st.name);
  const run = st.status === 'running';
  const ico = st.status === 'error' ? icon('warning', 14) : st.status === 'refused' ? icon('x', 14) : run ? spinner(14) : icon(AGENT_ICONS[cat] || 'puzzle', 14);
  return `<div class="step agent-step ${st.status} c-${cat}">
    <span class="step-ico">${ico}</span>
    <span class="step-label">${esc(stepLabel(st))}${st.status === 'refused' ? ` — <em>${esc(t('ag_refused'))}</em>` : ''}${st.error ? ` — <em>${esc(st.error)}</em>` : ''}</span>
    ${st.status === 'asking' && st.perm ? permCard(st, m) : ''}
    ${st.deps ? depsCard(st) : ''}
    ${st.name === 'run_subagent' ? subagentBlock(st, m) : `<div class="step-detail">${stepDetail(st)}</div>`}
  </div>`;
}

// ───────────────────────────── events ─────────────────────────────
function onAgentEvent(ev, m) {
  const st = (m.steps || []).find((x) => x.id === ev.id);
  switch (ev.type) {
    case 'agent_switch':
      m.agent = true;
      if (S.conv) { S.conv.agent = true; }
      renderTopbar(); toast(t('agentOn'));
      if (S.settings.agentPanel !== false) { S.spOpen = true; renderSessionPanel(); }
      break;
    case 'tools_info': m.toolsInfo = { count: ev.count, tokens: ev.tokens }; break;
    case 'permission':
      if (st) { st.status = 'asking'; st.perm = ev; }
      if (document.hidden || !document.hasFocus()) api.notify({ title: t('perm_notify'), body: ev.summary || ev.tool, onlyIfHidden: true });
      break;
    case 'deps_needed': if (st) st.deps = { dep: ev.dep }; break;
    case 'tool_progress': if (st) { if (ev.pct != null) st.pct = ev.pct; else st.live = ((st.live || '') + ev.text).slice(-20000); } break;
    case 'retract': m.content = (m.content || '').replace(ev.text, ''); break;
    case 'plan': if (!ev.sub) { m.plan = ev.steps; S.sp = S.sp || {}; renderSessionPanel(); } break;
    case 'sub_token': { const p = (m.steps || []).find((x) => x.id === ev.parent); if (p) p.subText = ((p.subText || '') + ev.text).slice(-2000); break; }
  }
  if (ev.type !== 'tools_info') scheduleStreamRender();
  if (['permission', 'agent_switch'].includes(ev.type)) renderSessionPanel();
}
api.on('browser:focus', () => { if (S.viewer && S.viewer.type === 'agent') { S.viewer.tab = 'browser'; renderViewer(); } else openWorkspace('browser'); });
api.on('browser:state', (st) => {
  const sig = (x) => JSON.stringify(((x || {}).tabs || []).map((q) => [q.id, q.title, q.active, q.loading]));
  const changed = sig(S.browser) !== sig(st);
  S.browser = st;
  if (changed && S.viewer && S.viewer.type === 'agent' && S.viewer.tab === 'browser') { const tb = $('.ab-tabs'); if (tb || (st.tabs || []).length) { renderViewer(); return; } } const bar = $('#ab-url'); if (bar && document.activeElement !== bar) bar.value = st.url || ''; const t0 = $('.ab-title'); if (t0) t0.textContent = st.title || ''; const ctl = $('.ab-control'); if (ctl) ctl.classList.toggle('on', !!st.userControl); });
api.on('browser:blocked', (b) => toast(t('ag_dl_blocked', { f: b.file || '' })));
api.on('deps:progress', ({ dep, p }) => {
  for (const m of (S.conv && S.conv.messages) || []) for (const st of m.steps || []) if (st.deps && st.deps.dep === dep && st.deps.installing) st.deps.p = p;
  scheduleStreamRender();
});

// ───────────────────────────── workspace (side panel) ─────────────────────────────
function openWorkspace(tab) { S.viewer = { type: 'agent', tab: tab || (S.viewer && S.viewer.type === 'agent' && S.viewer.tab) || 'steps' }; renderViewer(); }
function convSteps() { return ((S.conv && S.conv.messages) || []).flatMap((m) => (m.steps || []).map((s) => ({ ...s, msg: m.id }))); }
function workspaceView() {
  const v = S.viewer; const tab = v.tab || 'steps';
  const steps = convSteps().filter((s) => !['web_search', 'fetch_url'].includes(s.name));
  const filesT = steps.filter((s) => s.view && s.view.path && ['write_file', 'edit_file', 'create_document', 'delete_file'].includes(s.name));
  const tabs = [['steps', 'tasks', t('ws_steps')], ['browser', 'globe', t('ws_browser')], ['files', 'folder', t('ws_files')]];
  let body = '';
  if (tab === 'steps') body = steps.length ? `<ol class="ws-steps">${steps.map((s) => `<li class="${s.status}">${s.status === 'running' || s.status === 'asking' ? spinner(13) : icon(s.status === 'error' ? 'warning' : s.status === 'refused' ? 'x' : 'check', 13)}<span>${esc(stepLabel(s))}</span></li>`).join('')}</ol>` : `<div class="empty-note">${esc(t('ws_empty'))}</div>`;
  if (tab === 'files') body = filesT.length ? `<div class="ws-files">${[...new Map(filesT.map((s) => [s.view.path, s])).values()].map((s) => `<div class="file-chip" data-action="reveal-path" data-path="${esc(s.view.path)}">${icon('file', 13)}<span>${esc(s.view.path)}</span><small>${esc(t('ws_kind_' + s.name))}</small></div>`).join('')}</div>` : `<div class="empty-note">${esc(t('ws_nofiles'))}</div>`;
  if (tab === 'browser') {
    const b = S.browser || {};
    const tabsHtml = (b.tabs || []).length ? `<div class="ab-tabs">${b.tabs.map((x) => `<button class="ab-tab ${x.active ? 'on' : ''}" data-action="ab-tab" data-id="${x.id}" title="${esc(x.url)}">${x.loading ? spinner(11) : icon('globe', 12)}<span>${esc(x.title || fav(x.url) || t('ab_newtab'))}</span><i class="x" data-action="ab-tab-close" data-id="${x.id}">${icon('x', 11)}</i></button>`).join('')}<button class="ab-tab-new" data-action="ab" data-a="newtab" title="${esc(t('ab_newtab'))}">${icon('plus', 14)}</button></div>` : '';
    body = `${tabsHtml}<div class="ab-bar">
        <button class="icon-btn sm" data-action="ab" data-a="back" title="${esc(t('back'))}">${icon('back', 15)}</button>
        <button class="icon-btn sm" data-action="ab" data-a="forward" title="${esc(t('forward'))}">${icon('forward', 15)}</button>
        <button class="icon-btn sm" data-action="ab" data-a="reload" title="${esc(t('refresh'))}">${icon('refresh', 15)}</button>
        <button class="icon-btn sm" data-action="ab" data-a="home" title="${esc(t('ab_home'))}">${icon('home', 15)}</button>
        <form class="ab-form" data-form="ab-go"><input id="ab-url" name="u" value="${esc(b.url || '')}" placeholder="${esc(t('ab_placeholder'))}" spellcheck="false"></form>
        <button class="ab-control ${b.userControl ? 'on' : ''}" data-action="ab-control" title="${esc(t('ab_control_hint'))}">${icon('user', 14)}<span>${esc(b.userControl ? t('ab_giveback') : t('ab_take'))}</span></button>
      </div>
      <div class="ab-view" id="agent-browser">${b.open ? '' : `<div class="ab-empty">${icon('globe', 28)}<p>${esc(t('ab_empty'))}</p></div>`}</div>`;
  }
  return `<div class="v-head"><span class="ah-ico">${icon('agent', 16)}</span><span class="v-title">${esc(t('ws_title'))}</span>
      <div class="v-tools"><div class="seg sm">${tabs.map(([k, ic, l]) => `<button class="${tab === k ? 'on' : ''}" data-action="ws-tab" data-tab="${k}">${icon(ic, 13)} ${esc(l)}</button>`).join('')}</div>
      <button class="icon-btn sm" data-action="viewer-close" title="${esc(t('close'))}">${icon('x', 17)}</button></div></div>
    <div class="v-body ws-body ws-${tab}">${body}</div>`;
}
// Keep the native browser view glued to its placeholder.
function syncBrowser() {
  const el = $('#agent-browser');
  const visible = !!el && !S.settingsTab && !$('#modal-root .modal') && !$('#popover-root').innerHTML && S.viewer && S.viewer.type === 'agent' && S.viewer.tab === 'browser';
  const r = el ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
  api.browser.bounds({ x: r.x, y: r.y, width: r.width, height: r.height, visible });
}
const ro = new ResizeObserver(() => syncBrowser());
let roTarget = null;
function afterViewerRender() {
  const el = $('#agent-browser');
  if (el && el !== roTarget) { if (roTarget) ro.unobserve(roTarget); ro.observe(el); roTarget = el; }
  syncBrowser();
}
window.addEventListener('resize', syncBrowser);
setInterval(syncBrowser, 700); // cheap safety net (overlays, animations)

Object.assign(actions, {
  'shot-open': (el) => openViewer({ type: 'image', title: t('ag_k_shot') !== 'ag_k_shot' ? t('ag_k_shot') : 'Capture', src: el.getAttribute('src') }),
  'perm': (el) => {
    const id = el.dataset.id;
    const m = (S.streaming && S.streaming.msg);
    const st = m && (m.steps || []).find((x) => x.id === id);
    if (!S.streaming) return;
    if (st) { st.status = 'running'; st.perm = null; }
    let v = el.dataset.v;
    // "always let Fabro use the computer": no more question, in any conversation (Settings › Agent can undo it)
    if (v === 'cu-always') { v = 'once'; saveSettings({ computer: { ...(S.settings.computer || {}), confirm: false } }); toast(t('perm_cu_always_done')); }
    api.chat.answer(S.streaming.reqId, id, v);
    scheduleStreamRender();
  },
  'deps-install': async (el) => {
    const id = el.dataset.id; const m = S.streaming && S.streaming.msg; const st = m && m.steps.find((x) => x.id === id);
    if (!st) return;
    st.deps.installing = true; st.deps.p = 0; st.deps.error = null; scheduleStreamRender();
    try { await api.deps.install(st.deps.dep); st.deps = null; api.chat.answer(S.streaming.reqId, id, true); }
    catch (e) { st.deps.installing = false; st.deps.error = cleanErr(e); }
    scheduleStreamRender();
  },
  'deps-skip': (el) => { const m = S.streaming && S.streaming.msg; const st = m && m.steps.find((x) => x.id === el.dataset.id); if (st) st.deps = null; api.chat.answer(S.streaming.reqId, el.dataset.id, false); },
  'ws-tab': (el) => { S.viewer.tab = el.dataset.tab; renderViewer(); },
  'open-workspace': () => openWorkspace(),
  'ab': async (el) => { S.browser = await api.browser.control(el.dataset.a); if (el.dataset.a === 'newtab') renderViewer(); },
  'ab-tab': async (el, e) => { if (e && e.target.closest('[data-action=ab-tab-close]')) return; S.browser = await api.browser.control('tab', el.dataset.id); renderViewer(); },
  'ab-tab-close': async (el) => { S.browser = await api.browser.control('closetab', el.dataset.id); renderViewer(); },
  'ab-control': async () => { S.browser = await api.browser.control(S.browser && S.browser.userControl ? 'release' : 'take'); renderViewer(); },
  'reveal-path': (el) => api.shell.reveal(el.dataset.path),
  'gen-open': (el) => openViewer({ type: 'image', title: el.alt || '', src: el.src }),
  'open-path': (el) => api.shell.openPath(el.dataset.path),
});
// a typed answer to a question card (no inline handlers: the page's CSP forbids them)
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form="q-own"]'); if (!f) return;
  e.preventDefault();
  const v = (f.querySelector('input') || {}).value; if (v && v.trim()) actions.perm({ dataset: { id: f.dataset.id, v: v.trim() } });
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form="ab-go"]'); if (!f) return;
  e.preventDefault(); api.browser.control('go', new FormData(f).get('u'));
});
