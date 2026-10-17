'use strict';
/* Code mode: open a project folder, explorer with git badges, code sessions (agent always on, scoped to
   the project), modified-file cards, Diff / File / Preview viewer with an editor, terminal panel with
   Terminal / Tests / Problems tabs, git (branch, commit, discard, undo), per-project permissions,
   project instructions (FABRO.md / AGENTS.md / CLAUDE.md) and undo of an agent turn. */

S.cx = { root: null, info: null, expanded: new Set(['']), dirs: new Map(), git: { repo: false, files: {} }, recent: null,
  term: { tabs: [{ id: 'terminal', kind: 'terminal', out: '' }], active: 'terminal', open: true, h: 220, runs: {} }, tests: null, problems: [], cmdHist: [], devUrl: null };

const CX_EXT_LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rs: 'rust', go: 'go', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', css: 'css', scss: 'scss', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sh: 'bash', ps1: 'powershell', sql: 'sql', lua: 'lua', luau: 'lua', swift: 'swift', vue: 'xml', svelte: 'xml', dockerfile: 'dockerfile' };
const cxLang = (p) => CX_EXT_LANG[(String(p).match(/\.([^.\\/]+)$/) || [, ''])[1].toLowerCase()] || (/dockerfile$/i.test(p) ? 'dockerfile' : '');
const cxSep = () => (S.info.platform === 'win32' ? '\\' : '/');
const cxRel = (abs) => { const r = S.cx.root; if (!r || !abs) return abs; const a = String(abs); return a.toLowerCase().startsWith(r.toLowerCase()) ? a.slice(r.length).replace(/^[\\/]+/, '') : a; };
const cxBase = (p) => String(p).split(/[\\/]/).pop();
const GIT_CLS = { M: 'mod', A: 'add', U: 'add', D: 'del', R: 'mod' };

// ───────────────────────────── project lifecycle ─────────────────────────────
async function cxOpen(root, { keepConv = false } = {}) {
  try { S.cx.info = await api.code.info(root); } catch (e) { toast(cleanErr(e), 'err'); return false; }
  if (S.cx.root !== root) { S.cx.dirs = new Map(); S.cx.expanded = new Set(['']); S.cx.tests = null; S.cx.problems = []; S.cx.devUrl = null; }
  S.cx.root = root; S.cx.git = S.cx.info.git;
  if (!keepConv && S.conv && (!S.conv.code || S.conv.code.root !== root)) S.conv = null;
  await cxLoadDir('');
  for (const d of S.cx.expanded) if (d) await cxLoadDir(d).catch(() => S.cx.expanded.delete(d));
  return true;
}
async function cxLoadDir(rel) { S.cx.dirs.set(rel, await api.code.tree(S.cx.root, rel)); }
async function cxRefresh() {
  if (!S.cx.root) return;
  try {
    S.cx.git = await api.code.status(S.cx.root);
    for (const d of [...S.cx.dirs.keys()]) if (d === '' || S.cx.expanded.has(d)) await cxLoadDir(d).catch(() => S.cx.dirs.delete(d));
  } catch {}
  if (S.mode === 'code') { cxRenderTree(); cxRenderTopbarBranch(); }
  if (S.viewer && S.viewer.type === 'codefile' && !S.viewer.dirty) cxLoadViewer(S.viewer.rel, S.viewer.tab, true);
}
const cxRefreshSoon = debounce(cxRefresh, 250);
api.on('code:changed', ({ root }) => { if (root === S.cx.root) cxRefreshSoon(); });

// ───────────────────────────── view ─────────────────────────────
function renderCodeView() {
  if (!S.cx.root) return cxWelcome();
  const hasMsgs = S.conv && S.conv.messages.length;
  return `<div class="cx">
    <aside class="cx-side" id="cx-side">${cxSide()}</aside>
    <div class="cx-main">
      <div class="cx-chat">${hasMsgs ? `<div class="scroller" id="scroller"><div class="thread">${S.conv.messages.map(renderMessage).join('')}</div></div>` : cxStart()}</div>
      <div class="dock">${renderComposer()}</div>
      <div class="cx-term ${S.cx.term.open ? 'open' : ''}" id="cx-term" style="--th:${S.cx.term.h}px">${cxTerm()}</div>
    </div>
  </div>`;
}
function afterCodeRender() {
  bindComposer();
  if (S.conv && S.conv.messages.length) scrollBottom(true);
  cxBindTerm();
  if (!S.cx.root && !S.cx.recent) api.code.recent().then((r) => { S.cx.recent = r; if (S.mode === 'code' && !S.cx.root) renderView(); });
}

