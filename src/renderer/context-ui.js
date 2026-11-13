'use strict';
/* Context gauge next to the model pill: the real size of the last prompt and the real window (it can grow), from the
   main process (src/main/context). Falls back to app.js's estimate for a conversation it knows nothing about.
   Shows when the beginning of the conversation is summarised, and a short note right after it happens. */
(() => {
  const G = new Map(); // convId → { used, ctx, covered, grown, busy }
  const base = window.ctxRing;
  const nf = (n) => { try { return new Intl.NumberFormat(S.lang, { maximumFractionDigits: 1, notation: n >= 10000 ? 'compact' : 'standard' }).format(n); } catch { return String(n); } };

  function ring() {
    const g = S.conv && G.get(S.conv.id);
    if (!g || !g.ctx || !g.used) return typeof base === 'function' ? base() : '';
    const p = Math.min(1, g.used / g.ctx);
    const r = 8, c = 2 * Math.PI * r;
    const lines = [t('ctx_usage', { used: nf(g.used), max: nf(g.ctx), p: Math.round(p * 100) })];
    if (g.covered) lines.push(t('ctx_covered', { n: g.covered }));
    if (g.grown && g.grown.to) lines.push(t('ctx_grown', { n: nf(g.grown.to) }));
    if (g.busy) lines.push(t('ctx_busy'));
    const cls = [p > 0.85 ? 'warn' : '', g.covered ? 'sum' : '', g.busy ? 'busy' : ''].filter(Boolean).join(' ');
    return `<div class="ctx-ring ${cls}" role="img" aria-label="${esc(lines.join('. '))}" title="${esc(lines.join('\n'))}">
      <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="${r}" class="track"/><circle cx="11" cy="11" r="${r}" class="fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/></svg>
      ${g.covered ? '<i class="ctx-sum" aria-hidden="true"></i>' : ''}</div>`;
  }
  window.ctxRing = ring;

  function repaint() { const el = document.querySelector('#composer .ctx-ring'); if (el) el.outerHTML = ring(); }
  api.on('chat:event', (ev) => {
    const c = ev && (ev.type === 'context' ? ev : ev.type === 'done' && ev.context ? ev.context : null);
    if (!c || !c.convId) return;
    const prev = G.get(c.convId) || {};
    G.set(c.convId, { ...prev, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) });
    if (S.conv && S.conv.id === c.convId) {
      repaint();
      if (ev.type === 'context' && ev.compressedNow && c.covered) toast(t('ctx_doneNow', { n: c.covered }));
      if (ev.type === 'context' && ev.grewNow && c.grown && c.grown.to) toast(t('ctx_grewNow', { n: nf(c.grown.to) }));
    }
  });
  window.CtxGauge = { get: (id) => G.get(id), repaint };
})();
