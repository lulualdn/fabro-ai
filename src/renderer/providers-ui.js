'use strict';
/* Settings → Providers: external providers (cloud APIs, Ollama, LM Studio, OpenAI-compatible). */

const PROV_TILE = {
  ollama: ['#111', '#fff', 'O'], lmstudio: ['#5b4bdb', '#fff', 'LM'], openai: ['#0d0d0d', '#fff', 'AI'], anthropic: ['#d97757', '#fff', 'A'],
  xai: ['#000', '#fff', 'x'], google: ['#1a73e8', '#fff', 'G'], mistral: ['#fa520f', '#fff', 'M'], deepseek: ['#4d6bfe', '#fff', 'D'],
  groq: ['#f55036', '#fff', 'g'], openrouter: ['#6467f2', '#fff', 'OR'], together: ['#0f6fff', '#fff', 'T'], cerebras: ['#f05a28', '#fff', 'C'],
  perplexity: ['#1f8a8a', '#fff', 'P'], custom: ['var(--panel)', 'var(--text-2)', '{ }'],
};
const provTile = (kind, size = 36) => {
  const [bg, fg, l] = PROV_TILE[kind] || PROV_TILE.custom;
  return `<span class="prov-tile" style="--s:${size}px;background:${bg};color:${fg}">${esc(l)}</span>`;
};
const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

async function loadProviders(redetect = true) {
  try { S.prov = await api.providers.view(); } catch (e) { S.prov = { enabled: false, presets: [], list: [] }; }
  if (S.settingsTab === 'providers') renderSettings();
  if (redetect && S.prov.enabled) {
    S.detect = await api.providers.detect().catch(() => null);
    if (S.settingsTab === 'providers') renderSettings();
  }
}
async function afterProviderChange(view) {
  if (view) S.prov = view;
  S.settings = await api.settings.get();
  await refreshModels();
  renderSettings(); renderSidebar(); refreshComposer();
  if (S.mode === 'chat' && (!S.conv || !S.conv.messages.length)) renderView();
}