function cxWelcome() {
  const rec = S.cx.recent || [];
  const cm = currentModel();
  const coder = cm && /coder|code|devstral|codestral/i.test(cm.label + ' ' + (cm.id || ''));
  return `<div class="cx-welcome">
    <div class="cxw-ico">${icon('code', 30)}</div>
    <h1>${esc(t('cx_title'))}</h1>
    <p class="muted">${esc(t('cx_sub'))}</p>
    <div class="cxw-actions"><button class="btn primary lg" data-action="cx-open">${icon('folderOpen', 18)} ${esc(t('cx_openFolder'))}</button></div>
    ${rec.length ? `<div class="cxw-recent"><div class="cxw-h">${esc(t('cx_recent'))}</div>${rec.map((r) => `<button class="cxw-proj" data-action="cx-open-recent" data-root="${esc(r.root)}">${icon('folder', 18)}<span><b>${esc(r.name)}</b><small>${esc(r.root)}</small></span>${r.kind && r.kind !== 'unknown' ? `<em>${esc(r.kind)}</em>` : ''}</button>`).join('')}</div>` : ''}
    ${!coder ? `<div class="cxw-model">${icon('sparkle', 18)}<div><b>${esc(t('cx_modelTitle'))}</b><small>${esc(t('cx_modelBody'))}</small></div><button class="btn sm" data-action="cx-get-coder">${icon('download', 14)} ${esc(t('cx_modelGet'))}</button></div>` : ''}
  </div>`;
}
function cxStart() {
  const i = S.cx.info || {};
  const sugg = ['cx_s_explain', 'cx_s_bug', 'cx_s_tests', 'cx_s_readme'];
  return `<div class="cx-start">
    <h2>${esc(t('cx_ask', { p: i.name || '' }))}</h2>
    <div class="cx-sugg">${sugg.map((k) => `<button class="chip-btn" data-action="cx-suggest" data-k="${k}">${esc(t(k))}</button>`).join('')}</div>
    <div class="cx-instr">${i.instructions ? `${icon('book', 15)}<span>${esc(t('cx_instrFound', { f: i.instructions.file }))}</span><button class="link" data-action="cx-file" data-rel="${esc(i.instructions.file)}" data-tab="file">${esc(t('open'))}</button>`
      : `${icon('book', 15)}<span>${esc(t('cx_instrNone'))}</span><button class="link" data-action="cx-instr-create">${esc(t('cx_instrCreate'))}</button>`}</div>
  </div>`;
}

