'use strict';
/* Settings (v0.2): five sections — My account · My models · My Fabro · Resources · Advanced (sub-tabs).
   Loaded right after app.js. Owns openSettings / closeSettings / renderSettings / settingsBody.

   · Old deep links keep working: openSettings('providers'|'engine'|'agent'|'storage'|'usage'|'system'|'mods'|'anywhere'…)
     land on the section that now holds that content (and scroll to it). New ones: 'account', 'models', 'fabro',
     'resources', 'advanced', 'advanced:<sub>', 'models#storage'.
   · settingsBody(leaf) still returns the old pages' HTML (other files wrap it: Anywhere, Mods) — sections are built
     from those pieces.
   · stShows(leaf) tells other files whether what they show is on screen (replaces `S.settingsTab === 'x'`).
   · Live blocks (accounts, themes, model finder, Resources, Mon Fabro, MCP / skills import, lab, prompts…) are
     "mounts": rendered once by their module and kept across re-renders of the panel (the panel re-renders often). */

const TABS = [ // legacy list: kept because other files splice their tab in (anywhere-ui, mods-ui). Not drawn.
  { id: 'general' }, { id: 'models' }, { id: 'engine' }, { id: 'storage' }, { id: 'providers' }, { id: 'usage' }, { id: 'agent' },
  { id: 'shortcut' }, { id: 'generation' }, { id: 'system' }, { id: 'about' },
];
const ST_SECTIONS = [
  { id: 'account', icon: 'user' }, { id: 'models', icon: 'box' }, { id: 'fabro', icon: 'sparkle' },
  { id: 'resources', icon: 'chart' }, { id: 'advanced', icon: 'sliders' },
];
const ST_SUBS = [
  { id: 'connectors', icon: 'plug' }, { id: 'skills', icon: 'book' }, { id: 'agent', icon: 'agent' }, { id: 'engine', icon: 'zap' },
  { id: 'voice', icon: 'waveform' }, { id: 'shortcuts', icon: 'key' }, { id: 'localapi', icon: 'server' }, { id: 'mods', icon: 'puzzle' },
  { id: 'tasks', icon: 'tasks' }, { id: 'updates', icon: 'download' }, { id: 'developer', icon: 'flask' }, { id: 'prompts', icon: 'edit' },
  { id: 'about', icon: 'info' },
];
// old tab id → [section, sub, anchor]
const ST_LEGACY = {
  general: ['account'], providers: ['account', null, 'keys'], anywhere: ['account', null, 'anywhere'], keys: ['account', null, 'keys'],
  models: ['models'], storage: ['models', null, 'storage'],
  usage: ['resources', null, 'usage'], fabro: ['fabro'], memory: ['fabro'], resources: ['resources'], account: ['account'],
  engine: ['advanced', 'engine'], generation: ['advanced', 'engine', 'gen'], agent: ['advanced', 'agent'], mcp: ['advanced', 'connectors'],
  shortcut: ['advanced', 'shortcuts'], mods: ['advanced', 'mods'], system: ['advanced', 'updates'], about: ['advanced', 'about'],
  advanced: ['advanced'],
};
// which old pages a view shows (for stShows)
const ST_LEAVES = {
  account: ['general', 'providers', 'anywhere'], models: ['models', 'storage'], fabro: ['fabro'], resources: ['resources', 'usage'],
  'advanced:connectors': ['agent', 'mcp'], 'advanced:skills': ['agent', 'skills'], 'advanced:agent': ['agent'], 'advanced:engine': ['engine', 'generation', 'storage'],
  'advanced:voice': ['voice'], 'advanced:shortcuts': ['shortcut'], 'advanced:localapi': ['engine', 'localapi'], 'advanced:mods': ['mods'],
  'advanced:tasks': ['tasks'], 'advanced:updates': ['system', 'general', 'updates'], 'advanced:developer': ['system', 'developer'],
  'advanced:prompts': ['prompts'], 'advanced:about': ['about'],
};
const stView = () => (S.settingsTab === 'advanced' ? 'advanced:' + (S.settingsSub || 'connectors') : S.settingsTab);
function stShows(leaf) { return !!S.settingsTab && (ST_LEAVES[stView()] || []).includes(leaf); }