function providersTab() {
  const P = S.prov;
  if (!P) return `<div class="muted">${esc(t('loading'))}</div>`;
  const master = row(t('provEnable'), toggleBtn('prov-enable', P.enabled), t('provEnableHint'));
  if (!P.enabled) {
    return `${master}
      <div class="prov-empty">
        <div class="pe-tiles">${['openai', 'anthropic', 'xai', 'google', 'ollama', 'lmstudio'].map((k, i) => `<span style="--i:${i}">${provTile(k, 40)}</span>`).join('')}</div>
        <p>${esc(t('provPitch'))}</p>
        <button class="btn primary" data-action="prov-enable" data-value="true">${icon('cloud', 16)} ${esc(t('provEnableBtn'))}</button>
      </div>`;
  }
  const byKind = (k) => P.list.filter((p) => p.kind === k);
  const det = S.detect || {};
  const oneClick = ['ollama', 'lmstudio'].map((k) => {
    const pre = P.presets.find((x) => x.kind === k);
    const have = byKind(k)[0];
    const d = det[k];
    const status = !S.detect ? `<span class="muted">${esc(t('provDetecting'))}</span>`
      : d && d.running ? `<span class="ok-dot"></span>${esc(t('provRunning', { n: d.models }))}`
      : `<span class="off-dot"></span>${esc(t('provNotRunning'))}`;
    const btn = have ? `<span class="chip ok">${icon('check', 13)} ${esc(t('provConnected'))}</span>`
      : d && d.running ? `<button class="btn sm primary" data-action="prov-quick" data-kind="${k}">${icon('link', 14)} ${esc(t('provConnect'))}</button>`
      : `<button class="btn sm" data-action="ext-link-btn" data-url="${esc(pre.site)}">${icon('download', 14)} ${esc(t('provGet'))}</button>`;
    return `<div class="oc-card ${have ? 'on' : ''}">
      ${provTile(k, 40)}
      <div class="oc-text"><b>${esc(pre.name)}</b><small>${status}</small></div>
      ${btn}
    </div>`;
  }).join('');

  const rows = P.list.map((p) => {
    const n = (p.models || []).length;
    const sub = [hostOf(p.baseUrl), t('provModels', { n }), p.keyHint].filter(Boolean).join(' · ');
    const editing = S.provEdit === p.id;
    return `<div class="prov-row ${p.enabled ? '' : 'off'} ${p.error ? 'err' : ''}">
      ${provTile(p.kind)}
      <div class="m-text"><b>${esc(p.name)}</b><small>${esc(sub)}</small>
        ${p.error ? `<small class="prov-err">${icon('warning', 12)} ${esc(t('err_' + p.error + '_t') !== 'err_' + p.error + '_t' ? t('err_' + p.error + '_t') : p.error)}</small>` : ''}</div>
      <button class="icon-btn sm" data-action="prov-refresh" data-id="${esc(p.id)}" title="${esc(t('provRefresh'))}">${icon('refresh', 16)}</button>
      <button class="icon-btn sm" data-action="prov-edit" data-id="${esc(p.id)}" title="${esc(t('provEdit'))}">${icon('key', 16)}</button>
      <button class="icon-btn sm" data-action="prov-remove" data-id="${esc(p.id)}" title="${esc(t('delete'))}">${icon('trash', 16)}</button>
      ${toggleBtn('prov-toggle', p.enabled, `data-id="${esc(p.id)}"`)}
    </div>${editing ? provForm({ kind: p.kind, id: p.id, baseUrl: p.baseUrl, name: p.name }) : ''}`;
  }).join('');

  const cloud = P.presets.filter((x) => !x.local);
  const addGrid = `<div class="prov-grid">${cloud.map((x, i) => `<button class="prov-add ${S.provForm && S.provForm.kind === x.kind ? 'sel' : ''}" style="--i:${i}" data-action="prov-form" data-kind="${x.kind}">
      ${provTile(x.kind, 30)}<span>${esc(x.custom ? t('provCustom') : x.name)}</span>${byKind(x.kind).length ? icon('check', 14) : ''}</button>`).join('')}</div>`;

  return `${master}
    <div class="st-sec">${esc(t('provOneClick'))}</div>
    <div class="oc-grid">${oneClick}</div>
    ${P.list.length ? `<div class="st-sec">${esc(t('provYours'))}</div><div class="prov-list">${rows}</div>` : ''}
    <div class="st-sec">${esc(t('provAdd'))}</div>
    ${addGrid}
    ${S.provForm && !S.provForm.id ? provForm(S.provForm) : ''}
    <p class="muted small st-foot">${icon('shield', 13)} ${esc(t('provPrivacy'))}</p>`;
}

function provForm(f) {
  const pre = S.prov.presets.find((x) => x.kind === f.kind) || {};
  const needsUrl = pre.custom || f.id;
  return `<form class="prov-form" data-form="provider" data-kind="${esc(f.kind)}" ${f.id ? `data-id="${esc(f.id)}"` : ''}>
    <div class="pf-head">${provTile(f.kind, 28)}<b>${esc(f.id ? f.name : pre.custom ? t('provCustom') : pre.name)}</b>
      ${pre.keyUrl ? `<button type="button" class="link-btn" data-action="ext-link-btn" data-url="${esc(pre.keyUrl)}">${esc(t('provGetKey'))} ${icon('link', 12)}</button>` : ''}</div>
    ${pre.custom && !f.id ? `<label class="pf-field"><span>${esc(t('provName'))}</span><input class="input" name="name" placeholder="vLLM, LocalAI…" value="${esc(f.name || '')}"></label>` : ''}
    ${needsUrl ? `<label class="pf-field"><span>${esc(t('provBaseUrl'))}</span><input class="input mono" name="baseUrl" spellcheck="false" placeholder="http://127.0.0.1:8000/v1" value="${esc(f.baseUrl || '')}"></label>` : ''}
    ${!pre.keyless ? `<label class="pf-field"><span>${esc(t(pre.custom ? 'provKeyOptional' : 'provKey'))}</span><input class="input mono" name="apiKey" type="password" spellcheck="false" autocomplete="off" placeholder="${esc(f.id ? t('provKeyKeep') : 'sk-…')}"></label>` : ''}
    ${S.provBusy ? `<div class="pf-busy">${spinner(18)} ${esc(t('provTesting'))}</div>` : ''}
    ${S.provError ? `<div class="pf-error">${icon('warning', 14)} ${esc(S.provError)}</div>` : ''}
    <div class="pf-actions"><button type="button" class="btn sm" data-action="prov-cancel">${esc(t('cancel'))}</button>
      <button type="submit" class="btn sm primary" ${S.provBusy ? 'disabled' : ''}>${icon(f.id ? 'check' : 'link', 14)} ${esc(t(f.id ? 'save' : 'provConnect'))}</button></div>
  </form>`;
}