// Explorer + changes + commit
function cxSide() {
  const i = S.cx.info || {}; const g = S.cx.git || {};
  const changes = Object.entries(g.files || {});
  return `<div class="cx-proj"><button class="cx-proj-btn" data-action="cx-switch" title="${esc(S.cx.root)}">${icon('folder', 16)}<b>${esc(i.name || '')}</b>${icon('down', 13)}</button>
      <button class="icon-btn xs" data-action="cx-refresh" title="${esc(t('refresh'))}">${icon('refresh', 14)}</button></div>
    <div class="cx-tree" id="cx-tree">${cxTreeHtml('', 0)}</div>
    <div class="cx-changes">
      <div class="cx-h">${icon('git', 14)}<span>${g.repo ? esc(g.branch || 'HEAD') : esc(t('cx_noGit'))}</span>${g.repo && g.ahead ? `<small>↑${g.ahead}</small>` : ''}<span class="grow"></span>
        ${g.repo ? `<button class="icon-btn xs" data-action="cx-branch" title="${esc(t('cx_branch'))}">${icon('git', 13)}</button><button class="icon-btn xs" data-action="cx-log" title="${esc(t('cx_history'))}">${icon('tasks', 13)}</button>` : `<button class="link" data-action="cx-git-init">${esc(t('cx_gitInit'))}</button>`}</div>
      ${g.repo ? `${changes.length ? `<div class="cx-chlist">${changes.slice(0, 200).map(([f, k]) => `<div class="cx-ch" data-action="cx-file" data-rel="${esc(f)}" data-tab="diff" title="${esc(f)}"><span class="gb ${GIT_CLS[k] || 'mod'}">${k}</span><span class="cx-ch-n">${esc(cxBase(f))}</span><small>${esc(f.includes('/') || f.includes('\\') ? f.replace(/[\\/][^\\/]+$/, '') : '')}</small><button class="icon-btn xs" data-action="cx-discard" data-rel="${esc(f)}" title="${esc(t('cx_discard'))}">${icon('retry', 12)}</button></div>`).join('')}</div>
        <form class="cx-commit" data-form="cx-commit"><input class="input sm2" name="m" placeholder="${esc(t('cx_commitPh'))}" autocomplete="off"><button class="btn sm primary" type="submit">${icon('commit', 14)} ${esc(t('cx_commit'))}</button></form>`
        : `<div class="cx-clean">${icon('done', 14)} ${esc(t('cx_clean'))}</div>`}` : ''}
    </div>`;
}
function cxTreeHtml(rel, depth) {
  const items = S.cx.dirs.get(rel);
  if (!items) return depth === 0 ? `<div class="cx-loading">${spinner(16)}</div>` : '';
  const files = (S.cx.git && S.cx.git.files) || {};
  const norm = (p) => p.split('\\').join('/');
  const changedUnder = (d) => { const pre = norm(d) + '/'; return Object.keys(files).some((f) => norm(f).startsWith(pre)); };
  const sel = S.viewer && S.viewer.type === 'codefile' ? S.viewer.rel : null;
  return items.map((e) => {
    const k = files[norm(e.path)] || files[e.path];
    if (e.dir) {
      const open = S.cx.expanded.has(e.path);
      return `<div class="cx-node dir ${open ? 'open' : ''}" style="--d:${depth}" data-action="cx-dir" data-rel="${esc(e.path)}">${icon('right', 12, 'chev')}${icon(open ? 'folderOpen' : 'folder', 15)}<span>${esc(e.name)}</span>${changedUnder(e.path) ? '<i class="dot"></i>' : ''}</div>${open ? cxTreeHtml(e.path, depth + 1) : ''}`;
    }
    return `<div class="cx-node file ${sel === e.path ? 'sel' : ''} ${k ? 'g-' + (GIT_CLS[k] || 'mod') : ''}" style="--d:${depth}" data-action="cx-file" data-rel="${esc(e.path)}" data-tab="file"><i class="sp"></i>${icon(cxFileIcon(e.name), 15)}<span>${esc(e.name)}</span>${k ? `<em class="gb ${GIT_CLS[k] || 'mod'}">${k}</em>` : ''}</div>`;
  }).join('');
}
function cxFileIcon(n) { const x = (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase(); return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(x) ? 'image' : ['md', 'txt'].includes(x) ? 'file' : ['json', 'yml', 'yaml', 'toml', 'ini', 'lock'].includes(x) ? 'sliders' : 'fileCode'; }
function cxRenderTree() { const el = $('#cx-side'); if (el) { const sc = $('#cx-tree') && $('#cx-tree').scrollTop; el.innerHTML = cxSide(); if (sc) $('#cx-tree').scrollTop = sc; } }
function cxRenderTopbarBranch() { if (S.mode === 'code') renderTopbar(); }

// ───────────────────────────── terminal panel ─────────────────────────────
function cxTerm() {
  const T = S.cx.term; const tab = T.active;
  const running = Object.values(T.runs).filter((r) => r.running);
  const cmds = (S.cx.info && S.cx.info.commands) || {};
  const tb = S.cx.tests; const probs = S.cx.problems;
  const tabs = [['terminal', 'terminal', t('cx_term')], ['tests', 'flask', t('cx_tests') + (tb && tb.summary ? ` ${tb.summary.failed ? '✕' + tb.summary.failed : '✓'}` : '')], ['problems', 'bug', t('cx_problems') + (probs.length ? ` ${probs.length}` : '')]];
  let body = '';
  if (tab === 'terminal') {
    const out = (T.tabs.find((x) => x.id === 'terminal') || {}).out || '';
    body = `<pre class="cx-out" id="cx-out">${out ? cxAnsi(out) : `<span class="muted">${esc(t('cx_termHint'))}</span>`}</pre>
      <form class="cx-prompt" data-form="cx-cmd"><span>${esc(cxBase(S.cx.root || ''))} $</span><input name="c" id="cx-cmd" autocomplete="off" spellcheck="false" placeholder="${esc(cmds.run || cmds.test || 'npm install')}"></form>`;
  } else if (tab === 'tests') {
    body = !tb ? `<div class="cx-empty">${icon('flask', 22)}<p>${esc(cmds.test ? t('cx_testsHint', { c: cmds.test }) : t('cx_noTestCmd'))}</p>${cmds.test ? `<button class="btn sm primary" data-action="cx-run-tests">${icon('play', 14)} ${esc(t('cx_runTests'))}</button>` : ''}</div>`
      : `<div class="cx-tsum ${tb.running ? 'run' : tb.summary && tb.summary.ok ? 'ok' : 'bad'}">${tb.running ? spinner(14) : icon(tb.summary && tb.summary.ok ? 'done' : 'error', 16)}
          <b>${esc(tb.running ? t('cx_testsRunning') : tb.summary && tb.summary.ok ? t('cx_testsOk') : t('cx_testsFail'))}</b>
          ${tb.summary ? `<span>${tb.summary.passed != null ? esc(t('cx_passed', { n: tb.summary.passed })) : ''}${tb.summary.failed ? ' · ' + esc(t('cx_failed', { n: tb.summary.failed })) : ''}</span>` : ''}<span class="grow"></span>
          <code>${esc(tb.command || '')}</code><button class="btn sm" data-action="cx-run-tests" ${tb.running ? 'disabled' : ''}>${icon('retry', 13)}</button></div>
        ${tb.summary && tb.summary.failures.length ? `<ul class="cx-fails">${tb.summary.failures.map((f) => `<li>${icon('x', 12)} ${esc(f)}</li>`).join('')}</ul>` : ''}
        <details class="cx-raw" ${tb.running ? 'open' : ''}><summary>${esc(t('cx_output'))}</summary><pre class="cx-out">${cxAnsi(tb.out || '')}</pre></details>`;
  } else {
    body = probs.length ? `<div class="cx-probs">${probs.map((p) => `<div class="cx-prob ${p.severity}" data-action="cx-file" data-rel="${esc(cxRel(p.file))}" data-tab="file" data-line="${p.line}">${icon(p.severity === 'error' ? 'error' : 'warning', 14)}<span>${esc(p.message)}</span><small>${esc(cxBase(p.file))}:${p.line}</small></div>`).join('')}</div>`
      : `<div class="cx-empty">${icon('bug', 22)}<p>${esc(S.cx.lintRan ? t('cx_noProblems') : cmds.lint ? t('cx_lintHint', { c: cmds.lint }) : t('cx_noLintCmd'))}</p>${cmds.lint ? `<button class="btn sm" data-action="cx-run-lint">${icon('play', 14)} ${esc(t('cx_runLint'))}</button>` : ''}</div>`;
  }
  return `<div class="cx-term-head" data-action="cx-term-toggle-head">
      <div class="cx-tabs">${tabs.map(([k, ic, l]) => `<button class="${tab === k ? 'on' : ''}" data-action="cx-term-tab" data-tab="${k}">${icon(ic, 13)} ${esc(l)}</button>`).join('')}</div>
      <span class="grow"></span>
      ${S.cx.devUrl ? `<button class="chip accent" data-action="cx-preview-url" title="${esc(S.cx.devUrl)}">${icon('eye', 13)} ${esc(t('cx_preview'))}</button>` : ''}
      ${running.length ? `<button class="icon-btn xs" data-action="cx-kill" title="${esc(t('stop'))}">${icon('stop', 13)}</button>` : ''}
      <button class="icon-btn xs" data-action="cx-term-clear" title="${esc(t('cx_clear'))}">${icon('trash', 13)}</button>
      <button class="icon-btn xs" data-action="cx-term-toggle" title="${esc(t(S.cx.term.open ? 'cx_hide' : 'cx_show'))}">${icon(S.cx.term.open ? 'down' : 'up', 14)}</button>
    </div>
    <div class="cx-term-body">${body}</div>
    <div class="cx-resize" id="cx-resize"></div>`;
}
// Minimal ANSI → HTML (colors, bold), then escape.
function cxAnsi(s) {
  const C = { 30: '#6b6b6b', 31: '#e5534b', 32: '#57ab5a', 33: '#c69026', 34: '#539bf5', 35: '#b083f0', 36: '#39c5cf', 37: '#adbac7', 90: '#768390', 91: '#ff7b72', 92: '#7ee787', 93: '#e3b341', 94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd' };
  let open = 0;
  const out = esc(String(s).slice(-60000)).replace(/\x1b\[([0-9;]*)m/g, (m, codes) => {
    let r = '';
    for (const c of codes.split(';').map(Number)) {
      if (c === 0 || !codes) { r += '</span>'.repeat(open); open = 0; }
      else if (c === 1) { r += '<span class="b">'; open++; }
      else if (C[c]) { r += `<span style="color:${C[c]}">`; open++; }
    }
    return r;
  }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '');
  return out + '</span>'.repeat(open);
}
function cxRenderTerm() { const el = $('#cx-term'); if (!el) return; const o = $('#cx-out'); const near = !o || o.scrollHeight - o.scrollTop - o.clientHeight < 60; const focused = document.activeElement && document.activeElement.id === 'cx-cmd'; const val = $('#cx-cmd') ? $('#cx-cmd').value : ''; el.innerHTML = cxTerm(); el.classList.toggle('open', S.cx.term.open); el.style.setProperty('--th', S.cx.term.h + 'px'); const o2 = $('#cx-out'); if (o2 && near) o2.scrollTop = o2.scrollHeight; if ($('#cx-cmd')) { $('#cx-cmd').value = val; if (focused) $('#cx-cmd').focus(); } cxBindTerm(); }
const cxRenderTermSoon = (() => { let raf = 0; return () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; cxRenderTerm(); }); }; })();
function cxBindTerm() {
  const h = $('#cx-resize'); if (!h || h._b) return; h._b = true;
  h.addEventListener('pointerdown', (e) => {
    const y0 = e.clientY, h0 = S.cx.term.h; h.setPointerCapture(e.pointerId);
    const mv = (ev) => { S.cx.term.h = Math.max(120, Math.min(innerHeight * 0.7, h0 + (y0 - ev.clientY))); $('#cx-term').style.setProperty('--th', S.cx.term.h + 'px'); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
  });
  const inp = $('#cx-cmd');
  if (inp && !inp._b) { inp._b = true; inp.addEventListener('keydown', (e) => {
    const H = S.cx.cmdHist; if (!H.length) return;
    if (e.key === 'ArrowUp') { S.cx.hi = Math.max(0, (S.cx.hi ?? H.length) - 1); inp.value = H[S.cx.hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { S.cx.hi = Math.min(H.length, (S.cx.hi ?? H.length) + 1); inp.value = H[S.cx.hi] || ''; e.preventDefault(); }
  }); }
}
api.on('code:term', ({ id, kind, data }) => {
  const T = S.cx.term;
  const run = T.runs[id] || (T.runs[id] = { kind, running: true });
  if (kind === 'tests') { S.cx.tests = { ...(S.cx.tests || {}), running: true, out: ((S.cx.tests && S.cx.tests.running ? S.cx.tests.out : '') || '') + data, command: (S.cx.tests || {}).command }; if (!run.shown) { run.shown = true; T.open = true; T.active = 'tests'; } }
  else { const tt = T.tabs.find((x) => x.id === 'terminal'); tt.out = (tt.out + data).slice(-200000); if (kind === 'lint' && !run.shown) { run.shown = true; } }
  const m = String(data).replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}\/?\S*/);
  if (m && !S.cx.devUrl) { S.cx.devUrl = m[0].replace(/[).,]+$/, ''); }
  if (S.mode === 'code') cxRenderTermSoon();
});
api.on('code:exit', ({ id, kind, code, summary, problems }) => {
  const r = S.cx.term.runs[id]; if (r) r.running = false;
  if (kind === 'tests') S.cx.tests = { ...(S.cx.tests || {}), running: false, code, summary };
  if (kind === 'lint' || (kind === 'tests' && problems && problems.length)) { S.cx.problems = problems || []; S.cx.lintRan = true; if (kind === 'lint') { S.cx.term.active = 'problems'; S.cx.term.open = true; } }
  if (kind === 'terminal') { const tt = S.cx.term.tabs.find((x) => x.id === 'terminal'); tt.out += `\n\x1b[90m[exit ${code}]\x1b[0m\n`; }
  if (S.mode === 'code') cxRenderTerm();
  cxRefreshSoon();
});
async function cxRunCmd(command, kind = 'terminal') {
  if (!S.cx.root || !command) return;
  if (kind === 'terminal') { const tt = S.cx.term.tabs.find((x) => x.id === 'terminal'); tt.out += `\x1b[1m$ ${command}\x1b[0m\n`; S.cx.term.active = 'terminal'; }
  if (kind === 'tests') S.cx.tests = { running: true, out: '', command };
  S.cx.term.open = true; cxRenderTerm();
  const id = await api.code.run(S.cx.root, command, kind);
  S.cx.term.runs[id] = S.cx.term.runs[id] || { kind, running: true };
}

