/* Fabro motion runtime — one small layer, no library.
   CSS (styles/motion.css + transitions in the component rules) does most of the work. This file adds what CSS
   can't do on its own, without the rest of the app having to call it:
   · layout glide (FLIP): when the sidebar or the side panel opens/closes, the main column's content glides from
     where it was to where it lands — a transform only, measured once, interruptible mid-flight (toggle fast:
     it follows from wherever it is, never queues or snaps);
   · menus open from where you clicked (transform-origin at the pointer) and fade out instead of vanishing;
   · stacked toasts close the gap smoothly when one leaves;
   · the window hidden → every animation holds still (html.is-hidden), WAAPI ones are finished.
   Reduced motion (system setting or Fabro's "Reduce motion") turns all of it off.
   Public: window.Motion = { reduced, token, ms, glide(el, dx, dy), enter(el, opts) } for other modules. */
(function () {
  'use strict';
  const root = document.documentElement;
  const css = () => getComputedStyle(root);
  const token = (name) => css().getPropertyValue(name).trim();
  const ms = (name, fallback) => { const v = token(name); const n = parseFloat(v); return Number.isFinite(n) ? (/ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n) : fallback; };
  const reduced = () => root.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const off = () => reduced() || document.hidden;

  // ── window hidden: hold everything still ──
  const onVis = () => {
    root.classList.toggle('is-hidden', document.hidden);
    if (document.hidden) for (const a of running) { try { a.finish(); } catch {} }
  };
  document.addEventListener('visibilitychange', onVis);
  onVis();

  const running = new Set();
  function track(anim, el) {
    running.add(anim);
    if (el) el.classList.add('is-moving');
    const done = () => { running.delete(anim); if (el && ![...running].some((a) => a.effect && a.effect.target === el)) el.classList.remove('is-moving'); };
    anim.addEventListener('finish', done); anim.addEventListener('cancel', done);
    return anim;
  }

  // ── where the user acted (for origin-aware menus) ──
  let lastPoint = null;
  document.addEventListener('pointerdown', (e) => { lastPoint = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = document.activeElement; if (!a || a === document.body) return;
    const r = a.getBoundingClientRect(); lastPoint = { x: r.left + r.width / 2, y: r.top + r.height / 2, t: performance.now() };
  }, true);

  // ─────────────────────────── layout glide (FLIP) ───────────────────────────
  // The sidebar and the side panel change the main column's width. Layout snaps once to the final state; each
  // piece of the column is then translated back to where it was and released with a spring. Where each piece
  // "was" is derived from the previous column box and how the piece is anchored (left, right or centred), so
  // nothing has to be measured before the change — callers don't need to know this exists.
  // Long scrolling content is never moved as one piece: a moving element gets painted whole, and a
  // 40-message thread painted at once costs hundreds of ms on a slow CPU. For those, only the pieces actually on
  // screen glide (a handful of messages); the ones out of view simply take their new place.
  const FLIP = [['.tb-left'], ['.tb-right'], ['.view > .scroller > .thread', 'center', 'kids'], ['.welcome'], ['.dock > .composer'], ['.dock > .disclaimer'],
    ['.view > .page', 'center', 'kids'], ['.view > .prj-view', 'center', 'kids'], ['.locked'], ['.cx-start'], ['.cx-welcome'], ['.session-panel.open']];
  const LAYOUT_CLASSES = ['sb-collapsed', 'with-viewer', 'wide-viewer', 'drawer-open'];
  const glides = new Map(); // selector → { anim, dx }
  let lastMain = null, armed = false;

  // read the curve once per batch: getComputedStyle after an animation started would force a style + layout pass
  function glide(el, dx, dy = 0, key, t) {
    if (!el || (!dx && !dy) || off()) return null;
    t = t || { dur: ms('--dur-3', 360), ease: token('--ease-spring') || 'ease-out' };
    const prev = key && glides.get(key);
    if (prev) { try { prev.anim.cancel(); } catch {} }
    const anim = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: t.dur, easing: t.ease, composite: t.add ? 'add' : 'replace' }); // 'add' only over an existing transform (it can't run on the compositor)
    track(anim, el);
    if (key) { glides.set(key, { anim, dx, dy }); anim.addEventListener('finish', () => { if (glides.get(key) && glides.get(key).anim === anim) glides.delete(key); }); }
    return anim;
  }
  // where a running glide has the piece right now (offset from its layout position)
  function currentOffset(key) {
    const g = glides.get(key); if (!g) return [0, 0];
    const t = g.anim.effect && g.anim.effect.getComputedTiming();
    if (!t || t.progress == null || g.anim.playState !== 'running') return [0, 0];
    return [g.dx * (1 - t.progress), g.dy * (1 - t.progress)];
  }
  function onScreenKids(box) {
    const top = -40, bottom = innerHeight + 40;
    return [...box.children].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > top && r.top < bottom; });
  }
  function flipMain(before, now) {
    if (window.Motion && window.Motion.noFlip) return; // diagnostics switch
    const app = document.getElementById('app'); if (!app) return;
    // 1. read everything (layout is clean here: one pass)…
    const t = { dur: ms('--dur-3', 360), ease: token('--ease-spring') || 'ease-out' };
    const todo = [];
    for (const [sel, anchor, kids] of FLIP) {
      let els = [...app.querySelectorAll(sel)];
      if (kids) els = els.flatMap(onScreenKids);
      els.forEach((el, i) => {
        const key = sel + '#' + (el.id || i);
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const lg = r.left - now.left, rg = now.right - r.right;
        let dx;
        if (anchor === 'center' || Math.abs(lg - rg) < 6) dx = (before.left + before.right) / 2 - (now.left + now.right) / 2; // centred
        else if (lg <= rg) dx = before.left - now.left;                                                                    // left-anchored
        else dx = before.right - now.right;                                                                                // right-anchored
        dx += currentOffset(key)[0];
        if (Math.abs(dx) >= .5) todo.push([el, dx, key, getComputedStyle(el).transform !== 'none']);
      });
    }
    // 2. …then write (no read after the first animation starts)
    for (const [el, dx, key, add] of todo) glide(el, dx, 0, key, { ...t, add });
  }
  function watchLayout() {
    const app = document.getElementById('app'), main = app && app.querySelector('.main');
    if (!main || !window.ResizeObserver) return;
    new MutationObserver((recs) => {
      for (const r of recs) {
        const was = new Set(String(r.oldValue || '').split(/\s+/)), is = app.classList;
        if (LAYOUT_CLASSES.some((c) => was.has(c) !== is.contains(c))) { armed = true; return; }
      }
    }).observe(app, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    new ResizeObserver(() => {
      const r = main.getBoundingClientRect();
      if (armed && lastMain && (r.left !== lastMain.left || r.width !== lastMain.width)) flipMain(lastMain, r);
      armed = false;
      lastMain = { left: r.left, right: r.right, width: r.width };
    }).observe(main);
  }

  // ─────────────────────────── menus ───────────────────────────
  // Open: scale up from the point the user acted on (or the menu's nearest edge). Close: the menu is removed
  // by the app at once; a copy of it fades out on top so it never just vanishes.
  let ghostLayer = null;
  const ghosts = () => ghostLayer || (ghostLayer = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'motion-ghosts', ariaHidden: 'true' }));
  function enter(el, { from = lastPoint, sheet = false } = {}) {
    if (!el || off()) return;
    const r = el.getBoundingClientRect();
    let ox = r.width / 2, oy = 0;
    if (from && performance.now() - from.t < 1500) {
      ox = Math.min(Math.max(from.x - r.left, 0), r.width);
      oy = Math.min(Math.max(from.y - r.top, 0), r.height);
    } else if (r.top > innerHeight / 2) oy = r.height;
    el.style.transformOrigin = `${ox}px ${oy}px`;
    const spring = token('--ease-spring') || 'ease-out';
    track(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--dur-1', 160), easing: 'linear' }), el);
    track(el.animate(sheet ? [{ transform: 'translateY(32px)' }, { transform: 'none' }] : [{ transform: 'scale(.95)' }, { transform: 'none' }],
      { duration: ms('--dur-2', 240), easing: spring }), el);
  }
  function leave(node) {
    const g = node.cloneNode(true);
    g.classList.replace('popover', 'popover-ghost'); g.classList.replace('models-pop', 'ghost-models');
    g.setAttribute('inert', ''); g.setAttribute('aria-hidden', 'true');
    for (const x of [g, ...g.querySelectorAll('[id],[data-action]')]) { x.removeAttribute('id'); x.removeAttribute('data-action'); }
    ghosts().appendChild(g);
    const sheet = g.classList.contains('sheet');
    const a = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: sheet ? 'translateY(24px)' : 'scale(.98)' }],
      { duration: ms('--dur-1', 160), easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    a.finished.catch(() => {}).finally(() => g.remove());
  }
  function watchMenus() {
    const pr = document.getElementById('popover-root'); if (!pr) return;
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.removedNodes) if (n.nodeType === 1 && n.classList.contains('popover') && !off()) leave(n);
        for (const n of r.addedNodes) if (n.nodeType === 1 && n.classList.contains('popover')) enter(n, { sheet: n.classList.contains('sheet') });
      }
    }).observe(pr, { childList: true });
  }

  // ─────────────────────────── toasts ───────────────────────────
  function watchToasts() {
    const box = document.getElementById('toasts'); if (!box) return;
    const tops = new Map();
    const record = () => { for (const t of box.children) tops.set(t, t.getBoundingClientRect().top); };
    new MutationObserver((recs) => {
      const removed = recs.some((r) => r.removedNodes.length);
      if (removed && !off()) {
        const moves = [...box.children].map((t) => [t, tops.get(t) == null ? 0 : tops.get(t) - t.getBoundingClientRect().top]);
        for (const [t, dy] of moves) if (Math.abs(dy) > .5) glide(t, 0, dy);
      }
      for (const r of recs) for (const n of r.removedNodes) tops.delete(n);
      requestAnimationFrame(record);
    }).observe(box, { childList: true });
  }

  function init() { watchLayout(); watchMenus(); watchToasts(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Motion = { reduced, token, ms, glide, enter };
})();
