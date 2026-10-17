'use strict';
/* Fabro — renderer. Plain JS, no framework. */
// `api` is the global exposed by preload.js (contextBridge).

// ───────────────────────────── State ─────────────────────────────
const S = {
  info: null, settings: null, specs: null,
  lang: 'en',
  convs: [], conv: null,
  mode: 'chat',
  engine: { status: 'idle' },
  installed: { local: [], downloads: [] },
  provModels: [],          // models from external providers (when enabled)
  prov: null,              // providers view { enabled, presets, list }
  detect: null,            // { ollama, lmstudio } one-click detection
  catalog: null,
  downloads: {},           // id -> progress
  pending: [],             // attachments for next message
  streaming: null,         // { reqId, msg }
  code: new Map(),         // code card registry
  viewer: null,            // { type, ... }
  settingsTab: null,       // open settings tab or null
  search: { q: '', results: null, loading: false, repo: null, files: null },
  updater: { state: 'idle' },
  hist: [], histIdx: -1, sbQuery: '', moreOpen: false,
};

const MODES = [            // workspaces (top toggle). Agent is automatic inside Chat.
  { id: 'chat', icon: 'chat' },
  { id: 'code', icon: 'code' },
];
const PAGES = [            // sidebar destinations
  { id: 'projects', icon: 'folder' },
  { id: 'artifacts', icon: 'shapes' },
  { id: 'tasks', icon: 'tasks' },
  { id: 'custom', icon: 'brush' },
];
const pageIcon = (id) => (MODES.find((m) => m.id === id) || PAGES.find((m) => m.id === id) || { icon: 'chat' }).icon;
const LANGS = { en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch' };

// ───────────────────────────── Utils ─────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtBytes = (b) => { if (!b && b !== 0) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b.toFixed(b < 10 && i > 1 ? 1 : 0)} ${u[i]}`; };
const fmtNum = (n) => n == null ? '—' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function t(key, vars) {
  const d = I18N[S.lang] || I18N.en;
  let s = d[key] ?? I18N.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

async function saveSettings(patch) {
  S.settings = await api.settings.set(patch);
}

function resolveLang() {
  const pref = S.settings.language;
  if (pref && pref !== 'auto' && I18N[pref]) return pref;
  const sys = [...(S.info.systemLanguages || []), S.info.locale || '', navigator.language || ''];
  for (const l of sys) { const c = String(l).slice(0, 2).toLowerCase(); if (I18N[c]) return c; }
  return 'en';
}

function applyDevMode() {
  const on = !!S.settings.devMode;
  document.body.classList.toggle('dev', on);
  const b = $('#dev-banner');
  b.hidden = !on;
  if (on) b.innerHTML = `${icon('warning', 14)}<b>${esc(t('devBanner'))}</b><span>v${esc(S.info.version)}-dev · ${esc(S.info.platform)}</span>`;
}

function applyTheme() {
  const th = S.settings.theme;
  const dark = th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  api.win.theme(dark);
}

// ───────────────────────────── Markdown ─────────────────────────────
const LANG_NAMES = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python', lua: 'Lua', luau: 'Luau', html: 'HTML', css: 'CSS', json: 'JSON', bash: 'Bash', sh: 'Shell', shell: 'Shell', powershell: 'PowerShell', c: 'C', cpp: 'C++', cs: 'C#', csharp: 'C#', java: 'Java', go: 'Go', rust: 'Rust', rs: 'Rust', php: 'PHP', ruby: 'Ruby', sql: 'SQL', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', xml: 'XML', kotlin: 'Kotlin', swift: 'Swift', text: 'Text', plaintext: 'Text' };
const langName = (l) => LANG_NAMES[(l || '').toLowerCase()] || (l ? l[0].toUpperCase() + l.slice(1) : t('code'));
let MD_CTX = { prefix: 'x', n: 0 };

function highlight(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    if (code.length < 20000) return hljs.highlightAuto(code).value;
  } catch { /* fall through */ }
  return esc(code);
}

marked.use({
  gfm: true, breaks: false,
  renderer: {
    code(tok, infoArg) {
      const text = typeof tok === 'object' ? tok.text : tok;
      const lang = ((typeof tok === 'object' ? tok.lang : infoArg) || '').split(/\s+/)[0];
      const key = `${MD_CTX.prefix}:${MD_CTX.n++}`;
      S.code.set(key, { code: text, lang });
      const lines = text.split('\n').length;
      const long = lines > 14;
      return `<div class="code-card${long ? ' collapsed' : ''}" data-key="${key}">
        <div class="cc-head">
          <span class="cc-badge">${icon('code', 14)}</span>
          <span class="cc-lang">${esc(langName(lang))}</span>
          <span class="cc-lines">${t('lines', { n: lines })}</span>
          <span class="cc-actions">
            <button class="icon-btn sm" data-action="code-copy" title="${esc(t('copy'))}">${icon('copy', 15)}</button>
            ${/^(html?|svg)$/i.test(lang) ? `<button class="icon-btn sm" data-action="code-preview" title="${esc(t('artPreview'))}">${icon('play', 15)}</button>` : ''}
            ${lines > 12 ? `<button class="icon-btn sm" data-action="code-keep" title="${esc(t('artKeep'))}">${icon('shapes', 15)}</button>` : ''}
            <button class="icon-btn sm" data-action="code-open" title="${esc(t('openViewer'))}">${icon('expand', 15)}</button>
          </span>
        </div>
        <pre class="cc-body"><code class="hljs">${highlight(text, lang)}</code></pre>
        ${long ? `<button class="cc-more" data-action="code-toggle"><span>${esc(t('showAll', { n: lines }))}</span>${icon('down', 14)}</button>` : ''}
      </div>`;
    },
    link(tok) {
      const href = tok.href || '', text = tok.text || href;
      return `<a href="${esc(href)}" data-action="ext-link" title="${esc(href)}">${esc(text)}</a>`;
    },
  },
});

let MD_CITES = null;
function md(text, prefix, opts) {
  MD_CTX = { prefix, n: 0 };
  const html = DOMPurify.sanitize(marked.parse(text || '', opts), { ADD_ATTR: ['data-action', 'data-key', 'target'] });
  return MD_CITES && !opts ? linkCitations(html, MD_CITES) : html;
}

// ───────────────────────────── Models helpers ─────────────────────────────
function allModels() {
  const l = S.installed.local.filter((m) => !m.role).map((m) => ({ ref: { backend: 'local', id: m.id }, label: m.name, sub: `${m.quant || 'GGUF'} · ${fmtBytes(m.sizeBytes)}`, vision: m.vision, src: 'local' }));
  const p = (S.provModels || []).map((m) => ({ ref: m.ref, label: m.label, sub: [m.providerName, m.params, m.quant].filter(Boolean).join(' · '), vision: m.vision, src: m.provider, provider: m.providerName, kind: m.kind, remote: !m.local }));
  return [...l, ...p];
}
const refKey = (r) => !r ? '' : r.backend === 'provider' ? `p:${r.provider}:${r.model}` : r.backend === 'local' ? `l:${r.id}` : `${r.backend}:${r.id || r.name}`;
const sameRef = (a, b) => !!a && !!b && refKey(a) === refKey(b);
function currentModel() {
  const list = allModels();
  return list.find((m) => sameRef(m.ref, S.settings.selectedModel)) || null;
}
async function refreshModels() {
  [S.installed, S.provModels] = await Promise.all([api.models.installed(), api.providers.models()]);
  for (const d of S.installed.downloads) S.downloads[d.id] = d;
  if (!currentModel()) {
    const first = allModels()[0];
    if (first) await saveSettings({ selectedModel: first.ref });
  }
}

// ───────────────────────────── Sidebar ─────────────────────────────
function engineLabel() {
  const eng = S.engine;
  return ({
    idle: t('engine_idle'), installing: t('engine_installing', { p: Math.round((eng.progress || 0) * 100) }),
    loading: t('engine_loading'), ready: t('engine_ready'), error: t('engine_error'), stopping: t('engine_idle'),
  })[eng.status] || eng.status;
}

function recentItem(c) {
  const active = S.conv && S.conv.id === c.id;
  const live = S.streaming && S.conv && S.conv.id === c.id;
  const badge = live ? '<span class="r-live" aria-label="En cours"></span>'
    : c.agent ? `<span class="r-ico" title="${esc(t('agentConv'))}">${icon('agentBadge', 15)}</span>`
    : c.hasArtifact ? `<span class="r-ico">${icon('file', 15)}</span>` : '';
  return `<div class="recent ${active ? 'active' : ''}" style="--i:${S.convs.indexOf(c)}" data-action="open-conv" data-id="${c.id}" title="${esc(c.title || t('untitled'))}">
      <span class="r-title">${esc(c.title || t('untitled'))}</span>
      <span class="r-tools">
        <button class="icon-btn xs" data-action="pin-conv" data-id="${c.id}" title="${esc(t(c.pinned ? 'unpin' : 'pin'))}">${icon('pin', 14)}</button>
        <button class="icon-btn xs" data-action="del-conv" data-id="${c.id}" title="${esc(t('delete'))}">${icon('x', 14)}</button>
      </span>
      ${badge}
    </div>`;
}

function renderRecents() {
  const el = $('#sb-lists');
  if (!el) return;
  const q = S.sbQuery.trim().toLowerCase();
  if (q && S.sbResults) return renderSearchResults(el);
  const list = S.convs.filter((c) => (S.mode === 'code' ? c.codeRoot && (!S.cx.root || c.codeRoot === S.cx.root) : !c.codeRoot) && (!q || (c.title || '').toLowerCase().includes(q)));
  const pinned = list.filter((c) => c.pinned), rest = list.filter((c) => !c.pinned);
  el.innerHTML = `
    ${pinned.length ? `<div class="sb-section"><span>${esc(t('pinned'))}</span></div>${pinned.map(recentItem).join('')}` : ''}
    ${rest.length ? `<div class="sb-section"><span>${esc(S.mode === 'code' && S.cx.root ? t('cx_sessions') : t('recents'))}</span><button class="icon-btn xs" data-action="noop" title="${esc(t('filter'))}">${icon('filter', 14)}</button></div>${rest.map(recentItem).join('')}` : ''}
    ${q && !list.length ? `<div class="sb-empty">${esc(t('noResults'))}</div>` : ''}`;
}

// Code mode with a file open on a narrow window: the app sidebar steps aside (like an IDE).
const sbAuto = () => S.mode === 'code' && !!S.viewer && S.viewer.type === 'codefile' && innerWidth < 1500;
const sbHidden = () => !!S.settings.sidebarCollapsed || (sbAuto() && !S.sbForce);
function renderSidebar() {
  const sb = $('#sidebar');
  const collapsed = sbHidden();
  $('#app').classList.toggle('sb-collapsed', collapsed);
  const installed = S.settings.installedModes || ['chat'];
  const eng = S.engine;
  const cm = currentModel();
  const ws = MODES.includes(MODES.find((m) => m.id === S.mode)) ? S.mode : 'chat';
  const name = userFirstName() || 'Fabro';

  const toggle = `<div class="ws-toggle" role="tablist" aria-label="${esc(t('workspace'))}">${MODES.map((m) =>
    `<button role="tab" aria-selected="${ws === m.id}" class="${ws === m.id ? 'on' : ''}" data-action="mode" data-mode="${m.id}" title="${esc(t('mode_' + m.id))}">${icon(m.icon, 16)}</button>`).join('')}</div>`;

  const pages = PAGES.map((p) => `<button class="nav-item ${S.mode === p.id ? 'active' : ''}" data-action="mode" data-mode="${p.id}" title="${esc(t('nav_' + p.id))}">
      ${icon(p.icon)}<span class="label">${esc(t('nav_' + p.id))}</span>${p.locked && !installed.includes(p.id) ? `<span class="lock">${icon('lock', 13)}</span>` : ''}</button>`).join('');

  const more = S.moreOpen ? `<div class="nav-sub">
      <button class="nav-item sub" data-action="settings" data-tab="models">${icon('box', 16)}<span class="label">${esc(t('tab_models'))}</span></button>
      <button class="nav-item sub" data-action="settings" data-tab="engine">${icon('zap', 16)}<span class="label">${esc(t('tab_engine'))}</span></button>
      <button class="nav-item sub" data-action="soon">${icon('cpu', 16)}<span class="label">${esc(t('nav_extensions'))}</span></button>
    </div>` : '';

  sb.innerHTML = `
    <div class="sb-top">
      <button class="icon-btn" data-action="toggle-sidebar" title="${esc(t(collapsed ? 'expandSidebar' : 'collapseSidebar'))}">${icon('panel')}</button>
      <button class="icon-btn hide-c" data-action="hist-back" ${S.histIdx > 0 ? '' : 'disabled'} title="${esc(t('back'))}">${icon('back', 17)}</button>
      <button class="icon-btn hide-c" data-action="hist-fwd" ${S.histIdx < S.hist.length - 1 ? '' : 'disabled'} title="${esc(t('forward'))}">${icon('forward', 17)}</button>
      <span class="grow hide-c"></span>
      <span class="hide-c">${toggle}</span>
    </div>
    <label class="sb-search hide-c">${icon('search', 16)}<input id="sb-q" type="search" placeholder="${esc(t('searchChats'))}" value="${esc(S.sbQuery)}" aria-label="${esc(t('searchChats'))}"><kbd>Ctrl K</kbd></label>
    <nav class="nav">
      <button class="nav-item new" data-action="new-chat" title="${esc(t('newChat'))}"><span class="nc-ico">${icon('plus', 15)}</span><span class="label">${esc(t(S.mode === 'code' && S.cx.root ? 'cx_newSession' : 'newChat'))}</span></button>
      ${pages}
      <button class="nav-item muted-item" data-action="toggle-more" aria-expanded="${S.moreOpen}">${icon(S.moreOpen ? 'down' : 'right', 16)}<span class="label">${esc(t('nav_more'))}</span></button>
      ${more}
    </nav>
    <div class="recents-wrap"><div class="recents" id="sb-lists"></div></div>
    <button class="sb-user" data-action="user-menu" title="${esc(cm ? cm.label + ' · ' + engineLabel() : t('noModelShort'))}">
      <span class="avatar">${esc((name[0] || 'F').toUpperCase())}${['loading', 'installing'].includes(eng.status) ? `<span class="av-spin">${spinner(18)}</span>` : `<span class="av-dot st-${eng.status}"></span>`}</span>
      <span class="label u-text"><b>${esc(name)}</b><small>${esc(cm ? cm.label : t('noModelShort'))} · ${esc(engineLabel())}</small></span>
      <span class="hide-c u-chev">${icon('down', 15)}</span>
    </button>`;
  renderRecents();
  const q = $('#sb-q');
  if (q) q.addEventListener('input', () => { S.sbQuery = q.value; renderRecents(); runSearch(); });
}

function openUserMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const th = S.settings.theme;
  $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
    <div class="popover" style="left:${r.left}px; bottom:${innerHeight - r.top + 8}px; min-width:${Math.max(240, r.width)}px">
      <button class="pm-item" data-action="settings" data-tab="general">${icon('settings', 16)}<span class="pm-text"><b>${esc(t('settings'))}</b></span><kbd>Ctrl ,</kbd></button>
      <button class="pm-item" data-action="settings" data-tab="models">${icon('box', 16)}<span class="pm-text"><b>${esc(t('manageModels'))}</b></span></button>
      <button class="pm-item" data-action="set" data-key="theme" data-value="${th === 'dark' ? 'light' : 'dark'}">${icon(th === 'dark' ? 'sun' : 'moon', 16)}<span class="pm-text"><b>${esc(t(th === 'dark' ? 'themeLight' : 'themeDark'))}</b></span></button>
      <div class="pm-sep"></div>
      <button class="pm-item" data-action="settings" data-tab="about">${icon('info', 16)}<span class="pm-text"><b>${esc(t('tab_about'))}</b></span></button>
    </div>`;
}

function navTo(mode, convId, push = true) {
  if (push) {
    S.hist = S.hist.slice(0, S.histIdx + 1);
    const last = S.hist[S.hist.length - 1];
    if (!last || last.mode !== mode || last.convId !== convId) { S.hist.push({ mode, convId }); S.histIdx = S.hist.length - 1; }
  }
}

// ───────────────────────────── Topbar ─────────────────────────────
function renderTopbar() {
  const title = S.mode === 'chat' ? (S.conv && S.conv.messages.length ? S.conv.title || t('untitled') : '')
    : S.mode === 'code' ? (S.cx.root ? `${S.cx.info ? S.cx.info.name : ''}${S.conv && S.conv.messages.length ? ' · ' + (S.conv.title || t('untitled')) : ''}` : t('mode_code')) : t('nav_' + S.mode);
  $('#topbar').innerHTML = `
    <div class="tb-left">
      ${S.settings.sidebarCollapsed ? '' : ''}
      <span class="tb-title">${esc(title)}</span>
      ${S.mode === 'chat' && S.conv && S.conv.agent ? `<button class="chip agent-chip" data-action="open-workspace" title="${esc(t('ws_title'))}">${icon('agent', 13)} ${esc(t('agentBadge'))}</button>` : ''}
      ${S.mode === 'chat' && S.conv && S.conv.project ? `<button class="chip prj-chip" data-action="open-project" data-id="${esc(S.conv.project)}">${icon('folder', 13)} ${esc(((S.prj.list || []).find((p) => p.id === S.conv.project) || S.prj.current || {}).name || t('nav_projects'))}</button>` : ''}
      ${S.mode === 'chat' && ((S.conv && S.conv.ephemeral) || (!S.conv && S.ephemeralNext)) ? `<span class="chip ghost-chip">${icon('eyeOff', 13)} ${esc(t('ephemeralBadge'))}</span>` : ''}
    </div>
    <div class="tb-right">
      ${S.updater.state === 'ready' ? `<button class="chip accent upd-chip" data-action="upd-open">${icon('download', 14)} ${esc(t('restartToUpdate'))}</button>` : ''}
      ${S.mode === 'chat' && S.conv && S.conv.agent ? `<button class="icon-btn ${S.spOpen !== false ? 'on' : ''}" data-action="sp-toggle" title="${esc(t('sp_title'))}">${icon('plan', 18)}</button>` : ''}
      ${sbHidden() ? `<button class="icon-btn" data-action="toggle-sidebar" title="${esc(t('expandSidebar'))}">${icon('panel', 19)}</button>` : ''}
    </div>`;
  if (typeof renderSessionPanel === 'function') renderSessionPanel();
}

// ───────────────────────────── Update dialog ─────────────────────────────
// Shown once per downloaded version; "Later" leaves the topbar chip and installs on quit.
function maybeShowUpdate() {
  const v = S.updater.version || '';
  let seen = ''; try { seen = localStorage.getItem('fabro.updSeen') || ''; } catch {}
  if (seen === v) return;
  try { localStorage.setItem('fabro.updSeen', v); } catch {}
  openUpdateDialog();
}
function openUpdateDialog() {
  const u = S.updater;
  const notes = u.notes ? DOMPurify.sanitize(u.notes, { FORBID_TAGS: ['img', 'style', 'iframe', 'form'], FORBID_ATTR: ['style'] }) : '';
  const date = u.date ? new Date(u.date).toLocaleDateString(S.lang, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="upd-later"></div>
    <div class="modal upd" role="dialog" aria-modal="true" aria-labelledby="upd-title">
      <div class="upd-hero">${logo(46, 'upd-logo')}<div><h2 id="upd-title">${esc(t('upd_title', { v: u.version || '' }))}</h2>
        <small>v${esc(S.info.version)} → v${esc(u.version || '')}${date ? ' · ' + esc(date) : ''}</small></div></div>
      <div class="upd-notes md">${notes || `<p class="muted">${esc(t('upd_noNotes'))}</p>`}</div>
      <p class="upd-hint">${icon('info', 14)} ${esc(t('upd_hint'))}</p>
      <div class="modal-actions">
        <button class="btn" data-action="upd-later">${esc(t('upd_later'))}</button>
        <button class="btn primary" data-action="install-update">${icon('refresh', 15)} ${esc(t('upd_restart'))}</button>
      </div>
    </div>`;
  const m = $('#modal-root .modal'); m.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  m.querySelector('.btn.primary').focus();
}
function closeModal() { const r = $('#modal-root'); const m = r.querySelector('.modal'); if (!m) return; r.classList.add('closing'); setTimeout(() => { r.innerHTML = ''; r.classList.remove('closing'); }, 180); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal-root .modal')) { e.stopPropagation(); closeModal(); } }, true);

// ───────────────────────────── Views ─────────────────────────────
// Animated view swap (View Transitions API, falls back to an instant swap).
function vt(fn, opts) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce || document.hidden) { fn(); return null; }
  if (opts && opts.kind) document.documentElement.dataset.vt = opts.kind;
  const t = document.startViewTransition(fn);
  // A skipped transition (window hidden, tray) rejects these promises: that is not an error.
  t.ready.catch(() => {}); t.updateCallbackDone.catch(() => {});
  t.finished.catch(() => {}).finally(() => { delete document.documentElement.dataset.vt; });
  return t;
}

