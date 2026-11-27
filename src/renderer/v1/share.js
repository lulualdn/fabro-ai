'use strict';
// Share by link: shows what will be shared, creates the link (src/main/share.js), copies it, and can remove it.
window.V1Share = (function () {
  let cur = null; let links = [];
  async function open(target) {
    cur = target; links = await api.share.list(target.kind, target.id).catch(() => []);
    paint();
  }
  function paint(busy) {
    const { t, esc, head, sheet, ic } = V1;
    sheet(`${head(t('shareH'))}<p class="lead">${cur.kind === 'artifact' ? t('shareArt') : t('shareConv')} ${t('shareWho')}</p>
      ${links.map((l) => `<div class="opt"><span class="grow"><span class="mono">${esc(l.url)}</span></span><button class="btn" data-act="share-copy" data-u="${esc(l.url)}">${t('copy')}</button><button class="btn ghost" data-act="share-off" data-id="${esc(l.id)}">${t('shareOff')}</button></div>`).join('')}
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn pri" data-act="share-go" ${busy ? 'disabled' : ''}>${ic('share')}${busy ? '…' : t('shareGo')}</button></div>`);
  }
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act^="share-"]'); if (!el || !cur) return;
    const a = el.dataset.act;
    if (a === 'share-go') {
      paint(true);
      try { const r = await api.share.create(cur); await navigator.clipboard.writeText(r.url).catch(() => {}); V1.toast(V1.t('shareDone')); links = await api.share.list(cur.kind, cur.id); }
      catch (err) { V1.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
      paint();
    }
    if (a === 'share-copy') { await navigator.clipboard.writeText(el.dataset.u).catch(() => {}); V1.toast(V1.t('shareDone')); }
    if (a === 'share-off') { try { await api.share.remove(el.dataset.id); links = links.filter((l) => l.id !== el.dataset.id); } catch (err) { V1.toast(String(err.message || err), 'err'); } paint(); }
  });
  return { open };
})();