function toggleBtn(action, on, extra = '') {
  return `<button class="switch ${on ? 'on' : ''}" data-action="${action}" data-value="${!on}" ${extra} role="switch" aria-checked="${on}"><i></i></button>`;
}
const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');

Object.assign(actions, {
  'prov-enable': async (el) => {
    const on = el.dataset.value === 'true';
    S.prov = await api.providers.enable(on);
    await afterProviderChange();
    if (on) loadProviders(true);
  },
  'prov-quick': async (el) => {
    const kind = el.dataset.kind;
    el.disabled = true; el.innerHTML = `${spinner(14)} ${esc(t('provTesting'))}`;
    try {
      const v = await api.providers.add({ kind });
      const p = v.list.find((x) => x.kind === kind);
      toast(t('provAdded', { name: p.name, n: (p.models || []).length }));
      await afterProviderChange(v);
    } catch (e) { toast(cleanErr(e), 'err'); renderSettings(); }
  },
  'prov-form': (el) => { S.provForm = S.provForm && S.provForm.kind === el.dataset.kind ? null : { kind: el.dataset.kind }; S.provEdit = null; S.provError = ''; renderSettings(); setTimeout(() => $('.prov-form input')?.focus(), 50); },
  'prov-edit': (el) => { S.provEdit = S.provEdit === el.dataset.id ? null : el.dataset.id; S.provForm = null; S.provError = ''; renderSettings(); },
  'prov-cancel': () => { S.provForm = null; S.provEdit = null; S.provError = ''; renderSettings(); },
  'prov-remove': async (el) => {
    if (!confirm(t('provRemoveConfirm'))) return;
    await afterProviderChange(await api.providers.remove(el.dataset.id));
  },
  'prov-toggle': async (el) => { await afterProviderChange(await api.providers.update(el.dataset.id, { enabled: el.dataset.value === 'true' })); },
  'prov-refresh': async (el) => {
    el.classList.add('spinning');
    const r = await api.providers.refresh(el.dataset.id);
    const err = r.errors && r.errors[el.dataset.id];
    if (err) toast(err, 'err'); else toast(t('provRefreshed'));
    await afterProviderChange(r);
  },
  'ext-link-btn': (el) => api.shell.open(el.dataset.url),
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="provider"]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  const data = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()]));
  S.provBusy = true; S.provError = ''; renderSettings();
  try {
    let v;
    if (f.dataset.id) {
      const patch = {};
      if (data.baseUrl) patch.baseUrl = data.baseUrl;
      if (data.apiKey) patch.apiKey = data.apiKey;
      v = await api.providers.update(f.dataset.id, patch);
      toast(t('provSaved'));
    } else {
      v = await api.providers.add({ kind: f.dataset.kind, ...data });
      const p = v.list[v.list.length - 1];
      toast(t('provAdded', { name: p.name, n: (p.models || []).length }));
    }
    S.provForm = null; S.provEdit = null;
    S.provBusy = false;
    await afterProviderChange(v);
  } catch (err) {
    S.provBusy = false; S.provError = cleanErr(err); renderSettings();
  }
});
