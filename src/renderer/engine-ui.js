'use strict';
/* Settings → Engine (built-in llama.cpp: loaded models, monitor, energy, defaults, version/rollback, logs, local API)
   and → Usage (token history). */

let monTimer = null;
function startMonitor() {
  stopMonitor();
  const tick = async () => {
    try { S.mon = await api.monitor.sample(); } catch { return; }
    const el = $('#mon'); if (el) el.outerHTML = monitorCard();
  };
  tick(); monTimer = setInterval(tick, 2000);
  api.localApi.status().then((s) => { S.localApiStatus = s; if (S.settingsTab === 'engine') renderSettings(); }).catch(() => {});
}
function stopMonitor() { clearInterval(monTimer); monTimer = null; }

function meter(label, used, total, unit = t('unitGB'), extra = '') {
  const p = total ? Math.min(1, used / total) : 0;
  return `<div class="meter"><div class="mt-top"><span>${esc(label)}</span><b>${used == null ? '—' : nf1().format(used)}${total ? ` / ${nf1().format(total)}` : ''} ${esc(unit)}</b></div>
    <div class="mt-track ${p > 0.92 ? 'hot' : p > 0.75 ? 'warm' : ''}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>${extra ? `<div class="mt-extra">${extra}</div>` : ''}</div>`;
}
function monitorCard() {
  const m = S.mon;
  if (!m) return `<div class="mon" id="mon"><div class="muted small">${spinner(14)} ${esc(t('loading'))}</div></div>`;
  const g = m.gpus[0];
  const gpuExtra = g ? [g.util != null && `${t('gpuLoad')} ${g.util} %`, g.temp != null && `${g.temp} °C`, g.power != null && `${Math.round(g.power)} W`].filter(Boolean).join(' · ') : '';
  return `<div class="mon" id="mon">
    ${g ? meter(`${t('memVram')} · ${g.name}`, g.usedGB, g.totalGB, t('unitGB'), esc(gpuExtra)) : `<div class="meter"><div class="mt-top"><span>${esc(t('memVram'))}</span><b class="muted">${esc(S.specs && S.specs.unified ? t('memUnified') : t('monNoGpu'))}</b></div></div>`}
    ${meter(t('memRam'), m.ram.usedGB, m.ram.totalGB)}
    ${meter(t('cpuLoad'), m.cpu, 100, '%', esc(t('threadsN', { n: m.cpus })))}
    ${m.procs.length ? `<div class="mon-procs">${m.procs.map((p) => `<span>${icon('box', 12)} ${esc(p.name)} · ${gb(p.ramGB)} RAM${p.vramGB != null ? ` · ${gb(p.vramGB)} ${esc(t('vramShort'))}` : ''}</span>`).join('')}</div>` : ''}
  </div>`;
}