function renderView() {
  renderTopbar();
  reportQuick();
  const v = $('#view');
  if (S.mode === 'code') {
    v.className = 'view code-view' + (S.cx.root ? '' : ' cx-none');
    v.innerHTML = renderCodeView();
    afterCodeRender();
    return;
  }
  if (S.mode !== 'chat') {
    v.className = 'view';
    v.innerHTML = S.mode === 'custom' ? renderCustomPage() : S.mode === 'artifacts' && typeof renderArtifactsPage === 'function' ? renderArtifactsPage() : S.mode === 'projects' ? renderProjectsPage() : renderSoon(S.mode);
    if (S.mode === 'custom') bindCustomPage();
    if (S.mode === 'projects') afterProjectsRender();
    return;
  }
  const empty = !S.conv || !S.conv.messages.length;
  v.className = 'view ' + (empty ? 'is-welcome' : 'is-thread');
  if (empty) {
    v.innerHTML = renderWelcome();
  } else {
    v.innerHTML = `<div class="scroller" id="scroller"><div class="thread">${S.conv.messages.map(renderMessage).join('')}</div></div>
      <div class="dock">${renderComposer()}<div class="disclaimer">${esc(t('disclaimer'))}</div></div>`;
    scrollBottom(true);
  }
  bindComposer();
}

// Picked once per (language, name, hour) so it doesn't flicker on re-render.
let _greet = { key: '', text: '' };
function userFirstName() { return (S.settings.userName || '').trim() || prettyName(S.info.userName); }
function greeting() {
  const name = userFirstName(), d = new Date();
  const key = `${S.lang}|${name}|${d.toDateString()}|${d.getHours()}`;
  if (_greet.key !== key) _greet = { key, text: pickGreeting(S.lang, name, d) };
  return _greet.text;
}

