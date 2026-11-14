// Fabro on a phone (Fabro Anywhere shows this same interface in a phone-sized window). Touch only:
//   · swipe right from the left edge opens the menu, swipe left closes it;
//   · at the last message, keep pulling up: a ring fills, and letting go when it is full starts a new chat;
//   · a bubble in the top bar when the computer is not connected (tap: connect / pair);
//   · updating the computer's Fabro from the phone tells the phone to wait for it.
// Nothing here runs on a computer with a mouse.
(() => {
  const remote = () => !!window.FABRO_REMOTE;
  const phone = () => compact() && (remote() || matchMedia('(pointer: coarse)').matches);
  let g = null; // the gesture in progress
  const setDrawer = (on) => { if (!!S.drawer === on) return; S.drawer = on; renderSidebar(); renderTopbar(); };

  // ── pull up for a new chat ──
  const PULL = 150; let ring = null;
  function ringEl() {
    if (ring && ring.isConnected) return ring;
    ring = document.createElement('div'); ring.className = 'ph-pull'; ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = `<svg viewBox="0 0 44 44" width="44" height="44"><circle class="ph-track" cx="22" cy="22" r="19"/><circle class="ph-fill" cx="22" cy="22" r="19" pathLength="100"/></svg><span class="ph-ico">${icon('edit', 18)}</span><b>${esc(t('newChat'))}</b>`;
    document.body.appendChild(ring); return ring;
  }
  function pull(p) {
    const el = ringEl(); const k = Math.max(0, Math.min(1, p));
    el.style.setProperty('--p', k); el.classList.toggle('on', k > 0.05); el.classList.toggle('full', k >= 1);
    el.querySelector('.ph-fill').style.strokeDashoffset = String(100 - k * 100);
  }
  const canPull = (sc) => S.mode === 'chat' && !S.streaming && S.conv && S.conv.messages.length && sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 2;

  document.addEventListener('touchstart', (e) => {
    if (!phone() || e.touches.length !== 1 || S.settingsTab) { g = null; return; }
    const t0 = e.touches[0]; const sc = $('#scroller');
    g = { x: t0.clientX, y: t0.clientY, kind: null, edge: t0.clientX < 28 && !S.drawer, open: !!S.drawer,
      pull: !e.target.closest('.dock, #sidebar, .modal, .popover') && canPull(sc), p: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!g) return; const t1 = e.touches[0]; const dx = t1.clientX - g.x; const dy = t1.clientY - g.y;
    if (!g.kind) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) g.kind = 'side';
      else if (g.pull && dy < -14 && Math.abs(dy) > Math.abs(dx) * 1.4) g.kind = 'pull';
      else if (Math.abs(dy) > 14) { g = null; return; }
      else return;
    }
    if (g.kind === 'pull') { g.p = (-dy - 14) / PULL; pull(g.p); }
  }, { passive: true });
  const end = (e) => {
    if (!g) return; const cur = g; g = null;
    if (cur.kind === 'pull') {
      const done = cur.p >= 1; pull(0);
      if (done) { if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} } document.documentElement.classList.add('ph-fresh'); newChat(); setTimeout(() => document.documentElement.classList.remove('ph-fresh'), 450); }
      return;
    }
    if (cur.kind !== 'side') return;
    const t1 = (e.changedTouches && e.changedTouches[0]) || null; if (!t1) return; const dx = t1.clientX - cur.x;
    // open: from the left edge, or a long swipe anywhere outside something that scrolls sideways
    if (!cur.open && dx > 60 && (cur.edge || (dx > 110 && !e.target.closest('pre, table, .code-card, .iui-mm, .cx-tree, input, textarea, [data-noswipe]')))) setDrawer(true);
    else if (cur.open && dx < -50) setDrawer(false);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => { if (g && g.kind === 'pull') pull(0); g = null; }, { passive: true });

  // ── not connected to the computer ──
  const top0 = renderTopbar;
  window.renderTopbar = function () {
    top0.apply(this, arguments);
    if (!remote() || !window.FABRO_REMOTE.local) return;
    const r = $('#topbar .tb-right'); if (!r || r.querySelector('.ph-off')) return;
    r.insertAdjacentHTML('afterbegin', `<button class="chip ph-off" data-action="ph-pair">${icon('link', 13) || ''}<span>${esc(t('ph_off'))}</span></button>`);
  };
  actions['ph-pair'] = () => { if (window.FABRO_REMOTE && window.FABRO_REMOTE.pair) window.FABRO_REMOTE.pair(); };

  // ── updating the computer from the phone ──
  const inst = actions['install-update'];
  actions['install-update'] = (...a) => { if (remote() && window.FABRO_REMOTE.updating) window.FABRO_REMOTE.updating(); return inst(...a); };
})();