function stResolve(tab) {
  tab = String(tab || 'account');
  let anchor = null;
  if (tab.includes('#')) [tab, anchor] = tab.split('#');
  if (tab.startsWith('advanced:')) return { sec: 'advanced', sub: ST_SUBS.some((x) => x.id === tab.slice(9)) ? tab.slice(9) : 'connectors', anchor };
  if (ST_SUBS.some((x) => x.id === tab) && !ST_LEGACY[tab]) return { sec: 'advanced', sub: tab, anchor };
  const l = ST_LEGACY[tab] || (ST_SECTIONS.some((x) => x.id === tab) ? [tab] : ['account']);
  return { sec: l[0], sub: l[1] || (l[0] === 'advanced' ? S.settingsSub || 'connectors' : null), anchor: anchor || l[2] || null };
}

// What each view needs loaded (the old openSettings did this per tab).
const ST_LOAD = {
  account: () => { loadProviders(); if (S.aw) api.anywhere.status().then((s) => { S.aw.status = s; if (stShows('anywhere')) renderSettings(); }).catch(() => {}); },
  models: async () => {
    loadModelExtras();
    const jobs = [window.Accounts ? Accounts.models().catch(() => null) : null, api.resources.overview().catch(() => null), S.catalog ? null : api.models.catalog().catch(() => null)];
    const [acc, ov, cat] = await Promise.all(jobs);
    if (acc) S.accModels = acc; if (ov) S.resOverview = ov; if (cat) S.catalog = cat;
    if (stShows('models')) renderSettings();
  },
  resources: () => { loadUsage(); },
  'advanced:connectors': () => loadAgentSettings(),
  'advanced:skills': () => loadAgentSettings(),
  'advanced:agent': () => loadAgentSettings(),
  'advanced:engine': () => { loadModelExtras(); api.localApi.status().then((s) => { S.localApiStatus = s; }).catch(() => {}); },
  'advanced:localapi': () => api.localApi.status().then((s) => { S.localApiStatus = s; if (stShows('localapi')) renderSettings(); }).catch(() => {}),
  'advanced:shortcuts': () => loadHotkeyStatus(),
  'advanced:mods': () => { if (typeof loadMods === 'function') loadMods(); },
  'advanced:tasks': () => api.tasks.list().then((l) => { S.tasks = l; if (stShows('tasks')) renderSettings(); }).catch(() => {}),
  'advanced:updates': () => stLoadSystem(),
  'advanced:developer': () => stLoadSystem(),
};
function stLoadSystem() {
  Promise.all([api.runtime.status(), api.crash.list()]).then(([rt, cr]) => { S.rt = rt; S.crashes = cr; if (stShows('system')) renderSettings(); }).catch(() => {});
}

async function openSettings(tab = 'account') {
  const r = stResolve(tab);
  const before = S.settingsTab ? stView() : null;
  S.settingsTab = r.sec;
  if (r.sub) S.settingsSub = r.sub;
  S.stAnchor = r.anchor;
  closePopover();
  if (typeof stopMonitor === 'function') stopMonitor(); // the old engine monitor: Resources has live charts now
  renderSettings();
  const v = stView();
  if (before !== v || r.anchor) { const fn = ST_LOAD[v]; if (fn) try { await fn(); } catch { /* shown as loading */ } }
}
function closeSettings() {
  stUnmountAll();
  S.settingsTab = null; S._lastTab = null; S.stAnchor = null;
  const o = $('.overlay');
  if (o) { o.classList.add('closing'); setTimeout(() => { if (!S.settingsTab) { $('#overlay-root').innerHTML = ''; $('#prompt')?.focus(); } }, 160); }
}