function renderWelcome() {
  const models = allModels();
  const setup = !models.length ? renderSetupCard() : '';
  const chips = ['sugg_explain', 'sugg_write', 'sugg_code', 'sugg_plan'].map((k, i) =>
    `<button class="sugg" style="--i:${i}" data-action="suggest" data-text="${esc(t(k + '_prompt'))}">${esc(t(k))}</button>`).join('');
  return `<div class="welcome">
    <h1 class="greet">${logo(42, 'hero-spin')}<span>${esc(greeting())}</span></h1>
    ${setup}
    ${renderComposer()}
    ${models.length ? `<div class="suggestions">${chips}</div>` : ''}
  </div>`;
}

function renderSetupCard() {
  const cat = S.catalog;
  if (!cat) return `<div class="setup-card loading">${esc(t('detecting'))}</div>`;
  const rec = cat.items.find((m) => m.id === cat.recommended);
  const sp = cat.specs;
  const gpu = sp.gpus[0];
  const hw = [gpu ? `${gpu.name}${gpu.vramGB ? ` · ${gpu.vramGB} GB` : ''}` : t('noGpu'), `${sp.ramGB} GB RAM`].join(' · ');
  const dl = rec && Object.values(S.downloads).find((d) => d.repo === rec.repo && d.status === 'downloading');
  return `<div class="setup-card">
    <div class="sc-row">
      <div class="sc-ico">${icon('cpu', 20)}</div>
      <div class="sc-text">
        <div class="sc-title">${esc(t('setupTitle'))}</div>
        <div class="sc-sub">${esc(hw)}</div>
        ${sp.gpuNote === 'gpu-too-small' ? `<div class="sc-note">${icon('info', 14)} ${esc(t('gpuTooSmall'))}</div>` : sp.accel === 'cpu' ? `<div class="sc-note">${icon('cpu', 14)} ${esc(t('cpuOnlyNote'))}</div>` : ''}
      </div>
    </div>
    ${rec ? `<div class="sc-model">
      <div><div class="sc-name">${esc(rec.name)} <span class="fit fit-${rec.fit}">${esc(t('fit_' + rec.fit))}</span></div>
      <div class="sc-meta">${esc(rec.by)} · ${esc(rec.params)} · ≈ ${rec.sizeGB} GB</div></div>
      ${dl ? renderProgress(dl) : `<button class="btn primary" data-action="dl-catalog" data-id="${rec.id}">${icon('download', 16)} ${esc(t('downloadStart'))}</button>`}
    </div>` : `<div class="sc-model"><span class="muted">${esc(t('noFitModel'))}</span></div>`}
    ${S.engine.status === 'error' ? errorCard({ code: S.engine.errorCode, message: S.engine.error, detail: S.engine.errorDetail }, 'engine') : ''}
    <div class="sc-links">
      <button class="link-btn" data-action="settings" data-tab="models">${esc(t('chooseAnother'))}</button>
      <span class="muted">·</span><button class="link-btn" data-action="settings" data-tab="providers">${esc(t('useProvider'))}</button>
    </div>
  </div>`;
}

function renderProgress(d) {
  const p = d.total ? d.received / d.total : 0;
  return `<div class="progress-inline" data-dl="${esc(d.id)}">
    <div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
    <span class="pct">${Math.round(p * 100)}% · ${fmtBytes(d.received)} / ${fmtBytes(d.total)}${d.speed ? ` · ${fmtBytes(d.speed)}/s` : ''}</span>
    <button class="icon-btn xs" data-action="dl-cancel" data-id="${esc(d.id)}" title="${esc(t('cancel'))}">${icon('x', 14)}</button>
  </div>`;
}

function renderSoon(mode) {
  return `<div class="locked">
    <div class="lk-ico">${icon(pageIcon(mode), 30)}</div>
    <h2>${esc(t('nav_' + mode))}</h2>
    <p class="lk-desc">${esc(t('desc_' + mode))}</p>
    <span class="chip">${esc(t('soon'))}</span>
  </div>`;
}

function renderLockedMode(mode) {
  const m = { icon: pageIcon(mode) };
  const items = (t('deps_' + mode) || '').split('|').filter(Boolean);
  return `<div class="locked">
    <div class="lk-ico">${icon(m.icon, 30)}</div>
    <h2>${esc(t(mode === 'code' ? 'mode_code' : 'nav_' + mode))}</h2>
    <p class="lk-desc">${esc(t('desc_' + mode))}</p>
    <ul class="lk-list">${items.map((i) => `<li>${icon('check', 15)}<span>${esc(i)}</span></li>`).join('')}</ul>
    <button class="btn primary lg" data-action="install-mode" data-mode="${mode}">${icon('download', 17)} ${esc(t('installDeps'))}</button>
    <p class="muted small">${esc(t('installNote'))}</p>
  </div>`;
}

// ───────────────────────────── Messages ─────────────────────────────
function renderAttachments(atts = [], removable = false) {
  if (!atts.length) return '';
  return `<div class="atts">${atts.map((a, i) => {
    const rm = removable ? `<button class="att-x" data-action="att-remove" data-i="${i}">${icon('x', 12)}</button>` : '';
    if (a.kind === 'image') return `<div class="att att-img" data-action="att-open" data-i="${i}" data-src="${removable ? 'pending' : ''}"><img src="${a.data}" alt="">${rm}</div>`;
    const ic = a.kind === 'video' ? 'video' : a.kind === 'audio' ? 'waveform' : a.ext === 'pdf' ? 'filePdf' : /^docx?$/.test(a.ext) ? 'fileDoc' : /^xlsx?|csv$/.test(a.ext) ? 'fileXls' : /^pptx?$/.test(a.ext) ? 'filePpt' : a.ext === 'zip' ? 'fileZip' : 'file';
    const meta = [String(a.ext || a.kind).toUpperCase(), fmtBytes(a.size), a.pages ? t('pagesN', { n: a.pages }) : '', a.loading ? '…' : ''].filter(Boolean).join(' · ');
    return `<div class="att att-file ${a.thumb ? 'has-thumb' : ''}" data-action="att-open" data-i="${i}" data-src="${removable ? 'pending' : ''}" title="${esc(a.path || a.name)}">
      ${a.thumb ? `<img class="af-thumb" src="${a.thumb}" alt="">` : `<span class="af-ico">${icon(ic, 18)}</span>`}<span class="af-text"><b>${esc(a.name)}</b><small>${esc(meta)}</small></span>${rm}</div>`;
  }).join('')}</div>`;
}

function renderThinking(m) {
  if (!m.reasoning) return '';
  const live = m.pending && !m.content;
  const secs = m.thinkStart ? Math.max(1, Math.round(((m.thinkEnd || Date.now()) - m.thinkStart) / 1000)) : null;
  const label = live ? t('thinking') : secs ? t('thoughtFor', { s: secs }) : t('thoughts');
  return `<details class="think" ${live ? 'open' : ''}>
    <summary>${icon('brain', 15)}<span>${esc(label)}</span>${icon('down', 14, 'chev')}</summary>
    <div class="think-body">${esc(m.reasoning)}</div>
  </details>`;
}

function renderPrecisions(m) {
  if (!(m.precisions || []).length) return '';
  return `<div class="precisions">${m.precisions.map((p) => `<div class="precision ${p.used ? 'used' : ''}"><span class="pr-l">${icon('chat', 13)} ${esc(t(p.used ? 'precisionUsed' : 'precisionQueued'))}</span><div class="md">${md(p.text, m.id + 'p', { breaks: true })}</div></div>`).join('')}</div>`;
}
function injectPrecision() {
  const ta = $('#prompt'); const text = ta && ta.value.trim();
  if (!S.streaming || !text) return false;
  const m = S.streaming.msg;
  api.chat.inject(S.streaming.reqId, text).then((ok) => { if (!ok) toast(t('precisionLate'), 'err'); });
  (m.precisions ||= []).push({ text, used: false, at: Date.now() });
  ta.value = ''; S._draft = ''; ta.style.height = 'auto'; updateSendState();
  scheduleStreamRender();
  return true;
}
function assistantBody(m) {
  let html = renderThinking(m) + renderSteps(m) + renderPrecisions(m);
  if (m.content) { MD_CITES = sourceMap(m); try { html += (hasArtifacts(m) ? renderWithArtifacts(m) : `<div class="md">${md(m.content, m.id)}</div>`) + citedSources(m); } finally { MD_CITES = null; } }
  else if (m.pending && !m.reasoning && !(m.steps || []).length) {
    const st = m.status === 'loading' ? t('loadingModel') : '';
    html += `<div class="typing">${spinner(34)}${st ? `<em>${esc(st)}</em>` : ''}</div>`;
  }
  if (m.error) html += errorCard({ code: m.errorCode || (m.error === 'NO_MODEL' ? 'NO_MODEL' : 'UNKNOWN'), message: m.error, detail: m.errorDetail });
  if (m.checkpoint) html += cxTurnCard(m);
  return html;
}

// Readable error card: what happened, what to do, one-click fixes, technical details folded.
const ERR_ACTIONS = {
  NETWORK: ['retry'], RATE_LIMIT: ['retry'],
  PROVIDER_AUTH: ['providers'], PROVIDER_RATE: ['retry'], PROVIDER_MODEL: ['models'], PROVIDER_HTTP: ['retry', 'copy'], PROVIDER_DOWN: ['retry', 'providers'], PROVIDER_OFF: ['providers'], GITHUB: ['retry', 'copy'],
  NO_BUILD: ['retry', 'cpu', 'copy'], NO_BINARY: ['retry', 'cpu', 'copy'], BROKEN_BUILD: ['cpu', 'retry', 'copy'], DOWNLOAD: ['retry', 'copy'],
  OUT_OF_MEMORY: ['models', 'cpu'], MODEL_FILE: ['models'], START_FAILED: ['retry', 'cpu', 'copy'], TIMEOUT: ['retry', 'models', 'copy'],
  ENGINE_DOWN: ['retry', 'copy'], NO_MODEL: ['models'], UNKNOWN: ['retry', 'copy'],
};
function errorCard(err, where = 'msg') {
  const code = I18N.en['err_' + err.code + '_t'] ? err.code : 'UNKNOWN';
  const acts = (ERR_ACTIONS[code] || ERR_ACTIONS.UNKNOWN).filter((a) => !(a === 'cpu' && (S.settings.engine || {}).variant === 'cpu'));
  const btn = { retry: ['retry', 'errRetry'], cpu: ['cpu', 'errCpu'], models: ['box', 'errModels'], copy: ['copy', 'errCopy'], providers: ['cloud', 'errProviders'] };
  const tech = [err.message, err.detail].filter(Boolean).join('\n');
  return `<div class="err-card" data-where="${where}">
    <div class="err-head"><span class="err-ico">${icon('warning', 18)}</span><div><b>${esc(t('err_' + code + '_t'))}</b><p>${esc(t('err_' + code + '_b'))}</p></div></div>
    <div class="err-actions">${acts.map((a, i) => `<button class="btn sm ${i === 0 ? 'primary' : ''}" data-action="err-${a}" data-where="${where}">${icon(btn[a][0], 14)} ${esc(t(btn[a][1]))}</button>`).join('')}</div>
    ${tech && code !== 'NO_MODEL' ? `<details class="err-tech"><summary>${esc(t('errDetails'))}</summary><pre>${esc(tech)}</pre></details>` : ''}
  </div>`;
}
async function copyDiagnostics(btn) {
  let d = {};
  try { d = await api.engine.diagnostics(); } catch (e) { d = { error: String(e) }; }
  const text = ['Fabro diagnostic', `app ${S.info.version} · ${d.platform || S.info.platform}`, '```json', JSON.stringify(d, null, 2).slice(0, 12000), '```'].join('\n');
  await navigator.clipboard.writeText(text);
  if (btn) flashCheck(btn);
  toast(t('errCopied'));
}