// ───────────────────────────── file viewer: Diff / File / Preview + editor ─────────────────────────────
async function cxLoadViewer(rel, tab = 'file', silent = false, line = null) {
  const prev = S.viewer && S.viewer.type === 'codefile' && S.viewer.rel === rel ? S.viewer : null;
  if (prev && prev.dirty && !silent && !confirm(t('cx_unsaved'))) return;
  const v = { type: 'codefile', rel, tab, line, loading: !silent };
  if (!silent) { S.viewer = v; renderViewer(); }
  try {
    const [file, diff] = await Promise.all([api.code.read(S.cx.root, rel).catch((e) => ({ error: cleanErr(e) })), api.code.diff(S.conv && S.conv.code ? S.conv.id : null, S.cx.root, rel).catch(() => null)]);
    Object.assign(v, { file, diff, loading: false, text: file && file.content });
    if (tab === 'preview') v.url = await api.code.preview(S.cx.root, rel);
  } catch (e) { v.error = cleanErr(e); v.loading = false; }
  if (silent && prev) { v.tab = prev.tab; v.url = prev.url; }
  if (S.viewer && S.viewer.type === 'codefile' && S.viewer.rel === rel) { S.viewer = v; renderViewer(); }
  if (S.mode === 'code') cxRenderTree();
}
function codeFileView() {
  const v = S.viewer;
  const isHtml = /\.html?$/i.test(v.rel);
  const tabs = [['diff', 'diff', t('cx_diff')], ['file', 'fileCode', t('cx_file')], ...(isHtml || S.cx.devUrl ? [['preview', 'eye', t('cx_preview')]] : [])];
  let body = '';
  if (v.loading) body = `<div class="cx-loading">${spinner(22)}</div>`;
  else if (v.tab === 'diff') body = cxDiffHtml(v.diff);
  else if (v.tab === 'preview') body = `<iframe class="art-frame cx-prev" sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups" src="${esc(v.url || S.cx.devUrl || '')}"></iframe>`;
  else if (v.file && (v.file.binary || v.file.tooBig)) body = `<div class="cx-empty">${icon('file', 22)}<p>${esc(t(v.file.binary ? 'cx_binary' : 'cx_tooBig'))}</p></div>`;
  else if (v.file && v.file.error) body = `<div class="cx-empty">${icon('warning', 22)}<p>${esc(v.file.error)}</p></div>`;
  else body = `<div class="cx-editor" id="cx-editor"><div class="cx-gutter" id="cx-gutter"></div><div class="cx-ed-wrap"><pre class="cx-hl" id="cx-hl" aria-hidden="true"><code class="hljs"></code></pre><textarea id="cx-ta" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off"></textarea></div></div>`;
  const d = v.diff; const counts = d ? cxDiffCount(d) : null;
  return `<div class="v-head"><span class="ah-ico">${icon(cxFileIcon(v.rel), 16)}</span><span class="v-title" title="${esc(v.rel)}">${esc(cxBase(v.rel))}${v.dirty ? ' •' : ''}</span>
      ${counts && (counts.add || counts.del) ? `<span class="cx-cnt"><b class="add">+${counts.add}</b><b class="del">−${counts.del}</b></span>` : ''}
      <div class="v-tools"><div class="seg sm">${tabs.map(([k, ic, l]) => `<button class="${v.tab === k ? 'on' : ''}" data-action="cx-vtab" data-tab="${k}">${icon(ic, 13)} ${esc(l)}</button>`).join('')}</div>
      ${v.tab === 'file' && v.dirty ? `<button class="btn sm primary" data-action="cx-save">${esc(t('save'))}</button>` : ''}
      <button class="icon-btn sm" data-action="reveal-path" data-path="${esc((S.cx.root || '') + cxSep() + v.rel)}" title="${esc(t('ag_reveal'))}">${icon('folder', 15)}</button>
      <button class="icon-btn sm" data-action="viewer-close" title="${esc(t('close'))}">${icon('x', 17)}</button></div></div>
    <div class="cx-path">${esc(v.rel)}</div>
    <div class="v-body cx-vbody">${body}</div>`;
}
function afterCodeFile() {
  const v = S.viewer; const ta = $('#cx-ta'); if (!ta) return;
  ta.value = v.text ?? '';
  const hl = $('#cx-hl code'), gut = $('#cx-gutter'), lang = cxLang(v.rel);
  const paint = () => {
    const txt = ta.value;
    hl.innerHTML = (txt.length < 400000 ? highlight(txt, lang) : esc(txt)) + '\n';
    const n = txt.split('\n').length;
    if (gut.childElementCount !== n) gut.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('');
  };
  const sync = () => { hl.parentElement.scrollTop = ta.scrollTop; hl.parentElement.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  paint();
  ta.addEventListener('input', () => { v.text = ta.value; if (!v.dirty) { v.dirty = true; const h = $('.v-title'); if (h) h.textContent += ' •'; const tools = $('.v-tools .seg'); if (tools && !$('[data-action=cx-save]')) tools.insertAdjacentHTML('afterend', `<button class="btn sm primary" data-action="cx-save">${esc(t('save'))}</button>`); } paint(); sync(); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); actions['cx-save'](); }
    if (e.key === 'Tab' && !e.ctrlKey) { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.setRangeText('  ', s, en, 'end'); ta.dispatchEvent(new Event('input')); }
  });
  if (v.line) { const lh = 20; ta.scrollTop = Math.max(0, (v.line - 5) * lh); sync(); const pos = ta.value.split('\n').slice(0, v.line - 1).join('\n').length + 1; ta.focus(); ta.setSelectionRange(pos, pos); v.line = null; }
}