// ───────────────────────────── mounts ─────────────────────────────
// <div data-mount="key"> filled once by its module; the node is kept across panel re-renders.
const ST_MOUNTS = {
  accounts: (el) => window.Accounts && Accounts.renderSection(el),
  themes: (el) => window.Themes && window.Themes.renderSection && Themes.renderSection(el),
  'model-finder': (el) => window.ModelFinder && ModelFinder.renderSection && ModelFinder.renderSection(el),
  resources: (el) => window.ResourcesUI && ResourcesUI.mount(el),
  myfabro: (el) => window.MyFabroUI && MyFabroUI.mount(el),
  'mcp-easy': (el) => window.McpEasy && McpEasy.renderSection(el),
  'skills-import': (el) => window.SkillsImport && SkillsImport.renderSection(el),
  devlab: (el) => window.DevLab && DevLab.renderSection(el),
  sysprompts: (el) => window.SysPrompts && SysPrompts.renderSection(el),
  notebook: (el) => window.Notebook && Notebook.renderSection(el),
  guides: (el) => window.Guides && Guides.renderSection(el),
};
const stMounted = new Map(); // key → element (with its module's content)
function stUnmountAll() {
  for (const [k, el] of stMounted) { const m = ST_UNMOUNT[k]; if (m) try { m(el); } catch {} }
  stMounted.clear();
}
const ST_UNMOUNT = {
  resources: (el) => window.ResourcesUI && ResourcesUI.unmount && ResourcesUI.unmount(el),
  myfabro: (el) => window.MyFabroUI && MyFabroUI.unmount && MyFabroUI.unmount(el),
};
const mount = (key, id) => `<div class="st-mount" data-mount="${key}"${id ? ` id="${id}"` : ''}></div>`;