function renderStats(m) {
  if (!m.stats || m.pending) return '';
  const s = m.stats;
  const parts = [];
  if (s.completionTokens) parts.push(t('tokensOut', { n: fmtNum(s.completionTokens) }));
  if (s.tokPerSec) parts.push(`${s.tokPerSec} tok/s`);
  if (m.toolsInfo && m.toolsInfo.count) parts.push(t('toolsGauge', { n: m.toolsInfo.count, k: fmtNum(m.toolsInfo.tokens) }));
  if (s.promptTokens) parts.push(t('tokensIn', { n: fmtNum(s.promptTokens) }));
  return `<span class="stats" title="${esc(m.model || '')}">${esc(parts.join(' · '))}</span>`;
}

function renderMessage(m, idx) {
  if (m.role === 'user') {
    return `<div class="msg user ${Date.now() - m.createdAt < 1500 ? 'fresh' : ''}" id="m-${m.id}">
      <div class="bubble">${renderAttachments(m.attachments)}${m.content ? `<div class="u-md md">${md(m.content, m.id, { breaks: true })}</div>` : ''}</div>
      <div class="msg-actions">${branchNav(m)}<button class="icon-btn xs" data-action="edit-msg" data-id="${m.id}" title="${esc(t('editMsg'))}">${icon('edit', 14)}</button><button class="icon-btn xs" data-action="copy-msg" data-id="${m.id}" title="${esc(t('copy'))}">${icon('copy', 14)}</button></div>
    </div>`;
  }
  const isLast = S.conv && idx === S.conv.messages.length - 1;
  return `<div class="msg assistant ${m.pending ? 'pending' : ''} ${m.pending && Date.now() - m.createdAt < 1500 ? 'fresh' : ''}" id="m-${m.id}">
    <div class="a-body">${assistantBody(m)}</div>
    <div class="msg-actions ${m.pending ? 'hidden' : ''}">
      ${branchNav(m)}
      <button class="icon-btn xs" data-action="copy-msg" data-id="${m.id}" title="${esc(t('copy'))}">${icon('copy', 14)}</button>
      ${isLast ? `<button class="icon-btn xs" data-action="regen" title="${esc(t('retry'))}">${icon('retry', 14)}</button>` : ''}
      ${renderStats(m)}
    </div>
  </div>`;
}

let rafPending = false;
function scheduleStreamRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const m = S.streaming && S.streaming.msg;
    if (!m) return;
    const el = $(`#m-${m.id} .a-body`);
    if (!el) return;
    const near = isNearBottom();
    const thinkOpen = el.querySelector('details.think')?.open;
    el.innerHTML = assistantBody(m);
    const th = el.querySelector('details.think');
    if (th && thinkOpen === false) th.open = false;
    if (near) scrollBottom();
  });
}

function isNearBottom() { const s = $('#scroller'); return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 140; }
function scrollBottom(force) { const s = $('#scroller'); if (s && (force || isNearBottom())) s.scrollTop = s.scrollHeight; }

// ───────────────────────────── Composer ─────────────────────────────
function estimateTokens() {
  if (!S.conv) return 0;
  const last = [...S.conv.messages].reverse().find((m) => m.stats && m.stats.promptTokens);
  if (last) {
    const idx = S.conv.messages.indexOf(last);
    const after = S.conv.messages.slice(idx + 1).reduce((n, m) => n + (m.content || '').length / 3.7, 0);
    return Math.round(last.stats.promptTokens + (last.stats.completionTokens || 0) + after);
  }
  return Math.round(S.conv.messages.reduce((n, m) => n + (m.content || '').length / 3.7, 0));
}

function ctxRing() {
  const ctx = S.settings.engine.ctx || 8192;
  const used = estimateTokens();
  const p = Math.min(1, used / ctx);
  const r = 8, c = 2 * Math.PI * r;
  const warn = p > 0.85 ? 'warn' : '';
  return `<div class="ctx-ring ${warn}" title="${esc(t('contextUsage', { used: fmtNum(used), max: fmtNum(ctx) }))}">
    <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="${r}" class="track"/><circle cx="11" cy="11" r="${r}" class="fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/></svg>
  </div>`;
}

function renderComposer() {
  const cm = currentModel();
  const busy = !!S.streaming;
  return `<div class="composer" id="composer">
    ${renderAttachments(S.pending, true)}
    <textarea id="prompt" rows="1" placeholder="${esc(t(S.conv && S.conv.messages.length ? 'replyPlaceholder' : 'placeholder'))}"></textarea>
    <div class="c-bar">
      <button class="icon-btn" data-action="plus-menu" title="${esc(t('plusMenu'))}">${icon('plus', 19)}</button>
      <div class="c-extras">${composerExtras()}</div>
      <div class="grow"></div>
      <button class="model-pill" data-action="model-menu">${esc(cm ? cm.label : t('chooseModel'))}${icon('down', 14)}</button>
      ${ctxRing()}
      <button class="icon-btn mic-btn" data-action="dictate" title="${esc(t('vx_dictate'))}">${icon('mic', 18)}</button>
      ${S.mode !== 'code' ? `<button class="icon-btn vx-open" data-action="voice-mode" title="${esc(t('vx_title'))}">${icon('waveform', 18)}</button>` : ''}
      <button class="send ${busy ? 'stop' : ''}" id="send-btn" data-action="${busy ? 'stop' : 'send'}" title="${esc(t(busy ? 'stop' : 'send'))}">${icon(busy ? 'stop' : 'up', 18)}</button>
    </div>
  </div>`;
}

function bindComposer() {
  const ta = $('#prompt');
  if (!ta) return;
  if (S._draft) ta.value = S._draft;
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'; updateSendState(); };
  ta.addEventListener('input', () => { S._draft = ta.value; fit(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (S.streaming) injectPrecision(); else { const b = $('#send-btn'); if (b) { b.classList.remove('launch'); void b.offsetWidth; b.classList.add('launch'); } sendPrompt(); } }
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); return; }
    // a big paste becomes an attached .txt file (only the pasted text), like Claude
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text && (text.length > 4000 || text.split('\n').length > 60)) {
      e.preventDefault();
      const n = S.pending.filter((x) => x.pasted).length + 1;
      S.pending.push({ kind: 'text', pasted: true, name: n > 1 ? `texte-colle-${n}.txt` : 'texte-colle.txt', ext: 'txt', size: new Blob([text]).size, text, type: 'text/plain' });
      refreshComposer();
      toast(t('pastedAsFile', { n: text.split('\n').length }));
    }
  });
  fit();
  if (!S.settingsTab) ta.focus();
}

function updateSendState() {
  const b = $('#send-btn'), ta = $('#prompt');
  if (b && !S.streaming) b.disabled = !(ta && ta.value.trim()) && !S.pending.length;
  // while answering: typing turns the stop button into "add a precision" (the answer keeps going)
  if (b && S.streaming) {
    const add = !!(ta && ta.value.trim());
    if ((b.dataset.action === 'inject') !== add) {
      b.dataset.action = add ? 'inject' : 'stop'; b.classList.toggle('stop', !add); b.disabled = false;
      b.title = t(add ? 'precisionSend' : 'stop'); b.innerHTML = icon(add ? 'up' : 'stop', 18);
    }
  }
}

function refreshComposer() {
  const c = $('#composer');
  if (!c) return;
  const val = $('#prompt')?.value || '';
  c.outerHTML = renderComposer();
  S._draft = val;
  bindComposer();
}

// ───────────────────────────── Attachments ─────────────────────────────
const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|lua|luau|html?|css|scss|xml|ya?ml|toml|ini|sh|bat|ps1|c|h|cpp|hpp|cs|java|kt|go|rs|php|rb|sql|swift|log)$/i;
const readAs = (f, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](f); });

