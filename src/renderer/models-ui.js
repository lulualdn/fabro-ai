'use strict';
/* Settings → Models (your models + per-model sheet, downloads, catalog, search) and → Storage (libraries, import, download settings). */

const nf1 = () => new Intl.NumberFormat(S.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const gb = (x) => x == null ? '—' : `${nf1().format(x)} ${t('unitGB')}`;

async function loadModelExtras() {
  try {
    const [plans, libs] = await Promise.all([api.models.plans(), api.models.libraries()]);
    S.plans = plans; S.libs = libs;
  } catch { /* keep previous */ }
  if (S.settingsTab === 'models' || S.settingsTab === 'storage') renderSettings();
}
const refreshPlans = debounce(loadModelExtras, 250);

function loadedInfo(id) { return (S.engine.loaded || []).find((l) => l.id === id); }
const MODE_KEY = { gpu: 'modeGpu', split: 'modeSplit', moe: 'modeMoe', cpu: 'modeCpu' };

function memBar(pl, compact = false) {
  if (!pl) return '';
  const sp = S.specs || {};
  const budget = sp.unified ? sp.gpuBudgetGB : (pl.budgetGB || 0);
  const parts = [];
  if (budget > 0) {
    const p = Math.min(1, pl.vramGB / budget);
    parts.push(`<div class="mb-line"><span>${esc(t(sp.unified ? 'memUnified' : 'memVram'))}</span><div class="mb-track ${pl.vramGB > budget ? 'over' : ''}"><i style="width:${(p * 100).toFixed(1)}%"></i></div><b>${gb(pl.vramGB)} / ${gb(budget)}</b></div>`);
  }
  if (!sp.unified && (pl.ramGB > 0.05 || !budget)) {
    const rb = sp.ramGB || pl.ramBudgetGB || 1;
    parts.push(`<div class="mb-line"><span>${esc(t('memRam'))}</span><div class="mb-track ram"><i style="width:${Math.min(100, pl.ramGB / rb * 100).toFixed(1)}%"></i></div><b>${gb(pl.ramGB)} / ${gb(rb)}</b></div>`);
  }
  if (compact) return `<div class="membar compact">${parts.join('')}</div>`;
  return `<div class="membar">${parts.join('')}
    <div class="mb-note">${icon(pl.fits ? 'info' : 'warning', 13)} ${esc(t(MODE_KEY[pl.mode] || 'modeCpu'))}${pl.moe ? ' · MoE' : ''} · ${esc(t('ctxShort', { n: Math.round(pl.ctx / 1024) }))}${pl.fits ? '' : ' · ' + esc(t('memTight'))}</div></div>`;
}

function modelRow(m) {
  const ref = { backend: 'local', id: m.id };
  const active = sameRef(ref, S.settings.selectedModel);
  const ld = loadedInfo(m.id);
  const pl = (S.plans || {})[m.id];
  const lib = (S.libs || []).find((l) => l.id === (m.library || 'default'));
  const src = m.imported ? `<span class="src-badge">${esc(t('src_' + (m.source || 'folder')))}</span>` : '';
  const open = S.modelOpen === m.id;
  return `<div class="m-card ${open ? 'open' : ''}">
    <div class="m-row" data-action="model-open" data-id="${esc(m.id)}">
      <div class="m-ico">${icon('box', 18)}</div>
      <div class="m-text"><b>${esc(m.name)} ${src}</b>
        <small>${esc([m.quant, fmtBytes(m.sizeBytes), m.vision && t('vision'), lib && (S.libs || []).length > 1 && lib.name].filter(Boolean).join(' · '))}</small></div>
      ${ld ? `<span class="chip ${ld.status === 'ready' ? 'ok' : ''}">${ld.status === 'ready' ? `<span class="ok-dot"></span>${esc(t('loadedShort'))}` : `${spinner(12)} ${esc(t('loadingShort'))}`}</span>` : ''}
      ${pl ? `<span class="m-mem ${pl.fits ? '' : 'warn'}" title="${esc(t(MODE_KEY[pl.mode]))}">${esc(pl.vramGB > 0 ? gb(pl.vramGB) + ' ' + t('vramShort') : gb(pl.ramGB) + ' RAM')}</span>` : ''}
      ${active ? `<span class="chip accent">${esc(t('active'))}</span>` : `<button class="btn sm" data-action="pick-model" data-ref="${esc(JSON.stringify(ref))}">${esc(t('use'))}</button>`}
      <span class="m-chev">${icon('down', 16)}</span>
    </div>
    ${open ? modelSheet(m, pl, ld) : ''}
  </div>`;
}

function profOf(id) { return (S.settings.modelProfiles || {})[id] || {}; }
function pselect(id, key, value, opts) {
  return `<select class="input sm2" data-prof="${esc(id)}" data-key="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function pseg(id, key, value, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="${String(value ?? '') === String(v) ? 'on' : ''}" data-action="prof-set" data-id="${esc(id)}" data-key="${key}" data-value="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}

function modelSheet(m, pl, ld) {
  const p = profOf(m.id);
  const g = S.settings.engine || {};
  const glob = (v) => t('globalVal', { v });
  const ctxOpts = [['', glob(`${Math.round((g.ctx || 8192) / 1024)}K`)], ...[2048, 4096, 8192, 16384, 32768, 65536, 131072].filter((n) => !m.ctxTrain || n <= m.ctxTrain).map((n) => [n, `${n / 1024}K`])];
  const idleOpts = [['', glob(g.idleMinutes ? `${g.idleMinutes} min` : t('never'))], [0, t('never')], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [240, '4 h']];
  const gen = p.gen || {};
  const v = S.verify && S.verify[m.id];
  const libs = S.libs || [];
  return `<div class="m-sheet">
    <div class="ms-sec"><div class="ms-h">${icon('cpu', 14)} ${esc(t('memTitle'))}</div>${memBar(pl)}</div>
    <div class="ms-grid">
      <label>${esc(t('contextLength'))}${pselect(m.id, 'ctx', p.ctx, ctxOpts)}</label>
      <label>${esc(t('gpuLayers'))}${pselect(m.id, 'gpuLayers', p.gpuLayers, [['', glob(g.gpuLayers < 0 ? t('auto') : g.gpuLayers)], [-1, t('auto')], [0, t('cpuOnly')], [8, '8'], [16, '16'], [24, '24'], [32, '32'], [48, '48'], [999, t('allLayers')]])}</label>
      <label>${esc(t('preload'))}${pselect(m.id, 'preload', p.preload || 'demand', [['demand', t('preload_demand')], ['startup', t('preload_startup')], ['always', t('preload_always')]])}</label>
      <label>${esc(t('idleUnload'))}${pselect(m.id, 'idleMinutes', p.idleMinutes, idleOpts)}</label>
      <label>${esc(t('threads'))}<input class="input sm2" type="number" min="0" max="256" placeholder="${esc(t('auto'))}" value="${esc(p.threads ?? '')}" data-prof="${esc(m.id)}" data-key="threads"></label>
      <label>${esc(t('temperature'))}<input class="input sm2" type="number" min="0" max="2" step="0.05" placeholder="${esc(String(S.settings.gen.temperature))}" value="${esc(gen.temperature ?? '')}" data-prof="${esc(m.id)}" data-key="gen.temperature"></label>
    </div>
    <div class="ms-row"><span>${esc(t('kvCache'))}<small>${esc(t('kvCacheHint'))}</small></span>${pseg(m.id, 'kvType', p.kvType || '', [['', t('global')], ['f16', 'F16'], ['q8_0', 'Q8'], ['q4_0', 'Q4']])}</div>
    <div class="ms-row"><span>${esc(t('flashAttn'))}<small>${esc(t('flashAttnHint'))}</small></span>${pseg(m.id, 'flashAttn', p.flashAttn || '', [['', t('global')], ['auto', t('auto')], ['on', t('on')], ['off', t('off')]])}</div>
    ${m.moe || (pl && pl.moe) ? `<div class="ms-row"><span>${esc(t('cpuMoe'))}<small>${esc(t('cpuMoeHint'))}</small></span>${pseg(m.id, 'cpuMoe', p.cpuMoe || '', [['', t('global')], ['auto', t('auto')], ['on', t('on')], ['off', t('off')]])}</div>` : ''}
    <div class="ms-sec"><div class="ms-h">${icon('archive', 14)} ${esc(t('storageTitle'))}</div>
      <div class="ms-path" title="${esc(m.path)}" data-action="model-reveal" data-path="${esc(m.path)}">${icon('folder', 14)}<span>${esc(m.path)}</span></div>
      <div class="ms-actions">
        ${!m.imported && libs.length > 1 ? `<select class="input sm2" data-move="${esc(m.id)}">${libs.map((l) => `<option value="${esc(l.id)}" ${l.id === (m.library || 'default') ? 'selected' : ''}>${esc(t('libOn', { n: l.name }))}</option>`).join('')}</select>` : ''}
        ${S.moving && S.moving[m.id] ? `<span class="muted small">${spinner(14)} ${esc(t('moving', { p: Math.round(S.moving[m.id] * 100) }))}</span>` : ''}
        <button class="btn sm" data-action="model-verify" data-id="${esc(m.id)}" ${v && v.running ? 'disabled' : ''}>${icon('shield', 14)} ${esc(v && v.running ? t('verifying', { p: Math.round((v.p || 0) * 100) }) : t('verify'))}</button>
        ${v && v.result ? `<span class="small ${v.result.ok ? 'ok-txt' : 'err-txt'}">${icon(v.result.ok ? 'success' : 'error', 14)} ${esc(v.result.ok ? (v.result.checked ? t('verifyOk') : t('verifyUnknown')) : t('verifyBad', { f: v.result.bad.join(', ') }))}</span>`
          : m.verifiedAt ? `<span class="small muted">${icon('check', 13)} ${esc(t('verifiedOn', { d: new Date(m.verifiedAt).toLocaleDateString(S.lang) }))}</span>` : ''}
      </div>
    </div>
    <div class="ms-foot">
      ${ld && ld.status === 'ready' ? `<button class="btn sm" data-action="model-unload" data-id="${esc(m.id)}">${icon('power', 14)} ${esc(t('unload'))}</button>`
        : `<button class="btn sm" data-action="model-load" data-id="${esc(m.id)}" ${ld ? 'disabled' : ''}>${icon('play', 14)} ${esc(t('loadNow'))}</button>`}
      <button class="btn sm" data-action="model-rename" data-id="${esc(m.id)}">${icon('edit', 14)} ${esc(t('rename'))}</button>
      ${Object.keys(profOf(m.id)).some((k) => profOf(m.id)[k] !== null && profOf(m.id)[k] !== undefined) ? `<button class="btn sm" data-action="prof-reset" data-id="${esc(m.id)}">${icon('refresh', 14)} ${esc(t('resetProfile'))}</button>` : ''}
      <span class="grow"></span>
      <button class="btn sm danger" data-action="model-delete" data-id="${esc(m.id)}">${icon('trash', 14)} ${esc(t(m.imported ? 'removeFromFabro' : 'delete'))}</button>
    </div>
  </div>`;
}

function dlRow(d) {
  const p = d.total ? d.received / d.total : 0;
  const st = d.status;
  const label = st === 'queued' ? t('dlQueued') : st === 'paused' ? t('dlPaused') : st === 'verifying' ? t('verifying', { p: Math.round((d.verifyProgress || 0) * 100) })
    : `${Math.round(p * 100)} % · ${fmtBytes(d.received)} / ${fmtBytes(d.total)}${d.speed ? ` · ${fmtBytes(d.speed)}/s` : ''}${d.speed && d.total ? ` · ${t('etaLeft', { t: fmtDur((d.total - d.received) / d.speed) })}` : ''}`;
  return `<div class="dl-row st-${st}" data-dl-row="${esc(d.id)}">
    <div class="m-ico">${icon(st === 'paused' ? 'pause' : 'download', 17)}</div>
    <div class="m-text"><b>${esc(d.file || d.id)}</b><small>${esc(d.repo || '')}${d.libraryName && (S.libs || []).length > 1 ? ' · ' + esc(d.libraryName) : ''}</small>
      <div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><small class="dl-meta">${esc(label)}</small></div>
    ${st === 'downloading' || st === 'queued' ? `<button class="icon-btn sm" data-action="dl-pause" data-id="${esc(d.id)}" title="${esc(t('pause'))}">${icon('pause', 16)}</button>` : ''}
    ${st === 'paused' ? `<button class="icon-btn sm" data-action="dl-resume" data-id="${esc(d.id)}" title="${esc(t('resume'))}">${icon('play', 16)}</button>` : ''}
    <button class="icon-btn sm" data-action="dl-cancel" data-id="${esc(d.id)}" title="${esc(t('cancel'))}">${icon('x', 16)}</button>
  </div>`;
}
const fmtDur = (s) => !isFinite(s) ? '—' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;

function modelsTab() {
  const loc = S.installed.local;
  const dls = Object.values(S.downloads).filter((d) => ['queued', 'downloading', 'paused', 'verifying'].includes(d.status));
  const provRows = (S.provModels || []).length ? `<button class="m-row link-row" data-action="settings-tab" data-tab="providers">
      <div class="m-ico">${icon('cloud', 18)}</div><div class="m-text"><b>${esc(t('provModelsCount', { n: S.provModels.length }))}</b><small>${esc([...new Set(S.provModels.map((m) => m.providerName))].join(' · '))}</small></div>${icon('right', 16)}</button>` : '';

  const cat = S.catalog;
  const catHtml = !cat ? `<div class="muted">${esc(t('detecting'))}</div>` : [...cat.items].sort((a, b) => (b.id === cat.recommended) - (a.id === cat.recommended) || (FIT_ORDER[a.fit] ?? 9) - (FIT_ORDER[b.fit] ?? 9) || b.sizeGB - a.sizeGB).map((m) => {
    const dl = Object.values(S.downloads).find((d) => d.repo === m.repo && ['downloading', 'queued', 'paused', 'verifying'].includes(d.status));
    return `<div class="cat-card ${m.blocked ? 'dim' : ''}">
      <div class="cc-top"><b>${esc(m.name)}</b>${m.id === cat.recommended ? `<span class="chip accent">${esc(t('recommended'))}</span>` : ''}</div>
      <div class="cc-meta">${esc(m.by)} · ${esc(m.params)} · ≈ ${m.sizeGB} GB</div>
      <div class="cc-tags">${m.blocked ? '' : `<span class="fit fit-${m.fit}">${esc(t('fit_' + m.fit))}</span>`}${m.tags.map((x) => `<span class="tag">${esc(t('tag_' + x))}</span>`).join('')}</div>
      <div class="cc-act">${m.installed ? `<span class="muted small">${icon('check', 14)} ${esc(t('installed'))}</span>` : dl ? `<span class="muted small">${icon('download', 13)} ${esc(t(dl.status === 'paused' ? 'dlPaused' : dl.status === 'queued' ? 'dlQueued' : 'dlInProgress'))}</span>` : m.blocked ? `<span class="blocked">${icon('lock', 14)} ${esc(t('fitWhy_' + m.fit))}</span>` : `<button class="btn sm" data-action="dl-catalog" data-id="${m.id}">${icon('download', 14)} ${esc(t('download'))}</button>`}</div>
    </div>`;
  }).join('');

  const sr = S.search;
  let searchHtml = '';
  if (sr.loading) searchHtml = `<div class="muted small">${esc(t('searching'))}</div>`;
  else if (sr.results) {
    searchHtml = sr.results.length ? sr.results.map((r) => `<div class="sr-item ${sr.repo === r.repo ? 'open' : ''}">
        <button class="sr-head" data-action="sr-open" data-repo="${esc(r.repo)}">${icon(sr.repo === r.repo ? 'down' : 'right', 15)}<b>${esc(r.repo)}</b><span class="muted small">${icon('download', 12)} ${fmtNum(r.downloads)}</span></button>
        ${sr.repo === r.repo ? renderRepoFiles() : ''}
      </div>`).join('') : `<div class="muted small">${esc(t('noResults'))}</div>`;
  }
  const libs = S.libs || [];
  const target = libs.length > 1 ? `<select class="input sm2" data-input="defaultLibrary" title="${esc(t('dlTarget'))}">${libs.map((l) => `<option value="${esc(l.id)}" ${l.isDefault ? 'selected' : ''}>${esc(t('libOn', { n: l.name }))}${l.free != null ? ` · ${esc(fmtBytes(l.free))} ${esc(t('free'))}` : ''}</option>`).join('')}</select>` : '';

  return `
    <div class="st-sec">${esc(t('yourModels'))}<span class="grow"></span><button class="link-btn" data-action="settings-tab" data-tab="storage">${icon('archive', 13)} ${esc(t('importModels'))}</button></div>
    ${loc.length || provRows ? loc.map(modelRow).join('') + provRows : `<div class="empty-note">${esc(t('noModelsYet'))}</div>`}
    ${dls.length ? `<div class="st-sec">${esc(t('downloads'))}</div><div class="dl-list">${dls.map(dlRow).join('')}</div>` : ''}
    <div class="st-sec">${esc(t('recommendedFor'))} <span class="muted small">${S.specs ? esc(specLine()) : ''}</span><span class="grow"></span>${target}</div>
    <div class="cat-grid">${catHtml}</div>
    <div class="st-sec">${esc(t('searchHF'))}</div>
    <form class="search-row" data-form="hf-search">${icon('search', 16)}<input class="input bare" name="q" value="${esc(sr.q)}" placeholder="${esc(t('searchPh'))}"><button class="btn sm" type="submit">${esc(t('search'))}</button></form>
    <div class="sr-list">${searchHtml}</div>`;
}

// ───────────────────────────── Storage tab ─────────────────────────────
function storageTab() {
  const libs = S.libs;
  const d = S.settings.downloads || {};
  const libHtml = !libs ? `<div class="muted">${esc(t('loading'))}</div>` : libs.map((l) => {
    const tot = l.free != null ? l.free + l.used : null;
    return `<div class="lib-row ${l.isDefault ? 'def' : ''}">
      <div class="m-ico">${icon(l.builtin ? 'box' : 'folder', 18)}</div>
      <div class="m-text"><b>${esc(l.name)}${l.isDefault ? ` <span class="chip accent">${esc(t('libDefault'))}</span>` : ''}</b>
        <small class="mono" title="${esc(l.path)}">${esc(l.path)}</small>
        <small>${esc(t('libStats', { n: l.count, u: fmtBytes(l.used), f: l.free != null ? fmtBytes(l.free) : '—' }))}</small>
        ${tot ? `<div class="bar thin"><i style="width:${Math.min(100, l.used / tot * 100).toFixed(1)}%"></i></div>` : ''}</div>
      ${l.isDefault ? '' : `<button class="btn sm" data-action="lib-default" data-id="${esc(l.id)}">${esc(t('libMakeDefault'))}</button>`}
      ${l.builtin ? '' : `<button class="icon-btn sm" data-action="lib-remove" data-id="${esc(l.id)}" title="${esc(t('delete'))}">${icon('trash', 16)}</button>`}
    </div>`;
  }).join('');
  const sc = S.importScan;
  let imp = '';
  if (sc === 'loading') imp = `<div class="muted small">${spinner(14)} ${esc(t('scanning'))}</div>`;
  else if (Array.isArray(sc)) {
    const fresh = sc.filter((c) => !c.already);
    imp = !sc.length ? `<div class="empty-note">${esc(t('importNone'))}</div>` : `<div class="imp-list">${sc.map((c, i) => `<label class="imp-row ${c.already ? 'done' : ''}">
        <input type="checkbox" data-imp="${i}" ${c.already ? 'disabled' : 'checked'}>
        <span class="src-badge">${esc(t('src_' + c.source))}</span>
        <span class="m-text"><b>${esc(c.name)}</b><small class="mono">${esc(c.path)}</small></span>
        <span class="muted small">${esc(fmtBytes(c.sizeBytes))}${c.mmproj ? ' · ' + esc(t('vision')) : ''}${c.already ? ' · ' + esc(t('alreadyIn')) : ''}</span></label>`).join('')}</div>
      ${fresh.length ? `<div class="pf-actions"><button class="btn sm primary" data-action="import-go">${icon('download', 14)} ${esc(t('importN', { n: fresh.length }))}</button></div>` : ''}`;
  }
  return `
    <div class="st-sec">${esc(t('libraries'))}<span class="grow"></span><button class="btn sm" data-action="lib-add">${icon('plus', 14)} ${esc(t('libAdd'))}</button></div>
    <p class="muted small st-intro">${esc(t('librariesHint'))}</p>
    <div class="lib-list">${libHtml}</div>
    <div class="st-sec">${esc(t('importTitle'))}</div>
    <p class="muted small st-intro">${esc(t('importHint'))}</p>
    <div class="imp-actions"><button class="btn sm" data-action="import-scan">${icon('search', 14)} ${esc(t('importScanApps'))}</button>
      <button class="btn sm" data-action="import-folder">${icon('folder', 14)} ${esc(t('importFolder'))}</button></div>
    ${imp}
    <div class="st-sec">${esc(t('downloads'))}</div>
    ${row(t('dlParallel'), seg('downloads.maxConcurrent', d.maxConcurrent || 1, [[1, '1'], [2, '2'], [3, '3']]), t('dlParallelHint'))}
    ${row(t('dlLimit'), `<select class="input" data-input="downloads.limitMBps" data-type="float">${[[0, t('unlimited')], [2, '2 MB/s'], [5, '5 MB/s'], [10, '10 MB/s'], [25, '25 MB/s'], [50, '50 MB/s'], [100, '100 MB/s']].map(([v, l]) => `<option value="${v}" ${(d.limitMBps || 0) == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, t('dlLimitHint'))}
    ${row(t('hfToken'), `<input class="input mono" type="password" autocomplete="off" placeholder="hf_…" value="${esc(S.settings.hfToken || '')}" data-input="hfToken">`, t('hfTokenHint'))}`;
}

// ───────────────────────────── actions ─────────────────────────────
async function saveProfile(id, key, value) {
  let patch;
  if (key.startsWith('gen.')) patch = { gen: { [key.slice(4)]: value } };
  else patch = { [key]: value };
  await api.models.profile(id, patch);
  S.settings = await api.settings.get();
  refreshPlans();
  renderSettings();
}
const profVal = (key, raw) => {
  if (raw === '' || raw == null) return null;
  if (['ctx', 'gpuLayers', 'idleMinutes', 'threads'].includes(key)) return parseInt(raw, 10);
  if (key === 'gen.temperature') return parseFloat(raw);
  return raw;
};

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.prof) { e.stopImmediatePropagation(); return saveProfile(el.dataset.prof, el.dataset.key, profVal(el.dataset.key, el.value)); }
  if (el.dataset.move) {
    const id = el.dataset.move;
    (S.moving ||= {})[id] = 0; renderSettings();
    try { await api.models.move(id, el.value); toast(t('moved')); }
    catch (err) { toast(movErr(err), 'err'); }
    delete S.moving[id];
    await refreshModels(); await loadModelExtras();
  }
  if (el.dataset.imp !== undefined) { /* checkbox state read on import */ }
}, true);
const movErr = (e) => { const m = cleanErr(e); return /NO_SPACE/.test(m) ? t('noSpace') : m; };

Object.assign(actions, {
  'model-open': (el, e) => { if (e.target.closest('button')) return; S.modelOpen = S.modelOpen === el.dataset.id ? null : el.dataset.id; renderSettings(); },
  'prof-set': (el) => saveProfile(el.dataset.id, el.dataset.key, profVal(el.dataset.key, el.dataset.value)),
  'prof-reset': async (el) => {
    const p = profOf(el.dataset.id); const patch = {};
    for (const k of Object.keys(p)) patch[k] = null;
    await api.models.profile(el.dataset.id, patch); S.settings = await api.settings.get(); refreshPlans(); renderSettings();
  },
  'model-load': async (el) => { el.disabled = true; try { await api.engine.load(el.dataset.id); } catch (e) { toast(cleanErr(e), 'err'); } renderSettings(); },
  'model-unload': async (el) => { await api.engine.stop(el.dataset.id); },
  'model-reveal': (el) => api.shell.reveal(el.dataset.path),
  'model-rename': async (el) => {
    const m = S.installed.local.find((x) => x.id === el.dataset.id);
    const name = prompt(t('rename'), m ? m.name : '');
    if (name && name.trim()) { await api.models.rename(el.dataset.id, name); await refreshModels(); renderSettings(); renderSidebar(); refreshComposer(); }
  },
  'model-verify': async (el) => {
    const id = el.dataset.id;
    (S.verify ||= {})[id] = { running: true, p: 0 }; renderSettings();
    try { const r = await api.models.verify(id); S.verify[id] = { result: r }; }
    catch (e) { S.verify[id] = { result: { ok: false, bad: [cleanErr(e)] } }; }
    await refreshModels(); renderSettings();
  },
  'dl-pause': (el) => api.models.pause(el.dataset.id),
  'dl-resume': (el) => api.models.resume(el.dataset.id),
  'lib-add': async () => { const r = await api.models.addLibrary(); if (r) { S.libs = r; renderSettings(); toast(t('libAdded')); } },
  'lib-remove': async (el) => {
    try { S.libs = await api.models.removeLibrary(el.dataset.id); renderSettings(); }
    catch (e) { toast(/LIBRARY_NOT_EMPTY/.test(cleanErr(e)) ? t('libNotEmpty') : cleanErr(e), 'err'); }
  },
  'lib-default': async (el) => { S.libs = await api.models.defaultLibrary(el.dataset.id); S.settings = await api.settings.get(); renderSettings(); },
  'import-scan': async () => { S.importScan = 'loading'; renderSettings(); S.importScan = await api.models.scanImports(false).catch(() => []); renderSettings(); },
  'import-folder': async () => { const prev = S.importScan; S.importScan = 'loading'; renderSettings(); const r = await api.models.scanImports(true).catch(() => []); S.importScan = r === null ? prev : r; renderSettings(); },
  'import-go': async () => {
    const pick = $$('[data-imp]').filter((c) => c.checked && !c.disabled).map((c) => S.importScan[+c.dataset.imp]);
    if (!pick.length) return;
    const added = await api.models.import(pick);
    toast(t('imported', { n: added.length }));
    S.importScan = null;
    await refreshModels(); await loadModelExtras(); renderSidebar(); refreshComposer();
  },
});

// Live progress for moves / verification (download progress is handled in app.js).
api.on('models:progress', (p) => {
  if (p.kind === 'move' && p.status === 'moving') { (S.moving ||= {})[p.id] = p.total ? p.received / p.total : 0; if (S.settingsTab === 'models') { const el = $(`.m-card.open .ms-actions .muted`); if (el) el.innerHTML = `${spinner(14)} ${esc(t('moving', { p: Math.round(S.moving[p.id] * 100) }))}`; } }
  if (p.kind === 'verify' && p.status === 'verifying' && S.verify && S.verify[p.id]) {
    S.verify[p.id].p = p.total ? p.received / p.total : 0;
    const b = $(`[data-action="model-verify"][data-id="${CSS.escape(p.id)}"]`); if (b) b.innerHTML = `${icon('shield', 14)} ${esc(t('verifying', { p: Math.round(S.verify[p.id].p * 100) }))}`;
  }
});