// ───────────────────────────── render ─────────────────────────────
function renderSettings(keepScroll = true) {
  if (!S.settingsTab) return;
  const view = stView();
  let ov = $('#overlay-root .overlay.st-ov');
  if (!ov) {
    $('#overlay-root').innerHTML = `<div class="overlay st-ov" data-action="overlay-bg">
      <div class="st-panel" role="dialog" aria-modal="true" aria-labelledby="st-title">
        <nav class="st-nav" aria-label="${esc(t('settings'))}"><div class="st-heading">${esc(t('settings'))}</div><div class="st-tabs"></div></nav>
        <div class="st-main">
          <div class="st-top"><h2 id="st-title"></h2><button class="icon-btn" data-action="close-settings" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">${icon('x')}</button></div>
          <div class="st-content"></div>
        </div>
      </div></div>`;
    ov = $('#overlay-root .overlay');
    requestAnimationFrame(() => ov.classList.add('shown'));
  }
  $('.st-tabs', ov).innerHTML = ST_SECTIONS.map((x) => `<button class="st-tab ${S.settingsTab === x.id ? 'active' : ''}" data-action="settings-tab" data-tab="${x.id}" ${S.settingsTab === x.id ? 'aria-current="page"' : ''}>${icon(x.icon, 17)}<span>${esc(t('st_sec_' + x.id))}</span></button>`).join('');
  $('#st-title').textContent = t('st_sec_' + S.settingsTab);
  const content = $('.st-content', ov);
  const same = content.dataset.view === view;
  const scroll = keepScroll && same ? content.scrollTop : 0;
  // keep what the user is typing in forms across re-renders (live status updates re-render the panel)
  const kept = $$('.st-content form[data-form] [name]').map((el) => [el.closest('form').dataset.form + '|' + el.name, el.value]);
  const af = document.activeElement;
  const focused = af && af.closest('.st-content form[data-form]') ? af.closest('form').dataset.form + '|' + af.name : null;
  const focusedInput = af && content.contains(af) && !af.closest('[data-mount]') && af.matches('[data-input],[data-prof]') ? (af.dataset.input || af.dataset.prof + '|' + af.dataset.key) : null;
  // take live mounts out before replacing the HTML
  if (!same) stUnmountAll();
  for (const el of $$('[data-mount]', content)) if (stMounted.has(el.dataset.mount)) el.remove();
  content.innerHTML = stBody(view);
  content.dataset.view = view;
  for (const ph of $$('[data-mount]', content)) {
    const k = ph.dataset.mount; const live = stMounted.get(k);
    if (live) { ph.replaceWith(live); continue; }
    stMounted.set(k, ph);
    try { const r = ST_MOUNTS[k] && ST_MOUNTS[k](ph); if (r && r.catch) r.catch((e) => console.warn('settings mount', k, e)); } catch (e) { console.warn('settings mount', k, e); }
  }
  for (const [k, v] of kept) { const [f, n] = k.split('|'); const el = $(`.st-content form[data-form="${f}"] [name="${n}"]`); if (el && !el.value) el.value = v; }
  if (focused) { const [f, n] = focused.split('|'); $(`.st-content form[data-form="${f}"] [name="${n}"]`)?.focus(); }
  else if (focusedInput) { const [a, b] = focusedInput.split('|'); (b ? $(`.st-content [data-prof="${CSS.escape(a)}"][data-key="${CSS.escape(b)}"]`) : $(`.st-content [data-input="${CSS.escape(a)}"]`))?.focus(); }
  content.scrollTop = scroll;
  if (!same) {
    content.classList.remove('tab-in'); void content.offsetWidth; content.classList.add('tab-in');
    const sub = $('.st-subtabs .on', content); if (sub && sub.scrollIntoView) sub.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (S.stAnchor) {
    const a = $(`[data-anchor="${CSS.escape(S.stAnchor)}"]`, content);
    if (a) { if (a.tagName === 'DETAILS') a.open = true; requestAnimationFrame(() => a.scrollIntoView({ block: 'start' })); }
    S.stAnchor = null;
  }
  S._lastTab = view;
}

function stBody(view) {
  if (view === 'account') return stAccount();
  if (view === 'models') return stModels();
  if (view === 'fabro') return mount('myfabro');
  if (view === 'resources') return stResources();
  if (view.startsWith('advanced:')) return stAdvanced(view.slice(9));
  return '';
}
const stGroup = (title, body, { anchor, intro, icon: ic } = {}) => `<section class="st-group"${anchor ? ` data-anchor="${anchor}"` : ''}>
  <h3 class="st-gh">${ic ? icon(ic, 16) : ''}<span>${esc(title)}</span></h3>${intro ? `<p class="st-intro">${esc(intro)}</p>` : ''}${body}</section>`;
const stMore = (label, body, anchor) => `<details class="st-more"${anchor ? ` data-anchor="${anchor}"` : ''}><summary>${icon('right', 14)}<span>${esc(label)}</span></summary><div class="st-more-body">${body}</div></details>`;

// Old pages, by id (others wrap this: Anywhere adds 'anywhere', Mods adds 'mods' and rows to 'shortcut').
function settingsBody(tab) {
  if (tab === 'models') return modelsTab();
  if (tab === 'providers') return providersTab();
  if (tab === 'shortcut') return shortcutTab();
  if (tab === 'engine') return engineTab();
  if (tab === 'storage') return storageTab();
  if (tab === 'usage') return usageTab();
  if (tab === 'agent') return agentTab();
  if (tab === 'about') return stAbout();
  return '';
}

// ───────────────────────────── My account ─────────────────────────────
function resolveLangAuto() { const s = S.settings.language; S.settings.language = 'auto'; const l = resolveLang(); S.settings.language = s; return l; }
function stAccount() {
  const st = S.settings;
  const langOpts = [['auto', t('langAuto', { l: LANGS[resolveLangAuto()] || 'English' })], ...Object.entries(LANGS)]
    .map(([v, l]) => `<option value="${v}" ${st.language === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const styles = typeof styleList === 'function' ? styleList() : [];
  const cur = typeof activeStyle === 'function' ? activeStyle() : null;
  return `
    ${mount('accounts')}
    ${stGroup(t('st_callYou'), `
      ${row(t('yourName'), `<input class="input" type="text" maxlength="40" data-input="userName" value="${esc(st.userName || '')}" placeholder="${esc(prettyName(S.info.userName) || t('yourName'))}">`, t('yourNameHint'))}
      ${row(t('st_aiName'), `<input class="input" type="text" maxlength="30" data-input="aiName" value="${esc(st.aiName || '')}" placeholder="Fabro">`, t('st_aiNameHint'))}`, { icon: 'user' })}
    ${stGroup(t('st_instructions'), `
      <div class="st-block"><div class="st-label"><span>${esc(t('systemPrompt'))}</span><small>${esc(t('systemPromptHint'))}</small></div>
        <textarea class="input area" rows="4" data-input="gen.systemPrompt" placeholder="${esc(t('systemPromptPh'))}" aria-label="${esc(t('systemPrompt'))}">${esc((st.gen || {}).systemPrompt || '')}</textarea></div>
      ${styles.length ? row(t('responseStyles'), `<select class="input" data-input="activeStyle" aria-label="${esc(t('responseStyles'))}">${styles.map((s) => `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`,
        t('st_stylesHint')) : ''}
      <p class="st-foot"><button class="link-btn" data-action="st-custom-page">${icon('brush', 13)} ${esc(t('st_stylesMore'))}</button></p>`, { anchor: 'instructions', icon: 'edit' })}
    ${stGroup(t('st_look'), `
      ${row(t('language'), `<select class="input" data-input="language" aria-label="${esc(t('language'))}">${langOpts}</select>`)}
      ${row(t('theme'), seg('theme', st.theme, [['system', t('themeSystem'), 'monitor'], ['light', t('themeLight'), 'sun'], ['dark', t('themeDark'), 'moon'], ...(spookySeason() || st.theme === 'halloween' ? [['halloween', t('themeHalloween'), 'pumpkin']] : [])]))}
      ${mount('themes', 'set-themes')}
      ${row(t('reduceMotion'), toggle('reduceMotion', !!st.reduceMotion), t('reduceMotionHint'))}
      ${row(t('lightMode'), toggle('lightMode', lightModeOn()), t(S.specs && S.specs.lowPower ? 'lightModeHintLow' : 'lightModeHint'))}`, { icon: 'brush' })}
    ${stGroup(t('st_keys'), providersTab(), { anchor: 'keys', intro: t('st_keysIntro'), icon: 'cloud' })}
    ${stGroup(t('st_anywhere'), settingsBody('anywhere'), { anchor: 'anywhere', icon: 'phone' })}`;
}

// ───────────────────────────── My models ─────────────────────────────
// Plain words for how a model runs (autotune when loaded, the memory plan otherwise).
function stTuneText(m) {
  const ld = (S.resOverview && S.resOverview.loaded || []).find((l) => l.id === m.id);
  const sum = ld && ((ld.tuning && ld.tuning.summary) || ld.auto);
  const bits = [];
  const how = (mode) => ({ gpu: t('st_runGpu'), split: t('st_runSplit'), moe: t('st_runMoe'), cpu: t('st_runCpu') })[mode];
  if (sum) {
    if (how(sum.mode)) bits.push(how(sum.mode));
    if (sum.threads) bits.push(t('st_runThreads', { n: sum.threads }));
    if (sum.ctx) bits.push(t('st_runCtx', { n: Math.round(sum.ctx / 1024) }));
    if (sum.tokPerSec) bits.push(t('st_runSpeed', { n: Math.round(sum.tokPerSec) }));
    return { text: bits.join(' · '), now: true };
  }
  const pl = (S.plans || {})[m.id];
  if (!pl) return null;
  bits.push(({ gpu: t('st_willGpu'), split: t('st_willSplit'), moe: t('st_willMoe'), cpu: t('st_willCpu') })[pl.mode] || '');
  if (!pl.fits) bits.push(t('st_tight'));
  return { text: bits.filter(Boolean).join(' · '), now: false };
}
function stModelRow(m) {
  let h = modelRow(m);
  const tune = stTuneText(m);
  const tier = m.tier ? `<span class="chip tier tier-${esc(m.tier)}">${esc(t('st_tier_' + m.tier) !== 'st_tier_' + m.tier ? t('st_tier_' + m.tier) : m.tier)}</span>` : '';
  if (tier) h = h.replace('</b>', ` ${tier}</b>`);
  if (tune && tune.text) h = h.replace('</small></div>', `</small><small class="st-tune ${tune.now ? 'now' : ''}">${icon(tune.now ? 'zap' : 'info', 12)} ${esc(tune.text)}</small></div>`);
  return h;
}
function stDefaultModel() {
  const list = allModels().filter((m) => !m.mod);
  if (!list.length) return '';
  const cur = refKey(S.settings.selectedModel);
  return row(t('st_defaultModel'), `<select class="input" data-st-model aria-label="${esc(t('st_defaultModel'))}">${cur ? '' : `<option value="">—</option>`}${list.map((m) => `<option value="${esc(refKey(m.ref))}" ${refKey(m.ref) === cur ? 'selected' : ''}>${esc(m.provider ? `${m.provider} · ${m.label}` : m.label)}</option>`).join('')}</select>`, t('st_defaultModelHint'));
}
function stModels() {
  const loc = S.installed.local;
  const dls = Object.values(S.downloads).filter((d) => ['queued', 'downloading', 'paused', 'verifying'].includes(d.status));
  const others = ((S.accModels || {}).others || []).filter((o) => !loc.some((m) => m.id === o.id));
  const provRows = (S.provModels || []).length ? `<button class="m-row link-row" data-action="settings-tab" data-tab="providers">
      <div class="m-ico">${icon('cloud', 18)}</div><div class="m-text"><b>${esc(t('provModelsCount', { n: S.provModels.length }))}</b><small>${esc([...new Set(S.provModels.map((m) => m.providerName))].join(' · '))}</small></div>${icon('right', 16)}</button>` : '';
  return `
    ${stDefaultModel()}
    ${stGroup(t('yourModels'), `<p class="st-intro">${esc(t('st_modelsIntro'))}</p>${loc.length || provRows ? loc.map(stModelRow).join('') + provRows : `<div class="empty-note">${esc(t('noModelsYet'))}</div>`}
      ${dls.length ? `<div class="st-sec">${esc(t('downloads'))}</div><div class="dl-list">${dls.map(dlRow).join('')}</div>` : ''}`, { icon: 'box' })}
    ${others.length ? stGroup(t('st_others'), `<div class="list">${others.map((o) => `<div class="list-row"><div class="m-ico">${icon('box', 17)}</div>
        <div class="m-text"><b>${esc(o.name)}</b><small>${esc(fmtBytes(o.sizeBytes))} · ${esc(t('st_othersNoDl'))}</small></div>
        <button class="btn sm" data-action="st-link-model" data-id="${esc(o.id)}">${icon('plus', 14)} ${esc(t('st_useToo'))}</button></div>`).join('')}</div>`, { intro: t('st_othersIntro'), icon: 'user' }) : ''}
    ${mount('model-finder', 'set-model-finder')}
    ${stGroup(t('st_install'), catalogBlock() + hfSearchBlock(), { icon: 'download', anchor: 'install' })}
    ${stMore(t('st_where'), librariesBlock() + importBlock(), 'storage')}`;
}

// ───────────────────────────── Resources ─────────────────────────────
function stResources() {
  return `${mount('resources')}
    ${stMore(t('st_usage'), usageTab(), 'usage')}`;
}

// ───────────────────────────── Advanced ─────────────────────────────
function stAdvanced(sub) {
  const tabs = `<div class="st-subtabs tabs" role="tablist" aria-label="${esc(t('st_sec_advanced'))}">${ST_SUBS.map((x) => `<button role="tab" class="${sub === x.id ? 'on' : ''}" aria-selected="${sub === x.id}" data-action="settings-tab" data-tab="advanced:${x.id}">${icon(x.icon, 14)}<span>${esc(t('st_sub_' + x.id))}</span></button>`).join('')}</div>`;
  return `${tabs}<div class="st-subbody" role="tabpanel">${stSubBody(sub)}</div>`;
}
function stSubBody(sub) {
  const st = S.settings;
  const g = st.gen || {};
  switch (sub) {
    case 'connectors': return `<p class="st-intro">${esc(t('st_connIntro'))}</p>${window.McpEasy ? mount('mcp-easy', 'set-mcp-easy') : mcpHtml()}`;
    case 'skills': return `${window.SkillsImport ? mount('skills-import', 'set-skills-import') : skillsHtml()}${agentToolsHtml()}`;
    case 'agent': return agentCoreHtml() + computerSection();
    case 'engine': {
      const range = (k, min, max, step, v) => `<div class="range-wrap"><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-input="gen.${k}" data-type="float" aria-label="${esc(k)}"><span class="rv">${v}</span></div>`;
      return engineCoreHtml() + `
        <div class="st-sec" data-anchor="gen">${esc(t('tab_generation'))}</div>
        ${row(t('temperature'), range('temperature', 0, 2, 0.05, g.temperature), t('temperatureHint'))}
        ${row('Top P', range('topP', 0.05, 1, 0.05, g.topP))}
        ${row(t('maxTokens'), `<input class="input sm" type="number" min="0" max="131072" value="${g.maxTokens}" data-input="gen.maxTokens" data-type="int" aria-label="${esc(t('maxTokens'))}">`, t('maxTokensHint'))}
        ${row(t('st_autoTitle'), toggle('autoTitle', st.autoTitle !== false), t('st_autoTitleHint'))}
        ${downloadOptsBlock()}`;
    }
    case 'voice': {
      const pref = st.voiceModel || 'same';
      const opts = allModels().filter((m) => !m.mod).map((m) => `<option value="${esc(refKey(m.ref))}" ${pref === refKey(m.ref) ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
      const lv = Object.entries(st.localVoices || {});
      return `<p class="st-intro">${esc(t('st_voiceIntro'))}</p>
        ${row(t('vx_model'), `<select class="input" data-input="voiceModel" aria-label="${esc(t('vx_model'))}"><option value="same" ${pref === 'same' ? 'selected' : ''}>${esc(t('vx_modelSame'))}</option><option value="auto" ${pref === 'auto' ? 'selected' : ''}>${esc(t('vx_modelAuto'))}</option>${opts}</select>`, t('vx_modelHint'))}
        ${row(t('st_voices'), lv.length ? `<span class="muted small">${esc(lv.map(([l, v]) => `${l.toUpperCase()} · ${v}`).join(', '))}</span>` : `<span class="muted small">${esc(t('auto'))}</span>`, t('st_voicesHint'))}
        ${row(t('st_voiceTry'), `<button class="btn sm" data-action="st-voice">${icon('waveform', 14)} ${esc(t('st_voiceOpen'))}</button>`)}`;
    }
    case 'shortcuts': return settingsBody('shortcut');
    case 'localapi': return localApiHtml();
    case 'mods': return settingsBody('mods');
    case 'tasks': {
      const n = (S.tasks || []).length;
      return `<p class="st-intro">${esc(t('st_tasksIntro'))}</p>
        ${row(t('st_tasksCount', { n }), `<button class="btn sm" data-action="st-open-page" data-page="tasks">${icon('tasks', 14)} ${esc(t('open'))}</button>`, t('st_tasksHint'))}`;
    }
    case 'updates':
      return `${row(t('autoUpdate'), toggle('autoUpdate', st.autoUpdate), t('autoUpdateHint'))}
        ${row(t('appVersion'), `<span class="mono">v${esc(S.info.version)}</span> <button class="btn sm" data-action="check-update">${esc(t('checkUpdates'))}</button>`, updaterText())}
        <div class="st-sec">${esc(t('tel_title'))}</div>
        <p class="st-intro">${esc(t('tel_hint'))}</p>
        ${row(t('tel_crash'), toggle('telemetry.crashReports', !!(st.telemetry || {}).crashReports), t('tel_crashHint'))}
        ${(S.crashes || []).length ? row(t('tel_saved', { n: S.crashes.length }), `<button class="btn sm" data-action="crash-folder">${icon('folder', 14)} ${esc(t('open'))}</button>${S.crashes[0] ? `<button class="btn sm" data-action="crash-report" data-f="${esc(S.crashes[0].file)}">${icon('share', 14)} ${esc(t('tel_send'))}</button>` : ''}`) : ''}`;
    case 'developer': {
      const sp = S.specs;
      const accel = sp ? { cuda: 'NVIDIA CUDA', metal: 'Apple Metal', vulkan: 'Vulkan', cpu: 'CPU' }[sp.accel] : '';
      return `${row(t('devMode'), toggle('devMode', st.devMode), t('devModeHint'))}
        ${st.devMode ? row(t('devTools'), `<button class="btn sm" data-action="devtools">${icon('terminal', 14)} ${esc(t('open'))}</button>`, 'F12 · Ctrl+Shift+I · Ctrl+R') : ''}
        ${row(t('rt_runtime'), `<span class="chip ${S.rt && S.rt.isolated ? 'ok' : ''}">${esc(S.rt ? (S.rt.isolated ? t('rt_isolated', { p: S.rt.pid || '—' }) : t('rt_inprocess')) : '…')}</span>`, t('rt_hint'))}
        ${sp ? `<div class="st-sec">${esc(t('tab_system'))}</div><div class="spec-grid">
          <div class="spec"><small>${esc(t('os'))}</small><b>${esc(sp.os)} · ${esc(sp.arch)}</b></div>
          <div class="spec"><small>CPU</small><b>${esc(sp.cpu.model)}</b><span>${sp.cpu.threads} threads</span></div>
          <div class="spec"><small>RAM</small><b>${sp.ramGB} GB</b></div>
          <div class="spec"><small>${esc(t('acceleration'))}</small><b>${esc(accel)}</b></div>
          ${sp.gpus.map((x) => `<div class="spec wide"><small>GPU</small><b>${esc(x.name)}</b><span>${x.vramGB ? x.vramGB + ' GB VRAM' : sp.unified ? t('unifiedMemory') : ''}</span></div>`).join('')}
        </div><p class="muted small">${esc(t('budgetNote', { g: sp.gpuBudgetGB, r: sp.ramBudgetGB }))}</p>` : ''}
        ${window.DevLab ? mount('devlab', 'set-devlab') : ''}`;
    }
    case 'prompts': {
      const any = window.SysPrompts || window.Notebook || window.Guides;
      return `<p class="st-intro">${esc(t('st_promptsIntro'))}</p>
        ${window.SysPrompts ? mount('sysprompts', 'set-sysprompts') : ''}${window.Notebook ? mount('notebook', 'set-notebook') : ''}${window.Guides ? mount('guides', 'set-guides') : ''}
        ${any ? '' : `<div class="empty-note">${esc(t('st_promptsEmpty'))} <button class="link-btn" data-action="settings-tab" data-tab="account#instructions">${esc(t('st_instructions'))}</button></div>`}`;
    }
    case 'about': return stAbout();
  }
  return '';
}
function stAbout() {
  return `<div class="about">${logo(56)}<h3>Fabro</h3><p class="muted">v${esc(S.info.version)} · ${esc(t('tagline'))}</p>
    <p class="small">${esc(t('taglineLong'))}</p><p class="small muted">${esc(t('aboutText'))}</p>
    <p class="small"><a href="https://github.com/ggml-org/llama.cpp" data-action="ext-link">llama.cpp</a> · <a href="https://huggingface.co/models?library=gguf" data-action="ext-link">Hugging Face</a> · <a href="https://ollama.com" data-action="ext-link">Ollama</a></p></div>`;
}
function updaterText() {
  const u = S.updater;
  return ({ checking: t('upd_checking'), latest: t('upd_latest'), downloading: t('upd_downloading', { p: Math.round((u.progress || 0) * 100) }), ready: t('upd_ready', { v: u.version || '' }), error: t('upd_error'), dev: t('upd_dev') })[u.state] || '';
}

// ───────────────────────────── actions ─────────────────────────────
Object.assign(actions, {
  'st-link-model': async (el) => {
    el.disabled = true;
    try { await Accounts.linkModel(el.dataset.id); S.accModels = await Accounts.models(); await refreshModels(); toast(t('st_linked')); }
    catch (e) { toast(cleanErr(e), 'err'); }
    renderSettings(); renderSidebar(); refreshComposer();
  },
  'st-custom-page': () => { closeSettings(); S.mode = 'custom'; navTo('custom', null); renderSidebar(); renderView(); },
  'st-open-page': (el) => { closeSettings(); S.mode = el.dataset.page; navTo(S.mode, null); renderSidebar(); renderView(); },
  'st-voice': () => { closeSettings(); if (actions['voice-mode']) actions['voice-mode'](); },
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('[data-st-model]')) return;
  const m = allModels().find((x) => refKey(x.ref) === el.value);
  if (!m) return;
  await saveSettings({ selectedModel: m.ref });
  renderSidebar(); refreshComposer(); renderSettings();
});
