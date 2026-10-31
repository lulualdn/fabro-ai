'use strict';
/* Fabro Anywhere — the Halloween scene, drawn on one canvas behind the interface.
   Home: the light of a flickering lantern and a jack-o'-lantern (both in the page, see .hw-scene) spills on the
   wall and on the greeting; bats wander around.
   Chat: a fire flow rises from the bottom with embers, sometimes turning violet; now and then a storm — rain,
   lightning — lights up bare trees in the background; a few bats cross over.
   Stops when the tab is hidden, draws a single still frame with reduced motion, lighter on phones. */
(function () {
  const root = document.documentElement;
  let cv = null, g = null, raf = 0, W = 0, H = 0, dpr = 1, last = 0, mode = null, still = false;
  const st = { bats: [], embers: [], drops: [], trees: null, treeKey: '', hue: 24, hueTo: 24, nextHue: 0, storm: 0, stormEnd: 0, nextStorm: 0, flash: 0, bolt: null, nextFlash: 0, nextBat: 0, flick: 1, flickTo: 1, dip: 0, flick2: 1 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const phone = () => root.dataset.device === 'phone';
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── which scene, if any ──
  function want() {
    if (root.dataset.skin !== 'halloween') return null;
    if (document.querySelector('#vx') || document.body.classList.contains('full-on')) return null;
    return document.querySelector('.main.home, .welcome') ? 'home' : document.querySelector('.main') ? 'chat' : null;
  }
  function refresh() {
    const m = want();
    if (!m) { stop(); return; }
    if (!cv) {
      cv = document.createElement('canvas'); cv.id = 'fx'; cv.setAttribute('aria-hidden', 'true');
      document.body.prepend(cv); g = cv.getContext('2d'); size();
    }
    if (m !== mode) { mode = m; st.bats = []; st.embers = []; st.drops = []; if (m === 'home') for (let i = 0; i < (phone() ? 3 : 6); i++) st.bats.push(bat(true)); }
    still = reduce();
    if (still) { cancelAnimationFrame(raf); raf = 0; frame(performance.now(), true); return; }
    if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; mode = null; if (cv) { cv.remove(); cv = null; g = null; } root.style.removeProperty('--flick'); }
  function size() {
    if (!cv) return;
    dpr = Math.min(devicePixelRatio || 1, phone() ? 1.25 : 1.5);
    W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0); st.treeKey = '';
  }

  // ── bats ──
  function bat(anywhere) {
    const fromLeft = Math.random() < 0.5;
    return { x: anywhere ? rnd(0, W) : fromLeft ? -40 : W + 40, y: anywhere ? rnd(H * 0.05, H * 0.55) : rnd(H * 0.08, H * 0.5), vx: (fromLeft ? 1 : -1) * rnd(40, 95), ph: rnd(0, 6), s: rnd(0.6, 1.25) * (phone() ? 0.8 : 1), wob: rnd(0.6, 1.6), seed: rnd(0, 100), wander: anywhere };
  }
  function drawBat(b, k) {
    const flap = Math.sin(b.ph) ; const s = b.s * 14;
    g.save(); g.translate(b.x, b.y); g.scale(b.vx < 0 ? -1 : 1, 1);
    g.fillStyle = `rgba(8,4,12,${0.92 * k})`;
    g.beginPath();
    const wy = flap * s * 0.9; // wing tips up and down
    g.moveTo(0, 0);
    g.quadraticCurveTo(-s * 0.6, -s * 0.2 + wy * 0.4, -s * 1.6, wy - s * 0.1);
    g.quadraticCurveTo(-s * 1.2, s * 0.15 + wy * 0.3, -s * 0.95, s * 0.35 + wy * 0.15);
    g.quadraticCurveTo(-s * 0.6, s * 0.2, -s * 0.35, s * 0.4);
    g.quadraticCurveTo(-s * 0.15, s * 0.15, 0, s * 0.3);
    g.quadraticCurveTo(s * 0.15, s * 0.15, s * 0.35, s * 0.4);
    g.quadraticCurveTo(s * 0.6, s * 0.2, s * 0.95, s * 0.35 + wy * 0.15);
    g.quadraticCurveTo(s * 1.2, s * 0.15 + wy * 0.3, s * 1.6, wy - s * 0.1);
    g.quadraticCurveTo(s * 0.6, -s * 0.2 + wy * 0.4, 0, 0);
    g.fill();
    g.beginPath(); g.ellipse(0, s * 0.12, s * 0.18, s * 0.3, 0, 0, Math.PI * 2); g.fill(); // body
    g.beginPath(); g.moveTo(-s * 0.12, -s * 0.12); g.lineTo(-s * 0.08, -s * 0.32); g.lineTo(0, -s * 0.15); g.lineTo(s * 0.08, -s * 0.32); g.lineTo(s * 0.12, -s * 0.12); g.fill(); // ears
    g.restore();
  }
  function stepBats(dt, now) {
    if (mode === 'chat' && now > st.nextBat) { const n = Math.random() < 0.3 ? 3 : Math.random() < 0.5 ? 2 : 1; for (let i = 0; i < n; i++) { const b = bat(false); b.x += (b.vx > 0 ? -1 : 1) * i * 50; b.y += i * 18; st.bats.push(b); } st.nextBat = now + rnd(9000, 20000); }
    for (const b of st.bats) {
      b.ph += dt * (11 + b.wob * 3);
      b.x += b.vx * dt; b.y += Math.sin(now / 700 * b.wob + b.seed) * 22 * dt + Math.sin(now / 1900 + b.seed) * 10 * dt;
      if (b.wander) { // home: turn around at the edges, drift up and down
        if (b.x < -30 && b.vx < 0) b.vx = rnd(40, 90); else if (b.x > W + 30 && b.vx > 0) b.vx = -rnd(40, 90);
        if (Math.random() < dt * 0.15) b.vx *= -1;
        b.y = Math.max(H * 0.03, Math.min(H * 0.62, b.y));
      }
    }
    st.bats = st.bats.filter((b) => b.wander || (b.x > -80 && b.x < W + 80));
  }

  // ── bare trees (drawn once per size) ──
  function trees() {
    const key = W + 'x' + H; if (st.treeKey === key && st.trees) return st.trees;
    const c = document.createElement('canvas'); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const t = c.getContext('2d'); t.setTransform(dpr, 0, 0, dpr, 0, 0); t.lineCap = 'round';
    let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const branch = (x, y, len, ang, w, depth) => {
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      t.lineWidth = w; t.beginPath(); t.moveTo(x, y);
      t.quadraticCurveTo(x + Math.cos(ang + 0.3) * len * 0.5, y + Math.sin(ang + 0.3) * len * 0.5, x2, y2); t.stroke();
      if (depth <= 0 || len < 6) return;
      const n = depth > 3 ? 2 : r() < 0.7 ? 2 : 3;
      for (let i = 0; i < n; i++) branch(x2, y2, len * (0.62 + r() * 0.18), ang + (r() - 0.5) * 1.3 + (i - (n - 1) / 2) * 0.55, Math.max(0.6, w * 0.66), depth - 1);
    };
    const ground = H;
    const spots = W < 600 ? [[0.06, 1], [0.94, 0.9], [0.5, 0.45]] : [[0.04, 1.1], [0.16, 0.7], [0.86, 1], [0.97, 0.8], [0.42, 0.42], [0.63, 0.5]];
    for (const [fx, sc] of spots) {
      const far = sc < 0.6; t.strokeStyle = far ? 'rgba(22,12,30,.85)' : 'rgba(6,3,9,.96)';
      const h = H * 0.42 * sc;
      branch(W * fx, ground + 4, h * 0.45, -Math.PI / 2 + (r() - 0.5) * 0.25, 10 * sc + 3, 7);
    }
    st.trees = c; st.treeKey = key; return c;
  }

  // ── fire flow ──
  const fire = (h, l, a) => `hsla(${h},100%,${l}%,${a})`;
  function drawFire(now, k) {
    const base = H * (phone() ? 0.16 : 0.2), h = st.hue;
    // the glow on everything above
    const glow = g.createLinearGradient(0, H, 0, H - base * 3.2);
    glow.addColorStop(0, fire(h, 48, 0.3 * k)); glow.addColorStop(0.45, fire(h + 10, 42, 0.09 * k)); glow.addColorStop(1, fire(h, 40, 0));
    g.fillStyle = glow; g.fillRect(0, H - base * 3.2, W, base * 3.2);
    g.globalCompositeOperation = 'screen'; // no clipping to flat yellow where layers overlap
    for (let L = 0; L < 3; L++) {
      const amp = base * (0.55 - L * 0.12), sp = 0.0006 + L * 0.00035, off = L * 37;
      g.beginPath(); g.moveTo(0, H);
      const yAt = (x) => { const n = Math.sin(x * 0.012 + now * sp * 1.7 + off) * 0.5 + Math.sin(x * 0.031 - now * sp * 2.6 + off) * 0.3 + Math.sin(x * 0.067 + now * sp * 4.1) * 0.2; return H - base * (0.3 + L * 0.1) - Math.max(0, n) ** 1.6 * amp - amp * 0.25; };
      let px = 0, py = yAt(0); g.lineTo(px, py);
      for (let x = 12; x <= W + 24; x += 12) { const y = yAt(x); g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); px = x; py = y; } // smooth tongues
      g.lineTo(W, H); g.closePath();
      const gr = g.createLinearGradient(0, H, 0, H - base * 1.6);
      gr.addColorStop(0, fire(h + 14 + L * 6, 55, (0.42 - L * 0.08) * k)); gr.addColorStop(0.5, fire(h + L * 4, 48, (0.22 - L * 0.04) * k)); gr.addColorStop(1, fire(h - 8, 40, 0));
      g.fillStyle = gr; g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  function stepEmbers(dt) {
    const max = phone() ? 60 : 140, base = H * (phone() ? 0.16 : 0.2);
    while (st.embers.length < max && Math.random() < 0.9) st.embers.push({ x: rnd(0, W), y: H - rnd(0, base * 0.6), vy: -rnd(28, 95), vx: rnd(-12, 12), r: rnd(0.8, 2.6), life: 0, max: rnd(2.5, 6.5), sw: rnd(0, 6), hj: rnd(-14, 18) });
    for (const e of st.embers) { e.life += dt; e.y += e.vy * dt; e.sw += dt * 2; e.x += (e.vx + Math.sin(e.sw) * 14) * dt; }
    st.embers = st.embers.filter((e) => e.life < e.max && e.y > -10);
  }
  function drawEmbers(k) {
    g.globalCompositeOperation = 'lighter';
    for (const e of st.embers) {
      const a = Math.min(1, e.life * 2) * (1 - e.life / e.max) * k;
      const rr = e.r * 3.2; const gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, rr);
      gr.addColorStop(0, fire(st.hue + 25 + e.hj, 75, 0.95 * a)); gr.addColorStop(0.35, fire(st.hue + e.hj, 60, 0.45 * a)); gr.addColorStop(1, fire(st.hue, 50, 0));
      g.fillStyle = gr; g.fillRect(e.x - rr, e.y - rr, rr * 2, rr * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ── storm: rain and lightning ──
  function boltPath() {
    const pts = []; let x = rnd(W * 0.15, W * 0.85), y = 0; pts.push([x, y]);
    while (y < H * rnd(0.45, 0.7)) { y += rnd(14, 34); x += rnd(-26, 26); pts.push([x, y]); }
    return pts;
  }
  function stepStorm(dt, now) {
    if (!st.nextStorm) st.nextStorm = now + rnd(6000, 14000);
    if (!st.storm && now > st.nextStorm) { st.storm = 1; st.stormEnd = now + rnd(7000, 12000); st.nextFlash = now + rnd(600, 1600); }
    if (st.storm) {
      if (now > st.stormEnd) { st.storm = 0; st.nextStorm = now + rnd(16000, 32000); }
      else if (now > st.nextFlash) { st.flash = 1; st.bolt = boltPath(); st.nextFlash = now + rnd(1800, 4200); if (Math.random() < 0.35) setTimeout(() => { st.flash = Math.max(st.flash, 0.7); }, 120); }
    }
    st.flash = Math.max(0, st.flash - dt * 3.2);
    // rain falls during the storm (and its tail)
    const want = st.storm ? (phone() ? 110 : 260) : 0;
    while (st.drops.length < want) st.drops.push({ x: rnd(-50, W), y: rnd(-H, 0), v: rnd(700, 1100), l: rnd(10, 22) });
    for (const d of st.drops) { d.y += d.v * dt; d.x += d.v * 0.18 * dt; }
    st.drops = st.drops.filter((d) => d.y < H + 20 && (st.storm || d.y > 0));
  }
  function drawStorm(k) {
    if (st.flash > 0) {
      g.fillStyle = `rgba(200,185,255,${0.28 * st.flash * k})`; g.fillRect(0, 0, W, H);
      if (st.bolt && st.flash > 0.45) {
        g.strokeStyle = `rgba(240,232,255,${st.flash * k})`; g.lineWidth = 2.2; g.shadowColor = 'rgba(190,160,255,.9)'; g.shadowBlur = 18;
        g.beginPath(); st.bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.shadowBlur = 0;
      }
    }
    if (st.drops.length) {
      g.strokeStyle = `rgba(170,160,210,${0.32 * k})`; g.lineWidth = 1; g.beginPath();
      for (const d of st.drops) { g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * 0.18, d.y - d.l); }
      g.stroke();
    }
  }

  // ── the lantern and the pumpkin (home) ──
  function stepFlicker(dt, now) {
    // a candle: a soft wobble, and every few seconds a quick blink
    if (Math.random() < dt * 4) st.flickTo = rnd(0.72, 1);
    if (!st.dip && Math.random() < dt * 0.35) st.dip = now + rnd(70, 160);
    let f = st.flick + (st.flickTo - st.flick) * Math.min(1, dt * 9);
    if (st.dip) { if (now < st.dip) f = 0.18; else st.dip = 0; }
    st.flick = f; st.flick2 = 0.82 + Math.sin(now / 230) * 0.06 + Math.sin(now / 97) * 0.05 + (Math.random() - 0.5) * 0.05;
    root.style.setProperty('--flick', f.toFixed(3)); root.style.setProperty('--flick2', st.flick2.toFixed(3));
  }
  const centre = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height * 0.62, el, r } : null; };
  function drawHome() {
    const lamp = centre('.hw-lamp .hw-glass'), pk = centre('.hw-pumpkin');
    g.globalCompositeOperation = 'lighter';
    if (lamp) {
      const R = Math.max(W, H) * 0.55 * (0.85 + st.flick * 0.15);
      const gr = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R);
      gr.addColorStop(0, `rgba(255,190,110,${0.42 * st.flick})`); gr.addColorStop(0.18, `rgba(255,140,50,${0.18 * st.flick})`); gr.addColorStop(0.55, `rgba(160,70,30,${0.06 * st.flick})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // where the light falls on the greeting: its words catch it (CSS reads --lx / --ly)
      const greet = document.querySelector('.home-desk .greet-t, .home-phone .greet span');
      if (greet) { const r = greet.getBoundingClientRect(); greet.style.setProperty('--lx', ((lamp.x - r.left) / r.width * 100).toFixed(1) + '%'); greet.style.setProperty('--ly', ((lamp.y - r.top) / r.height * 100).toFixed(1) + '%'); }
    }
    if (pk) {
      const R = Math.min(W, H) * 0.32;
      const gr = g.createRadialGradient(pk.x, pk.y, 0, pk.x, pk.y, R);
      gr.addColorStop(0, `rgba(255,150,40,${0.3 * st.flick2})`); gr.addColorStop(0.4, `rgba(255,100,20,${0.09 * st.flick2})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(pk.x - R, pk.y - R, R * 2, R * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ── frame ──
  function frame(now, once) {
    const dt = once ? 0.016 : Math.min(0.05, (now - last) / 1000); last = now;
    g.clearRect(0, 0, W, H);
    if (mode === 'home') {
      stepFlicker(dt, now); drawHome();
      if (!once) stepBats(dt, now); for (const b of st.bats) drawBat(b, 1);
      return;
    }
    // colour: orange fire, sometimes violet for a while
    if (!st.nextHue) st.nextHue = now + rnd(15000, 30000);
    if (now > st.nextHue) { st.hueTo = st.hueTo < 100 ? 278 : 24; st.nextHue = now + (st.hueTo > 100 ? rnd(7000, 12000) : rnd(20000, 40000)); }
    st.hue += (st.hueTo - st.hue) * Math.min(1, dt * 0.6);
    if (!once) { stepStorm(dt, now); stepEmbers(dt); stepBats(dt, now); }
    // trees: barely there, standing out against each flash
    g.globalAlpha = 0.55 + st.flash * 0.45; g.drawImage(trees(), 0, 0, W, H); g.globalAlpha = 1;
    drawStorm(1); drawFire(now, 1); drawEmbers(1);
    for (const b of st.bats) drawBat(b, 1);
  }
  function loop(now) { raf = 0; if (!cv || document.hidden || still) return; frame(now); raf = requestAnimationFrame(loop); }

  addEventListener('resize', () => { size(); if (still && cv) frame(performance.now(), true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  let qT = 0; const queue = () => { clearTimeout(qT); qT = setTimeout(refresh, 60); };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['data-skin', 'data-device'] });
  window.FAFx = { refresh, _st: st }; // _st: tests
  queue();
})();
