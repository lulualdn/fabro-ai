'use strict';
/* Personalization page: name, custom instructions, response styles (incl. learned from an example), memory. */

function renderCustomPage() {
  const st = S.settings;
  const mem = st.memory || {};
  const mems = S.memories || [];
  const styles = styleList();
  const learning = S.styleLearn || {};
  return `<div class="page custom-page">
    <header class="pg-head"><div class="pg-ico">${icon('brush', 22)}</div><div><h1>${esc(t('nav_custom'))}</h1><p>${esc(t('customLead'))}</p></div></header>

    <section class="pg-card">
      <h2>${icon('user', 16)} ${esc(t('aboutYou'))}</h2>
      <label class="pg-field"><span>${esc(t('yourName'))}</span><input class="input" maxlength="40" data-input="userName" value="${esc(st.userName || '')}" placeholder="${esc(prettyName(S.info.userName) || '')}"></label>
      <label class="pg-field"><span>${esc(t('systemPrompt'))}<small>${esc(t('systemPromptHint'))}</small></span>
        <textarea class="input area" rows="5" data-input="gen.systemPrompt" placeholder="${esc(t('systemPromptPh'))}">${esc(st.gen.systemPrompt || '')}</textarea></label>
    </section>

    <section class="pg-card">
      <h2>${icon('brush', 16)} ${esc(t('responseStyles'))}</h2>
      <div class="style-grid">${styles.map((s) => `<button class="style-card ${activeStyle().id === s.id ? 'on' : ''}" data-action="set-style-page" data-value="${esc(s.id)}">
          <b>${esc(s.name)}</b><small>${esc(s.builtin ? t('styleHint_' + s.id) : (s.prompt || '').split('\n')[0].replace(/^[-•]\s*/, ''))}</small>
          ${s.builtin ? '' : `<span class="sc-del" data-action="style-delete" data-id="${esc(s.id)}" title="${esc(t('delete'))}">${icon('x', 13)}</span>`}
        </button>`).join('')}</div>
      <details class="learn" ${learning.open ? 'open' : ''}>
        <summary data-action="learn-toggle">${icon('plus', 14)} ${esc(t('styleLearnTitle'))}</summary>
        <p class="muted small">${esc(t('styleLearnHint'))}</p>
        <input class="input" id="style-name" maxlength="40" placeholder="${esc(t('styleNamePh'))}" value="${esc(learning.name || '')}">
        <textarea class="input area" id="style-sample" rows="6" placeholder="${esc(t('styleSamplePh'))}">${esc(learning.sample || '')}</textarea>
        ${learning.result ? `<div class="learn-result"><b>${esc(t('styleDetected'))}</b><textarea class="input area" id="style-prompt" rows="6">${esc(learning.result)}</textarea></div>` : ''}
        ${learning.error ? `<div class="pf-error">${icon('warning', 14)} ${esc(learning.error)}</div>` : ''}
        <div class="pf-actions">
          ${learning.result ? `<button class="btn sm primary" data-action="style-save">${icon('check', 14)} ${esc(t('styleSave'))}</button>`
            : `<button class="btn sm primary" data-action="style-learn" ${learning.busy ? 'disabled' : ''}>${learning.busy ? spinner(14) : icon('zap', 14)} ${esc(t('styleAnalyze'))}</button>`}
        </div>
      </details>
    </section>

    <section class="pg-card">
      <h2>${icon('brain', 16)} ${esc(t('memoryTitle'))}</h2>
      <p class="muted small">${esc(t('memoryLead'))}</p>
      <div class="pg-toggles">
        <label class="pg-tg">${toggle('memory.enabled', mem.enabled !== false)}<span><b>${esc(t('memoryUse'))}</b><small>${esc(t('memoryUseHint'))}</small></span></label>
        <label class="pg-tg">${toggle('memory.auto', mem.auto !== false)}<span><b>${esc(t('memoryAuto'))}</b><small>${esc(t('memoryAutoHint'))}</small></span></label>
      </div>
      <form class="mem-add" data-form="mem-add"><input class="input" name="text" maxlength="300" placeholder="${esc(t('memoryAddPh'))}"><button class="btn sm" type="submit">${icon('plus', 14)} ${esc(t('memoryAdd'))}</button></form>
      <div class="mem-list">${mems.length ? mems.map((m, i) => `<div class="mem-row" style="--i:${i}">
          ${S.memEdit === m.id ? `<input class="input mem-edit" data-mem="${esc(m.id)}" value="${esc(m.text)}">`
            : `<span class="mem-text">${esc(m.text)}</span><small class="muted">${esc(new Date(m.updated).toLocaleDateString(S.lang, { day: 'numeric', month: 'short' }))}</small>`}
          <button class="icon-btn xs" data-action="mem-edit" data-id="${esc(m.id)}" title="${esc(t('rename'))}">${icon(S.memEdit === m.id ? 'check' : 'edit', 14)}</button>
          <button class="icon-btn xs" data-action="mem-delete" data-id="${esc(m.id)}" title="${esc(t('delete'))}">${icon('trash', 14)}</button>
        </div>`).join('') : `<div class="empty-note">${esc(t('memoryEmpty'))}</div>`}</div>
      ${mems.length ? `<button class="link-btn danger-link" data-action="mem-clear">${esc(t('memoryClear'))}</button>` : ''}
    </section>
  </div>`;
}

