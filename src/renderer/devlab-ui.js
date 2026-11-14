// Developer lab (Settings › Advanced, under developer mode): the same question, several set-ups side by side
// (a model + a system prompt), then a report written by a model. Main side: src/main/devlab.js.
(() => {
  const L = { q: '', cols: [{ model: '', prompt: 'none', text: '' }, { model: '', prompt: 'none', text: '' }], res: [], busy: false, report: null, prompts: null };
  const MAXC = 4;
  let host = null;
  const mkey = (m) => refKey(m.ref);
  const models = () => allModels().filter((m) => m.src !== 'mod' && m.ref && m.ref.backend !== 'mod');
  const refOf = (k) => { const m = models().find((x) => mkey(x) === k) || models().find((x) => currentModel() && sameRef(x.ref, currentModel().ref)) || models()[0]; return m ? m.ref : null; };
  const labelOf = (i) => String.fromCharCode(65 + i);

  async function systemOf(c) {
    if (c.prompt === 'none') return '';
    if (c.prompt === 'text') return c.text || '';
    try { const p = await api.sysprompts.get(c.prompt); return (p && p.body) || ''; } catch { return ''; }
  }

  function colHtml(c, i) {
    const r = L.res[i];
    const cur = c.model || (currentModel() ? mkey(currentModel()) : '');
    return `<div class="dl-col" data-i="${i}">
      <div class="dl-col-head"><b>${labelOf(i)}</b>${L.cols.length > 2 ? `<button class="icon-btn sm" data-dl="rm" data-i="${i}" title="${esc(t('dl_remove'))}">${icon('x', 14)}</button>` : ''}</div>
      <select class="input sm" data-dl="model" data-i="${i}">${models().map((m) => `<option value="${esc(mkey(m))}" ${mkey(m) === cur ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <select class="input sm" data-dl="prompt" data-i="${i}">
        <option value="none" ${c.prompt === 'none' ? 'selected' : ''}>${esc(t('dl_noPrompt'))}</option>
        <option value="text" ${c.prompt === 'text' ? 'selected' : ''}>${esc(t('dl_typed'))}</option>
        ${(L.prompts || []).map((p) => `<option value="${esc(p.id)}" ${c.prompt === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      ${c.prompt === 'text' ? `<textarea class="input area mono dl-sys" data-dl="text" data-i="${i}" rows="4" placeholder="${esc(t('dl_typedPh'))}">${esc(c.text || '')}</textarea>` : ''}
      <div class="dl-out ${r && r.error ? 'err' : ''}">${r ? (r.pending ? `<span class="muted">${esc(t('dl_running'))}</span>` : r.error ? esc(r.error) : esc(r.text || '')) : `<span class="muted">${esc(t('dl_empty'))}</span>`}</div>
      ${r && !r.pending && !r.error ? `<div class="dl-meta">${(r.ms / 1000).toFixed(1)} s · ${t('dl_chars', { n: (r.text || '').length })}</div>` : ''}
    </div>`;
  }

  function html() {
    const done = L.res.filter((r) => r && r.text).length;
    return `<div class="st-sec">${esc(t('dl_title'))}</div>
      <p class="muted small">${esc(t('dl_hint'))}</p>
      <textarea class="input area dl-q" data-dl="q" rows="3" placeholder="${esc(t('dl_qPh'))}">${esc(L.q)}</textarea>
      <div class="dl-cols">${L.cols.map(colHtml).join('')}</div>
      <div class="dl-actions">
        <button class="btn primary sm" data-dl="run" ${L.busy || !models().length ? 'disabled' : ''}>${icon('play', 14)} ${esc(L.busy ? t('dl_running') : t('dl_run'))}</button>
        ${L.cols.length < MAXC ? `<button class="btn sm" data-dl="add" ${L.busy ? 'disabled' : ''}>${icon('plus', 14)} ${esc(t('dl_add'))}</button>` : ''}
        <button class="btn sm" data-dl="judge" ${L.busy || done < 1 ? 'disabled' : ''}>${icon('file', 14)} ${esc(t('dl_judge'))}</button>
      </div>
      ${!models().length ? `<p class="muted small">${esc(t('dl_noModel'))}</p>` : ''}
      ${L.report ? `<div class="dl-report"><div class="dl-col-head"><b>${esc(t('dl_report'))}</b>${L.report.proposal ? `<button class="btn sm" data-dl="use">${esc(t('dl_use', { l: labelOf(L.cols.length - 1) }))}</button>` : ''}</div><div class="dl-out ${L.report.error ? 'err' : ''}">${L.report.pending ? `<span class="muted">${esc(t('dl_judging'))}</span>` : esc(L.report.error || L.report.text || '')}</div></div>` : ''}`;
  }

  function paint() { if (host && host.isConnected) host.innerHTML = html(); }

  async function run() {
    if (L.busy || !L.q.trim()) { if (!L.q.trim()) toast(t('dl_needQ')); return; }
    L.busy = true; L.report = null; L.res = L.cols.map(() => ({ pending: true })); paint();
    for (let i = 0; i < L.cols.length; i++) {
      const c = L.cols[i]; const system = await systemOf(c);
      const r = await api.devlab.one({ model: refOf(c.model), system, user: L.q }).catch((e) => ({ error: e.message }));
      L.res[i] = { ...r, system, label: labelOf(i) }; paint();
    }
    L.busy = false; paint();
  }

  async function judge() {
    if (L.busy) return;
    L.busy = true; L.report = { pending: true }; paint();
    const cur = currentModel();
    const r = await api.devlab.judge({ model: cur ? cur.ref : refOf(''), user: L.q, lang: S.lang, results: L.res.filter((x) => x && x.text) }).catch((e) => ({ error: e.message }));
    const m = /```[a-z]*\n([\s\S]*?)```/i.exec(r.text || '');
    L.report = { ...r, proposal: m ? m[1].trim() : '' }; L.busy = false; paint();
  }

  function onClick(e) {
    const b = e.target.closest('[data-dl]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'TEXTAREA') return;
    const k = b.dataset.dl; const i = Number(b.dataset.i);
    if (k === 'run') run();
    else if (k === 'judge') judge();
    else if (k === 'add' && L.cols.length < MAXC) { L.cols.push({ model: '', prompt: 'none', text: '' }); paint(); }
    else if (k === 'rm' && L.cols.length > 2) { L.cols.splice(i, 1); L.res.splice(i, 1); paint(); }
    else if (k === 'use' && L.report && L.report.proposal) { const c = L.cols[L.cols.length - 1]; c.prompt = 'text'; c.text = L.report.proposal; paint(); }
  }
  function onInput(e) {
    const el = e.target.closest('[data-dl]'); if (!el) return;
    const k = el.dataset.dl; const i = Number(el.dataset.i);
    if (k === 'q') L.q = el.value;
    else if (k === 'text' && L.cols[i]) L.cols[i].text = el.value;
    else if (k === 'model' && L.cols[i]) L.cols[i].model = el.value;
    else if (k === 'prompt' && L.cols[i]) { L.cols[i].prompt = el.value; paint(); }
  }

  window.DevLab = {
    renderSection(el) {
      if (!S.settings.devMode) { el.innerHTML = ''; return; }
      if (host !== el) { host = el; el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onInput); }
      paint();
      if (!L.prompts) api.sysprompts.list().then((l) => { L.prompts = l || []; paint(); }).catch(() => { L.prompts = []; });
    },
    _state: L,
  };
})();
