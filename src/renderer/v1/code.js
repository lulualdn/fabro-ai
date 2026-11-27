'use strict';
// Fabro Code in the v1 interface: pick a project folder (or a recent one), then the same chat works on its files
// (meta.code, like the terminal). The mascot shows what Fabro is doing. `fabro code` opens the same sessions in a
// terminal (src/cli/fabro.js).
window.V1Code = (function () {
  const T = {
    fr: { h: 'Fabro Code', lead: 'Choisis un dossier de projet. Fabro lit le code, le modifie, lance les tests et garde des points de retour.', open: 'Ouvrir un dossier', recent: 'Récents', term: 'Dans ton terminal, dans le dossier du projet :', copy: 'Copier', copied: 'Copié', install: 'Installer la commande', installed: 'Commande installée', ph: 'Demande une modification, un test, une explication…' },
    en: { h: 'Fabro Code', lead: 'Pick a project folder. Fabro reads the code, edits it, runs the tests and keeps restore points.', open: 'Open a folder', recent: 'Recent', term: 'In your terminal, in the project folder:', copy: 'Copy', copied: 'Copied', install: 'Install the command', installed: 'Command installed', ph: 'Ask for a change, a test, an explanation…' },
  };
  const t = (k) => (T[V1.lang] || T.en)[k];
  let recent = null; let raf = 0; let lastActive = Date.now(); let doneAt = 0; let state = 'idle';

  function stateNow() {
    const S = V1.S; const st = S.streaming;
    if ([...S.asks.values()].length) return 'waiting';
    if (st && S.conv && st.convId === S.conv.id) {
      lastActive = Date.now();
      const run = (st.msg.steps || []).filter((s) => s.status === 'running').pop();
      if (run) return /write|edit|apply|run_command|run_test|git|lint|checkpoint/.test(run.name) ? 'code' : /search|read_page|research|fetch|find/.test(run.name) ? 'search' : 'thinking';
      return 'thinking';
    }
    const last = S.conv && S.conv.messages[S.conv.messages.length - 1];
    if (last && last.error && Date.now() - lastActive < 60000) return 'error';
    if (Date.now() - doneAt < 4000) return 'success';
    return Date.now() - lastActive > 5 * 60000 ? 'sleep' : 'idle';
  }
  function loop(ts) {
    const cv = document.querySelector('canvas.masc'); if (!cv) { raf = 0; return; }
    const reduce = document.documentElement.classList.contains('reduce') || document.documentElement.classList.contains('eco') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    state = stateNow();
    FabroMascot.draw(cv.getContext('2d'), state, reduce ? 0 : ts, { scale: +cv.dataset.s || 4, ink: getComputedStyle(document.documentElement).getPropertyValue('--t3'), reduce });
    const lab = document.querySelector('.masc-state'); if (lab) lab.textContent = FabroMascot.LABEL[V1.lang === 'fr' ? 'fr' : 'en'][state];
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf) raf = requestAnimationFrame(loop); };
  Fabro.on('done', () => { doneAt = Date.now(); lastActive = Date.now(); });

  function cmdBox() {
    return `<div class="codecmd"><span>${t('term')}</span><code>fabro code</code><span class="grow"></span><button class="btn" data-act="code-copy">${t('copy')}</button><button class="btn ghost" data-act="code-install">${t('install')}</button></div>`;
  }
  // home of Fabro Code: no project open yet
  function home(el) {
    if (!recent) api.code.recent().then((r) => { recent = r || []; if (V1.S.view === 'code') V1.renderAll(); }).catch(() => { recent = []; });
    el.innerHTML = `<div class="home code-home"><div class="code-hero"><canvas class="masc" data-s="6" width="96" height="114"></canvas><div><h1>${t('h')}</h1><p class="subt">${t('lead')}</p><p class="masc-state mono"></p></div></div>
      <div class="code-acts"><button class="btn pri" data-act="code-open">${V1.ic('code')}${t('open')}</button></div>
      ${(recent || []).length ? `<h3 class="code-h3">${t('recent')}</h3><div class="code-recent">${recent.slice(0, 8).map((r) => `<button class="opt" data-act="code-recent" data-root="${V1.esc(r.root)}"><span class="grow">${V1.esc(r.name)}<small>${V1.esc(r.root)}</small></span></button>`).join('')}</div>` : ''}
      ${cmdBox()}</div>`;
    start();
  }
  // in a project: a header with the mascot above the usual thread
  function bar(c) {
    return `<div class="code-bar"><canvas class="masc" data-s="2" width="32" height="38"></canvas><div class="grow"><b>${V1.esc(c.code.root.split(/[\\/]/).pop())}</b><small class="masc-state"></small></div><code class="mono">fabro code</code><button class="btn ghost" data-act="code-copy">${t('copy')}</button></div>`;
  }
  async function openRoot(root) {
    const info = root ? await api.code.info(root).catch(() => null) : await api.code.open().catch(() => null);
    if (!info || !info.root) return;
    V1.S.conv = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), title: info.name, mode: 'code', code: { root: info.root }, agent: true, nodes: [], leafId: null, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    V1.S.view = 'chat'; recent = null; V1.renderAll(); start();
    const ta = document.querySelector('.composer textarea'); if (ta) { ta.placeholder = t('ph'); ta.focus(); }
  }
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act^="code-"]'); if (!el) return;
    const a = el.dataset.act;
    if (a === 'code-open') return openRoot(null);
    if (a === 'code-recent') return openRoot(el.dataset.root);
    if (a === 'code-copy') { await navigator.clipboard.writeText('fabro code').catch(() => {}); el.textContent = t('copied'); setTimeout(() => { el.textContent = t('copy'); }, 1200); }
    if (a === 'code-install') { const r = await api.cli.install().catch((x) => ({ ok: false, error: x.message })); V1.toast(r.ok ? `${t('installed')} · ${r.note || ''}` : String(r.error || '?'), r.ok ? '' : 'err'); }
  });
  return { home, bar, start };
})();
