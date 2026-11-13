'use strict';
/* Settings › Resources: disk use in one bar, live RAM / VRAM / CPU charts (Fabro vs other apps), tips with one-click
   actions, and the limits as one simple choice. Built on api.resources.* (docs/v02/api-resources.md).
   Live samples are subscribed only while this screen is on screen and the window is visible (lease renewed every
   45 s); everything stops when the section is left, the settings close or the window hides. */
(function () {
  if (!window.api || !api.resources) return;
  const GB = 2 ** 30;
  const R = { el: null, ov: null, disk: null, tips: null, hist: [], sub: null, lease: 0, off: null, busy: {}, open: false };
  const nf = (d = 1) => new Intl.NumberFormat(S.lang, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const gbs = (b) => b == null ? '—' : `${nf(b >= 10 * GB ? 0 : 1).format(b / GB)} ${t('unitGB')}`;
  const gbv = (x) => x == null ? '—' : `${nf(x >= 10 ? 0 : 1).format(x)} ${t('unitGB')}`;
  const tt = (k, v) => t('res_' + k, v);

  // ───────────────────────── disk ─────────────────────────
  const GROUP = { model: 'm', engine: 'f', voice: 'f', images: 'f', tools: 'f', data: 'd', cache: 'c' };
  function sectionLabel(s) {
    if (s.kind === 'model') return s.label;
    const k = 'res_sec_' + s.id; return t(k) !== k ? t(k) : s.label;
  }
  function diskHtml() {
    const d = R.disk;
    if (!d) return `<div class="res-loading muted small">${spinner(14)} ${esc(tt('measuring'))}</div>`;
    const secs = d.sections.filter((s) => s.bytes > 0);
    const inBar = secs.filter((s) => s.inAppData !== false);
    const elsewhere = secs.filter((s) => s.inAppData === false);
    const disk = d.disk || {};
    const total = disk.totalBytes || inBar.reduce((a, s) => a + s.bytes, 0) + (disk.otherBytes || 0) + (disk.freeBytes || 0);
    let mi = 0;
    const parts = [
      ...inBar.map((s) => ({ key: s.id, label: sectionLabel(s), bytes: s.bytes, g: GROUP[s.kind] || 'o', shade: s.kind === 'model' ? mi++ % 4 : 0, sec: s })),
      ...(disk.otherBytes ? [{ key: 'others', label: tt('otherApps'), bytes: disk.otherBytes, g: 'x' }] : []),
      ...(disk.freeBytes ? [{ key: 'free', label: tt('free'), bytes: disk.freeBytes, g: 'free' }] : []),
    ];
    const pct = (b) => total ? (b / total) * 100 : 0;
    const share = (b) => `${nf(pct(b) < 1 ? 1 : 0).format(pct(b))} %`;
    const bar = parts.filter((p) => pct(p.bytes) >= 0.15).map((p) => `<span class="rb-seg g-${p.g} sh-${p.shade || 0}" style="flex-grow:${p.bytes / GB}" title="${esc(`${p.label} · ${gbs(p.bytes)} · ${share(p.bytes)}`)}"></span>`).join('');
    const fabro = d.fabroBytes || inBar.reduce((a, s) => a + s.bytes, 0);
    const legend = parts.map((p) => `<li class="rl-row"><span class="rl-key g-${p.g} sh-${p.shade || 0}" aria-hidden="true"></span><span class="rl-name">${esc(p.label)}</span><span class="rl-val">${esc(gbs(p.bytes))}</span><span class="rl-pct">${esc(share(p.bytes))}</span></li>`).join('');
    const caches = secs.find((s) => s.id === 'caches');
    return `<p class="res-lead">${esc(tt('diskLead', { f: gbs(fabro), free: gbs(disk.freeBytes), path: disk.path || '' }))}</p>
      <div class="res-bar" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${gbs(p.bytes)}`).join(', '))}">${bar}</div>
      <ul class="res-legend">${legend}</ul>
      ${elsewhere.length ? `<p class="muted small">${esc(tt('elsewhere', { n: elsewhere.map((s) => `${s.label} (${gbs(s.bytes)})`).join(', ') }))}</p>` : ''}
      <div class="res-acts">
        <button class="btn sm" data-res="clear" ${!caches || R.busy.clear ? 'disabled' : ''}>${R.busy.clear ? spinner(14) : icon('trash', 14)} ${esc(tt('clearCaches'))}${caches ? ` · ${esc(gbs(caches.bytes))}` : ''}</button>
        <button class="btn sm ghost" data-res="disk-refresh">${icon('refresh', 14)} ${esc(tt('remeasure'))}</button>
        <span class="muted small">${esc(tt('cachesSafe'))}</span>
      </div>`;
  }

  // ───────────────────────── live charts ─────────────────────────
  const W = 320, H = 96, PAD = 2;
  function series(kind) {
    return R.hist.map((s) => {
      if (kind === 'cpu') return s.cpu ? { a: s.cpu.fabro || 0, b: Math.max(0, (s.cpu.total || 0) - (s.cpu.fabro || 0)), max: 100, at: s.at } : null;
      const m = s[kind]; if (!m || m.unified || m.totalGB == null) return null;
      return { a: m.fabroGB || 0, b: m.otherGB != null ? m.otherGB : Math.max(0, (m.usedGB || 0) - (m.fabroGB || 0)), max: m.totalGB, at: s.at };
    }).filter(Boolean);
  }
  function path(pts, key, max) {
    const n = pts.length; if (!n) return '';
    const x = (i) => (n === 1 ? W : (i / (n - 1)) * W);
    const y = (v) => H - PAD - (Math.min(max, v) / max) * (H - PAD * 2);
    return pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  }
  function chartHtml(kind) {
    const label = { ram: tt('ram'), vram: tt('vram'), cpu: tt('cpu') }[kind];
    const last = R.hist[R.hist.length - 1];
    if (kind === 'vram' && last && last.vram && last.vram.unified) return `<div class="res-chart"><div class="rc-h"><b>${esc(label)}</b></div><p class="muted small">${esc(tt('unified'))}</p></div>`;
    if (kind === 'vram' && last && !last.vram) return `<div class="res-chart"><div class="rc-h"><b>${esc(label)}</b></div><p class="muted small">${esc(tt('noVram'))}</p></div>`;
    const pts = series(kind).slice(-90);
    const p = pts[pts.length - 1];
    const unit = kind === 'cpu' ? (v) => `${Math.round(v)} %` : gbv;
    const max = p ? p.max : 1;
    const stack = pts.map((q) => ({ ...q, ab: q.a + q.b }));
    const now = p ? tt('chartNow', { f: unit(p.a), o: unit(p.b), free: kind === 'cpu' ? `${Math.max(0, Math.round(100 - p.a - p.b))} %` : unit(Math.max(0, p.max - p.a - p.b)) }) : tt('waiting');
    const svg = pts.length > 1 ? `<svg class="rc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`${label}: ${now}`)}">
        <line class="rc-grid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><line class="rc-base" x1="0" x2="${W}" y1="${H - PAD}" y2="${H - PAD}"/>
        <path class="rc-area-a" d="${path(stack, 'a', max)}L${W},${H - PAD}L0,${H - PAD}Z"/>
        <path class="rc-line-b" d="${path(stack, 'ab', max)}"/>
        <path class="rc-line-a" d="${path(stack, 'a', max)}"/>
        <line class="rc-cross" x1="0" x2="0" y1="0" y2="${H}" hidden/>
      </svg>` : `<div class="rc-empty muted small">${spinner(14)} ${esc(tt('waiting'))}</div>`;
    return `<div class="res-chart" data-kind="${kind}">
      <div class="rc-h"><b>${esc(label)}</b><span class="rc-total muted small">${p ? esc(kind === 'cpu' ? '100 %' : tt('ofTotal', { n: gbv(max) })) : ''}</span></div>
      <div class="rc-plot">${svg}<div class="rc-tip" hidden></div></div>
      <div class="rc-now small">${esc(now)}</div></div>`;
  }
  function chartsHtml() {
    return `<div class="res-legend-line small"><span><i class="lk a" aria-hidden="true"></i>${esc(tt('fabro'))}</span><span><i class="lk b" aria-hidden="true"></i>${esc(tt('fabroPlusOthers'))}</span></div>
      <div class="res-charts">${chartHtml('ram')}${chartHtml('vram')}${chartHtml('cpu')}</div>`;
  }
  function modelsNow() {
    const last = R.hist[R.hist.length - 1];
    const ms = (last && last.models) || [];
    if (!ms.length) return `<p class="muted small">${esc(tt('noModelLoaded'))}</p>`;
    return `<div class="list res-loaded">${ms.map((m) => `<div class="list-row"><span class="${m.busy ? 'spin-dot' : 'ok-dot'}" aria-hidden="true"></span><span class="m-text"><b>${esc(m.name)}</b><small>${esc([m.vramGB ? `${gbv(m.vramGB)} ${t('vramShort')}` : '', m.ramGB > 0.05 ? `${gbv(m.ramGB)} RAM` : '', m.busy ? t('busyNow') : ''].filter(Boolean).join(' · '))}</small></span>
      <button class="btn sm" data-res="act" data-id="unload:${esc(m.id)}">${icon('power', 14)} ${esc(t('unload'))}</button></div>`).join('')}</div>`;
  }

  // ───────────────────────── tips ─────────────────────────
  function tipText(x) {
    const d = x.data || {};
    const k = 'res_tip_' + x.id.replace(/:.*/, '');
    if (x.id === 'caches') { const c = R.disk && R.disk.sections.find((s) => s.id === 'caches'); return t(k, { s: c ? gbs(c.bytes) : '' }); }
    if (x.id === 'vram-others' && d.othersGB != null) return t(k, { s: gbv(d.othersGB) });
    if (['battery', 'threads', 'disk-low'].includes(x.id) && t(k) !== k) return t(k, { s: R.disk && R.disk.disk ? gbs(R.disk.disk.freeBytes) : '' });
    return x.text;
  }
  function tipsHtml() {
    if (!R.tips) return `<div class="muted small">${spinner(14)}</div>`;
    if (!R.tips.length) return `<p class="res-ok">${icon('success', 15)} ${esc(tt('allGood'))}</p>`;
    return `<ul class="res-tips">${R.tips.map((x) => `<li class="res-tip ${x.severity}"><span class="rt-ic">${icon(x.severity === 'warn' ? 'warning' : 'bulb', 15)}</span>
      <span class="rt-text">${esc(tipText(x))}</span>
      ${x.action ? `<button class="btn sm" data-res="act" data-id="${esc(x.action.id)}" ${R.busy[x.action.id] ? 'disabled' : ''}>${R.busy[x.action.id] ? spinner(14) : ''} ${esc(t('res_act_' + x.action.id.split(':')[0]) !== 'res_act_' + x.action.id.split(':')[0] ? t('res_act_' + x.action.id.split(':')[0]) : x.action.label)}</button>` : ''}</li>`).join('')}</ul>`;
  }

  // ───────────────────────── limits ─────────────────────────
  const PRESETS = {
    balanced: { threads: 'auto', priority: 'auto', maxGenerations: 1, batteryBackoff: true, unloadOnPressure: true, ramHeadroomGB: 'auto', vramHeadroomGB: 'auto' },
    quiet: { threads: 'half', priority: 'low', maxGenerations: 1, batteryBackoff: true, unloadOnPressure: true, ramHeadroomGB: 'more', vramHeadroomGB: 'auto' },
    max: { threads: 'auto', priority: 'high', maxGenerations: 1, batteryBackoff: false, unloadOnPressure: true, ramHeadroomGB: 'auto', vramHeadroomGB: 'auto' },
  };
  function presetValues(id) {
    const p = { ...PRESETS[id] };
    const topo = (R.ov && R.ov.specs && R.ov.specs.topology) || {};
    if (p.threads === 'half') p.threads = Math.max(2, Math.floor((topo.physical || 4) / 2));
    if (p.ramHeadroomGB === 'more') p.ramHeadroomGB = Math.max(4, Math.round(((R.ov && R.ov.specs.ramGB) || 16) * 0.3));
    return p;
  }
  function currentPreset(l) {
    for (const id of Object.keys(PRESETS)) { const p = presetValues(id); if (Object.keys(p).every((k) => String(l[k]) === String(p[k]))) return id; }
    return 'custom';
  }
  function limitsHtml() {
    const l = S.settings.limits || {};
    const cur = currentPreset(l);
    const opt = (v, list) => list.map(([x, lab]) => `<option value="${esc(x)}" ${String(l[v]) === String(x) ? 'selected' : ''}>${esc(lab)}</option>`).join('');
    const topo = (R.ov && R.ov.specs && R.ov.specs.topology) || {};
    const thr = [['auto', t('auto')], ...[2, 4, 6, 8, 12, 16, 24, 32].filter((n) => n <= (topo.logical || 16)).map((n) => [n, String(n)])];
    const hr = [['auto', t('auto')], [1, '1 GB'], [2, '2 GB'], [4, '4 GB'], [6, '6 GB'], [8, '8 GB']];
    const sw = (k, on) => `<button class="switch ${on ? 'on' : ''}" data-res="lim" data-k="${k}" data-v="${!on}" role="switch" aria-checked="${on}" aria-label="${esc(tt('lim_' + k))}"><i></i></button>`;
    return `<div class="seg res-presets" role="radiogroup" aria-label="${esc(tt('limitsTitle'))}">${['balanced', 'quiet', 'max'].map((id) => `<button role="radio" aria-checked="${cur === id}" class="${cur === id ? 'on' : ''}" data-res="preset" data-id="${id}">${esc(tt('pre_' + id))}</button>`).join('')}</div>
      <p class="st-intro res-pre-hint">${esc(tt(cur === 'custom' ? 'pre_customHint' : 'pre_' + cur + 'Hint'))}</p>
      <details class="st-more res-lim-more" ${R.open ? 'open' : ''}><summary data-res="lim-toggle">${icon('right', 14)}<span>${esc(tt('limDetails'))}</span></summary><div class="st-more-body">
        ${row(tt('lim_threads'), `<select class="input sm2" data-res-sel="threads" aria-label="${esc(tt('lim_threads'))}">${opt('threads', thr)}</select>`, tt('lim_threadsHint'))}
        ${row(tt('lim_priority'), `<select class="input sm2" data-res-sel="priority" aria-label="${esc(tt('lim_priority'))}">${opt('priority', [['auto', t('auto')], ['low', tt('prio_low')], ['normal', tt('prio_normal')], ['high', tt('prio_high')]])}</select>`, tt('lim_priorityHint'))}
        ${row(tt('lim_ramHeadroomGB'), `<select class="input sm2" data-res-sel="ramHeadroomGB" aria-label="${esc(tt('lim_ramHeadroomGB'))}">${opt('ramHeadroomGB', hr)}</select>`, tt('lim_headroomHint'))}
        ${row(tt('lim_vramHeadroomGB'), `<select class="input sm2" data-res-sel="vramHeadroomGB" aria-label="${esc(tt('lim_vramHeadroomGB'))}">${opt('vramHeadroomGB', hr)}</select>`)}
        ${row(tt('lim_maxGenerations'), `<select class="input sm2" data-res-sel="maxGenerations" aria-label="${esc(tt('lim_maxGenerations'))}">${opt('maxGenerations', [[1, '1'], [2, '2'], [3, '3']])}</select>`, tt('lim_maxGenerationsHint'))}
        ${row(tt('lim_unloadOnPressure'), sw('unloadOnPressure', l.unloadOnPressure !== false), tt('lim_unloadOnPressureHint'))}
        ${row(tt('lim_batteryBackoff'), sw('batteryBackoff', l.batteryBackoff !== false), tt('lim_batteryBackoffHint'))}
        ${row(tt('lim_autotune'), sw('autotune', l.autotune !== false), tt('lim_autotuneHint'))}
        ${row(tt('lim_allowSwap'), sw('allowSwap', !!l.allowSwap), tt('lim_allowSwapHint'))}
      </div></details>`;
  }

  // ───────────────────────── frame ─────────────────────────
  function machineLine() {
    const o = R.ov; if (!o) return '';
    const sp = o.specs; const g = (sp.gpus || [])[0];
    const bits = [sp.cpu && sp.cpu.model, `${sp.ramGB} GB RAM`, g ? `${g.name}${g.vramGB ? ` · ${g.vramGB} GB` : ''}` : null].filter(Boolean);
    const mode = o.energy && o.energy.mode;
    return `<p class="res-machine">${icon('monitor', 15)} <span>${esc(bits.join(' · '))}</span>${mode ? `<span class="chip">${esc(t('energy_' + mode) !== 'energy_' + mode ? t('energy_' + mode) : mode)}</span>` : ''}</p>`;
  }
  function draw() {
    if (!R.el) return;
    const keepOpen = R.el.querySelector('.res-lim-more'); if (keepOpen) R.open = keepOpen.open;
    R.el.innerHTML = `${machineLine()}
      <section class="st-group"><h3 class="st-gh">${icon('archive', 16)}<span>${esc(tt('disk'))}</span></h3><div class="res-disk">${diskHtml()}</div></section>
      <section class="st-group"><h3 class="st-gh">${icon('cpu', 16)}<span>${esc(tt('live'))}</span></h3><p class="st-intro">${esc(tt('liveIntro'))}</p><div class="res-live">${chartsHtml()}</div><div class="res-models">${modelsNow()}</div></section>
      <section class="st-group"><h3 class="st-gh">${icon('bulb', 16)}<span>${esc(tt('tips'))}</span></h3><div class="res-tips-wrap">${tipsHtml()}</div></section>
      <section class="st-group"><h3 class="st-gh">${icon('sliders', 16)}<span>${esc(tt('limitsTitle'))}</span></h3><div class="res-limits">${limitsHtml()}</div></section>`;
  }
  // samples: only the live part is redrawn (cheap), and never while the window is hidden
  let raf = 0;
  function drawLive() {
    if (raf || !R.el) return;
    raf = requestAnimationFrame(() => {
      raf = 0; if (!R.el) return;
      const l = R.el.querySelector('.res-live'); if (l && !l.querySelector('.rc-tip:not([hidden])')) l.innerHTML = chartsHtml();
      const m = R.el.querySelector('.res-models'); if (m) m.innerHTML = modelsNow();
    });
  }
  async function loadAll() {
    const [ov, disk, tips] = await Promise.all([api.resources.overview().catch(() => null), api.resources.disk({}).catch(() => null), api.resources.tips().catch(() => [])]);
    if (!R.el) return;
    R.ov = ov; R.disk = disk; R.tips = tips; draw();
  }
  async function subscribe() {
    if (!R.el || document.hidden) return;
    try { const r = await api.resources.subscribe({ id: R.sub || undefined, intervalMs: 2000 }); R.sub = r.id; if (r.history && r.history.length && !R.hist.length) { R.hist = r.history.slice(-90); drawLive(); } } catch {}
    clearTimeout(R.lease); R.lease = setTimeout(subscribe, 45000);
  }
  function unsubscribe() { clearTimeout(R.lease); R.lease = 0; if (R.sub) { api.resources.unsubscribe(R.sub).catch(() => {}); } }
  const onVis = () => { if (!R.el) return; if (document.hidden) unsubscribe(); else subscribe(); };

  async function onClick(e) {
    const b = e.target.closest('[data-res]'); if (!b || !R.el.contains(b)) return;
    const k = b.dataset.res;
    if (k === 'lim-toggle') return; // native <details>
    e.stopPropagation();
    if (k === 'clear') {
      R.busy.clear = true; draw();
      try { const r = await api.resources.clearCaches(); toast(tt('cleared', { s: gbs(r.freedBytes || 0) })); } catch (er) { toast(cleanErr(er), 'err'); }
      R.busy.clear = false; R.disk = await api.resources.disk({ refresh: true }).catch(() => R.disk); R.tips = await api.resources.tips().catch(() => R.tips); draw();
    }
    if (k === 'disk-refresh') { R.disk = null; draw(); R.disk = await api.resources.disk({ refresh: true }).catch(() => null); draw(); }
    if (k === 'act') {
      const id = b.dataset.id; R.busy[id] = true; draw();
      try { const r = await api.resources.action(id); toast(r && r.note ? r.note : tt('done')); } catch (er) { toast(cleanErr(er), 'err'); }
      delete R.busy[id];
      [R.tips, R.ov] = await Promise.all([api.resources.tips().catch(() => R.tips), api.resources.overview().catch(() => R.ov)]);
      if (id === 'clear-caches') R.disk = await api.resources.disk({ refresh: true }).catch(() => R.disk);
      draw();
    }
    if (k === 'preset') { await saveSettings({ limits: presetValues(b.dataset.id) }); draw(); }
    if (k === 'lim') { await saveSettings({ limits: { [b.dataset.k]: b.dataset.v === 'true' } }); draw(); }
  }
  async function onChange(e) {
    const s = e.target.closest('[data-res-sel]'); if (!s || !R.el.contains(s)) return;
    e.stopPropagation();
    const v = s.value === 'auto' ? 'auto' : Number(s.value);
    await saveSettings({ limits: { [s.dataset.resSel]: v } }); draw();
  }
  // crosshair + tooltip on the charts
  function onMove(e) {
    const plot = e.target.closest && e.target.closest('.rc-plot'); if (!plot) return;
    const kind = plot.closest('.res-chart').dataset.kind; const pts = series(kind).slice(-90); if (pts.length < 2) return;
    const r = plot.getBoundingClientRect(); const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.round(fx * (pts.length - 1)); const p = pts[i];
    const cross = plot.querySelector('.rc-cross'); const tip = plot.querySelector('.rc-tip');
    if (!cross || !tip) return;
    const x = (i / (pts.length - 1)) * W; cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.hidden = false;
    const unit = kind === 'cpu' ? (v) => `${Math.round(v)} %` : gbv;
    const ago = Math.max(0, Math.round((Date.now() - p.at) / 1000));
    tip.innerHTML = `<b>${esc(ago < 3 ? tt('now') : tt('secAgo', { n: ago }))}</b><span><i class="lk a"></i>${esc(tt('fabro'))} ${esc(unit(p.a))}</span><span><i class="lk b"></i>${esc(tt('others'))} ${esc(unit(p.b))}</span>`;
    tip.hidden = false; tip.style.transform = `translateX(${Math.min(r.width - 150, Math.max(0, fx * r.width - 75)).toFixed(0)}px)`;
  }
  function onLeave(e) {
    const plot = e.target.closest && e.target.closest('.rc-plot'); if (!plot) return;
    const c = plot.querySelector('.rc-cross'); const tp = plot.querySelector('.rc-tip'); if (c) c.hidden = true; if (tp) tp.hidden = true;
  }

  function mount(el) {
    unmount();
    R.el = el; el.classList.add('res-root');
    draw();
    el.addEventListener('click', onClick, true);
    el.addEventListener('change', onChange, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerout', onLeave);
    R.off = api.on('resources:sample', (s) => { if (!R.el || !s) return; R.hist.push(s); if (R.hist.length > 90) R.hist.shift(); if (!document.hidden) drawLive(); });
    document.addEventListener('visibilitychange', onVis);
    subscribe(); loadAll();
  }
  function unmount() {
    if (!R.el) return;
    unsubscribe();
    if (R.off) R.off(); R.off = null;
    document.removeEventListener('visibilitychange', onVis);
    R.el.removeEventListener('click', onClick, true); R.el.removeEventListener('change', onChange, true);
    R.el.removeEventListener('pointermove', onMove); R.el.removeEventListener('pointerout', onLeave);
    R.el = null; R.hist = [];
  }
  window.ResourcesUI = { mount, unmount, _state: R };
})();