// Line diff (Myers), shown as unified hunks with 3 lines of context.
function cxDiffOps(a, b) {
  const A = a === '' ? [] : a.split('\n'), B = b === '' ? [] : b.split('\n');
  const N = A.length, M = B.length, max = N + M;
  if (N * M > 25e6) return [...A.map((l) => ['-', l]), ...B.map((l) => ['+', l])];
  const V = new Int32Array(2 * max + 2); const trace = [];
  let found = false;
  for (let D = 0; D <= max && !found; D++) {
    trace.push(V.slice());
    for (let k = -D; k <= D; k += 2) {
      let x = (k === -D || (k !== D && V[k - 1 + max] < V[k + 1 + max])) ? V[k + 1 + max] : V[k - 1 + max] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      V[k + max] = x;
      if (x >= N && y >= M) { found = true; break; }
    }
  }
  const ops = []; let x = N, y = M;
  for (let D = trace.length - 1; D >= 0; D--) {
    const Vd = trace[D]; const k = x - y;
    const prevK = (k === -D || (k !== D && Vd[k - 1 + max] < Vd[k + 1 + max])) ? k + 1 : k - 1;
    const px = Vd[prevK + max], py = px - prevK;
    while (x > px && y > py) { ops.push([' ', A[x - 1]]); x--; y--; }
    if (D > 0) { if (x === px) ops.push(['+', B[y - 1]]); else ops.push(['-', A[x - 1]]); }
    x = px; y = py;
  }
  return ops.reverse();
}
function cxDiffCount(d) { const ops = d._ops || (d._ops = cxDiffOps(d.before || '', d.after || '')); return { add: ops.filter((o) => o[0] === '+').length, del: ops.filter((o) => o[0] === '-').length }; }
function cxDiffHtml(d) {
  if (!d) return `<div class="cx-empty"><p>${esc(t('cx_noDiff'))}</p></div>`;
  const ops = d._ops || (d._ops = cxDiffOps(d.before || '', d.after || ''));
  if (!ops.some((o) => o[0] !== ' ')) return `<div class="cx-empty">${icon('done', 22)}<p>${esc(t('cx_noChanges'))}</p></div>`;
  const lang = cxLang(d.path);
  let a = 0, b = 0; const rows = ops.map(([k, l]) => { if (k !== '+') a++; if (k !== '-') b++; return { k, l, a: k === '+' ? '' : a, b: k === '-' ? '' : b }; });
  const keep = new Set(); rows.forEach((r, i) => { if (r.k !== ' ') for (let j = Math.max(0, i - 3); j <= Math.min(rows.length - 1, i + 3); j++) keep.add(j); });
  let html = '', gap = false;
  rows.forEach((r, i) => {
    if (!keep.has(i)) { if (!gap) { html += `<div class="dl-gap">⋯</div>`; gap = true; } return; }
    gap = false;
    const code = lang && r.l.length < 2000 ? highlight(r.l, lang) : esc(r.l);
    html += `<div class="dl ${r.k === '+' ? 'ins' : r.k === '-' ? 'rem' : ''}"><span class="ln">${r.a}</span><span class="ln">${r.b}</span><span class="sg">${r.k === ' ' ? '' : r.k}</span><code>${code || ' '}</code></div>`;
  });
  return `<div class="cx-diff hljs">${d.source ? `<div class="cx-dsrc">${esc(t('cx_dsrc_' + d.source))}</div>` : ''}${html}</div>`;
}