function engineTab() {
  const e = S.engine;
  const st = S.settings;
  const g = st.engine || {};
  const loaded = e.loaded || [];
  const ctxOpts = [2048, 4096, 8192, 16384, 32768, 65536, 131072].map((n) => `<option value="${n}" ${g.ctx === n ? 'selected' : ''}>${n / 1024}K tokens</option>`).join('');
  const gl = g.gpuLayers ?? -1;
  const energyNow = e.energy ? t('energy_' + e.energy) : '';
  const la = st.localApi || {};
  const las = S.localApiStatus || {};
  const url = `http://${la.lan ? (S.info.lanIp || 'localhost') : '127.0.0.1'}:${la.port || 11500}/v1`;
  return `
    <div class="eng-card st-${e.status}">
      <span class="dot"></span>
      <div><b>${esc(t('engine_' + (e.status === 'stopping' ? 'idle' : e.status), { p: Math.round((e.progress || 0) * 100) }))}</b>
      <small>llama.cpp ${esc(e.version || '—')}${e.variant ? ' · ' + esc(e.variant.toUpperCase()) : ''}${energyNow ? ' · ' + esc(energyNow) : ''}</small></div>
      <div class="grow"></div>
      ${loaded.length ? `<button class="btn sm" data-action="engine-stop">${icon('power', 14)} ${esc(t('unloadAll'))}</button>` : ''}
      <button class="btn sm" data-action="engine-update">${icon('refresh', 14)} ${esc(t('checkUpdates'))}</button>
    </div>
    ${e.status === 'error' ? errorCard({ code: e.errorCode, message: e.error, detail: e.errorDetail }, 'engine') : ''}
    ${loaded.length ? `<div class="loaded-list">${loaded.map((l) => `<div class="ld-row">
        <span class="${l.status === 'ready' ? 'ok-dot' : 'spin-dot'}"></span><b>${esc(l.name)}</b>
        <span class="muted small">${esc(t(MODE_KEY[l.mode] || 'modeCpu'))}${l.vramGB ? ` · ${gb(l.vramGB)} ${esc(t('vramShort'))}` : ''}${l.ramGB > 0.05 ? ` · ${gb(l.ramGB)} RAM` : ''}${l.pinned ? ' · ' + esc(t('pinnedMem')) : ''}${l.busy ? ' · ' + esc(t('busyNow')) : ''}</span>
        <span class="grow"></span><span class="muted small mono">:${l.port}</span>
        <button class="icon-btn sm" data-action="model-unload" data-id="${esc(l.id || '')}" title="${esc(t('unload'))}">${icon('power', 15)}</button></div>`).join('')}</div>` : ''}
    <div class="st-sec">${esc(t('monitor'))}</div>
    ${monitorCard()}
    <div class="st-sec">${esc(t('performance'))}</div>
    ${row(t('energyMode'), seg('engine.energy', g.energy || 'auto', [['auto', t('auto')], ['performance', t('energy_performance')], ['balanced', t('energy_balanced')], ['eco', t('energy_eco')]]), t('energyHint'))}
    ${row(t('multiModel'), toggle('engine.multiModel', g.multiModel !== false), t('multiModelHint'))}
    ${row(t('idleUnload'), `<select class="input" data-input="engine.idleMinutes" data-type="int">${[[0, t('never')], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [240, '4 h']].map(([v, l]) => `<option value="${v}" ${(g.idleMinutes ?? 30) == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, t('idleUnloadHint'))}
    <div class="st-sec">${esc(t('engineDefaults'))}</div>
    ${row(t('engineVariant'), seg('engine.variant', g.variant || 'auto', [['auto', t('auto')], ['cpu', t('cpuOnly')]]), t('engineVariantHint'))}
    ${row(t('contextLength'), `<select class="input" data-input="engine.ctx" data-type="int">${ctxOpts}</select>`, t('contextHint'))}
    ${row(t('gpuLayers'), `<div class="range-wrap"><input type="range" min="-1" max="99" step="1" value="${gl}" data-input="engine.gpuLayers" data-type="int"><span class="rv">${gl < 0 ? t('auto') : gl}</span></div>`, t('gpuLayersHint'))}
    ${row(t('kvCache'), seg('engine.kvType', g.kvType || 'f16', [['f16', 'F16'], ['q8_0', 'Q8'], ['q4_0', 'Q4']]), t('kvCacheHint'))}
    ${row(t('flashAttn'), seg('engine.flashAttn', g.flashAttn || 'auto', [['auto', t('auto')], ['on', t('on')], ['off', t('off')]]), t('flashAttnHint'))}
    ${row(t('cpuMoe'), seg('engine.cpuMoe', g.cpuMoe || 'auto', [['auto', t('auto')], ['on', t('on')], ['off', t('off')]]), t('cpuMoeHint'))}
    ${row(t('threads'), `<input class="input sm" type="number" min="0" max="256" value="${g.threads || 0}" data-input="engine.threads" data-type="int">`, t('threadsHint'))}
    <div class="st-sec">${esc(t('localApi'))}</div>
    ${row(t('localApiEnable'), toggle('localApi.enabled', !!la.enabled), t('localApiHint'))}
    ${la.enabled ? `
      <div class="api-box ${las.error ? 'err' : las.running ? 'ok' : ''}">
        <div class="api-url"><span class="${las.running ? 'ok-dot' : 'off-dot'}"></span><code>${esc(url)}</code>
          <button class="icon-btn sm" data-action="copy-text" data-text="${esc(url)}" title="${esc(t('copy'))}">${icon('copy', 15)}</button></div>
        ${las.error ? `<div class="pf-error">${icon('warning', 14)} ${esc(las.error === 'PORT_IN_USE' ? t('portInUse', { p: la.port || 11500 }) : las.error)}</div>` : ''}
        <pre class="api-ex">curl ${esc(url)}/chat/completions \\
  -H "Content-Type: application/json"${la.key ? ` \\\n  -H "Authorization: Bearer ${esc(la.key)}"` : ''} \\
  -d '{"model":"default","messages":[{"role":"user","content":"Hello"}]}'</pre>
        <small class="muted">${esc(t('localApiReq', { n: las.requests || 0 }))}</small>
      </div>
      ${row(t('apiPort'), `<input class="input sm" type="number" min="1024" max="65535" value="${la.port || 11500}" data-input="localApi.port" data-type="int">`)}
      ${row(t('apiKey'), `<div class="inline-ctl"><input class="input mono" value="${esc(la.key || '')}" placeholder="${esc(t('apiKeyNone'))}" data-input="localApi.key"><button class="btn sm" data-action="api-genkey">${esc(t('generate'))}</button></div>`, t('apiKeyHint'))}
      ${row(t('apiLan'), toggle('localApi.lan', !!la.lan), t('apiLanHint'))}` : ''}
    <div class="st-sec">${esc(t('engineVersion'))}</div>
    ${row('llama.cpp', `<span class="mono">${esc(e.version || '—')}</span>${e.prevVersion ? ` <button class="btn sm" data-action="engine-rollback">${icon('back', 14)} ${esc(t('rollbackTo', { v: e.prevVersion }))}</button>` : ''}`, e.prevVersion ? t('rollbackHint') : t('rollbackNone'))}
    <details class="logs" ${S.logsOpen ? 'open' : ''}><summary data-action="logs-toggle">${icon('terminal', 14)} ${esc(t('engineLogs'))}</summary>
      <div class="logs-tools"><button class="btn sm" data-action="logs-refresh">${icon('refresh', 13)} ${esc(t('refresh'))}</button><button class="btn sm" data-action="err-copy">${icon('copy', 13)} ${esc(t('errCopy'))}</button></div>
      <pre class="logs-body">${esc((S.logs || []).slice(-200).join('\n') || t('noLogs'))}</pre></details>
    <p class="muted small st-foot">${icon('info', 13)} ${esc(t('engineOnlyNote'))} <button class="link-btn" data-action="settings-tab" data-tab="providers">${esc(t('tab_providers'))}</button></p>`;
}

// ───────────────────────────── Usage tab ─────────────────────────────
async function loadUsage() {
  try { S.usage = await api.usage.summary(S.usageDays || 30); } catch { S.usage = null; }
  if (S.settingsTab === 'usage') renderSettings();
}
function usageTab() {
  const u = S.usage;
  if (!u) return `<div class="muted">${esc(t('loading'))}</div>`;
  const nf = new Intl.NumberFormat(S.lang);
  const days = u.days;
  const max = Math.max(1, ...days.map((d) => d.prompt + d.completion));
  const W = 640, H = 150, bw = W / days.length;
  const bars = days.map((d, i) => {
    const hp = (d.prompt / max) * (H - 18), hc = (d.completion / max) * (H - 18);
    const x = i * bw + 2, w = Math.max(2, bw - 4);
    const label = new Date(d.day + 'T12:00').toLocaleDateString(S.lang, { day: 'numeric', month: 'short' });
    return `<g class="ub" style="--i:${i}"><title>${esc(label)} · ${nf.format(d.prompt)} ${esc(t('usageIn'))} · ${nf.format(d.completion)} ${esc(t('usageOut'))} · ${d.requests} ${esc(t('usageReq'))}</title>
      <rect x="${x}" y="${H - hp - hc}" width="${w}" height="${Math.max(0, hc)}" rx="2" class="u-out"/>
      <rect x="${x}" y="${H - hp}" width="${w}" height="${Math.max(0, hp)}" rx="2" class="u-in"/></g>`;
  }).join('');
  const sum = days.reduce((a, d) => ({ p: a.p + d.prompt, c: a.c + d.completion, r: a.r + d.requests }), { p: 0, c: 0, r: 0 });
  const tick = (i) => new Date(days[i].day + 'T12:00').toLocaleDateString(S.lang, { day: 'numeric', month: 'short' });
  const maxM = Math.max(1, ...u.models.map((m) => m.prompt + m.completion));
  return `
    <div class="u-kpis">
      <div class="kpi"><small>${esc(t('usagePeriod', { n: days.length }))}</small><b>${esc(fmtNum(sum.p + sum.c))}</b><span>${esc(t('tokensWord'))}</span></div>
      <div class="kpi"><small>${esc(t('usageIn'))}</small><b>${esc(fmtNum(sum.p))}</b><span>${esc(t('tokensWord'))}</span></div>
      <div class="kpi"><small>${esc(t('usageOut'))}</small><b>${esc(fmtNum(sum.c))}</b><span>${esc(t('tokensWord'))}</span></div>
      <div class="kpi"><small>${esc(t('usageReqs'))}</small><b>${esc(nf.format(sum.r))}</b><span>${esc(t('usageAllTime', { n: fmtNum(u.total.prompt + u.total.completion) }))}</span></div>
    </div>
    <div class="u-chart">
      <div class="u-legend"><span><i class="u-in"></i>${esc(t('usageIn'))}</span><span><i class="u-out"></i>${esc(t('usageOut'))}</span><span class="grow"></span>${seg('usage-days', S.usageDays || 30, [[7, '7 j'], [30, '30 j'], [90, '90 j']]).replace(/data-action="set" data-key="usage-days"/g, 'data-action="usage-days"')}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="u-svg">${bars}</svg>
      <div class="u-ticks"><span>${esc(tick(0))}</span><span>${esc(tick(Math.floor(days.length / 2)))}</span><span>${esc(tick(days.length - 1))}</span></div>
    </div>
    <div class="st-sec">${esc(t('usageByModel'))}</div>
    ${u.models.length ? `<div class="u-models">${u.models.map((m) => `<div class="um-row">
      <span class="um-name" title="${esc(m.name)}">${esc(m.name)}</span>
      <div class="um-bar"><i style="width:${((m.prompt + m.completion) / maxM * 100).toFixed(1)}%"></i></div>
      <span class="um-n">${esc(fmtNum(m.prompt + m.completion))}</span><span class="muted small">${esc(t('usageReqN', { n: m.requests || 0 }))}</span></div>`).join('')}</div>` : `<div class="empty-note">${esc(t('usageEmpty'))}</div>`}
    <p class="muted small st-foot">${icon('shield', 13)} ${esc(t('usagePrivacy'))} <button class="link-btn" data-action="usage-clear">${esc(t('usageClear'))}</button></p>`;
}

Object.assign(actions, {
  'engine-rollback': async () => {
    if (!confirm(t('rollbackConfirm', { v: S.engine.prevVersion }))) return;
    try { await api.engine.rollback(); toast(t('rolledBack')); } catch (e) { toast(cleanErr(e), 'err'); }
  },
  'logs-toggle': async (el, e) => { e.preventDefault(); S.logsOpen = !S.logsOpen; if (S.logsOpen) S.logs = await api.engine.logs(); renderSettings(); },
  'logs-refresh': async () => { S.logs = await api.engine.logs(); renderSettings(); },
  'copy-text': (el) => { navigator.clipboard.writeText(el.dataset.text); flashCheck(el); },
  'api-genkey': async () => {
    const k = 'fab-' + [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await applySetting('localApi.key', k);
  },
  'usage-days': async (el) => { S.usageDays = +el.dataset.value; await loadUsage(); },
  'usage-clear': async () => { if (!confirm(t('usageClearConfirm'))) return; await api.usage.clear(); await loadUsage(); },
});

api.on('localapi:status', (s) => { S.localApiStatus = s; if (S.settingsTab === 'engine') renderSettings(); });
