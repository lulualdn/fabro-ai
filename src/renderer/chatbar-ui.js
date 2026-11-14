/* Chat bar extras (wave 3).
   1. Queued message: what is typed while an answer is written waits in a see-through bubble; "Send now" stops the
      answer and sends it as a new turn.
   2. Allow everything: per conversation, after a clear warning. Ordinary confirmations (write a file, run a
      command) are skipped; deleting, paying, sending, publishing and dangerous commands still ask (the guard in
      src/main/agent/index.js decides that, not this file).
   Public: window.ChatBar = { nowButton(m, p, i), chip(), plusItem(), allowAll() }. */
(function () {
  const live = (m) => S.streaming && S.streaming.msg === m;

  // ── 1. queued message ──
  function nowButton(m, p, i) {
    if (p.used || !live(m)) return '';
    return `<button class="pr-now" data-action="precision-now" data-i="${i}">${icon('up', 12)}<span>${esc(t('cb_now'))}</span></button>`;
  }
  actions['precision-now'] = () => {
    if (!S.streaming) return;
    const m = S.streaming.msg, reqId = S.streaming.reqId;
    const late = (m.precisions || []).filter((p) => !p.used);
    if (!late.length) return;
    m.precisions = m.precisions.filter((p) => p.used); // they leave the bubble: they become the next message
    const text = late.map((p) => p.text).join('\n');
    api.chat.abort(reqId);
    const t0 = Date.now();
    (function go() {
      if (S.streaming) { if (Date.now() - t0 < 10000) setTimeout(go, 50); else { S._draft = text; const ta = $('#prompt'); if (ta && !ta.value) ta.value = text; } return; }
      const ta = $('#prompt'), typed = ta ? ta.value : '';
      sendPrompt(text);
      const ta2 = $('#prompt'); if (ta2 && typed && typed !== text) { ta2.value = typed; S._draft = typed; } // what was being typed stays
    })();
  };

  // ── 2. allow everything ──
  const allowAll = () => !!(S.conv && S.conv.allowAll);
  function chip() {
    if (!allowAll()) return '';
    return `<button class="c-chip cb-all" data-action="allow-all" title="${esc(t('cb_allOff'))}">${icon('unlock', 14)}<span>${esc(t('cb_allOn'))}</span></button>`;
  }
  function plusItem() {
    if (S.mode === 'code') return ''; // Code has its own per-project permission modes
    return `<button class="pm-item" data-action="allow-all">${icon(allowAll() ? 'unlock' : 'lock', 16)}<span class="pm-text"><b>${esc(t('cb_all'))}</b><small>${esc(t('cb_allHint'))}</small></span><span class="pm-switch ${allowAll() ? 'on' : ''}"><i></i></span></button>`;
  }
  function set(on) {
    if (!S.conv) S.conv = newConv();
    S.conv.allowAll = !!on;
    if (S.conv.messages.length) persist();
    renderComposerExtras();
    if (on) toast(t('cb_allToast'));
  }
  function renderComposerExtras() {
    const box = $('#composer .c-extras') || $('.c-extras');
    if (box && typeof composerExtras === 'function') box.innerHTML = composerExtras();
    else if (typeof renderView === 'function' && !S.streaming) renderView();
  }
  actions['allow-all'] = () => {
    closePopover();
    if (allowAll()) { set(false); return; }
    $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="allow-all-no"></div>
      <div class="modal cb-warn" role="alertdialog" aria-modal="true" aria-labelledby="cb-warn-t" aria-describedby="cb-warn-d">
        <h2 id="cb-warn-t">${esc(t('cb_warnTitle'))}</h2>
        <div id="cb-warn-d"><p>${esc(t('cb_warn1'))}</p><p>${esc(t('cb_warn2'))}</p><p class="muted">${esc(t('cb_warn3'))}</p></div>
        <div class="modal-actions"><button class="btn" data-action="allow-all-no">${esc(t('cancel'))}</button><button class="btn primary" data-action="allow-all-yes">${esc(t('cb_warnYes'))}</button></div>
      </div>`;
    const b = $('#modal-root [data-action="allow-all-no"].btn'); if (b) b.focus();
  };
  actions['allow-all-no'] = () => closeModal();
  actions['allow-all-yes'] = () => { closeModal(); set(true); };

  window.ChatBar = { nowButton, chip, plusItem, allowAll };
})();
