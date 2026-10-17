'use strict';
/* Settings → Agent & extensions: allowed folders, tool permissions, dependencies, MCP servers, skills. */

async function loadAgentSettings() {
  try {
    [S.agentTools, S.mcp, S.skills, S.deps, S.imgStatus] = await Promise.all([api.agent.tools(), api.mcp.view(), api.skills.list(), api.deps.status(), api.images.status()]);
  } catch {}
  if (S.settingsTab === 'agent') renderSettings();
}
api.on('mcp:status', (v) => { S.mcp = v; if (S.settingsTab === 'agent') renderSettings(); });

const CAT_ORDER = ['files', 'shell', 'browser', 'documents', 'python', 'skills'];
function agentTab() {
  const ag = S.settings.agent || {};
  const tools = S.agentTools || [];
  const folders = ag.folders || [];
  const cats = [...new Set(tools.map((x) => (x.category.startsWith('mcp:') ? 'mcp' : x.category)))].sort((a, b) => (CAT_ORDER.indexOf(a) + 99) % 99 - (CAT_ORDER.indexOf(b) + 99) % 99);
  const pol = (x) => `<select class="input sm2 pol" data-tool="${esc(x.name)}">${['always', 'ask', 'never'].map((p) => `<option value="${p}" ${x.policy === p ? 'selected' : ''}>${esc(t('pol_' + p))}</option>`).join('')}</select>`;
  const mcp = S.mcp || [];
  const skills = S.skills || [];
  const py = (S.deps || {}).python || {};
  const add = S.mcpAdd;
  const srch = S.settings.search || {}; const br = S.settings.browser || {}; const sx = (S.deps || {}).searxng || {};
  const depBtn = (dep, ok) => ok ? `<span class="chip ok">${icon('check', 13)} ${esc(t('installed'))}</span>`
    : S.depsBusy === dep ? `<span class="muted small">${spinner(14)} ${Math.round((S.depsP || 0) * 100)} %</span>`
    : `<button class="btn sm" data-action="deps-now" data-dep="${dep}" ${S.depsBusy ? 'disabled' : ''}>${icon('download', 14)} ${esc(t('installDeps'))}</button>`;
  return `
    ${row(t('agentEnable'), toggle('agent.enabled', ag.enabled !== false), t('agentEnableHint'))}
    <div class="st-sec">${esc(t('agFolders'))}<span class="grow"></span><button class="btn sm" data-action="ag-folder-add">${icon('plus', 14)} ${esc(t('libAdd'))}</button></div>
    <p class="muted small st-intro">${esc(t('agFoldersHint'))}</p>
    <div class="lib-list">${folders.length ? folders.map((f) => `<div class="lib-row"><div class="m-ico">${icon('folder', 17)}</div><div class="m-text"><small class="mono">${esc(f)}</small></div><button class="icon-btn sm" data-action="ag-folder-rm" data-f="${esc(f)}" title="${esc(t('delete'))}">${icon('x', 15)}</button></div>`).join('') : `<div class="empty-note">${esc(t('agNoFolders'))}</div>`}</div>

    <div class="st-sec">${esc(t('agPerms'))}</div>
    <p class="muted small st-intro">${esc(t('agPermsHint'))}</p>
    <div class="perm-grid">${cats.map((c) => `<div class="pg-cat"><div class="pg-h">${icon(AGENT_ICONS[c] || 'puzzle', 14)} ${esc(t('agcat_' + c))}</div>
      ${tools.filter((x) => (x.category.startsWith('mcp:') ? 'mcp' : x.category) === c).map((x) => `<div class="pg-row"><span title="${esc(x.description)}"><b>${esc(x.name.replace(/^mcp__/, '').replace(/__/g, ' · '))}</b><small>${esc(t('risk_' + x.risk))}</small></span>${pol(x)}</div>`).join('')}</div>`).join('')}</div>

    <div class="st-sec">${esc(t('agDeps'))}</div>
    <div class="lib-row"><div class="m-ico">${icon('code', 17)}</div><div class="m-text"><b>Python 3.12</b><small>${esc(py.installed ? t('depsInstalled') : t('depsPython', { n: py.sizeMB || 32 }))}</small></div>
      ${depBtn('python', py.installed)}</div>
    <div class="lib-row"><div class="m-ico">${icon('git', 17)}</div><div class="m-text"><b>Git</b><small>${esc(t('depsGit'))}</small></div>${depBtn('git', (S.deps || {}).git)}</div>

    <div class="st-sec">${esc(t('img_title'))}</div>
    <p class="muted small st-intro">${esc(t('img_hint'))}</p>
    ${(() => { const im = S.imgStatus || {}; const pr = im.presets || {}; return Object.entries(pr).map(([k, p]) => `<div class="lib-row"><div class="m-ico">${icon('image', 17)}</div><div class="m-text"><b>${esc(p.name)}${k === im.recommended ? ` <span class="chip accent">${esc(t('recommended'))}</span>` : ''}</b><small>${esc(t('img_' + k))} · ≈ ${p.sizeGB} GB</small></div>
      ${p.ready && im.engine ? (im.preset === k ? `<span class="chip ok">${icon('check', 13)} ${esc(t('img_active'))}</span>` : `<button class="btn sm" data-action="img-use" data-k="${k}">${esc(t('img_use'))}</button>`) : S.depsBusy === 'images:' + k ? `<span class="muted small">${spinner(14)} ${Math.round((S.depsP || 0) * 100)} %</span>` : `<button class="btn sm" data-action="img-install" data-k="${k}" ${S.depsBusy ? 'disabled' : ''}>${icon('download', 14)} ${esc(t('installDeps'))}</button>`}</div>`).join(''); })()}

    <div class="st-sec">${esc(t('srchTitle'))}</div>
    <p class="muted small st-intro">${esc(t('srchHint'))}</p>
    ${row(t('srchEngine'), `<select class="input" data-input="search.engine">${[['searxng', 'SearXNG'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search'], ['ducky', 'Ducky']].map(([v, l]) => `<option value="${v}" ${(srch.engine || 'searxng') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    ${(srch.engine || 'searxng') === 'searxng' ? `
      <div class="lib-row"><div class="m-ico">${icon('search', 17)}</div><div class="m-text"><b>${esc(t('srchManaged'))}</b><small>${esc(sx.installed ? (sx.running ? t('srchRunning', { p: sx.port }) : t('srchStopped')) : t('srchNotInstalled'))}</small></div>
        ${sx.installed ? `<button class="btn sm" data-action="deps-rm" data-dep="searxng">${icon('trash', 14)}</button><span class="chip ok">${icon('check', 13)} ${esc(t('installed'))}</span>` : depBtn('searxng', false)}</div>
      ${row(t('srchOwnUrl'), `<input class="input mono" data-input="search.searxngUrl" value="${esc(srch.searxngUrl || '')}" placeholder="https://searx.example.org">`, t('srchOwnUrlHint'))}` : ''}
    ${srch.engine === 'ducky' ? row('Ducky URL', `<input class="input mono" data-input="search.duckyUrl" value="${esc(srch.duckyUrl || '')}" placeholder="https://…/api/search?q={q}">`) : ''}
    <div class="st-row"><div class="st-label"><span>${esc(t('srchTest'))}</span>${S.srchTest ? `<small>${esc(S.srchTest)}</small>` : ''}</div><div class="st-control"><button class="btn sm" data-action="srch-test">${S.srchTesting ? spinner(14) : icon('search', 14)} ${esc(t('srchTestGo'))}</button></div></div>

    <div class="st-sec">${esc(t('brTitle'))}</div>
    ${row(t('brAds'), toggle('browser.blockAds', br.blockAds !== false), t('brAdsHint'))}
    ${row(t('brConsent'), toggle('browser.autoConsent', br.autoConsent !== false), t('brConsentHint'))}
    ${row(t('brClear'), `<button class="btn sm" data-action="br-clear">${icon('trash', 14)} ${esc(t('brClearGo'))}</button>`, t('brClearHint'))}
    ${row(t('subagents'), toggle('agent.subagents', ag.subagents !== false), t('subagentsHint'))}

    <div class="st-sec">${esc(t('mcpTitle'))}<span class="grow"></span>
      <button class="btn sm" data-action="mcp-claude">${icon('download', 14)} ${esc(t('mcpImport'))}</button>
      <button class="btn sm" data-action="mcp-add-open">${icon('plus', 14)} ${esc(t('mcpAdd'))}</button></div>
    <p class="muted small st-intro">${esc(t('mcpHint'))}</p>
    ${add ? `<form class="prov-form" data-form="mcp-add">
      <div class="seg sm">${['stdio', 'http'].map((k) => `<button type="button" class="${add.type === k ? 'on' : ''}" data-action="mcp-type" data-v="${k}">${esc(t('mcp_' + k))}</button>`).join('')}</div>
      <label class="pf-field"><span>${esc(t('provName'))}</span><input class="input" name="name" placeholder="filesystem, github…" required></label>
      ${add.type === 'http' ? `<label class="pf-field"><span>URL</span><input class="input mono" name="url" placeholder="https://mcp.example.com/mcp" required></label>`
        : `<label class="pf-field"><span>${esc(t('mcpCommand'))}</span><input class="input mono" name="command" placeholder="npx -y @modelcontextprotocol/server-filesystem C:\\Users\\moi\\Documents" required></label>
           <label class="pf-field"><span>${esc(t('mcpEnv'))}</span><textarea class="input area mono" name="env" rows="2" placeholder="GITHUB_TOKEN=…"></textarea></label>`}
      ${S.mcpErr ? `<div class="pf-error">${icon('warning', 14)} ${esc(S.mcpErr)}</div>` : ''}
      <div class="pf-actions"><button type="button" class="btn sm" data-action="mcp-add-close">${esc(t('cancel'))}</button><button class="btn sm primary" type="submit">${icon('link', 14)} ${esc(t('provConnect'))}</button></div>
    </form>` : ''}
    ${S.claudeCfg ? `<div class="prov-form"><b>${esc(t('mcpFromClaude'))}</b><small class="muted mono">${esc(S.claudeCfg.path)}</small>
      ${S.claudeCfg.servers.length ? S.claudeCfg.servers.map((x, i) => `<label class="imp-row ${x.already ? 'done' : ''}"><input type="checkbox" data-cimp="${i}" ${x.already ? 'disabled' : 'checked'}><span class="m-text"><b>${esc(x.name)}</b><small class="mono">${esc(x.url || [x.command, ...(x.args || [])].join(' '))}</small></span></label>`).join('') : `<div class="muted small">${esc(t('mcpNoClaude'))}</div>`}
      <div class="pf-actions"><button class="btn sm" data-action="mcp-claude-close">${esc(t('cancel'))}</button>${S.claudeCfg.servers.some((x) => !x.already) ? `<button class="btn sm primary" data-action="mcp-claude-go">${esc(t('mcpImportGo'))}</button>` : ''}</div></div>` : ''}
    <div class="prov-list">${mcp.length ? mcp.map((m) => `<div class="prov-row ${m.status === 'off' ? 'off' : ''} ${m.status === 'error' ? 'err' : ''}">
        <span class="prov-tile" style="--s:36px;background:var(--panel);color:var(--text-2)">${icon('puzzle', 16)}</span>
        <div class="m-text"><b>${esc(m.name)}</b><small>${esc(m.type === 'http' ? m.url : [m.command, ...(m.args || [])].join(' '))}</small>
          <small class="mcp-st st-${m.status}">${m.status === 'ready' ? `<span class="ok-dot"></span>${esc(t('mcpReady', { n: m.tools.length }))}` : m.status === 'connecting' ? `${spinner(12)} ${esc(t('mcpConnecting'))}` : m.status === 'auth' ? `${icon('key', 12)} ${esc(t('mcpNeedsAuth'))}` : m.status === 'error' ? `${icon('warning', 12)} ${esc(m.error || '')}` : esc(t('mcpOff'))}</small></div>
        ${m.status === 'auth' ? `<button class="btn sm primary" data-action="mcp-signin" data-id="${esc(m.id)}">${esc(t('mcpSignIn'))}</button>` : ''}
        ${m.status === 'error' ? `<button class="icon-btn sm" data-action="mcp-retry" data-id="${esc(m.id)}" title="${esc(t('errRetry'))}">${icon('refresh', 16)}</button>` : ''}
        <button class="icon-btn sm" data-action="mcp-remove" data-id="${esc(m.id)}" title="${esc(t('delete'))}">${icon('trash', 16)}</button>
        ${toggleBtn('mcp-toggle', m.status !== 'off', `data-id="${esc(m.id)}"`)}
      </div>`).join('') : `<div class="empty-note">${esc(t('mcpEmpty'))}</div>`}</div>

    <div class="st-sec">${esc(t('skillsTitle'))}<span class="grow"></span><button class="btn sm" data-action="skills-folder">${icon('folder', 14)} ${esc(t('skillsOpen'))}</button><button class="btn sm" data-action="skills-refresh">${icon('refresh', 14)}</button></div>
    <p class="muted small st-intro">${esc(t('skillsHint'))}</p>
    <div class="prov-list">${skills.length ? skills.map((x) => `<div class="prov-row ${x.enabled ? '' : 'off'}"><span class="prov-tile" style="--s:36px;background:var(--accent-soft);color:var(--accent)">${icon('book', 16)}</span>
      <div class="m-text"><b>${esc(x.name)} <span class="src-badge">${esc(t('src_skill_' + x.source))}</span></b><small>${esc(x.description)}</small></div>${toggleBtn('skill-toggle', x.enabled, `data-name="${esc(x.name)}"`)}</div>`).join('') : `<div class="empty-note">${esc(t('skillsEmpty'))}</div>`}</div>`;
}

const parseCmd = (s) => (String(s).match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^["']|["']$/g, ''));
Object.assign(actions, {
  'ag-folder-add': async () => { const f = await api.agent.addFolder(); if (f) { S.settings = await api.settings.get(); renderSettings(); } },
  'ag-folder-rm': async (el) => { await api.agent.removeFolder(el.dataset.f); S.settings = await api.settings.get(); renderSettings(); },
  'img-install': async (el) => { S.depsBusy = 'images:' + el.dataset.k; S.depsP = 0; renderSettings(); try { S.imgStatus = await api.images.install(el.dataset.k); toast(t('depsDone')); } catch (e) { toast(cleanErr(e), 'err'); } S.depsBusy = false; renderSettings(); },
  'img-use': async (el) => { S.depsBusy = 'images:' + el.dataset.k; renderSettings(); try { S.imgStatus = await api.images.install(el.dataset.k); } catch (e) { toast(cleanErr(e), 'err'); } S.depsBusy = false; renderSettings(); },
  'deps-rm': async (el) => { await api.deps.remove(el.dataset.dep); S.deps = await api.deps.status(); renderSettings(); },
  'srch-test': async () => {
    S.srchTesting = true; S.srchTest = ''; renderSettings();
    const t0 = Date.now();
    try { const r = await api.search.test('Fabro AI'); S.srchTest = t('srchTestOk', { n: r.results.length, e: r.engine, ms: Date.now() - t0 }); } catch (e) { S.srchTest = cleanErr(e); }
    S.srchTesting = false; S.deps = await api.deps.status(); renderSettings();
  },
  'br-clear': async () => { await api.browser.control('clear'); toast(t('brCleared')); },
  'deps-now': async (el) => { S.depsBusy = el.dataset.dep; S.depsP = 0; renderSettings(); try { await api.deps.install(el.dataset.dep); toast(t('depsDone')); } catch (e) { toast(cleanErr(e), 'err'); } S.depsBusy = false; S.deps = await api.deps.status(); renderSettings(); },
  'mcp-add-open': () => { S.mcpAdd = { type: 'stdio' }; S.mcpErr = ''; renderSettings(); },
  'mcp-add-close': () => { S.mcpAdd = null; renderSettings(); },
  'mcp-type': (el) => { S.mcpAdd.type = el.dataset.v; renderSettings(); },
  'mcp-remove': async (el) => { if (!confirm(t('mcpRemoveConfirm'))) return; S.mcp = await api.mcp.remove(el.dataset.id); S.agentTools = await api.agent.tools(); renderSettings(); },
  'mcp-toggle': async (el) => { S.mcp = await api.mcp.toggle(el.dataset.id, el.dataset.value === 'true'); S.agentTools = await api.agent.tools(); renderSettings(); },
  'mcp-signin': async (el) => { try { S.mcp = await api.mcp.signIn(el.dataset.id); S.agentTools = await api.agent.tools(); } catch (e) { toast(cleanErr(e), 'err'); } renderSettings(); },
  'mcp-retry': async (el) => { S.mcp = await api.mcp.reconnect(el.dataset.id); S.agentTools = await api.agent.tools(); renderSettings(); },
  'mcp-claude': async () => { S.claudeCfg = await api.mcp.claudeConfig().catch((e) => ({ path: cleanErr(e), servers: [] })); renderSettings(); },
  'mcp-claude-close': () => { S.claudeCfg = null; renderSettings(); },
  'mcp-claude-go': async () => {
    const names = $$('[data-cimp]').filter((c) => c.checked && !c.disabled).map((c) => S.claudeCfg.servers[+c.dataset.cimp].name);
    S.claudeCfg = null; renderSettings();
    S.mcp = await api.mcp.importClaude(names); S.agentTools = await api.agent.tools(); renderSettings();
  },
  'skills-folder': () => api.skills.openFolder(),
  'skills-refresh': async () => { S.skills = await api.skills.list(); S.agentTools = await api.agent.tools(); renderSettings(); },
  'skill-toggle': async (el) => { S.skills = await api.skills.toggle(el.dataset.name, el.dataset.value === 'true'); renderSettings(); },
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.classList && el.classList.contains('pol')) { e.stopImmediatePropagation(); S.agentTools = await api.agent.policy(el.dataset.tool, el.value); renderSettings(); }
}, true);
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="mcp-add"]'); if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f).entries());
  const cfg = { name: d.name.trim() };
  if (S.mcpAdd.type === 'http') cfg.url = d.url.trim();
  else {
    const parts = parseCmd(d.command); cfg.command = parts[0]; cfg.args = parts.slice(1);
    cfg.env = Object.fromEntries(String(d.env || '').split('\n').map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  }
  try { S.mcp = await api.mcp.add(cfg); S.mcpAdd = null; S.agentTools = await api.agent.tools(); const s = S.mcp.find((x) => x.name === cfg.name); if (s && s.status === 'ready') toast(t('mcpAdded', { n: s.tools.length })); }
  catch (err) { S.mcpErr = cleanErr(err); }
  renderSettings();
});
api.on('deps:progress', ({ p }) => { S.depsP = p; if (S.settingsTab === 'agent' && S.depsBusy) renderSettings(); });