async function addFiles(files) {
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const base = { name: f.name, size: f.size, type: f.type, ext };
    try {
      if (f.type.startsWith('image/')) S.pending.push({ ...base, kind: 'image', data: await readAs(f, 'readAsDataURL') });
      else if (f.type.startsWith('video/')) S.pending.push({ ...base, kind: 'video', url: URL.createObjectURL(f) });
      else if (TEXT_EXT.test(f.name) || f.type.startsWith('text/')) {
        if (f.size > 2 * 1024 * 1024) { toast(t('fileTooBig', { name: f.name }), 'err'); continue; }
        S.pending.push({ ...base, kind: 'text', text: await readAs(f, 'readAsText') });
      } else {
        // any other file (PDF, Word, Excel, audio, ZIP…): copied into the AI's workspace, with a first look
        if (f.size > 500 * 1024 * 1024) { toast(t('fileTooBig', { name: f.name }), 'err'); continue; }
        const p = api.files.pathOf(f);
        const tmp = { ...base, kind: 'file', loading: true }; S.pending.push(tmp); refreshComposer();
        const r = await api.files.ingest(p ? { path: p, name: f.name } : { name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
        Object.assign(tmp, r, { loading: false, type: f.type });
      }
    } catch { toast(t('fileUnsupported', { name: f.name }), 'err'); }
  }
  refreshComposer();
}

function openAttachment(a) {
  if (!a) return;
  if (a.kind === 'image') openViewer({ type: 'image', title: a.name, src: a.data });
  else if (a.kind === 'video') a.url ? openViewer({ type: 'video', title: a.name, src: a.url }) : toast(t('videoSessionOnly'));
  else if ((a.kind === 'file' || a.kind === 'audio') && a.path) openViewer({ type: 'file', title: a.name, file: a });
  else if (a.kind === 'text') {
    if (/^(md|markdown)$/i.test(a.ext)) openViewer({ type: 'markdown', title: a.name, text: a.text });
    else openViewer({ type: 'code', title: a.name, lang: a.ext, code: a.text });
  }
}

// ───────────────────────────── Viewer panel ─────────────────────────────
function openViewer(v) { S.viewer = v; renderViewer(); }
function closeViewer() { S.viewer = null; renderViewer(); }

function renderViewer() {
  const el = $('#viewer');
  if (!S.viewer) S.sbForce = false;
  if ($('#app').classList.contains('sb-collapsed') !== sbHidden()) { renderSidebar(); renderTopbar(); }
  $('#app').classList.toggle('with-viewer', !!S.viewer);
  $('#app').classList.toggle('wide-viewer', !!S.viewer && ['artifact', 'htmlpreview', 'agent', 'codefile'].includes(S.viewer.type));
  if (!S.viewer || S.viewer.type !== 'agent') setTimeout(() => typeof syncBrowser === 'function' && syncBrowser(), 0);
  if (!S.viewer) { el.innerHTML = ''; return; }
  const v = S.viewer;
  if (v.type === 'agent') { el.innerHTML = workspaceView(); afterViewerRender(); return; }
  if (v.type === 'codefile') { el.innerHTML = codeFileView(); afterCodeFile(); return; }
  if (v.type === 'artifact') { el.innerHTML = artifactViewer(); if (v.editing) bindArtEditor(); return; }
  if (v.type === 'htmlpreview') {
    el.innerHTML = `<div class="v-head"><span class="v-title">${esc(v.title)}</span><div class="v-tools"><button class="icon-btn sm" data-action="viewer-close" title="${esc(t('close'))}">${icon('x', 17)}</button></div></div>
      <div class="v-body art-body"><iframe class="art-frame" sandbox="allow-scripts allow-forms allow-modals allow-popups" src="${esc(v.url)}"></iframe></div>`;
    return;
  }
  let body = '', tools = '';
  if (v.type === 'code') {
    const lines = v.code.split('\n');
    body = `<div class="v-code"><pre><code class="hljs">${highlight(v.code, v.lang).split('\n').map((l, i) => `<span class="ln" data-n="${i + 1}">${l || ' '}</span>`).join('\n')}</code></pre></div>`;
    tools = `<span class="muted small">${esc(langName(v.lang))} · ${t('lines', { n: lines.length })}</span>
      <button class="icon-btn sm" data-action="viewer-copy" title="${esc(t('copy'))}">${icon('copy', 16)}</button>
      <button class="icon-btn sm" data-action="viewer-save" title="${esc(t('download'))}">${icon('download', 16)}</button>`;
  } else if (v.type === 'image') {
    body = `<div class="v-media"><img src="${v.src}" alt=""></div>`;
  } else if (v.type === 'video') {
    body = `<div class="v-media"><video src="${v.src}" controls autoplay></video></div>`;
  } else if (v.type === 'file') {
    const a = v.file, url = 'file://' + encodeURI(String(a.path).replace(/\\/g, '/')).replace(/^file:\/\/(?!\/)/, 'file:///');
    tools = `<span class="muted small">${esc(fmtBytes(a.size))}${a.pages ? ' · ' + esc(t('pagesN', { n: a.pages })) : ''}</span>
      <button class="icon-btn sm" data-action="open-path" data-path="${esc(a.path)}" title="${esc(t('open'))}">${icon('expand', 16)}</button>
      <button class="icon-btn sm" data-action="reveal-path" data-path="${esc(a.path)}" title="${esc(t('ag_reveal'))}">${icon('folder', 16)}</button>`;
    if (a.kind === 'audio') body = `<div class="v-media"><audio src="${esc(url)}" controls></audio></div>`;
    else if (v.preview && v.preview.images) body = `<div class="v-pages">${v.preview.images.map((src, i) => `<figure><img src="${src}" alt=""><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>`;
    else if (v.preview && v.preview.text != null) body = v.preview.text ? `<div class="v-doc"><pre class="v-text">${esc(v.preview.text)}</pre></div>` : `<p class="muted pad">${esc(t('noPreview'))}</p>`;
    else { body = `<div class="v-media">${spinner(30)}</div>`; api.files.preview(a.path).then((pv) => { if (S.viewer === v) { v.preview = pv; renderViewer(); } }).catch(() => { if (S.viewer === v) { v.preview = { text: '' }; renderViewer(); } }); }
  } else if (v.type === 'markdown') {
    body = `<div class="v-doc md">${md(v.text, 'viewer')}</div>`;
    tools = `<button class="icon-btn sm" data-action="viewer-copy" title="${esc(t('copy'))}">${icon('copy', 16)}</button>`;
  }
  el.innerHTML = `<div class="v-head"><span class="v-title">${esc(v.title || '')}</span><div class="v-tools">${tools}
      <button class="icon-btn sm" data-action="viewer-close" title="${esc(t('close'))}">${icon('x', 17)}</button></div></div>
    <div class="v-body">${body}</div>`;
}

// ───────────────────────────── Popover (model menu) ─────────────────────────────
function closePopover() { $('#popover-root').innerHTML = ''; }

function openModelMenu(anchor) {
  const list = allModels();
  const r = anchor.getBoundingClientRect();
  const local = list.filter((m) => m.src === 'local');
  const groups = {}; list.filter((m) => m.src !== 'local').forEach((m) => { (groups[m.src] ||= { name: m.provider, items: [] }).items.push(m); });
  const item = (m) => `<button class="pm-item ${sameRef(m.ref, S.settings.selectedModel) ? 'sel' : ''}" data-action="pick-model" data-ref="${esc(JSON.stringify(m.ref))}">
      <span class="pm-text"><b>${esc(m.label)}</b><small>${esc(m.sub)}${m.vision ? ' · ' + esc(t('vision')) : ''}</small></span>
      ${sameRef(m.ref, S.settings.selectedModel) ? icon('check', 16) : ''}</button>`;
  $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
    <div class="popover models-pop" style="right:${Math.max(12, innerWidth - r.right)}px; bottom:${innerHeight - r.top + 8}px">
      ${local.length ? `<div class="pm-sec">${esc(t('builtInModels'))}</div>${local.map(item).join('')}` : ''}
      ${Object.values(groups).map((g) => `<div class="pm-sec">${esc(g.name)}</div>${g.items.map(item).join('')}`).join('')}
      ${!list.length ? `<div class="pm-empty">${esc(t('noModelsYet'))}</div>` : ''}
      <div class="pm-sep"></div>
      <button class="pm-item" data-action="settings" data-tab="models">${icon('box', 16)}<span class="pm-text"><b>${esc(t('manageModels'))}</b></span></button>
      <button class="pm-item" data-action="settings" data-tab="providers">${icon('cloud', 16)}<span class="pm-text"><b>${esc(t('tab_providers'))}</b></span></button>
    </div>`;
}

// ───────────────────────────── Settings overlay ─────────────────────────────
const TABS = [
  { id: 'general', icon: 'sliders' }, { id: 'models', icon: 'box' }, { id: 'engine', icon: 'zap' }, { id: 'storage', icon: 'archive' }, { id: 'providers', icon: 'cloud' },
  { id: 'usage', icon: 'chart' }, { id: 'agent', icon: 'agent' },
  { id: 'shortcut', icon: 'key' },
  { id: 'generation', icon: 'edit' }, { id: 'system', icon: 'cpu' }, { id: 'about', icon: 'info' },
];

async function openSettings(tab = 'general') {
  S.settingsTab = tab;
  closePopover();
  renderSettings();
  if (tab === 'models' && !S.catalog) { S.catalog = await api.models.catalog(); renderSettings(); }
  if (tab === 'system') { Promise.all([api.runtime.status(), api.crash.list()]).then(([rt, cr]) => { S.rt = rt; S.crashes = cr; if (S.settingsTab === 'system') renderSettings(); }); }
  if (tab === 'providers') loadProviders();
  if (tab === 'models' || tab === 'storage') loadModelExtras();
  if (tab === 'engine') startMonitor(); else stopMonitor();
  if (tab === 'usage') loadUsage();
  if (tab === 'agent') loadAgentSettings();
  if (tab === 'shortcut') loadHotkeyStatus();
}
function closeSettings() {
  S.settingsTab = null; S._lastTab = null; stopMonitor();
  const o = $('.overlay');
  if (o) { o.classList.add('closing'); setTimeout(() => { $('#overlay-root').innerHTML = ''; $('#prompt')?.focus(); }, 160); }
}

function renderSettings(keepScroll = true) {
  if (!S.settingsTab) return;
  const prev = $('.st-content');
  const scroll = keepScroll && prev ? prev.scrollTop : 0;
  const existing = $('.overlay');
  const nav = TABS.map((x) => `<button class="st-tab ${S.settingsTab === x.id ? 'active' : ''}" data-action="settings-tab" data-tab="${x.id}">${icon(x.icon, 17)}<span>${esc(t('tab_' + x.id))}</span></button>`).join('');
  const html = `<div class="overlay ${existing ? 'shown' : ''}" data-action="overlay-bg">
    <div class="st-panel" role="dialog" aria-modal="true">
      <div class="st-nav"><div class="st-heading">${esc(t('settings'))}</div>${nav}</div>
      <div class="st-main">
        <div class="st-top"><h2>${esc(t('tab_' + S.settingsTab))}</h2><button class="icon-btn" data-action="close-settings" title="${esc(t('close'))}">${icon('x')}</button></div>
        <div class="st-content ${S._lastTab !== S.settingsTab ? 'tab-in' : ''}">${settingsBody(S.settingsTab)}</div>
      </div>
    </div></div>`;
  // Keep what the user is typing in forms across re-renders (live status updates re-render the panel).
  const kept = $$('.st-content form[data-form] [name]').map((el) => [el.closest('form').dataset.form + '|' + el.name, el.value]);
  const focused = document.activeElement && document.activeElement.closest('.st-content form[data-form]') ? document.activeElement.closest('form').dataset.form + '|' + document.activeElement.name : null;
  $('#overlay-root').innerHTML = html;
  for (const [k, v] of kept) { const [f, n] = k.split('|'); const el = $(`.st-content form[data-form="${f}"] [name="${n}"]`); if (el && !el.value) el.value = v; }
  if (focused) { const [f, n] = focused.split('|'); $(`.st-content form[data-form="${f}"] [name="${n}"]`)?.focus(); }
  const c = $('.st-content'); if (c) c.scrollTop = scroll;
  S._lastTab = S.settingsTab;
  if (!existing) requestAnimationFrame(() => $('.overlay')?.classList.add('shown'));
}

const row = (label, control, hint = '') => `<div class="st-row"><div class="st-label"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</div><div class="st-control">${control}</div></div>`;
const seg = (key, value, opts) => `<div class="seg">${opts.map(([v, l, ic]) => `<button class="${String(value) === String(v) ? 'on' : ''}" data-action="set" data-key="${key}" data-value="${esc(v)}">${ic ? icon(ic, 15) : ''}${esc(l)}</button>`).join('')}</div>`;
const toggle = (key, on) => `<button class="switch ${on ? 'on' : ''}" data-action="set" data-key="${key}" data-value="${!on}" role="switch" aria-checked="${on}"><i></i></button>`;
const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
function patchFor(path, value) { const keys = path.split('.'); const out = {}; let cur = out; keys.forEach((k, i) => { cur[k] = i === keys.length - 1 ? value : {}; cur = cur[k]; }); return out; }

function settingsBody(tab) {
  const st = S.settings;
  if (tab === 'general') {
    const langOpts = [['auto', t('langAuto', { l: LANGS[resolveLangAuto()] || 'English' })], ...Object.entries(LANGS)]
      .map(([v, l]) => `<option value="${v}" ${st.language === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `
      ${row(t('yourName'), `<input class="input" type="text" maxlength="40" data-input="userName" value="${esc(st.userName || '')}" placeholder="${esc(prettyName(S.info.userName) || t('yourName'))}">`, t('yourNameHint'))}
      ${row(t('language'), `<select class="input" data-input="language">${langOpts}</select>`)}
      ${row(t('reduceMotion'), toggle('reduceMotion', !!st.reduceMotion), t('reduceMotionHint'))}
      ${row(t('theme'), seg('theme', st.theme, [['system', t('themeSystem'), 'monitor'], ['light', t('themeLight'), 'sun'], ['dark', t('themeDark'), 'moon']]))}
      ${row(t('autoUpdate'), toggle('autoUpdate', st.autoUpdate), t('autoUpdateHint'))}
      ${row(t('devMode'), toggle('devMode', st.devMode), t('devModeHint'))}
      ${st.devMode ? row(t('devTools'), `<button class="btn sm" data-action="devtools">${icon('terminal', 14)} ${esc(t('open'))}</button>`, 'F12 · Ctrl+Shift+I · Ctrl+R') : ''}
      ${row(t('appVersion'), `<span class="mono">v${esc(S.info.version)}</span> <button class="btn sm" data-action="check-update">${esc(t('checkUpdates'))}</button>`, updaterText())}`;
  }
  if (tab === 'models') return modelsTab();
  if (tab === 'providers') return providersTab();
  if (tab === 'shortcut') return shortcutTab();
  if (tab === 'engine') return engineTab();
  if (tab === 'storage') return storageTab();
  if (tab === 'usage') return usageTab();
  if (tab === 'agent') return agentTab();
  if (tab === 'generation') {
    const g = st.gen;
    const range = (k, min, max, step, v) => `<div class="range-wrap"><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-input="gen.${k}" data-type="float"><span class="rv">${v}</span></div>`;
    return `
      ${row(t('temperature'), range('temperature', 0, 2, 0.05, g.temperature), t('temperatureHint'))}
      ${row('Top P', range('topP', 0.05, 1, 0.05, g.topP))}
      ${row(t('maxTokens'), `<input class="input sm" type="number" min="0" max="131072" value="${g.maxTokens}" data-input="gen.maxTokens" data-type="int">`, t('maxTokensHint'))}
      <div class="st-block"><div class="st-label"><span>${esc(t('systemPrompt'))}</span><small>${esc(t('systemPromptHint'))}</small></div>
      <textarea class="input area" rows="6" data-input="gen.systemPrompt" placeholder="${esc(t('systemPromptPh'))}">${esc(g.systemPrompt)}</textarea></div>`;
  }
  if (tab === 'system') {
    const sp = S.specs;
    if (!sp) return `<div class="muted">${esc(t('detecting'))}</div>`;
    const accel = { cuda: 'NVIDIA CUDA', metal: 'Apple Metal', vulkan: 'Vulkan', cpu: 'CPU' }[sp.accel];
    return `<div class="spec-grid">
      <div class="spec"><small>${esc(t('os'))}</small><b>${esc(sp.os)} · ${esc(sp.arch)}</b></div>
      <div class="spec"><small>CPU</small><b>${esc(sp.cpu.model)}</b><span>${sp.cpu.threads} threads</span></div>
      <div class="spec"><small>RAM</small><b>${sp.ramGB} GB</b></div>
      <div class="spec"><small>${esc(t('acceleration'))}</small><b>${esc(accel)}</b></div>
      ${sp.gpus.map((g) => `<div class="spec wide"><small>GPU</small><b>${esc(g.name)}</b><span>${g.vramGB ? g.vramGB + ' GB VRAM' : sp.unified ? t('unifiedMemory') : ''}</span></div>`).join('')}
    </div>
    <p class="muted small">${esc(t('budgetNote', { g: sp.gpuBudgetGB, r: sp.ramBudgetGB }))}</p>
    <div class="st-sec">${esc(t('rt_title'))}</div>
    ${row(t('rt_runtime'), `<span class="chip ${S.rt && S.rt.isolated ? 'ok' : ''}">${esc(S.rt ? (S.rt.isolated ? t('rt_isolated', { p: S.rt.pid || '—' }) : t('rt_inprocess')) : '…')}</span>`, t('rt_hint'))}
    <div class="st-sec">${esc(t('tel_title'))}</div>
    <p class="muted small st-intro">${esc(t('tel_hint'))}</p>
    ${row(t('tel_crash'), toggle('telemetry.crashReports', !!(S.settings.telemetry || {}).crashReports), t('tel_crashHint'))}
    ${(S.crashes || []).length ? row(t('tel_saved', { n: S.crashes.length }), `<button class="btn sm" data-action="crash-folder">${icon('folder', 14)} ${esc(t('open'))}</button>${(S.crashes || [])[0] ? `<button class="btn sm" data-action="crash-report" data-f="${esc(S.crashes[0].file)}">${icon('share', 14)} ${esc(t('tel_send'))}</button>` : ''}`) : ''}`;
  }
  if (tab === 'about') {
    return `<div class="about">${logo(56)}<h3>Fabro</h3><p class="muted">v${esc(S.info.version)} · ${esc(t('tagline'))}</p>
      <p class="small">${esc(t('taglineLong'))}</p><p class="small muted">${esc(t('aboutText'))}</p>
      <p class="small"><a href="https://github.com/ggml-org/llama.cpp" data-action="ext-link">llama.cpp</a> · <a href="https://huggingface.co/models?library=gguf" data-action="ext-link">Hugging Face</a> · <a href="https://ollama.com" data-action="ext-link">Ollama</a></p></div>`;
  }
  return '';
}
function resolveLangAuto() { const s = S.settings.language; S.settings.language = 'auto'; const l = resolveLang(); S.settings.language = s; return l; }
function updaterText() {
  const u = S.updater;
  return ({ checking: t('upd_checking'), latest: t('upd_latest'), downloading: t('upd_downloading', { p: Math.round((u.progress || 0) * 100) }), ready: t('upd_ready', { v: u.version || '' }), error: t('upd_error'), dev: t('upd_dev') })[u.state] || '';
}

const FIT_ORDER = { great: 0, good: 1, ok: 2, 'needs-gpu': 3, 'too-big': 4 };
function specLine() {
  const sp = S.specs; const g = sp.gpus[0];
  return [g ? g.name + (g.vramGB ? ` ${g.vramGB} GB` : '') : 'CPU', `${sp.ramGB} GB RAM`].join(' · ');
}

function renderRepoFiles() {
  const f = S.search.files;
  if (!f) return `<div class="sr-files muted small">${esc(t('loading'))}</div>`;
  if (f.error) return `<div class="sr-files err small">${esc(f.error)}</div>`;
  if (!f.files.length) return `<div class="sr-files muted small">${esc(t('noGguf'))}</div>`;
  return `<div class="sr-files">${f.files.map((x) => {
    const id = `${f.repo}/${x.file}`;
    const dl = S.downloads[id] && S.downloads[id].status === 'downloading' ? S.downloads[id] : null;
    const inst = S.installed.local.some((m) => m.id === id);
    return `<div class="sf-row ${x.file === f.preferred ? 'pref' : ''}">
      <span class="sf-name" title="${esc(x.file)}">${esc(x.quant || x.file)}</span>
      <span class="muted small">${x.sizeGB} GB${x.parts.length > 1 ? ` · ${x.parts.length} parts` : ''}${x.mmproj ? ' · ' + esc(t('vision')) : ''}</span>
      <span class="fit fit-${x.fit}">${esc(t('fit_' + x.fit))}</span>
      ${inst ? `<span class="muted small">${icon('check', 14)}</span>` : dl ? renderProgress(dl) : x.blocked ? `<span class="muted small" title="${esc(t('fitWhy_' + x.fit))}">${icon('lock', 15)}</span>` : `<button class="icon-btn sm" data-action="dl-file" data-repo="${esc(f.repo)}" data-file="${esc(x.file)}" title="${esc(t('download'))}">${icon('download', 16)}</button>`}
    </div>`;
  }).join('')}</div>`;
}

// ───────────────────────────── Conversations ─────────────────────────────
function newConv() {
  const c = { id: uid(), title: '', mode: 'chat', nodes: [], leafId: null, messages: [], createdAt: Date.now(), updatedAt: Date.now(), ephemeral: !!S.ephemeralNext };
  if (S.mode === 'code' && S.cx.root) { c.mode = 'code'; c.code = { root: S.cx.root }; c.agent = true; c.ephemeral = false; }
  if (S.mode === 'projects' && S.prj.current) { c.project = S.prj.current.id; c.ephemeral = false; }
  S.ephemeralNext = false;
  return c;
}
const persist = debounce(async () => {
  if (!S.conv || !S.conv.messages.length || S.conv.ephemeral) return;
  const { messages, ...rest } = S.conv;
  const clean = { ...rest, nodes: S.conv.nodes.map(({ pending, status, ...m }) => ({ ...m, attachments: (m.attachments || []).map(({ url, ...a }) => a) })) };
  await api.conv.save(clean);
  S.convs = await api.conv.list();
  renderRecents();
}, 400);

async function openConv(id) {
  if (S.streaming) return;
  try { S.conv = treeify(await api.conv.get(id)); } catch { toast(t('loadFailed'), 'err'); return; }
  if (S.conv.project && !S.prj.list) api.projects.list().then((l) => { S.prj.list = l; renderTopbar(); });
  if (S.conv.code && S.conv.code.root) {
    S.mode = 'code'; S.code.clear(); navTo('code', id);
    if (S.cx.root !== S.conv.code.root) await cxOpen(S.conv.code.root, { keepConv: true });
    vt(() => { renderSidebar(); renderView(); });
    return;
  }
  S.mode = 'chat'; S.code.clear(); navTo('chat', id);
  vt(() => { renderSidebar(); renderView(); });
}

function reportQuick() { api.quick.report({ convId: S.conv && S.conv.messages.length ? S.conv.id : null, title: S.conv ? S.conv.title : '' }); }

function newChat() {
  if (S.streaming) return;
  if (S.mode === 'code' && S.cx.root) { S.conv = null; S.code.clear(); S._draft = ''; vt(() => { renderSidebar(); renderView(); }); return; }
  S.conv = null; S.mode = 'chat'; S.code.clear(); S._draft = ''; navTo('chat', null);
  vt(() => { renderSidebar(); renderView(); });
}

// ───────────────────────────── Sending ─────────────────────────────
function buildMessages() {
  const out = [];
  out.push({ role: 'system', content: systemPrompt() });
  for (const m of S.conv.messages) {
    if (m.pending || (m.role === 'assistant' && m.error && !m.content)) continue;
    if (m.role === 'assistant') {
      // precisions typed during that answer belong to the question it answered
      const pr = (m.precisions || []).filter((p) => p.used).map((p) => p.text);
      const u = out[out.length - 1];
      if (pr.length && u && u.role === 'user') {
        const add = `\n\n[Précisions ajoutées pendant la réponse]\n${pr.join('\n')}`;
        if (typeof u.content === 'string') u.content += add; else if (u.content[0]) u.content[0].text += add;
      }
      out.push({ role: 'assistant', content: m.content }); continue;
    }
    const texts = (m.attachments || []).filter((a) => a.kind === 'text').map((a) => `File: ${a.name}\n\`\`\`${a.ext || ''}\n${a.text}\n\`\`\``)
      .concat((m.attachments || []).filter((a) => (a.kind === 'file' || a.kind === 'audio') && a.path).map((a) => `Attached file: ${a.name} (${a.ext}, ${fmtBytes(a.size)}${a.pages ? `, ${a.pages} pages` : ''}) — saved in your workspace at ${a.path}. ${a.kind === 'audio' ? 'Transcribe it with convert_file (to: "transcript").' : a.text ? `Its text${a.chars > a.text.length ? ` (first ${a.text.length} of ${a.chars} chars)` : ''}:\n${a.text}` : 'Use convert_file to read it.'}${a.ext === 'pdf' ? '\n(To see the layout use inspect_document with pages; to change it keeping the layout use pdf_find_text + pdf_edit.)' : ''}`));
    const content = [...texts, m.content].filter(Boolean).join('\n\n');
    const imgs = (m.attachments || []).filter((a) => a.kind === 'image');
    if (imgs.length) out.push({ role: 'user', content: [{ type: 'text', text: content || ' ' }, ...imgs.map((a) => ({ type: 'image_url', image_url: { url: a.data } }))] });
    else out.push({ role: 'user', content });
  }
  return out;
}

async function sendPrompt(textOverride, opts = {}) {
  if (S.streaming) return;
  const ta = $('#prompt');
  const text = (textOverride ?? (ta ? ta.value : '')).trim();
  if (!text && !S.pending.length) return;
  if (!currentModel()) { toast(t('noModel'), 'err'); openSettings('models'); return; }
  if (!S.conv) S.conv = newConv();
  if (S.mode === 'projects') { S.mode = 'chat'; navTo('chat', S.conv.id); }
  const atts = S.pending.splice(0);
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  addNode({ id: uid(), role: 'user', content: text, attachments: atts, createdAt: Date.now() });
  if (!S.conv.title) S.conv.title = (text || atts[0]?.name || '').replace(/\s+/g, ' ').slice(0, 64);
  S._draft = '';
  generate(opts);
}

function generate(opts = {}) {
  const cm = currentModel();
  const msg = addNode({ id: uid(), role: 'assistant', content: '', reasoning: '', steps: [], model: cm ? cm.label : '', pending: true, createdAt: Date.now() });
  const reqId = uid();
  S.streaming = { reqId, msg, quick: !!opts.quick };
  const first = S.conv.messages.length <= 2;
  if (first) vt(() => { renderView(); renderSidebar(); }); else { renderView(); renderSidebar(); }
  const r = S.settings.gen.reasoning || 'auto';
  const usedTools = [...new Set(S.conv.messages.flatMap((x) => (x.steps || []).map((st) => st.name)))];
  api.chat.send({ reqId, model: S.settings.selectedModel, messages: buildMessages(), params: { ...S.settings.gen, reasoning: r === 'auto' ? (opts.voice || (S.voice && S.voice.on) ? 'off' : undefined) : r,voiceMode: !!(opts.voice || (S.voice && S.voice.on)), tools: [...chatTools(), ...(opts.voice || (S.voice && S.voice.on) ? ['show_on_scene'] : [])], agentMode: !!S.conv.agent || !!S.conv.code || (S.conv.messages || []).some((x) => (x.attachments || []).some((a) => a.kind === 'file' || a.kind === 'audio')), agentPrompt: agentPrompt(), vision: !!(cm && cm.vision), usedTools, agent: (S.settings.agent || {}).enabled !== false || !!S.conv.code }, meta: { convId: S.conv.id, turnId: msg.id, code: cxMeta(), project: S.conv.project || null, modelLabel: cm ? (cm.provider ? `${cm.provider} · ${cm.label}` : cm.label) : '' } });
}

function finishStream() {
  const m = S.streaming && S.streaming.msg;
  const fromQuick = S.streaming && S.streaming.quick;
  S.streaming = null;
  if (m && !fromQuick && !m.error && (document.hidden || !document.hasFocus())) {
    api.notify({ title: (S.conv && S.conv.title) || 'Fabro', body: (m.content || '').replace(/\s+/g, ' ').slice(0, 140), onlyIfHidden: true });
  }
  if (m) {
    m.pending = false;
    if (m.reasoning && !m.thinkEnd) m.thinkEnd = Date.now();
    // precisions that arrived too late (answer stopped) go back to the composer
    const late = (m.precisions || []).filter((p) => !p.used);
    if (late.length) { m.precisions = m.precisions.filter((p) => p.used); S._draft = [S._draft, ...late.map((p) => p.text)].filter(Boolean).join('\n'); }
    const el = $(`#m-${m.id}`);
    if (el) el.outerHTML = renderMessage(m, S.conv.messages.indexOf(m));
  }
  // drop "retry" button from previous assistant messages
  refreshComposer();
  persist();
  if (m) { afterAnswer(m); saveArtifactsFrom(m).catch(() => {}).then(() => renderSessionPanel()); }
}

function onChatEvent(ev) {
  if (!S.streaming || ev.reqId !== S.streaming.reqId) return;
  const m = S.streaming.msg;
  switch (ev.type) {
    case 'status': m.status = ev.status; scheduleStreamRender(); break;
    case 'reasoning': if (!m.thinkStart) m.thinkStart = Date.now(); m.reasoning += ev.text; scheduleStreamRender(); break;
    case 'token': if (m.reasoning && !m.thinkEnd) m.thinkEnd = Date.now(); m.content += ev.text; scheduleStreamRender(); break;
    case 'tool_start': (m.steps ||= []).push({ id: ev.id, name: ev.name, args: ev.args || {}, status: 'running', parent: ev.parent, t0: Date.now() }); scheduleStreamRender(); renderSessionPanel(); if (S.viewer && S.viewer.type === 'agent' && S.viewer.tab === 'steps') renderViewer(); break;
    case 'tool_end': { const st = (m.steps || []).find((x) => x.id === ev.id); if (st) { st.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; st.view = ev.view; st.error = ev.error; st.perm = null; st.deps = null; if (st.view && st.view.out == null && st.live) st.view.out = st.live; delete st.live; delete st.subText; } scheduleStreamRender(); renderSessionPanel(); if (S.viewer && S.viewer.type === 'agent' && S.viewer.tab !== 'browser') renderViewer(); break; }
    case 'agent_switch': case 'tools_info': case 'permission': case 'deps_needed': case 'tool_progress': case 'retract': case 'plan': case 'sub_token': onAgentEvent(ev, m); break;
    case 'checkpoint': m.checkpoint = { id: ev.id, files: ev.files }; cxRefreshSoon(); break;
    case 'precision_used': { let n = ev.count; for (const p of m.precisions || []) if (!p.used && n-- > 0) p.used = true; scheduleStreamRender(); break; }
    case 'precision_round': case 'tool_round': if (m.content && !/\n\n$/.test(m.content)) m.content += '\n\n'; break;
    case 'done': m.stats = ev.stats; finishStream(); break;
    case 'error': m.error = ev.message; m.errorCode = ev.code; m.errorDetail = ev.detail; finishStream(); break;
  }
}

// ───────────────────────────── Actions ─────────────────────────────
const actions = {
  'toggle-sidebar': async () => {
    if (sbAuto() && !S.settings.sidebarCollapsed) S.sbForce = !S.sbForce; // auto-hidden in Code mode: just show it for now
    else await saveSettings({ sidebarCollapsed: !S.settings.sidebarCollapsed });
    renderSidebar(); renderTopbar();
  },
  'new-chat': newChat,
  'mode': (el) => { S.mode = el.dataset.mode; if (S.mode === 'projects') { S.prj.current = null; S.prj.list = null; } if (S.conv && !!S.conv.code !== (S.mode === 'code')) S.conv = null; navTo(S.mode, S.mode === 'chat' && S.conv ? S.conv.id : null); vt(() => { renderSidebar(); renderView(); }); },
  'hist-back': () => histGo(-1),
  'hist-fwd': () => histGo(1),
  'toggle-more': () => { S.moreOpen = !S.moreOpen; renderSidebar(); },
  'focus-search': async () => { if (sbHidden()) await actions['toggle-sidebar'](); $('#sb-q')?.focus(); },
  'user-menu': (el) => openUserMenu(el),
  'soon': () => toast(t('soon')),
  'noop': () => {},
  'pin-conv': async (el, e) => {
    e.stopPropagation();
    const c = S.convs.find((x) => x.id === el.dataset.id);
    if (!c) return;
    await api.conv.patch(c.id, { pinned: !c.pinned });
    if (S.conv && S.conv.id === c.id) S.conv.pinned = !c.pinned;
    S.convs = await api.conv.list(); renderRecents();
  },
  'open-conv': (el) => openConv(el.dataset.id),
  'del-conv': async (el, e) => {
    e.stopPropagation();
    await api.conv.delete(el.dataset.id);
    if (S.conv && S.conv.id === el.dataset.id) S.conv = null;
    S.convs = await api.conv.list();
    renderSidebar(); renderView();
  },
  'settings': (el) => { closePopover(); openSettings(el.dataset.tab || 'general'); },
  'settings-tab': (el) => { openSettings(el.dataset.tab); },
  'close-settings': closeSettings,
  'overlay-bg': (el, e) => { if (e.target === el) closeSettings(); },
  'send': (el) => { el.classList.remove('launch'); void el.offsetWidth; el.classList.add('launch'); sendPrompt(); },
  'stop': () => { if (S.streaming) api.chat.abort(S.streaming.reqId); },
  'inject': () => { injectPrecision(); },
  'suggest': (el) => { const ta = $('#prompt'); ta.value = el.dataset.text; S._draft = ta.value; ta.dispatchEvent(new Event('input')); ta.focus(); },
  'attach': () => $('#file-input').click(),
  'att-remove': (el, e) => { e.stopPropagation(); S.pending.splice(+el.dataset.i, 1); refreshComposer(); },
  'att-open': (el) => {
    const i = +el.dataset.i;
    if (el.dataset.src === 'pending') return openAttachment(S.pending[i]);
    const msgEl = el.closest('.msg'); const m = S.conv.messages.find((x) => `m-${x.id}` === msgEl.id);
    openAttachment(m && m.attachments[i]);
  },
  'model-menu': (el) => openModelMenu(el),
  'close-pop': closePopover,
  'pick-model': async (el) => {
    const ref = JSON.parse(el.dataset.ref);
    await saveSettings({ selectedModel: ref });
    closePopover(); renderSidebar(); refreshComposer(); renderSettings();
  },
  'copy-msg': (el) => {
    const m = S.conv.messages.find((x) => x.id === el.dataset.id);
    navigator.clipboard.writeText(m ? m.content : ''); flashCheck(el);
  },
  'regen': () => {
    if (S.streaming) return;
    const last = S.conv.messages[S.conv.messages.length - 1];
    if (last && last.role === 'assistant') { S.conv.leafId = last.parentId; S.conv.messages = pathOf(S.conv); }
    generate();
  },
  'settings-page': (el) => { closePopover(); S.mode = el.dataset.page; navTo(S.mode, null); vt(() => { renderSidebar(); renderView(); }); },
  'code-copy': (el) => { const c = S.code.get(el.closest('.code-card').dataset.key); navigator.clipboard.writeText(c ? c.code : ''); flashCheck(el); },
  'code-open': (el) => { const c = S.code.get(el.closest('.code-card').dataset.key); if (c) openViewer({ type: 'code', title: langName(c.lang), lang: c.lang, code: c.code }); },
  'code-toggle': (el) => {
    const card = el.closest('.code-card'); card.classList.toggle('collapsed');
    const n = S.code.get(card.dataset.key).code.split('\n').length;
    el.querySelector('span').textContent = card.classList.contains('collapsed') ? t('showAll', { n }) : t('showLess');
  },
  'viewer-close': closeViewer,
  'viewer-copy': (el) => { const a = typeof curArt === 'function' && curArt(); navigator.clipboard.writeText(a ? a.versions[S.viewer.v].content : (S.viewer.code || S.viewer.text || '')); flashCheck(el); },
  'viewer-save': () => {
    const v = S.viewer; const ext = v.lang && /^[a-z0-9]+$/i.test(v.lang) ? v.lang : 'txt';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([v.code])); a.download = /\./.test(v.title) ? v.title : `code.${ext}`; a.click();
  },
  'ext-link': (el, e) => { e.preventDefault(); api.shell.open(el.getAttribute('href')); },
  'install-mode': async (el) => {
    const r = await api.modes.install(el.dataset.mode);
    toast(r.ok ? t('modeInstalled') : t('comingSoon'));
  },
  'set': async (el, e) => {
    closePopover();
    let v = el.dataset.value;
    if (v === 'true' || v === 'false') v = v === 'true';
    if (el.dataset.key === 'theme' && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const x = e.clientX || innerWidth / 2, y = e.clientY || innerHeight / 2;
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const t = vt(() => applySetting('theme', v), { kind: 'theme' });
      if (!t) return;
      try { await t.ready; } catch { return; }
      document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
      return;
    }
    await applySetting(el.dataset.key, v);
  },
  'crash-folder': () => api.crash.folder(),
  'crash-report': (el) => api.crash.report(el.dataset.f),
  'dl-catalog': async (el) => {
    const m = (S.catalog?.items || []).find((x) => x.id === el.dataset.id);
    if (!m) return;
    el.disabled = true;
    try { await api.models.download({ repo: m.repo, catalogId: m.id }); }
    catch (e) { toast(dlErr(e), 'err'); el.disabled = false; }
    if (S.settingsTab === 'models') renderSettings();
  },
  'dl-file': async (el) => {
    try { await api.models.download({ repo: el.dataset.repo, file: el.dataset.file }); } catch (e) { toast(dlErr(e), 'err'); }
  },
  'dl-cancel': (el) => api.models.cancel(el.dataset.id),
  'model-delete': async (el) => {
    const m = S.installed.local.find((x) => x.id === el.dataset.id);
    if (!confirm(t(m && m.imported ? 'confirmRemoveImport' : 'confirmDelete'))) return;
    if (S.settings.selectedModel && S.settings.selectedModel.id === el.dataset.id) await saveSettings({ selectedModel: null });
    await api.models.delete(el.dataset.id);
    S.modelOpen = null;
    await refreshModels(); S.catalog = await api.models.catalog(); if (typeof loadModelExtras === 'function') loadModelExtras();
    renderSettings(); renderSidebar(); renderView();
  },
  'sr-open': async (el) => {
    const repo = el.dataset.repo;
    if (S.search.repo === repo) { S.search.repo = null; renderSettings(); return; }
    S.search.repo = repo; S.search.files = null; renderSettings();
    try { S.search.files = await api.models.files(repo); } catch (e) { S.search.files = { error: e.message }; }
    if (S.search.repo === repo) renderSettings();
  },
  'engine-update': async () => {
    try { const r = await api.engine.update(); toast(r.updated ? t('engineUpdated', { v: r.version }) : r.reason === 'not-installed' ? t('engineNotInstalled') : r.reason === 'busy' ? t('engineBusy') : t('upd_latest')); }
    catch (e) { toast(e.message, 'err'); }
  },
  'engine-stop': () => api.engine.stop(),
  'err-retry': async (el) => {
    if (el.dataset.where === 'engine') { try { await api.engine.reinstall(); } catch {} return; }
    actions.regen();
  },
  'err-cpu': async (el) => {
    await saveSettings({ engine: { variant: 'cpu' } });
    toast(t('errCpuOn'));
    if (el.dataset.where === 'engine') { try { await api.engine.reinstall(); } catch {} return; }
    actions.regen();
  },
  'err-models': () => openSettings('models'),
  'err-providers': () => openSettings('providers'),
  'err-copy': (el) => copyDiagnostics(el),
  'devtools': () => api.win.devtools(),
  'check-update': () => api.updater.check(),
  'install-update': () => { closeModal(); api.updater.install(); },
  'upd-open': () => openUpdateDialog(),
  'upd-later': () => closeModal(),
};

async function histGo(d) {
  const i = S.histIdx + d;
  const h = S.hist[i];
  if (!h || S.streaming) return;
  S.histIdx = i;
  if (h.mode === 'chat' && h.convId) { try { S.conv = treeify(await api.conv.get(h.convId)); } catch { S.conv = null; } }
  else if (h.mode === 'chat') S.conv = null;
  S.mode = h.mode; S.code.clear();
  vt(() => { renderSidebar(); renderView(); }, { kind: d < 0 ? 'back' : 'fwd' });
}

function dlErr(e) {
  const m = String(e && e.message || e);
  if (/NEEDS_GPU/.test(m)) return t('fitWhy_needs-gpu');
  if (/TOO_BIG/.test(m)) return t('fitWhy_too-big');
  if (/NO_SPACE/.test(m)) return t('noSpace');
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function flashCheck(btn) {
  const old = btn.innerHTML; btn.innerHTML = icon('check', 15); btn.classList.add('ok');
  setTimeout(() => { btn.innerHTML = old; btn.classList.remove('ok'); }, 1200);
}

async function applySetting(key, value) {
  await saveSettings(patchFor(key, value));
  if (key === 'theme') applyTheme();
  if (key === 'devMode') { applyDevMode(); applyTheme(); }
  if (key === 'userName') { _greet.key = ''; renderSidebar(); if (S.mode !== 'custom') renderView(); }
  if (S.mode === 'custom' && (key.startsWith('memory') || key === 'activeStyle') && typeof rerenderCustom === 'function') rerenderCustom();
  if (key === 'language') { S.lang = resolveLang(); document.documentElement.lang = S.lang; renderSidebar(); renderView(); }
  if (key.startsWith('hotkey')) S.hotkeyStatus = await api.hotkey.apply();
  if (key.startsWith('localApi')) S.localApiStatus = await api.localApi.apply();
  if (key === 'engine.energy') api.engine.energy();
  if (key.startsWith('engine.') && typeof refreshPlans === 'function') refreshPlans();
  renderSettings();
}

// ───────────────────────────── Global events ─────────────────────────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) { return; }
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  let v = el.value;
  if (el.dataset.type === 'int') v = parseInt(v, 10) || 0;
  if (el.dataset.type === 'float') v = parseFloat(v);
  applySetting(el.dataset.input, v);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.type === 'range') { const rv = el.parentElement.querySelector('.rv'); if (rv) rv.textContent = el.dataset.input === 'engine.gpuLayers' && +el.value < 0 ? t('auto') : el.value; }
  if (el.matches('textarea[data-input]')) debouncedText(el);
});
const debouncedText = debounce((el) => saveSettings(patchFor(el.dataset.input, el.value)), 500);

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="hf-search"]');
  if (!f) return;
  e.preventDefault();
  const q = new FormData(f).get('q').trim();
  if (!q) return;
  S.search = { q, loading: true, results: null, repo: null, files: null };
  renderSettings();
  try { S.search.results = await api.models.search(q); } catch (err) { S.search.results = []; toast(err.message, 'err'); }
  S.search.loading = false;
  renderSettings();
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if ($('#popover-root').innerHTML) return closePopover();
    if (S.settingsTab) return closeSettings();
    if (S.viewer) return closeViewer();
    if (S.streaming) api.chat.abort(S.streaming.reqId);
  }
  if (mod && e.key === ',') { e.preventDefault(); openSettings('general'); }
  if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); actions['focus-search'](); }
  if (mod && (e.key === 'n' || e.key === 'N') && !e.shiftKey) { e.preventDefault(); newChat(); }
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); actions['toggle-sidebar'](); }
});

