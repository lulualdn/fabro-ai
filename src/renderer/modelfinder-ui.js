'use strict';
/* Models: "find a model in plain words" (section, picker dialog, chat card) and the light / intermediate / complex tiers.
   window.ModelFinder = { renderSection(el), renderTiers(el), cardsHtml(view), open(), mount(), tierBadge(ref), tierOf(ref), refreshTiers() }
   Installing always needs a click on a card: nothing here starts a download by itself. */
(function () {
  const ST = { q: '', busy: false, res: null, err: null, focus: false };
  const TIERS = ['light', 'medium', 'complex'];
  let tierMap = null; // model key → tier (cache of api.tiers.list)
  let tierData = null;

  const keyOf = (ref) => (!ref ? '' : ref.backend === 'provider' ? `p:${ref.provider}:${ref.model}` : ref.backend === 'local' ? `l:${ref.id}` : `${ref.backend}:${ref.id || ref.name}`);
  const gbTxt = (n) => new Intl.NumberFormat(S.lang, { maximumFractionDigits: 1 }).format(n);
  const langName = (c) => { try { return new Intl.DisplayNames([S.lang], { type: 'language' }).of(c); } catch { return c; } };

  // ───────────────────────────── tiers: cache + badge ─────────────────────────────
  async function refreshTiers() {
    const before = JSON.stringify(tierMap);
    try { tierData = await api.tiers.list(); tierMap = Object.fromEntries(tierData.models.map((m) => [m.key, m.tier])); } catch { /* keep the previous one */ }
    // badges in the model list change when the pool changes (a model installed, a provider connected)
    if (before !== JSON.stringify(tierMap) && S.settingsTab === 'models' && typeof renderSettings === 'function') renderSettings();
    return tierData;
  }
  const tierOf = (ref) => (tierMap && tierMap[keyOf(ref)]) || null;
  function tierBadge(ref) {
    const tier = typeof ref === 'string' ? ref : tierOf(ref);
    if (!tier || (tierData && tierData.single)) return '';
    return `<span class="tier-badge t-${tier}" title="${esc(t('tier_' + tier + '_d'))}"><span class="tb-bars"><i></i><i></i><i></i></span>${esc(t('tier_' + tier))}</span>`;
  }

  // ───────────────────────────── picks as cards ─────────────────────────────
  const isInstalled = (p) => p.installed || (S.installed && (S.installed.local || []).some((x) => x.repo === p.model.repo));
  const localOf = (p) => (S.installed && (S.installed.local || []).find((x) => x.repo === p.model.repo)) || null;
  const dlOf = (p) => Object.values(S.downloads || {}).find((d) => d.repo === p.model.repo && ['queued', 'downloading', 'paused', 'verifying'].includes(d.status));

  function actHtml(p) {
    const loc = localOf(p);
    const dl = dlOf(p);
    if (loc) {
      const ref = { backend: 'local', id: loc.id };
      const active = typeof sameRef === 'function' && sameRef(ref, S.settings.selectedModel);
      return active ? `<span class="chip ok">${icon('check', 13)} ${esc(t('mf_inUse'))}</span>`
        : `<span class="muted small">${icon('check', 13)} ${esc(t('mf_installed'))}</span><button class="btn sm primary" data-action="mf-use" data-id="${esc(loc.id)}">${esc(t('mf_use'))}</button>`;
    }
    if (dl && typeof renderProgress === 'function') return renderProgress(dl);
    return `<button class="btn primary" data-action="mf-install" data-repo="${esc(p.install.repo)}" data-file="${esc(p.install.file || '')}" data-cat="${esc(p.install.catalogId || '')}">${icon('download', 15)} ${esc(t('mf_install', { gb: gbTxt(p.variant.downloadGB) }))}</button>`;
  }

  function pickCard(p) {
    const m = p.model, v = p.variant, f = p.fit;
    const sub = [m.by, m.params ? (m.moe && m.activeParams ? `${m.params}B · ${m.activeParams}B` : `${m.params}B`) : null, v.quant, `${gbTxt(v.downloadGB)} ${t('unitGB')}`].filter(Boolean).join(' · ');
    const words = Math.max(1, Math.round(f.tokPerSec * 0.7));
    const speed = `${t('mf_speed_' + f.speed)} · ${t('mf_words', { n: words })}`;
    const wHtml = (p.warnings || []).filter((w) => w.code !== 'installed' && (w.level === 'warn' || ['cpuOnly', 'partial', 'bigDownload', 'license', 'estimate'].includes(w.code))).map((w) => {
      const pr = { ...(w.p || {}) }; if (w.code === 'slow') pr.n = Math.max(1, Math.round((w.p.tps || 1) * 0.7)); if (w.code === 'bigDownload') pr.gb = gbTxt(pr.gb);
      return `<li class="${w.level === 'warn' ? 'warn' : ''}">${icon(w.level === 'warn' ? 'warning' : 'info', 13)}<span>${esc(t('mf_warn_' + w.code, pr))}</span></li>`;
    }).join('');
    const chips = (codes, kind) => codes.map((c) => `<span class="tag">${esc(t('mf_' + kind + '_' + c))}</span>`).join('');
    return `<article class="mf-pick ${p.role === 'recommended' ? 'rec' : ''}" data-role="${esc(p.role)}">
      <header><span class="chip ${p.role === 'recommended' ? 'accent' : ''}">${esc(t('mf_role_' + p.role))}</span>${m.vision ? `<span class="chip">${icon('image', 12)} ${esc(t('mf_good_vision'))}</span>` : ''}</header>
      <h4>${esc(m.name)}</h4>
      <div class="mf-sub">${esc(sub)}</div>
      <div class="mf-fit"><span class="mf-dot s-${esc(f.speed)}"></span><b>${esc(t('mf_mode_' + f.mode))}</b><span class="muted"> · ${esc(speed)}</span></div>
      <div class="mf-cols">
        <div><small>${esc(t('mf_goodAt'))}</small><div class="mf-tags">${chips(p.good, 'good')}</div></div>
        ${p.weak.length ? `<div><small>${esc(t('mf_lessGood'))}</small><div class="mf-tags">${chips(p.weak, 'weak')}</div></div>` : ''}
      </div>
      ${wHtml ? `<ul class="mf-warn">${wHtml}</ul>` : ''}
      <footer class="mf-act">${actHtml(p)}</footer>
    </article>`;
  }

  function machineLine(res) {
    const mc = res.machine || {};
    const gpu = mc.gpu && mc.accel !== 'cpu' ? `${mc.gpu.name}${mc.gpu.vramGB ? ` (${gbTxt(mc.gpu.vramGB)} ${t('unitGB')})` : ''}` : t('mf_machineNoGpu');
    return t('mf_machine', { ram: gbTxt(mc.ramGB || 0), gpu });
  }
  function understood(res) {
    const c = res.criteria || {}; const bits = [];
    for (const u of c.uses || []) if (['code', 'vision', 'reasoning', 'longctx', 'tools', 'translation', 'writing', 'homework', 'roleplay'].includes(u)) bits.push(t('mf_use_' + u));
    for (const l of c.languages || []) bits.push(langName(l));
    bits.push(t('mf_prio_' + (c.priority || 'balanced')));
    if (c.maxSizeGB) bits.push(t('mf_upto', { n: gbTxt(c.maxSizeGB) }));
    return bits;
  }

  // The whole result: what was understood, the picks, notes. `inChat`: tighter, no "installNote".
  function cardsHtml(res, opts = {}) {
    if (!res) return '';
    const notes = (res.notes || []).map((n) => `<div class="mf-note ${n.code === 'nothing' ? 'warn' : ''}">${icon(n.code === 'nothing' ? 'warning' : 'info', 14)}<span>${esc(t('mf_note_' + n.code))}</span></div>`).join('');
    const picks = (res.picks || []).map(pickCard).join('');
    return `<div class="mf-result ${opts.inChat ? 'in-chat' : ''}">
      <div class="mf-meta"><span class="muted">${esc(t('mf_looked'))}:</span> ${understood(res).map((b) => `<span class="tag">${esc(b)}</span>`).join('')}</div>
      <div class="mf-meta muted">${esc(machineLine(res))}${res.considered ? ` · ${esc(t('mf_considered', { n: res.considered.evaluated || res.considered.total }))}` : ''}</div>
      ${notes}
      ${picks ? `<div class="mf-picks">${picks}</div><div class="mf-fine muted">${esc(t('mf_installNote'))}</div>` : ''}
    </div>`;
  }

  // ───────────────────────────── section (settings, onboarding, dialog) ─────────────────────────────
  function sectionHtml() {
    const chips = [1, 2, 3, 4, 5, 6].map((i) => `<button class="mf-chip" data-action="mf-chip" data-i="${i}">${esc(t('mf_ex' + i))}</button>`).join('');
    return `<div class="mf">
      <label class="mf-label" for="mf-q">${esc(t('mf_label'))}</label>
      <div class="mf-row"><input id="mf-q" class="input mf-q" type="text" autocomplete="off" spellcheck="false" maxlength="300" placeholder="${esc(t('mf_ph'))}" value="${esc(ST.q)}"><button class="btn primary" data-action="mf-find" ${ST.busy ? 'disabled' : ''}>${icon('search', 15)} ${esc(t('mf_go'))}</button></div>
      <div class="mf-chips">${chips}</div>
      <div class="mf-out" aria-live="polite">${outHtml()}</div>
      <div class="mf-fine muted">${esc(t('mf_askChat'))}</div>
    </div>`;
  }
  const outHtml = () => ST.busy ? `<div class="mf-busy">${typeof spinner === 'function' ? spinner(14) : ''}<span>${esc(t('mf_searching'))}</span></div>`
    : ST.err ? `<div class="mf-note warn">${icon('warning', 14)}<span>${esc(t('mf_err', { e: ST.err }))}</span></div>` : cardsHtml(ST.res);

  function renderSection(el) {
    if (!el) return;
    el.innerHTML = sectionHtml();
    if (!el._mf) {
      el._mf = true;
      el.addEventListener('input', (e) => { if (e.target.classList.contains('mf-q')) ST.q = e.target.value; });
      el.addEventListener('focusin', (e) => { if (e.target.classList.contains('mf-q')) ST.focus = true; });
      el.addEventListener('focusout', (e) => { if (e.target.classList.contains('mf-q')) ST.focus = false; });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('mf-q')) { e.preventDefault(); find(); } });
    }
    if (ST.focus) { const i = el.querySelector('.mf-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  const rerenderAll = () => { for (const el of document.querySelectorAll('[data-mf="section"], .mf-modal .mf-host')) renderSection(el); };
  const refreshOut = () => { for (const o of document.querySelectorAll('.mf-out')) o.innerHTML = outHtml(); for (const b of document.querySelectorAll('[data-action="mf-find"]')) b.disabled = ST.busy; };

  async function find(q) {
    if (typeof q === 'string') ST.q = q;
    const need = (ST.q || '').trim();
    if (!need || ST.busy) return;
    ST.busy = true; ST.err = null; ST.res = null; refreshOut();
    try { ST.res = await api.modelFinder.find({ need }); }
    catch (e) { ST.err = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    ST.busy = false; refreshOut();
    const inp = document.querySelector('.mf-q'); if (inp && ST.q !== inp.value) inp.value = ST.q;
  }

  // ───────────────────────────── dialog (model picker → "Help me choose…") ─────────────────────────────
  function open() {
    close();
    if (typeof closePopover === 'function') closePopover();
    const root = document.createElement('div'); root.id = 'mf-modal-root';
    root.innerHTML = `<div class="modal-backdrop" data-action="mf-close"></div>
      <div class="modal mf-modal" role="dialog" aria-modal="true" aria-label="${esc(t('mf_title'))}">
        <div class="mf-mhead"><h3>${esc(t('mf_title'))}</h3><button class="icon-btn" data-action="mf-close" title="${esc(t('mf_close'))}" aria-label="${esc(t('mf_close'))}">${icon('x', 16)}</button></div>
        <div class="mf-host"></div></div>`;
    document.body.appendChild(root);
    renderSection(root.querySelector('.mf-host'));
    const inp = root.querySelector('.mf-q'); if (inp) inp.focus();
    document.addEventListener('keydown', onEsc, true);
  }
  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  function close() { const r = document.getElementById('mf-modal-root'); if (r) r.remove(); document.removeEventListener('keydown', onEsc, true); }

  // ───────────────────────────── tiers section ─────────────────────────────
  function tiersHtml(d) {
    if (!d || !d.models.length) return `<div class="mf-tiers"><div class="mf-note">${icon('info', 14)}<span>${esc(t('tier_none'))}</span></div></div>`;
    const opt = (m, sel) => `<option value="${esc(m.key)}" ${sel ? 'selected' : ''}>${esc(m.label)}${m.provider ? ' · ' + esc(m.provider) : ''}</option>`;
    const rows = TIERS.map((tier) => {
      const c = d.chosen[tier]; const pref = d.prefer[tier] || '';
      const auto = d.models.filter((m) => m.tier === tier).sort((a, b) => tier === 'complex' ? b.effB - a.effB : a.effB - b.effB)[0];
      return `<div class="list-row mf-trow" data-tier="${tier}">
        <div class="mf-tinfo"><b>${tierBadge(tier)}</b><small>${esc(t('tier_' + tier + '_d'))}</small>${c && c.fallback && !pref ? `<small class="mf-fb">${icon('info', 12)} ${esc(t('tier_fallback', { name: c.label }))}</small>` : ''}</div>
        <select class="input mf-tsel" data-mf-pref="${tier}" aria-label="${esc(t('tier_' + tier))}">
          <option value="">${esc(t('tier_auto', { name: (c && c.label) || (auto && auto.label) || t('tier_none') }))}</option>
          ${d.models.map((m) => opt(m, m.key === pref)).join('')}
        </select></div>`;
    }).join('');
    const each = d.models.length > 1 ? `<details class="mf-each"><summary>${esc(t('tiers_each'))}</summary>
      ${d.models.map((m) => `<div class="list-row mf-trow"><div class="mf-tinfo"><b>${esc(m.label)}</b><small>${esc([m.provider, m.paramsB ? `${gbTxt(m.paramsB)}B` : null, m.sizeGB ? `${gbTxt(m.sizeGB)} ${t('unitGB')}` : null, m.tokPerSec ? `${gbTxt(m.tokPerSec)} tok/s` : null].filter(Boolean).join(' · '))}</small></div>
        <select class="input mf-tsel" data-mf-over="${esc(m.key)}" aria-label="${esc(m.label)}">
          <option value="">${esc(t('tier_autoShort'))} (${esc(t('tier_' + m.auto))})</option>
          ${TIERS.map((x) => `<option value="${x}" ${m.overridden && m.tier === x ? 'selected' : ''}>${esc(t('tier_' + x))}</option>`).join('')}
        </select></div>`).join('')}</details>` : '';
    return `<div class="mf-tiers"><div class="mf-thead"><h4>${esc(t('tiers_title'))}</h4><small class="muted">${esc(t(d.single ? 'tiers_single' : 'tiers_intro'))}</small></div>
      <div class="list mf-tlist">${rows}</div>${each}
      ${d.models.some((m) => !m.local) ? `<small class="muted">${esc(t('tiers_cloud'))}</small>` : ''}</div>`;
  }
  async function renderTiers(el) {
    if (!el) return;
    if (tierData) el.innerHTML = tiersHtml(tierData);
    const d = await refreshTiers();
    if (!el.isConnected) return;
    el.innerHTML = tiersHtml(d);
    if (!el._mfT) {
      el._mfT = true;
      el.addEventListener('change', async (e) => {
        const s = e.target.closest('select'); if (!s) return;
        try {
          if (s.dataset.mfPref) await api.tiers.setPreferred(s.dataset.mfPref, s.value || null);
          else if (s.dataset.mfOver) await api.tiers.setOverride(s.dataset.mfOver, s.value || null);
        } catch (err) { toast(String((err && err.message) || err), 'err'); }
        const open = el.querySelector('.mf-each')?.open;
        await renderTiers(el); if (open) { const dt = el.querySelector('.mf-each'); if (dt) dt.open = true; }
        if (typeof refreshComposer === 'function') { try { refreshComposer(); } catch {} }
      });
    }
  }

  // Settings → Models mounts both through placeholders (the settings screen calls ModelFinder.mount() after rendering).
  function mount(root = document) {
    for (const el of root.querySelectorAll('[data-mf="section"]')) renderSection(el);
    for (const el of root.querySelectorAll('[data-mf="tiers"]')) renderTiers(el);
  }

  // ───────────────────────────── actions ─────────────────────────────
  Object.assign(actions, {
    'mf-find': () => find(),
    'mf-chip': (el) => { const q = t('mf_ex' + el.dataset.i); ST.q = q; for (const i of document.querySelectorAll('.mf-q')) i.value = q; find(q); },
    'mf-open': () => open(),
    'mf-close': () => close(),
    'mf-use': (el) => { actions['pick-model']({ dataset: { ref: JSON.stringify({ backend: 'local', id: el.dataset.id }) } }); close(); },
    'mf-install': async (el) => {
      const { repo, file, cat } = el.dataset;
      const act = el.closest('.mf-act');
      el.disabled = true; el.innerHTML = `${typeof spinner === 'function' ? spinner(14) : ''} ${esc(t('mf_installing'))}`;
      try {
        const id = await api.models.download({ repo, file: file || undefined, catalogId: cat || undefined });
        if (act && act.isConnected && !S.downloads[id]) act.innerHTML = `<div class="progress-inline" data-dl="${esc(id)}"><div class="bar"><i style="width:0%"></i></div><span class="pct">${esc(t('mf_installing'))}</span></div>`;
      } catch (e) { toast(typeof dlErr === 'function' ? dlErr(e) : String(e.message || e), 'err'); el.disabled = false; el.innerHTML = `${icon('download', 15)} ${esc(t('mf_install', { gb: '' }))}`; }
    },
  });
  // when a download of a pick finishes, its card turns into "Installed · Use this model"
  api.on('models:progress', (p) => {
    if (p.kind || p.status !== 'done' || !p.model) return;
    setTimeout(async () => {
      for (const a of document.querySelectorAll('.mf-act')) {
        const art = a.closest('.mf-pick'); const btn = art && art.querySelector('[data-repo]');
        const inst = a.querySelector('[data-dl]'); const mine = inst && String(inst.dataset.dl).startsWith(p.repo + '/') || (btn && btn.dataset.repo === p.repo);
        if (mine) a.innerHTML = `<span class="muted small">${icon('check', 13)} ${esc(t('mf_installed'))}</span><button class="btn sm primary" data-action="mf-use" data-id="${esc(p.model.id)}">${esc(t('mf_use'))}</button>`;
      }
      refreshTiers();
    }, 700);
  });
  api.on('accounts:event', () => { tierMap = null; tierData = null; refreshTiers(); });

  window.ModelFinder = { renderSection, renderTiers, cardsHtml, open, close, mount, tierBadge, tierOf, refreshTiers, find };
  refreshTiers().then(() => { if (typeof refreshComposer === 'function' && S.settings) { try { refreshComposer(); } catch {} } });
})();