// ───────────────────────────── chat integration ─────────────────────────────
// Modified-file card for write/edit steps in Code mode (path, +/−, opens the diff).
function cxFileCard(st) {
  const v = st.view || {}; const rel = v.rel || cxRel(v.path);
  return `<button class="cx-fcard" data-action="cx-file" data-rel="${esc(rel)}" data-tab="diff">${icon(cxFileIcon(rel), 15)}<span class="cx-fpath"><b>${esc(cxBase(rel))}</b><small>${esc(rel)}</small></span>${v.created ? `<em class="gb add">${esc(t('cx_new'))}</em>` : ''}<b class="add">+${v.add || 0}</b><b class="del">−${v.del || 0}</b>${icon('right', 13)}</button>`;
}
// End-of-turn card: files changed by this answer + undo.
function cxTurnCard(m) {
  const cp = m.checkpoint; if (!cp || !cp.files || !cp.files.length || m.pending) return '';
  return `<div class="cx-turn ${cp.reverted ? 'reverted' : ''}">${icon('diff', 15)}<span>${esc(t(cp.reverted ? 'cx_turnReverted' : 'cx_turnFiles', { n: cp.files.length }))}</span>
    <span class="cx-turn-files">${cp.files.slice(0, 6).map((f) => `<button class="link" data-action="cx-file" data-rel="${esc(cxRel(f))}" data-tab="diff">${esc(cxBase(f))}</button>`).join('')}${cp.files.length > 6 ? ` +${cp.files.length - 6}` : ''}</span>
    <span class="grow"></span>${cp.reverted ? '' : `<button class="btn sm" data-action="cx-revert" data-id="${esc(m.id)}">${icon('retry', 13)} ${esc(t('cx_undo'))}</button>`}</div>`;
}
function cxPermChip() {
  const ps = (S.cx.info && S.cx.info.settings) || {}; const mode = ps.mode || 'edits';
  return `<button class="c-chip ${mode === 'auto' ? 'warn' : ''}" data-action="cx-perm-menu" title="${esc(t('cx_permTitle'))}">${icon(mode === 'ask' ? 'shield' : mode === 'auto' ? 'zap' : 'edit', 14)}<span>${esc(t('cx_perm_' + mode))}</span></button>`;
}
function cxMeta() {
  if (!S.conv || !S.conv.code) return null;
  return { root: S.conv.code.root, mode: ((S.cx.info && S.cx.info.settings) || {}).mode || 'edits', branch: S.cx.git && S.cx.git.branch };
}

