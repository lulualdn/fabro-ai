// Human-like pointer movement: a gently curved path, minimum-jerk speed profile (smooth start and
// stop), duration from Fitts' law. Produces helper steps played at ~125 Hz with precise timing.
const SPEED = { natural: 1, fast: 0.45, instant: 0 };
const rnd = (a, b) => a + Math.random() * (b - a);

function duration(d, k, width = 24) {
  if (k <= 0) return 0;
  return Math.round((90 + 110 * Math.log2(1 + d / width)) * k);
}

// from/to: {x,y} in screen pixels. Returns [{t:'move',x,y,ms}] ending exactly on `to`.
function path(from, to, { speed = 'natural', slow = 1 } = {}) {
  const k = (SPEED[speed] ?? 1) * slow;
  if (!from) return [{ t: 'move', x: Math.round(to.x), y: Math.round(to.y), ms: 0 }];
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
  if (k <= 0 || d < 3) return [{ t: 'move', x: Math.round(to.x), y: Math.round(to.y), ms: 0 }];
  const T = duration(d, k);
  const n = Math.max(4, Math.min(240, Math.round(T / 8)));
  // control points pushed a little to one side: arm movements are arcs, not rulers
  const side = Math.random() < 0.5 ? -1 : 1;
  const bend = Math.min(140, d * rnd(0.04, 0.14)) * side;
  const nx = -dy / d, ny = dx / d;
  const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
  const c2 = { x: from.x + dx * 0.72 + nx * bend * 0.6, y: from.y + dy * 0.72 + ny * bend * 0.6 };
  const steps = [];
  let lx = from.x, ly = from.y;
  for (let i = 1; i <= n; i++) {
    const tau = i / n;
    const s = tau * tau * tau * (10 - 15 * tau + 6 * tau * tau); // minimum jerk
    const u = 1 - s;
    const x = u * u * u * from.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s * s * s * to.x;
    const y = u * u * u * from.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s * s * s * to.y;
    const rx = i === n ? Math.round(to.x) : Math.round(x), ry = i === n ? Math.round(to.y) : Math.round(y);
    if (rx === lx && ry === ly && i !== n) { if (steps.length) steps[steps.length - 1].ms += T / n; continue; }
    steps.push({ t: 'move', x: rx, y: ry, ms: +(T / n).toFixed(2) });
    lx = rx; ly = ry;
  }
  return steps;
}

// Pauses a person makes: before pressing (hover lands), while holding, between double-click halves.
function pauses(speed = 'natural') {
  const k = SPEED[speed] ?? 1;
  if (k <= 0) return { hover: 15, press: 25, between: 45, dragStart: 60, dragEnd: 60, key: 8, char: 0 };
  return { hover: Math.round(rnd(45, 90) * Math.max(k, 0.5)), press: Math.round(rnd(55, 95) * Math.max(k, 0.6)), between: Math.round(rnd(60, 90)), dragStart: Math.round(rnd(110, 160) * Math.max(k, 0.6)), dragEnd: Math.round(rnd(120, 180) * Math.max(k, 0.6)), key: Math.round(rnd(18, 32) * Math.max(k, 0.5)), char: k >= 1 ? 9 : 2 };
}

module.exports = { path, pauses, duration, SPEED };
