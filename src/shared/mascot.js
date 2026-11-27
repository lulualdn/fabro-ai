// Fabro Code's mascot: a pixel golden retriever (original drawing, 16×16), shared by the app (canvas) and the
// terminal (ANSI half blocks, or plain blocks without color). States: idle, thinking, code, search, success,
// error, waiting, sleep. Frames alternate slowly; "reduce motion" keeps the first frame.
(function (root) {
  // palette: o outline, g gold, l light, d dark, k black (eye, nose), p tongue
  const PAL = { o: '#5b3414', g: '#e0a24a', l: '#f3cd85', d: '#b8762c', k: '#1b120c', p: '#e86a6a' };
  const F = [
`................
.......oo.......
......oddo......
.....oggggoo....
....oggggggko...
....ogglgggggok.
....ogglgggggoo.
.....oggggppo...
......oggggo....
.....ogggggo..o.
....oggllgggoodo
....oggllggggggo
....ogggggggggo.
....oggo..oggo..
....oko...oko...
................`,
`................
.......oo.......
......oddo......
.....oggggoo....
....oggggggko...
....ogglgggggok.
....ogglgggggoo.
.....oggggppo...
......oggggo....
.....ogggggo....
....oggllgggo.o.
....oggllgggoodo
....ogggggggggo.
....oggo..oggo..
....oko...oko...
................`];
  const STATES = ['idle', 'thinking', 'code', 'search', 'success', 'error', 'waiting', 'sleep'];
  const LABEL = {
    fr: { idle: 'prêt', thinking: 'réfléchit', code: 'écrit du code', search: 'cherche', success: 'fini', error: 'erreur', waiting: 'attend ta réponse', sleep: 'dort' },
    en: { idle: 'ready', thinking: 'thinking', code: 'writing code', search: 'searching', success: 'done', error: 'error', waiting: 'waiting for you', sleep: 'asleep' },
  };
  const rows = (frame) => frame.split('\n');
  // which frame and pixel tweaks for a state at time t (ms)
  function pixels(state, t, reduce) {
    const fi = reduce || state === 'sleep' || state === 'error' ? 0 : Math.floor(t / (state === 'success' ? 160 : 420)) % 2;
    let r = rows(F[fi]).map((x) => x.split(''));
    if (state === 'sleep' || (state === 'idle' && !reduce && t % 4200 < 160)) { r[4][10] = 'g'; r[4][9] = 'o'; } // eyes closed / blink
    if (state === 'error') { r[7][10] = 'g'; r[7][11] = 'g'; } // tongue in
    return r;
  }
  // ── canvas (app) ──
  function draw(ctx, state, t, opts = {}) {
    const s = opts.scale || 6; const ink = opts.ink || '#857d75'; const reduce = !!opts.reduce;
    const r = pixels(state, t, reduce); const bob = state === 'success' && !reduce ? -Math.round(Math.abs(Math.sin(t / 120)) * 2) : 0;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    r.forEach((row, y) => row.forEach((c, x) => { if (c === '.') return; ctx.fillStyle = PAL[c]; ctx.fillRect(x * s, (y + 3 + bob) * s, s, s); }));
    ctx.fillStyle = ink; ctx.font = `${s * 3}px ui-monospace, Consolas, monospace`;
    const bx = 11 * s, by = 3 * s;
    if (state === 'thinking') ctx.fillText('.'.repeat(reduce ? 3 : Math.floor(t / 300) % 4), bx, by);
    if (state === 'code') { ctx.fillStyle = '#ff5e42'; ctx.fillText(reduce || Math.floor(t / 250) % 2 ? '{ }' : '{_}', bx - 2 * s, by); }
    if (state === 'search') { ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, s / 1.6); const ox = bx + (reduce ? 0 : Math.sin(t / 300) * s * 2); ctx.beginPath(); ctx.arc(ox, by - s, s * 1.4, 0, 7); ctx.stroke(); ctx.fillRect(ox + s, by, s, s); }
    if (state === 'success') { ctx.fillStyle = '#7fc28a'; ctx.fillText('✓', bx, by); }
    if (state === 'error') { ctx.fillStyle = '#ff7a6b'; ctx.fillText('!', bx, by); }
    if (state === 'waiting') ctx.fillText(reduce || Math.floor(t / 500) % 2 ? '?' : ' ?', bx, by);
    if (state === 'sleep') ctx.fillText(['z', 'zz', 'zzZ'][reduce ? 2 : Math.floor(t / 600) % 3], bx, by);
  }
  // ── terminal ──
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const near256 = ([r, g, b]) => 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
  function ansi(state, t, opts = {}) {
    const color = opts.color !== false; const truecolor = !!opts.truecolor; const reduce = !!opts.reduce;
    const fg = (h) => (truecolor ? `\x1b[38;2;${hex(h).join(';')}m` : `\x1b[38;5;${near256(hex(h))}m`);
    const bg = (h) => (truecolor ? `\x1b[48;2;${hex(h).join(';')}m` : `\x1b[48;5;${near256(hex(h))}m`);
    const r = pixels(state, t, reduce); const out = [];
    for (let y = 0; y < r.length; y += 2) {
      let line = '';
      for (let x = 2; x < 15; x++) {
        const a = r[y][x], b = (r[y + 1] || [])[x] || '.';
        if (!color) { line += a !== '.' && b !== '.' ? '█' : a !== '.' ? '▀' : b !== '.' ? '▄' : ' '; continue; }
        if (a === '.' && b === '.') line += ' ';
        else if (a !== '.' && b !== '.') line += `${fg(PAL[a])}${bg(PAL[b])}▀\x1b[0m`;
        else if (a !== '.') line += `${fg(PAL[a])}▀\x1b[0m`;
        else line += `${fg(PAL[b])}▄\x1b[0m`;
      }
      out.push(line);
    }
    return out;
  }
  const api = { PAL, STATES, LABEL, draw, ansi, height: 8, width: 13 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FabroMascot = api;
})(typeof window !== 'undefined' ? window : globalThis);