// ───────────────────────────── actions ─────────────────────────────
Object.assign(actions, {
  'cx-open': async () => { const i = await api.code.open(); if (!i) return; S.cx.recent = null; await cxOpen(i.root); S.conv = null; vt(() => { renderSidebar(); renderView(); }); },
  'cx-open-recent': async (el) => { if (await cxOpen(el.dataset.root)) { S.conv = null; vt(() => { renderSidebar(); renderView(); }); } },
  'cx-switch': (el) => {
    const r = el.getBoundingClientRect(); const rec = (S.cx.recent || []).filter((x) => x.root !== S.cx.root);
    if (!S.cx.recent) api.code.recent().then((x) => { S.cx.recent = x; });
    $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div><div class="popover" style="left:${r.left}px;top:${r.bottom + 6}px;min-width:260px">
      ${rec.slice(0, 8).map((x) => `<button class="pm-item" data-action="cx-open-recent" data-root="${esc(x.root)}">${icon('folder', 16)}<span class="pm-text"><b>${esc(x.name)}</b><small>${esc(x.root)}</small></span></button>`).join('')}
      ${rec.length ? '<div class="pm-sep"></div>' : ''}
      <button class="pm-item" data-action="cx-open">${icon('folderOpen', 16)}<span class="pm-text"><b>${esc(t('cx_openFolder'))}</b></span></button>
      <button class="pm-item" data-action="cx-close">${icon('x', 16)}<span class="pm-text"><b>${esc(t('cx_closeProject'))}</b></span></button></div>`;
  },
  'cx-close': async () => { closePopover(); S.cx.root = null; S.cx.info = null; S.conv = null; S.cx.recent = null; await api.code.close(); if (S.viewer && S.viewer.type === 'codefile') closeViewer(); renderSidebar(); renderView(); },
  'cx-refresh': () => cxRefresh(),
  'cx-dir': async (el) => { const rel = el.dataset.rel; if (S.cx.expanded.has(rel)) S.cx.expanded.delete(rel); else { S.cx.expanded.add(rel); if (!S.cx.dirs.has(rel)) await cxLoadDir(rel); } cxRenderTree(); },
  'cx-file': (el, e) => { if (e && e.target.closest('[data-action=cx-discard]')) return; closePopover(); cxLoadViewer(el.dataset.rel, el.dataset.tab || 'file', false, el.dataset.line ? +el.dataset.line : null); },
  'cx-vtab': async (el) => { const v = S.viewer; v.tab = el.dataset.tab; if (v.tab === 'preview' && !v.url) v.url = /\.html?$/i.test(v.rel) ? await api.code.preview(S.cx.root, v.rel) : S.cx.devUrl; renderViewer(); },
  'cx-save': async () => { const v = S.viewer; if (!v || v.type !== 'codefile') return; try { await api.code.write(S.cx.root, v.rel, v.text); v.dirty = false; toast(t('cx_saved')); cxLoadViewer(v.rel, v.tab, true); } catch (e) { toast(cleanErr(e), 'err'); } },
  'cx-discard': async (el) => { if (!confirm(t('cx_discardConfirm', { f: el.dataset.rel }))) return; try { S.cx.git = await api.code.git(S.cx.root, 'discard', el.dataset.rel); cxRefresh(); } catch (e) { toast(cleanErr(e), 'err'); } },
  'cx-git-init': async () => { try { S.cx.git = await api.code.git(S.cx.root, 'init'); cxRenderTree(); } catch (e) { toast(cleanErr(e), 'err'); } },
  'cx-branch': async (el) => {
    const r = el.getBoundingClientRect(); const list = await api.code.branches(S.cx.root);
    $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div><div class="popover" style="left:${r.left}px;bottom:${innerHeight - r.top + 6}px;min-width:240px">
      ${list.map((b) => `<button class="pm-item ${b === S.cx.git.branch ? 'sel' : ''}" data-action="cx-switch-branch" data-b="${esc(b)}">${icon('git', 15)}<span class="pm-text"><b>${esc(b)}</b></span>${b === S.cx.git.branch ? icon('check', 14) : ''}</button>`).join('')}
      <div class="pm-sep"></div><form class="pm-form" data-form="cx-new-branch"><input class="input sm2" name="b" placeholder="${esc(t('cx_newBranch'))}" autocomplete="off"></form></div>`;
    $('#popover-root input').focus();
  },
  'cx-switch-branch': async (el) => { closePopover(); try { S.cx.git = await api.code.git(S.cx.root, 'switch', el.dataset.b); await cxRefresh(); toast(t('cx_onBranch', { b: el.dataset.b })); } catch (e) { toast(cleanErr(e), 'err'); } },
  'cx-log': async (el) => {
    const r = el.getBoundingClientRect(); const log = await api.code.log(S.cx.root);
    $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div><div class="popover cx-logpop" style="left:${r.left}px;bottom:${innerHeight - r.top + 6}px;width:360px">
      ${log.length ? log.map((c, i) => `<div class="cx-commitrow">${icon('commit', 14)}<span><b>${esc(c.subject)}</b><small>${esc(c.hash)} · ${esc(c.author)} · ${esc(c.when)}</small></span>${i === 0 ? `<button class="btn sm" data-action="cx-undo-commit" title="${esc(t('cx_undoCommitHint'))}">${esc(t('cx_undoCommit'))}</button>` : ''}</div>`).join('') : `<div class="pm-empty">${esc(t('cx_noCommits'))}</div>`}</div>`;
  },
  'cx-undo-commit': async () => { closePopover(); if (!confirm(t('cx_undoCommitConfirm'))) return; try { S.cx.git = await api.code.git(S.cx.root, 'undoCommit'); cxRefresh(); toast(t('cx_commitUndone')); } catch (e) { toast(cleanErr(e), 'err'); } },
  'cx-term-tab': (el, e) => { e && e.stopPropagation(); S.cx.term.active = el.dataset.tab; S.cx.term.open = true; cxRenderTerm(); },
  'cx-term-toggle': (el, e) => { e && e.stopPropagation(); S.cx.term.open = !S.cx.term.open; cxRenderTerm(); },
  'cx-term-toggle-head': (el, e) => { if (e.target.closest('button')) return; if (!S.cx.term.open) { S.cx.term.open = true; cxRenderTerm(); } },
  'cx-term-clear': () => { const T = S.cx.term; if (T.active === 'terminal') T.tabs[0].out = ''; else if (T.active === 'tests') S.cx.tests = null; else S.cx.problems = []; cxRenderTerm(); },
  'cx-kill': async () => { for (const [id, r] of Object.entries(S.cx.term.runs)) if (r.running) await api.code.kill(id); },
  'cx-run-tests': () => { const c = (S.cx.info.commands || {}).test; if (c) cxRunCmd(c, 'tests'); },
  'cx-run-lint': () => { const c = (S.cx.info.commands || {}).lint; if (c) { S.cx.term.active = 'problems'; cxRunCmd(c, 'lint'); } },
  'cx-preview-url': () => { const v = S.viewer && S.viewer.type === 'codefile' ? S.viewer : null; if (v) { v.tab = 'preview'; v.url = S.cx.devUrl; renderViewer(); } else { S.viewer = { type: 'codefile', rel: '', tab: 'preview', url: S.cx.devUrl, diff: null, file: null }; renderViewer(); } },
  'cx-suggest': (el) => sendPrompt(t(el.dataset.k + '_p')),
  'cx-instr-create': async () => { const f = 'FABRO.md'; await api.code.write(S.cx.root, f, t('cx_instrTemplate', { p: S.cx.info.name })); S.cx.info = await api.code.info(S.cx.root); renderView(); cxLoadViewer(f, 'file'); },
  'cx-revert': async (el) => {
    const m = S.conv.messages.find((x) => x.id === el.dataset.id); if (!m || !m.checkpoint) return;
    if (!confirm(t('cx_undoConfirm', { n: m.checkpoint.files.length }))) return;
    try {
      await api.code.revert(S.conv.id, m.checkpoint.id);
      const i = S.conv.messages.indexOf(m);
      for (const x of S.conv.messages.slice(i)) if (x.checkpoint) x.checkpoint.reverted = true;
      persist(); renderView(); toast(t('cx_reverted')); cxRefresh();
    } catch (e) { toast(cleanErr(e), 'err'); }
  },
  'cx-perm-menu': (el) => {
    const r = el.getBoundingClientRect(); const cur = ((S.cx.info && S.cx.info.settings) || {}).mode || 'edits';
    $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div><div class="popover" style="left:${r.left}px;bottom:${innerHeight - r.top + 8}px;width:320px">
      ${['ask', 'edits', 'auto'].map((k) => `<button class="pm-item ${cur === k ? 'sel' : ''}" data-action="cx-perm" data-v="${k}">${icon(k === 'ask' ? 'shield' : k === 'auto' ? 'zap' : 'edit', 16)}<span class="pm-text"><b>${esc(t('cx_perm_' + k))}</b><small>${esc(t('cx_permH_' + k))}</small></span>${cur === k ? icon('check', 15) : ''}</button>`).join('')}
      ${((S.cx.info.settings || {}).allow || []).length ? `<div class="pm-sep"></div><button class="pm-item" data-action="cx-perm-reset">${icon('retry', 15)}<span class="pm-text"><b>${esc(t('cx_permReset'))}</b><small>${esc((S.cx.info.settings.allow || []).join(', '))}</small></span></button>` : ''}</div>`;
  },
  'cx-perm': async (el) => { closePopover(); S.cx.info.settings = await api.code.project(S.cx.root, { mode: el.dataset.v }); refreshComposer(); },
  'cx-perm-reset': async () => { closePopover(); S.cx.info.settings = await api.code.project(S.cx.root, { allow: [] }); toast(t('cx_permResetDone')); },
  'cx-get-coder': () => { openSettings('models'); setTimeout(() => { const b = $('[data-action=dl-catalog][data-id="qwen3-coder-30b"]') || $('[data-action=dl-catalog][data-id="qwen2.5-coder-7b"]'); if (b) b.scrollIntoView({ block: 'center' }); }, 400); },
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form^="cx-"]'); if (!f) return;
  e.preventDefault();
  const k = f.dataset.form;
  if (k === 'cx-cmd') { const c = f.c.value.trim(); if (!c) return; S.cx.cmdHist.push(c); S.cx.hi = null; f.c.value = ''; cxRunCmd(c); }
  if (k === 'cx-commit') { const m = f.m.value.trim(); if (!m) { f.m.focus(); return; } try { S.cx.git = await api.code.git(S.cx.root, 'commit', m); toast(t('cx_committed')); cxRefresh(); } catch (er) { toast(cleanErr(er), 'err'); } }
  if (k === 'cx-new-branch') { const b = f.b.value.trim().replace(/\s+/g, '-'); if (!b) return; closePopover(); try { S.cx.git = await api.code.git(S.cx.root, 'switch', b); cxRefresh(); toast(t('cx_onBranch', { b })); } catch (er) { toast(cleanErr(er), 'err'); } }
});
