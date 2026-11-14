/* Wake-up scripts (wave 3): the visible trace and the call back.
   While a script runs for this chat, a chip sits in the chat bar (click = cancel). When it exits, its output is sent
   to the conversation as the next message and Fabro picks up where it stopped. If another chat is open, or an answer
   is being written, the result waits. Main: src/main/wakeups.js. Public: window.Wakeups = { chip(), label(step) }. */
(function () {
  let waiting = [];   // scripts still running (all chats)
  const pending = []; // finished scripts whose output has not been delivered yet
  let timer = null;

  const mine = () => (S.conv ? waiting.filter((j) => j.convId === S.conv.id) : []);
  const refreshBar = () => { const box = document.querySelector('.c-extras'); if (box && typeof composerExtras === 'function') box.innerHTML = composerExtras(); };

  function chip() {
    const l = mine(); if (!l.length) return '';
    const j = l[0], min = Math.max(1, Math.round((Date.now() - j.startedAt) / 60000));
    return `<button class="c-chip wk-chip" data-action="wake-cancel" data-id="${esc(j.id)}" title="${esc(t('wk_chipT', { c: j.command.slice(0, 120) }))}">${icon('tasks', 14) || ''}<span>${esc(t('wk_chip', { m: min, x: j.timeoutMin }))}</span>${icon('x', 12)}</button>`;
  }
  function label(st) {
    const c = String((st.args || {}).command || '').slice(0, 80);
    return t(st.status === 'running' || st.status === 'asking' ? 'wk_run' : 'wk_started', { c });
  }
  function message(r) {
    const min = Math.max(1, Math.round((r.ms || (r.endedAt - r.startedAt)) / 60000));
    const head = r.timedOut ? t('wk_msgTimeout', { m: r.timeoutMin }) : r.error ? t('wk_msgError', { e: r.error }) : t('wk_msg');
    const out = String(r.out || '').trim();
    return `${head}\n\n\`\`\`\n$ ${r.command}\n(exit ${r.code == null ? '?' : r.code}, ${min} min)\n${out ? out.slice(-4000) : t('wk_noOut')}\n\`\`\`${r.note ? `\n\n${t('wk_then', { n: r.note })}` : ''}`;
  }
  function deliver() {
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      if (!S.conv || S.conv.id !== r.convId || S.streaming) continue;
      pending.splice(i, 1);
      const ta = document.querySelector('#prompt'), typed = ta ? ta.value : '';
      sendPrompt(message(r));
      const ta2 = document.querySelector('#prompt'); if (ta2 && typed) { ta2.value = typed; S._draft = typed; }
      break; // one at a time: the next one goes after this answer
    }
    if (pending.length && !timer) timer = setInterval(deliver, 2000);
    if (!pending.length && timer) { clearInterval(timer); timer = null; }
  }

  actions['wake-cancel'] = async (el) => {
    const ok = await api.wakeups.cancel(el.dataset.id);
    if (ok) toast(t('wk_cancelled'));
  };
  api.on('wakeups:changed', (l) => { waiting = l || []; refreshBar(); });
  api.on('wakeups:done', (r) => {
    pending.push(r);
    const here = S.conv && S.conv.id === r.convId;
    if (!here) { const c = (S.convs || []).find((x) => x.id === r.convId); toast(t('wk_elsewhere', { t: (c && c.title) || t('untitled') })); }
    else if (S.streaming) toast(t('wk_after'));
    api.notify && api.notify({ title: t('wk_notify'), body: r.command.slice(0, 120), onlyIfHidden: true });
    deliver();
  });
  api.wakeups.list().then((l) => { waiting = l || []; }).catch(() => {});

  window.Wakeups = { chip, label };
})();
