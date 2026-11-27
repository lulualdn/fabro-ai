'use strict';
// Fabro v1 settings: what people change, nothing else. General, Connectors (one click), Models, Fabro Anywhere,
// Advanced (the full previous interface for what isn't rebuilt yet).
window.V1Settings = (function () {
  const $ = (s, r = document) => r.querySelector(s);
  let tab = 'general';
  let box = null;
  const st = { catalog: null, servers: null, adding: new Set(), need: null, mods: null, any: null, pair: null };
  const { esc } = window.V1 || {};

  function render(el) {
    box = el || box; if (!box) return;
    const { t } = V1;
    box.innerHTML = `<h2>${t('settings')}</h2><p class="lead">${t('setLead')}</p>
      <div class="tabs">${[['general', 'tGeneral'], ['connectors', 'tConnectors'], ['models', 'tModels'], ['anywhere', 'tAnywhere'], ['advanced', 'tAdvanced']].map(([k, l]) => `<button data-act="set:tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
      <div id="tab">${({ general, connectors, models, anywhere, advanced })[tab]()}</div><div data-slot="settings"></div>`;
    Fabro._paint('settings');
    if (tab === 'connectors' && !st.catalog) loadConnectors();
    if (tab === 'general' && !st.mods) api.mods.list().then((m) => { st.mods = m || []; render(); }).catch(() => { st.mods = []; });
    if (tab === 'anywhere' && !st.any) api.anywhere.status().then((s) => { st.any = s; render(); }).catch(() => {});
  }
  const row = (label, sub, ctrl) => `<div class="set"><div>${label}${sub ? `<small>${sub}</small>` : ''}</div>${ctrl}</div>`;
  const seg = (key, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="set:seg" data-key="${key}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tog = (key, on) => `<button class="tog ${on ? 'on' : ''}" data-act="set:tog" data-key="${key}" aria-pressed="${!!on}"></button>`;

  function general() {
    const { t, S } = V1; const s = S.settings; const v = s.v1 || {};
    const th = s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system';
    const modsOn = (st.mods || []).filter((m) => m.enabled && !m.builtin).length;
    return row(t('name'), '', `<input class="in" data-set="userName" value="${V1.esc(s.userName || '')}" style="width:200px">`)
      + row(t('look'), '', seg('theme', th, [['light', t('light')], ['dark', t('dark')], ['system', t('auto')]]))
      + row(t('eco'), t('ecoSub'), tog('eco', v.eco))
      + row(t('motion'), '', tog('reduceMotion', v.reduceMotion))
      + row(t('askBefore'), t('askBeforeSub'), seg('ask', v.ask === 'never' ? 'never' : 'risky', [['risky', t('risky')], ['never', t('never')]]))
      + row(t('lang'), '', seg('language', s.language && s.language !== 'auto' ? s.language : 'auto', [['auto', 'Auto'], ['fr', 'FR'], ['en', 'EN']]))
      + row(t('bigSet'), t('bigSetSub'), `<select class="in" data-set="bigModel" style="max-width:240px"><option value="">${t('none')}</option>${V1.allModels().map((m) => `<option value="${V1.esc(V1.refKey(m.ref))}" ${V1.refKey(m.ref) === V1.refKey(v.bigModel) ? 'selected' : ''}>${V1.esc(m.label)}${m.sub ? ' · ' + V1.esc(m.sub) : ''}</option>`).join('')}</select>`)
      + row(t('memory'), t('memorySub', { n: S.memories.length }), `<button class="btn" data-act="set:memory">${t('see')}</button>`)
      + (S.settings.mods && S.settings.mods.safe || S.modsOff ? row(t('mods'), t('modsSafe'), `<button class="btn pri" data-act="set:modsback">${t('modsBack')}</button>`) : row(t('mods'), t('modsSub', { n: modsOn }), ''))
      + (st.mods || []).filter((m) => !m.builtin).map((m) => row(V1.esc(m.name) + (m.version ? ` <span class="mono" style="color:var(--t3)">${V1.esc(m.version)}</span>` : ''), V1.esc(m.description || '') + (m.v1 ? '' : ` · ${t('modsOldOnly')}`) + (m.permissions && m.permissions.length ? ` · ${t('modsCan')} ${V1.esc(m.permissions.join(', '))}` : ''), tog('mod:' + m.id, m.enabled))).join('')
      + row('', '', `<button class="btn ghost" data-act="legacy" data-page="mods">${t('modsMore')}</button>`);
  }

  async function loadConnectors() {
    try { st.catalog = await api.mcpeasy.catalog(); } catch { st.catalog = []; }
    try { const v = await api.mcp.view(); st.servers = new Set(((v && (v.servers || v.list)) || (Array.isArray(v) ? v : [])).map((x) => x.name || x.id)); } catch { st.servers = new Set(); }
    render();
  }
  function connectors() {
    const { t } = V1;
    if (!st.catalog) return `<p class="lead">…</p>`;
    const need = st.need;
    return `<input class="in" data-set="mcpq" placeholder="${t('connSearch')}" style="width:100%" value="${V1.esc(st.q || '')}">
      <div class="mcps">${st.catalog.filter((c) => !st.q || c.id.includes(st.q.toLowerCase())).map((c) => {
        const on = st.servers.has(c.id) || st.servers.has(c.server.name); const ing = st.adding.has(c.id);
        return `<div class="mcp"><span class="ic">${V1.esc(c.id.slice(0, 2))}</span><div class="grow">${V1.esc(c.id)}<small>${V1.esc(c.requires || (c.server.url ? 'web' : ''))}</small></div><button class="add ${on ? 'ok' : ''}" data-act="set:mcp" data-id="${V1.esc(c.id)}" ${on || ing ? 'disabled' : ''}>${on ? t('added') : ing ? t('adding') : t('add')}</button></div>`;
      }).join('')}</div>
      ${need ? `<div class="card"><div class="grow">${V1.esc(need.id)} · ${t('needs')}${need.missing.map((k) => `<input class="in" data-need="${V1.esc(k)}" placeholder="${V1.esc((need.labels || {})[k] || k)}" style="width:100%;margin-top:6px">`).join('')}</div><button class="btn pri" data-act="set:mcp" data-id="${V1.esc(need.id)}">${t('add')}</button></div>` : ''}
      <div class="dropzone">${t('mcpbDrop')}<input class="in" data-set="mcpurl" placeholder="https://…/mcp"><button class="btn" data-act="set:mcpurl">${t('addUrl')}</button></div>`;
  }
  async function addMcp(id) {
    const c = st.catalog.find((x) => x.id === id); if (!c) return;
    const values = {};
    if (st.need && st.need.id === id) for (const el of document.querySelectorAll('[data-need]')) values[el.dataset.need] = el.value.trim();
    st.adding.add(id); render();
    const r = await api.mcpeasy.add({ ...c.server, values }).catch((e) => ({ ok: false, error: e.message }));
    st.adding.delete(id);
    if (r && r.ok !== false) { st.servers.add(id); st.need = null; V1.toast(V1.t('added')); }
    else if (r && r.missing) st.need = { id, missing: r.missing, labels: Object.fromEntries((c.server.needs || []).map((n) => [`${n.where}:${n.name !== undefined ? n.name : n.index}`, n.label])) };
    else V1.toast(String((r && r.error) || 'Erreur'), 'err');
    render();
  }

  function models() {
    const { t, S } = V1; const sel = V1.refKey(S.settings.selectedModel);
    return V1.allModels().map((m) => row(V1.esc(m.label), V1.esc(m.sub || ''), V1.refKey(m.ref) === sel ? `<span class="mono" style="color:var(--ok)">${t('active')}</span>` : `<button class="btn" data-act="pick" data-k="${V1.esc(V1.refKey(m.ref))}">${t('use')}</button>`)).join('')
      + row(t('installModel'), '', `<button class="btn" data-act="legacy" data-page="models">${t('open')}</button>`);
  }

  function anywhere() {
    const { t } = V1; const s = st.any || {}; const p = st.pair;
    let ring = '';
    if (p) { try { ring = FabroAnywhere.ringCodeSVG(FabroAnywhere.unb64u(p.data27), { accent: '#ff5e42' }); } catch {} }
    return row(t('anyOn'), t('anyOnSub'), tog('anywhere', s.enabled))
      + (p ? `<div class="ring">${ring}<div><p class="lead">${t('pairLead')}</p><div class="code">${V1.esc(p.text || '')}</div></div></div>` : row(t('pairPhone'), '', `<button class="btn pri" data-act="set:pair">${t('pairPhone')}</button>`))
      + ((s.devices || []).length ? `<h3 style="font-weight:500;font-size:13px;color:var(--t3);margin:18px 0 4px">${t('devices')}</h3>` + s.devices.map((d) => row(V1.esc(d.name || d.id), V1.esc(d.platform || ''), `<button class="btn" data-act="set:revoke" data-id="${V1.esc(d.id)}">${t('revoke')}</button>`)).join('') : '');
  }

  function advanced() {
    const { t } = V1;
    if (!st.kb) api.knowledge.list().then((l) => { st.kb = l || []; render(); }).catch(() => { st.kb = []; });
    return row(t('kb'), t('kbSub', { n: (st.kb || []).length }), '')
      + (st.kb || []).map((b) => row(V1.esc(b.title), V1.esc(b.when) + (b.builtin ? ' · ' + t('builtin') : ''), `<button class="btn" data-act="set:kb" data-id="${V1.esc(b.id)}">${t('see')}</button>`)).join('')
      + row(t('legacy'), t('legacySub'), `<button class="btn" data-act="legacy">${t('open')}</button>`);
  }

  async function action(a, el) {
    const { S } = V1; const v = { ...(S.settings.v1 || {}) };
    if (a === 'tab') { tab = el.dataset.tab; return render(); }
    if (a === 'seg') {
      const k = el.dataset.key, val = el.dataset.v;
      if (k === 'theme') { await V1.saveSettings({ theme: val }); V1.applyTheme(); }
      else if (k === 'language') { await V1.saveSettings({ language: val }); location.reload(); return; }
      else { v[k] = val; await V1.saveSettings({ v1: v }); }
      return render();
    }
    if (a === 'modsback') { await api.mods.safeOff(); V1.S.settings.mods = { ...(V1.S.settings.mods || {}), safe: false }; location.reload(); return; }
    if (a === 'tog') {
      const k = el.dataset.key;
      if (k.startsWith('mod:')) { const id = k.slice(4); const m = (st.mods || []).find((x) => x.id === id); await api.mods.enable(id, !(m && m.enabled)); location.reload(); return; }
      if (k === 'anywhere') { await api.anywhere.configure({ enabled: !(st.any && st.any.enabled) }); st.any = await api.anywhere.status(); return render(); }
      v[k] = !v[k]; await V1.saveSettings({ v1: v }); V1.applyTheme(); return render();
    }
    if (a === 'memory') {
      const list = S.memories;
      V1.sheet(`${V1.head(V1.t('memory'))}${list.map((m) => `<div class="opt"><span class="grow">${V1.esc(m.text)}</span><button class="ib" data-act="set:forget" data-id="${V1.esc(m.id)}">${V1.ic('x')}</button></div>`).join('') || '<p class="lead">—</p>'}`);
      return;
    }
    if (a === 'forget') { await api.memory.delete(el.dataset.id).catch(() => {}); S.memories = await api.memory.list().catch(() => S.memories); return action('memory'); }
    if (a === 'mcp') return addMcp(el.dataset.id);
    if (a === 'kb') {
      const b = await api.knowledge.get(el.dataset.id); if (!b) return;
      V1.sheet(`${V1.head(V1.esc(el.dataset.id))}<textarea class="in" id="kbtext" style="width:100%;height:52vh;padding:12px;font:12.5px/1.5 var(--mono)" ${b.builtin ? 'readonly' : ''}>${V1.esc(b.text)}</textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">${b.builtin ? '' : `<button class="btn ghost" data-act="set:kbdel" data-id="${V1.esc(b.id)}">${V1.t('del')}</button><button class="btn pri" data-act="set:kbsave" data-id="${V1.esc(b.id)}">${V1.t('save')}</button>`}</div>`, 'wide');
      return;
    }
    if (a === 'kbsave') { const r = await api.knowledge.save(el.dataset.id, document.getElementById('kbtext').value); if (r && r.ok) { V1.sheet(''); st.kb = null; render(); } else V1.toast((r && r.errors || ['?']).join(' '), 'err'); return; }
    if (a === 'kbdel') { await api.knowledge.delete(el.dataset.id); V1.sheet(''); st.kb = null; return render(); }
    if (a === 'mcpurl') {
      const u = (document.querySelector('[data-set=mcpurl]') || {}).value || ''; if (!/^https:\/\//.test(u.trim())) return;
      const r = await api.mcpeasy.parse(u.trim()).catch(() => null);
      const cfg = r && (r.server || r.config || (Array.isArray(r) ? r[0] : r));
      const out = cfg ? await api.mcpeasy.add(cfg).catch((e) => ({ ok: false, error: e.message })) : { ok: false, error: '?' };
      V1.toast(out && out.ok !== false ? V1.t('added') : String((out && out.error) || '?'), out && out.ok !== false ? '' : 'err');
      st.catalog = null; return render();
    }
    if (a === 'pair') { st.pair = await api.anywhere.pairStart().catch(() => null); st.any = await api.anywhere.status().catch(() => st.any); return render(); }
    if (a === 'revoke') { await api.anywhere.revoke(el.dataset.id).catch(() => {}); st.any = await api.anywhere.status().catch(() => st.any); return render(); }
  }
  async function change(el) {
    const k = el.dataset.set;
    if (k === 'userName') { await V1.saveSettings({ userName: el.value.trim() }); V1.renderSide(); }
    if (k === 'bigModel') { const m = V1.allModels().find((x) => V1.refKey(x.ref) === el.value); await V1.saveSettings({ v1: { ...(V1.S.settings.v1 || {}), bigModel: m ? m.ref : null } }); }
    if (k === 'mcpq') { st.q = el.value.trim(); render(); const i = document.querySelector('[data-set=mcpq]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  document.addEventListener('dragover', (e) => { if (tab === 'connectors' && box && box.isConnected) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (tab !== 'connectors' || !box || !box.isConnected) return; e.preventDefault();
    for (const f of e.dataTransfer.files) {
      if (!/\.(mcpb|dxt)$/i.test(f.name)) continue;
      try { const r = await api.mcpeasy.mcpb(api.files.pathOf(f)); const ok = r.result && r.result.ok !== false; V1.toast(ok ? V1.t('mcpbOk', { n: r.declares.name }) : String((r.result && r.result.error) || '?'), ok ? '' : 'err'); }
      catch (err) { V1.toast(String(err.message || err), 'err'); }
    }
    st.catalog = null; render();
  });
  // the paired phone shows up as soon as it's linked
  api.on('anywhere:status', (s) => { st.any = s; if (s && (s.devices || []).length && st.pair && !s.pairing) st.pair = null; if (tab === 'anywhere' && box && box.isConnected) render(); });
  return { render, action, change };
})();