function bindCustomPage() {
  const ed = $('.mem-edit');
  if (ed) { ed.focus(); ed.addEventListener('keydown', (e) => { if (e.key === 'Enter') actions['mem-edit']({ dataset: { id: ed.dataset.mem } }); if (e.key === 'Escape') { S.memEdit = null; renderView(); } }); }
}
const rerenderCustom = () => { if (S.mode === 'custom') { const sc = $('.custom-page')?.parentElement; const y = sc ? sc.scrollTop : 0; renderView(); const n = $('.custom-page')?.parentElement; if (n) n.scrollTop = y; } };

Object.assign(actions, {
  'set-style-page': async (el, e) => { if (e.target.closest('[data-action=style-delete]')) return; await saveSettings({ activeStyle: el.dataset.value }); rerenderCustom(); },
  'style-delete': async (el, e) => {
    e.stopPropagation();
    const left = (S.settings.styles || []).filter((x) => x.id !== el.dataset.id);
    await saveSettings({ styles: left, ...(S.settings.activeStyle === el.dataset.id ? { activeStyle: 'default' } : {}) });
    rerenderCustom();
  },
  'learn-toggle': (el, e) => { e.preventDefault(); S.styleLearn = { ...(S.styleLearn || {}), open: !(S.styleLearn || {}).open }; rerenderCustom(); },
  'style-learn': async () => {
    const sample = $('#style-sample').value.trim(), name = $('#style-name').value.trim();
    S.styleLearn = { open: true, name, sample, busy: true };
    if (sample.length < 80) { S.styleLearn = { ...S.styleLearn, busy: false, error: t('styleTooShort') }; return rerenderCustom(); }
    if (!currentModel()) { S.styleLearn = { ...S.styleLearn, busy: false, error: t('noModel') }; return rerenderCustom(); }
    rerenderCustom();
    try { S.styleLearn = { ...S.styleLearn, busy: false, result: await api.brain.style({ model: S.settings.selectedModel, sample, lang: S.lang }) }; }
    catch (e) { S.styleLearn = { ...S.styleLearn, busy: false, error: cleanErr(e) }; }
    rerenderCustom();
  },
  'style-save': async () => {
    const prompt = ($('#style-prompt') || {}).value || S.styleLearn.result;
    const name = ($('#style-name').value || '').trim() || t('styleMine');
    const id = 'style-' + Date.now().toString(36);
    await saveSettings({ styles: [...(S.settings.styles || []), { id, name, prompt: prompt.trim() }], activeStyle: id });
    S.styleLearn = null; toast(t('styleSaved', { n: name })); rerenderCustom();
  },
  'mem-edit': async (el) => {
    const id = el.dataset.id;
    if (S.memEdit === id) { const inp = $('.mem-edit'); if (inp && inp.value.trim()) await api.memory.update(id, inp.value.trim()); S.memEdit = null; S.memories = await api.memory.list(); }
    else S.memEdit = id;
    rerenderCustom();
  },
  'mem-delete': async (el) => { await api.memory.delete(el.dataset.id); S.memories = await api.memory.list(); rerenderCustom(); },
  'mem-clear': async () => { if (!confirm(t('memoryClearConfirm'))) return; await api.memory.clear(); S.memories = []; rerenderCustom(); },
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="mem-add"]');
  if (!f) return;
  e.preventDefault();
  const text = new FormData(f).get('text').trim();
  if (!text) return;
  await api.memory.add(text);
  S.memories = await api.memory.list();
  rerenderCustom();
});