$('#file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'drop' && e.dataTransfer.files.length && S.mode === 'chat') addFiles([...e.dataTransfer.files]);
}));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// IPC events
api.on('chat:event', (ev) => onChatEvent(ev)); // late-bound: voice mode wraps onChatEvent
api.on('app:command', ({ cmd }) => { if (cmd === 'new-chat') newChat(); });
api.on('quick:run', async ({ text, target }) => {
  if (S.streaming) { api.quick.started({ reqId: null, error: t('quickBusy') }); return; }
  if (!currentModel()) { api.quick.started({ reqId: null, error: t('noModel') }); return; }
  if (target === 'new' || !S.conv) { S.conv = null; S.code.clear(); S._draft = ''; navTo('chat', null); }
  S.mode = 'chat';
  await sendPrompt(text, { quick: true });
  if (S.streaming) api.quick.started({ reqId: S.streaming.reqId, convId: S.conv.id, title: S.conv.title, model: currentModel()?.label });
});
api.on('engine:status', (s) => {
  const wasReady = S.engine.status === 'ready';
  S.engine = { ...S.engine, ...s };
  if (!wasReady && s.status === 'ready') { document.body.classList.add('engine-pop'); setTimeout(() => document.body.classList.remove('engine-pop'), 900); }
  if (document.activeElement?.id !== 'sb-q') renderSidebar();
  const sc = $('.setup-card'); if (sc && S.catalog) sc.outerHTML = renderSetupCard();
  if (S.settingsTab === 'engine' || (S.settingsTab === 'models' && S.modelOpen)) renderSettings();
});
const refreshAfterDl = debounce(async () => {
  await refreshModels(); S.catalog = await api.models.catalog();
  renderSidebar(); if (S.mode === 'chat' && (!S.conv || !S.conv.messages.length)) renderView(); renderSettings();
}, 200);
api.on('models:progress', (p) => {
  if (p.kind) return; // move / verify progress → models-ui.js
  S.downloads[p.id] = p;
  if (p.status === 'done') { toast(t('downloadDone', { name: p.model?.name || '' })); delete S.downloads[p.id]; refreshAfterDl(); return; }
  if (p.status === 'error') { toast(`${t('downloadFailed')}: ${p.error}`, 'err'); delete S.downloads[p.id]; refreshAfterDl(); return; }
  if (p.status === 'cancelled') { delete S.downloads[p.id]; refreshAfterDl(); return; }
  // cheap in-place progress update
  const els = $$(`[data-dl="${CSS.escape(p.id)}"]`);
  const rowEl = $(`[data-dl-row="${CSS.escape(p.id)}"]`);
  if (rowEl && typeof dlRow === 'function') rowEl.outerHTML = dlRow(p);
  if (els.length) els.forEach((el) => { el.outerHTML = renderProgress(p); });
  if (rowEl || els.length) return;
  else { if (S.settingsTab === 'models') renderSettings(); if (!S.conv || !S.conv.messages.length) { const sc = $('.setup-card'); if (sc) sc.outerHTML = renderSetupCard(); } }
});
api.on('updater:status', (u) => { const was = S.updater.state; S.updater = u; if (u.state === 'ready' && was !== 'ready') maybeShowUpdate(); renderTopbar(); if (S.settingsTab === 'general') renderSettings(); });

// ───────────────────────────── Boot ─────────────────────────────
// Boot once every renderer script (chat-ui, models-ui…) is loaded.
window.addEventListener('DOMContentLoaded', async function boot() {
  [S.info, S.settings] = await Promise.all([api.info(), api.settings.get()]);
  document.body.classList.add('platform-' + S.info.platform, 'booting');
  setTimeout(() => document.body.classList.remove('booting'), 1600);
  S.lang = resolveLang();
  document.documentElement.lang = S.lang;
  applyTheme();
  applyDevMode();
  [S.convs, S.engine, S.memories] = await Promise.all([api.conv.list(), api.engine.status(), api.memory.list().catch(() => [])]);
  await refreshModels();
  navTo('chat', null);
  renderSidebar(); renderView(); renderViewer();
  S.specs = await api.system.specs();
  S.catalog = await api.models.catalog();
  if (!allModels().length && S.mode === 'chat' && !S.conv) renderView();
});
