/* Fabro themes — pure core (no DOM): colour maths, the manifest schema, sanitising of untrusted theme files,
   token derivation from a small palette, and compilation to CSS text.
   Works in the renderer (window.ThemesCore) and in node (scripts/themes-test.js) — keep it free of DOM calls.

   A theme manifest (see docs/v02/themes.md):
   { v:1, id, name:'x'|{en,fr}, author, base:'light'|'dark'|'both', desc?,
     palette:{ light?:{bg,panel,elev,text,accent,…}, dark?:{…} },     // a few seeds, the rest is derived (AA enforced)
     tokens:{ all?:{--x:v}, light?:{…}, dark?:{…} },                  // explicit overrides, whitelisted names only
     fonts:{ ui?, read?, display?, mono? },                           // system font stacks only
     texture:{ kind:'grain'|'grid'|'scanlines'|'dots'|'none', opacity, size?, layer:'under'|'over' },
     motion:'default'|'calm'|'steps'|'snap'|'none', layout:''|'cli' }
   Built-in themes may also carry `css` (a shipped stylesheet name). Imported themes never can. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ThemesCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────── colour maths ─────────
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  function parseColor(s) {
    if (typeof s !== 'string') return null;
    s = s.trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = s.match(/^rgba?\(\s*(\d{1,3}(?:\.\d+)?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?)\s*(?:[,/]\s*(\d*\.?\d+%?)\s*)?\)$/);
    if (m) {
      let a = 1; if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if ([m[1], m[2], m[3]].some((v) => +v > 255) || !(a >= 0 && a <= 1)) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    m = s.match(/^hsla?\(\s*(-?\d{1,3}(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*(?:[,/]\s*(\d*\.?\d+%?)\s*)?\)$/);
    if (m) {
      const h = ((+m[1] % 360) + 360) % 360, sat = +m[2] / 100, l = +m[3] / 100;
      if (sat > 1 || l > 1) return null;
      let a = 1; if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (!(a >= 0 && a <= 1)) return null;
      const k = (n) => (n + h / 30) % 12, f = (n) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
      return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a };
    }
    return null;
  }
  const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  const toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
  function fmt(c) { // normalised output: #rrggbb, or rgba() when translucent
    if (c.a >= 0.999) return toHex(c);
    return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(3)})`;
  }
  const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 });
  const alpha = (c, a) => ({ r: c.r, g: c.g, b: c.b, a });
  function over(fg, bg) { const a = fg.a == null ? 1 : fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    const A = typeof a === 'string' ? parseColor(a) : a, B = typeof b === 'string' ? parseColor(b) : b;
    if (!A || !B) return 0;
    const bgc = over(B, { r: 255, g: 255, b: 255 }), fgc = over(A, bgc);
    const l1 = lum(fgc), l2 = lum(bgc);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // Move fg toward `toward` (default: black or white, whichever helps) until it reads at `min` on every bg.
  function ensure(fg, bgs, min, toward) {
    let c = typeof fg === 'string' ? parseColor(fg) : fg;
    const B = bgs.map((b) => (typeof b === 'string' ? parseColor(b) : b));
    const ok = (x) => B.every((b) => contrast(x, b) >= min);
    if (ok(c)) return c;
    if (!toward) { const avg = B.reduce((n, b) => n + lum(b), 0) / B.length; toward = avg > 0.4 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }; }
    for (let t = 0.04; t <= 1.0001; t += 0.04) { const x = mix(c, toward, t); if (ok(x)) return x; }
    return toward;
  }
  const inkFor = (bg, a, b) => (contrast(a, bg) >= contrast(b, bg) ? a : b);

  // ───────── the token whitelist ─────────
  const COLORS = ['bg', 'panel', 'elev', 'elev-2', 'paper', 'bubble', 'code-bg', 'code-head', 'scrim', 'text', 'text-2', 'muted', 'faint',
    'border', 'border-strong', 'hover', 'active', 'pressed', 'accent', 'accent-hover', 'accent-text', 'accent-soft', 'accent-line', 'accent-ink', 'focus',
    'ok', 'ok-soft', 'warn', 'warn-soft', 'err', 'err-soft', 'on-status', 'hl', 'hl-ink', 'data-1', 'data-2', 'data-3',
    'syn-comment', 'syn-keyword', 'syn-string', 'syn-number', 'syn-title', 'syn-type', 'syn-attr', 'syn-meta', 'term-bg', 'term-fg', 'term-dim', 'term-line'];
  const LENGTHS = { 'r-xs': [0, 40], 'r-sm': [0, 40], 'r-md': [0, 40], 'r': [0, 40], 'r-lg': [0, 48], 'r-xl': [0, 56], 'r-pill': [0, 999],
    'gap': [0, 24], 'sb-w': [200, 420], 'measure': [24, 90, 'rem'], 'lift': [0, 24],
    'fs-2xs': [9, 16], 'fs-xs': [10, 18], 'fs-sm': [11, 20], 'fs-ui': [12, 22], 'fs-body': [12, 24], 'fs-read': [13, 26], 'fs-h4': [13, 30], 'fs-h3': [14, 36], 'fs-h2': [16, 44], 'fs-h1': [18, 56] };
  const NUMS = { 'lh-tight': [1, 1.8], 'lh-ui': [1.1, 2], 'lh-read': [1.2, 2.2], 'fw-medium': [300, 800], 'fw-strong': [400, 900] };
  const SHADOWS = ['shadow-sm', 'shadow', 'shadow-lg', 'thumb-shadow', 'knob-shadow', 'tile-shadow'];
  const TIMES = ['dur-press', 'dur-1', 'dur-2', 'dur-3', 'dur-4'];
  const EASES = ['ease-out', 'ease-in', 'ease-inout', 'ease-spring', 'ease-bounce'];
  const FONT_KEYS = { ui: 'font-ui', read: 'font-read', display: 'font-display', mono: 'font-mono' };
  const TOKEN_TYPE = {};
  COLORS.forEach((n) => { TOKEN_TYPE[n] = 'color'; });
  Object.keys(LENGTHS).forEach((n) => { TOKEN_TYPE[n] = 'length'; });
  Object.keys(NUMS).forEach((n) => { TOKEN_TYPE[n] = 'num'; });
  SHADOWS.forEach((n) => { TOKEN_TYPE[n] = 'shadow'; });
  TIMES.forEach((n) => { TOKEN_TYPE[n] = 'time'; });
  EASES.forEach((n) => { TOKEN_TYPE[n] = 'ease'; });
  // --logo is deliberately absent: the propeller always keeps the brand coral.

  const num = (s) => (/^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN);
  function cleanLength(v, name) {
    const [lo, hi, unit] = LENGTHS[name];
    const m = String(v).trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]); if (n < lo || n > hi) return null;
    const u = m[2] || (unit || 'px');
    if (unit === 'rem' && u !== 'rem') return null;
    if (!unit && u !== 'px') return null;
    return n + u;
  }
  function cleanNum(v, name) { const n = num(String(v).trim()); const [lo, hi] = NUMS[name]; return n >= lo && n <= hi ? String(n) : null; }
  function cleanTime(v) { const m = String(v).trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/); if (!m) return null; const ms = parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1); return ms <= 1200 ? Math.round(ms) + 'ms' : null; }
  function cleanEase(v) {
    v = String(v).trim().toLowerCase();
    if (/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(v)) return v;
    let m = v.match(/^cubic-bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)$/);
    if (m) { const [a, b, c, d] = m.slice(1).map(Number); return a >= 0 && a <= 1 && c >= 0 && c <= 1 && Math.abs(b) <= 3 && Math.abs(d) <= 3 ? `cubic-bezier(${a}, ${b}, ${c}, ${d})` : null; }
    m = v.match(/^steps\(\s*(\d{1,2})\s*(?:,\s*(start|end|jump-start|jump-end|jump-none|jump-both)\s*)?\)$/);
    if (m && +m[1] >= 1 && +m[1] <= 30) return `steps(${m[1]}${m[2] ? ', ' + m[2] : ''})`;
    return null;
  }
  function cleanColor(v) { const c = parseColor(v); return c ? fmt(c) : null; }
  function cleanShadow(v) {
    v = String(v).trim();
    if (v === 'none') return 'none';
    if (v.length > 400) return null;
    // split on commas that are not inside parentheses
    const layers = []; let depth = 0, cur = '';
    for (const ch of v) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch; }
    layers.push(cur);
    if (layers.length > 4 || depth !== 0) return null;
    const out = [];
    for (let l of layers) {
      l = l.trim(); let inset = false;
      if (/^inset\s/i.test(l)) { inset = true; l = l.replace(/^inset\s+/i, ''); }
      const m = l.match(/^((?:-?\d+(?:\.\d+)?(?:px)?\s+){2,4})(.+)$/);
      if (!m) return null;
      const lens = m[1].trim().split(/\s+/).map((x) => parseFloat(x));
      if (lens.some((x) => Math.abs(x) > 200)) return null;
      const col = cleanColor(m[2]); if (!col) return null;
      out.push((inset ? 'inset ' : '') + lens.map((x) => x + 'px').join(' ') + ' ' + col);
    }
    return out.join(', ');
  }
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'cursive', 'fantasy', 'emoji', 'math', 'fangsong']);
  function cleanFont(v) {
    v = String(v).trim();
    if (/^var\(--font-(ui|read|display|mono)\)$/.test(v)) return v;
    if (v.length > 400) return null;
    const parts = []; let cur = '', q = '';
    for (const ch of v) { if (q) { cur += ch; if (ch === q) q = ''; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { parts.push(cur); cur = ''; } else cur += ch; }
    if (q) return null; parts.push(cur);
    if (parts.length < 1 || parts.length > 12) return null;
    const out = [];
    for (let p of parts) {
      p = p.trim();
      let m = p.match(/^"([^"\;{}<>()@\n]{1,48})"$/) || p.match(/^'([^'\;{}<>()@\n]{1,48})'$/);
      if (m) { out.push('"' + m[1].trim() + '"'); continue; }
      if (GENERIC.has(p)) { out.push(p); continue; }
      if (/^-apple-system$|^BlinkMacSystemFont$/.test(p)) { out.push(p); continue; }
      if (/^[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+){0,4}$/.test(p) && !/^(url|var|calc|inherit|initial|unset|revert|expression)$/i.test(p)) { out.push(/ /.test(p) ? '"' + p + '"' : p); continue; }
      return null;
    }
    return out.join(', ');
  }
  function cleanToken(name, v) {
    switch (TOKEN_TYPE[name]) {
      case 'color': return cleanColor(v);
      case 'length': return cleanLength(v, name);
      case 'num': return cleanNum(v, name);
      case 'shadow': return cleanShadow(v);
      case 'time': return cleanTime(v);
      case 'ease': return cleanEase(v);
      default: return null;
    }
  }

  // ───────── textures: tiny SVGs, generated, static ─────────
  const TEXTURES = ['none', 'grain', 'grid', 'scanlines', 'dots'];
  const enc = (svg) => 'url("data:image/svg+xml,' + svg.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'") + '")';
  function textureImage(tex, ink) {
    const c = parseColor(ink) || { r: 128, g: 128, b: 128, a: 1 };
    const col = `rgb(${c.r | 0},${c.g | 0},${c.b | 0})`;
    const o = clamp(tex.opacity == null ? 0.05 : tex.opacity, 0, 0.35);
    switch (tex.kind) {
      case 'grain': { // paper fibre: a fixed turbulence tile (rasterised once)
        const s = 180;
        return { image: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 ${c.r / 255} 0 0 0 0 ${c.g / 255} 0 0 0 0 ${c.b / 255} 0 0 0 ${(o * 5).toFixed(3)} 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`), size: s };
      }
      case 'grid': { // fine grid, every 5th line stronger
        const g = clamp(tex.size || 16, 6, 64), s = g * 5;
        let d = ''; for (let i = 0; i < 5; i++) { d += `<path d="M${i * g + .5} 0V${s}M0 ${i * g + .5}H${s}" stroke="${col}" stroke-opacity="${i === 0 ? (o * 2).toFixed(3) : o.toFixed(3)}" stroke-width="1" fill="none"/>`; }
        return { image: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${d}</svg>`), size: s };
      }
      case 'scanlines': {
        const h = clamp(tex.size || 3, 2, 8);
        return { image: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="${h}"><rect width="4" height="1" fill="${col}" fill-opacity="${o.toFixed(3)}"/></svg>`), size: h };
      }
      case 'dots': {
        const g = clamp(tex.size || 14, 6, 40);
        return { image: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="${g}" height="${g}"><circle cx="${g / 2}" cy="${g / 2}" r=".8" fill="${col}" fill-opacity="${(o * 2).toFixed(3)}"/></svg>`), size: g };
      }
      default: return null;
    }
  }

  // ───────── motion presets ─────────
  const MOTION = {
    default: {},
    calm: { 'dur-press': '140ms', 'dur-1': '200ms', 'dur-2': '300ms', 'dur-3': '440ms', 'dur-4': '620ms', 'lift': '4px' },
    steps: { 'dur-press': '0ms', 'dur-1': '60ms', 'dur-2': '80ms', 'dur-3': '120ms', 'dur-4': '160ms', 'lift': '0px',
      'ease-out': 'steps(3, end)', 'ease-in': 'steps(3, end)', 'ease-inout': 'steps(3, end)', 'ease-spring': 'steps(4, end)', 'ease-bounce': 'steps(2, end)' },
    snap: { 'dur-press': '0ms', 'dur-1': '0ms', 'dur-2': '0ms', 'dur-3': '0ms', 'dur-4': '0ms', 'lift': '0px', 'ease-out': 'linear', 'ease-in': 'linear', 'ease-inout': 'linear', 'ease-spring': 'linear', 'ease-bounce': 'linear' },
  };
  MOTION.none = MOTION.snap;

  // ───────── palette → tokens ─────────
  const BASE = {
    light: { ok: '#2f7d4b', warn: '#9a6408', err: '#b8372e', hl: '#ffe9a8', syn: ['#8a857a', '#9b3f84', '#3b7637', '#a9521d', '#2d5fae', '#8a6107', '#9d442b', '#5d6b7a'] },
    dark: { ok: '#3ccf91', warn: '#f2b24a', err: '#ff7366', hl: '#5b4a12', syn: ['#8b877e', '#e08fd2', '#9fd18f', '#f2a66e', '#8ab4f8', '#e8c46a', '#f0937a', '#9aa7b4'] },
  };
  const SYN = ['syn-comment', 'syn-keyword', 'syn-string', 'syn-number', 'syn-title', 'syn-type', 'syn-attr', 'syn-meta'];
  const SEEDS = ['bg', 'panel', 'elev', 'text', 'accent', 'accent-ink', 'ok', 'warn', 'err', 'tint', 'shadow'];

  // palette ({bg, panel, elev, text, accent, + optional seeds}) → a complete token map for one mode, AA by construction.
  function derive(p, dark) {
    const P = (k, d) => parseColor(p[k]) || (d && parseColor(d));
    const bg = P('bg'), text = P('text');
    if (!bg || !text) return {};
    const panel = P('panel') || mix(bg, dark ? { r: 0, g: 0, b: 0 } : text, dark ? 0.35 : 0.04);
    const elev = P('elev') || mix(bg, dark ? { r: 255, g: 255, b: 255 } : { r: 255, g: 255, b: 255 }, dark ? 0.05 : 0.6);
    const accent0 = P('accent') || { r: 191, g: 91, b: 48, a: 1 };
    const surf = [bg, panel, elev];
    const B = BASE[dark ? 'dark' : 'light'];
    const white = { r: 255, g: 255, b: 255, a: 1 }, black = { r: 0, g: 0, b: 0, a: 1 };
    const t = {};
    const S = (k, c) => { t[k] = fmt(c); };
    S('bg', bg); S('panel', panel); S('elev', elev);
    S('elev-2', P('elev-2') || mix(bg, elev, 0.5));
    S('bubble', P('bubble') || mix(bg, text, dark ? 0.09 : 0.075));
    const bubble = parseColor(t.bubble);
    S('code-bg', P('code-bg') || mix(bg, dark ? black : text, dark ? 0.28 : 0.045));
    S('code-head', P('code-head') || mix(parseColor(t['code-bg']), text, 0.05));
    const code = parseColor(t['code-bg']);
    const shadowInk = P('shadow') || (dark ? black : mix(text, bg, 0.2));
    S('scrim', alpha(shadowInk, dark ? 0.6 : 0.28));
    S('text', ensure(text, [bg, panel, elev, bubble], 7));
    const tx = parseColor(t.text);
    S('text-2', ensure(mix(tx, bg, 0.22), [bg, panel, elev, bubble], 5.5, tx));
    S('muted', ensure(mix(tx, bg, 0.42), [bg, panel, elev, bubble], 4.7, tx));
    S('faint', mix(tx, bg, 0.66));
    S('border', P('border') || mix(bg, tx, 0.1));
    S('border-strong', P('border-strong') || mix(bg, tx, 0.19));
    S('hover', alpha(tx, 0.05)); S('active', alpha(tx, 0.085)); S('pressed', alpha(tx, 0.12));
    // accent: fills with readable ink; words/links in an AA variant
    const accent = accent0;
    S('accent', accent);
    S('accent-ink', P('accent-ink') || inkFor(accent, white, { r: 20, g: 22, b: 27, a: 1 }));
    t['accent-ink'] = fmt(ensure(parseColor(t['accent-ink']), [accent], 4.6));
    S('accent-hover', mix(accent, dark ? white : black, dark ? 0.14 : 0.1));
    S('accent-text', ensure(accent, surf, 4.6, tx));
    S('accent-soft', alpha(accent, dark ? 0.15 : 0.12));
    S('accent-line', alpha(accent, 0.4));
    S('focus', ensure(accent, surf, 3.2, tx));
    const stat = (k) => {
      const base = P(k, B[k]); const txt = ensure(base, [bg, panel, elev, bubble], 4.6, tx);
      S(k, txt); S(k + '-soft', alpha(base, 0.13));
      return base;
    };
    const ok = stat('ok'), warn = stat('warn'), err = stat('err');
    // text on a filled status colour
    S('on-status', inkFor(ok, white, { r: 20, g: 22, b: 27, a: 1 }));
    const fills = [parseColor(t.ok), parseColor(t.warn), parseColor(t.err)];
    t['on-status'] = fmt(ensure(parseColor(t['on-status']), fills, 4.5));
    S('hl', parseColor(B.hl)); S('hl-ink', inkFor(parseColor(B.hl), white, { r: 20, g: 18, b: 12, a: 1 }));
    S('data-1', accent); S('data-2', mix(accent, bg, 0.5)); S('data-3', dark ? { r: 125, g: 147, b: 196, a: 1 } : { r: 108, g: 127, b: 168, a: 1 });
    SYN.forEach((k, i) => S(k, ensure(P(k, B.syn[i]), [code], 4.5, tx)));
    // shadows: tinted by the theme, flat when asked
    const sh = (p.depth || 'soft');
    const si = shadowInk;
    const R = (a) => fmt(alpha(si, a));
    if (sh === 'none') { t['shadow-sm'] = 'none'; t.shadow = 'none'; t['shadow-lg'] = `0 0 0 1px ${t['border-strong']}`; }
    else if (sh === 'flat') { t['shadow-sm'] = 'none'; t.shadow = `0 1px 0 ${R(dark ? 0.4 : 0.08)}`; t['shadow-lg'] = `0 6px 20px ${R(dark ? 0.55 : 0.2)}`; }
    else { t['shadow-sm'] = `0 1px 1px ${R(dark ? 0.25 : 0.05)}`; t.shadow = `0 1px 2px ${R(dark ? 0.3 : 0.06)}, 0 8px 24px -8px ${R(dark ? 0.45 : 0.14)}`; t['shadow-lg'] = `0 2px 8px ${R(dark ? 0.35 : 0.08)}, 0 22px 56px -12px ${R(dark ? 0.6 : 0.26)}`; }
    return t;
  }

  // Resolve a manifest to the final tokens of one mode (palette-derived + explicit overrides, sanitised, contrast-fixed).
  function resolveTokens(m, mode, opts) {
    const dark = mode === 'dark';
    const out = Object.create(null);
    const pal = (m.palette && m.palette[mode]) || null;
    if (pal) Object.assign(out, derive(pal, dark));
    const tk = m.tokens || {};
    for (const src of [tk.all, tk[mode]]) {
      if (!src) continue;
      for (const k of Object.keys(src)) { const v = cleanToken(k, src[k]); if (v != null) out[k] = v; }
    }
    if (!(opts && opts.raw)) fixContrast(out, dark);
    return out;
  }
  // Explicit overrides can never make the app unreadable: the text pairs are nudged to AA.
  function fixContrast(t, dark) {
    const P = (k) => (t[k] ? parseColor(t[k]) : null);
    const bg = P('bg'), panel = P('panel') || bg, elev = P('elev') || bg, bub = P('bubble') || bg;
    if (!bg) return t;
    const surf = [bg, panel, elev];
    const tx = P('text'); if (!tx) return t;
    const tw = lum(bg) > 0.4 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    t.text = fmt(ensure(tx, [...surf, bub], 7, tw)); const T = parseColor(t.text);
    for (const [k, min] of [['text-2', 5.5], ['muted', 4.5], ['accent-text', 4.5], ['ok', 4.5], ['warn', 4.5], ['err', 4.5]]) if (P(k)) t[k] = fmt(ensure(P(k), surf, min, T));
    if (P('focus')) t.focus = fmt(ensure(P('focus'), surf, 3, T));
    if (P('accent') && P('accent-ink')) t['accent-ink'] = fmt(ensure(P('accent-ink'), [P('accent')], 4.5));
    if (P('code-bg')) SYN.forEach((k) => { if (P(k)) t[k] = fmt(ensure(P(k), [P('code-bg')], k === 'syn-comment' ? 3.6 : 4.5, T)); });
    return t;
  }

  // The contrast pairs every theme must satisfy, in each mode it supports.
  const PAIRS = [
    ['text', 'bg', 7], ['text', 'panel', 7], ['text', 'elev', 7], ['text', 'bubble', 7], ['text', 'code-bg', 7], ['text-2', 'bg', 4.5],
    ['muted', 'bg', 4.5], ['muted', 'panel', 4.5], ['muted', 'elev', 4.5], ['muted', 'bubble', 4.5],
    ['accent-text', 'bg', 4.5], ['accent-text', 'panel', 4.5], ['accent-text', 'elev', 4.5], ['accent-ink', 'accent', 4.5],
    ['focus', 'bg', 3], ['focus', 'panel', 3], ['focus', 'elev', 3], ['accent', 'bg', 3],
    ['ok', 'bg', 4.5], ['warn', 'bg', 4.5], ['err', 'bg', 4.5], ['ok', 'elev', 4.5], ['warn', 'elev', 4.5], ['err', 'elev', 4.5],
    ['on-status', 'ok', 4.5], ['on-status', 'warn', 4.5], ['on-status', 'err', 4.5], ['hl-ink', 'hl', 4.5],
    ['syn-keyword', 'code-bg', 4.5], ['syn-string', 'code-bg', 4.5], ['syn-number', 'code-bg', 4.5], ['syn-title', 'code-bg', 4.5], ['syn-type', 'code-bg', 4.5], ['syn-attr', 'code-bg', 4.5], ['syn-meta', 'code-bg', 4.5], ['syn-comment', 'code-bg', 3.6],
  ];
  function audit(tokens, pairs) {
    const res = [];
    for (const [fg, bg, min] of pairs || PAIRS) {
      const a = tokens[fg], b = tokens[bg];
      if (!a || !b) { res.push({ fg, bg, min, ratio: 0, pass: false, missing: true }); continue; }
      const ratio = contrast(a, b);
      res.push({ fg, bg, min, ratio: +ratio.toFixed(2), pass: ratio + 0.005 >= min });
    }
    return res;
  }

  // ───────── manifest validation / sanitising (the one door every theme file goes through) ─────────
  const MAX_BYTES = 64 * 1024;
  const LAYOUTS = ['', 'cli'];
  const MOTIONS = Object.keys(MOTION);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const ownKeys = (o) => Object.keys(o).filter((k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype');
  const cleanStr = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>`]/g, '').trim().slice(0, n);
  const slug = (s) => cleanStr(s, 60).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);

  // allowBuiltin: trusted manifests shipped in the app may carry `css`/`builtin`; imported ones never.
  function sanitize(input, opts) {
    opts = opts || {};
    const warnings = [], errors = [];
    let raw = input;
    if (typeof raw === 'string') {
      if (raw.length > MAX_BYTES) return { ok: false, errors: ['too_big'], warnings };
      try { raw = JSON.parse(raw); } catch { return { ok: false, errors: ['not_json'], warnings }; }
    }
    if (!isObj(raw)) return { ok: false, errors: ['not_object'], warnings };
    const m = { v: 1 };
    const kind = cleanStr(raw.kind || raw.type || '', 40);
    if (opts.imported && raw.fabrotheme !== 1 && raw.fabrotheme !== true && raw.v !== 1) warnings.push('no_marker');
    const id = opts.builtin ? cleanStr(raw.id, 32) : 'u-' + (slug(raw.id || raw.name) || 'theme');
    if (!/^[a-z0-9-]{2,34}$/.test(id)) errors.push('bad_id');
    m.id = id;
    const name = isObj(raw.name) ? { en: cleanStr(raw.name.en, 40), fr: cleanStr(raw.name.fr || raw.name.en, 40) } : cleanStr(raw.name, 40);
    if (!(typeof name === 'string' ? name : name.en)) errors.push('no_name');
    m.name = name;
    m.author = cleanStr(raw.author, 40);
    if (raw.desc) m.desc = isObj(raw.desc) ? { en: cleanStr(raw.desc.en, 140), fr: cleanStr(raw.desc.fr || raw.desc.en, 140) } : cleanStr(raw.desc, 140);
    m.base = ['light', 'dark', 'both'].includes(raw.base) ? raw.base : 'both';
    if (raw.base && m.base !== raw.base) warnings.push('base');
    // palette
    const palette = {};
    if (isObj(raw.palette)) {
      for (const mode of ['light', 'dark']) {
        if (!isObj(raw.palette[mode])) continue;
        const o = {};
        for (const k of ownKeys(raw.palette[mode])) {
          if (k === 'depth') { if (['soft', 'flat', 'none'].includes(raw.palette[mode][k])) o.depth = raw.palette[mode][k]; continue; }
          if (!SEEDS.includes(k) && !COLORS.includes(k)) { warnings.push('unknown:' + k); continue; }
          const c = cleanColor(raw.palette[mode][k]); if (c) o[k] = c; else warnings.push('bad:' + k);
        }
        if (o.bg && o.text) palette[mode] = o; else errors.push('palette_' + mode);
      }
    }
    m.palette = palette;
    // explicit tokens
    const tokens = {};
    if (isObj(raw.tokens)) {
      for (const grp of ['all', 'light', 'dark']) {
        if (!isObj(raw.tokens[grp])) continue;
        const o = {};
        for (const k0 of ownKeys(raw.tokens[grp])) {
          const k = k0.replace(/^--/, '');
          if (!TOKEN_TYPE[k]) { warnings.push('unknown:' + k0); continue; }
          const v = cleanToken(k, raw.tokens[grp][k0]);
          if (v == null) warnings.push('bad:' + k0); else o[k] = v;
        }
        if (Object.keys(o).length) tokens[grp] = o;
      }
    }
    m.tokens = tokens;
    // fonts: system stacks only
    const fonts = {};
    if (isObj(raw.fonts)) for (const k of ownKeys(raw.fonts)) {
      if (!FONT_KEYS[k]) { warnings.push('unknown:font.' + k); continue; }
      const v = cleanFont(raw.fonts[k]); if (v) fonts[k] = v; else warnings.push('bad:font.' + k);
    }
    m.fonts = fonts;
    // texture: a generated pattern chosen from a fixed list
    if (isObj(raw.texture) && TEXTURES.includes(raw.texture.kind) && raw.texture.kind !== 'none') {
      const layer = raw.texture.layer === 'over' ? 'over' : 'under';
      const cap = layer === 'over' ? 0.06 : 0.16;
      const op = Number(raw.texture.opacity);
      m.texture = { kind: raw.texture.kind, layer, opacity: Number.isFinite(op) ? clamp(op, 0, cap) : 0.05 };
      const sz = Number(raw.texture.size); if (Number.isFinite(sz)) m.texture.size = clamp(Math.round(sz), 2, 64);
    }
    m.motion = MOTIONS.includes(raw.motion) ? raw.motion : 'default';
    m.layout = LAYOUTS.includes(raw.layout || '') ? (raw.layout || '') : '';
    if (raw.layout && m.layout !== raw.layout) warnings.push('layout');
    if (raw.css != null) { if (opts.builtin) m.css = cleanStr(raw.css, 40); else warnings.push('css_ignored'); }
    if (raw.script != null || raw.js != null || raw.import != null || raw.url != null) warnings.push('code_ignored');
    if (opts.builtin) m.builtin = true;
    // a theme must define something to be worth having, and a usable palette for every mode it claims
    const modes = m.base === 'both' ? ['light', 'dark'] : [m.base];
    if (!(opts.builtin && m.id === 'fabro')) for (const md of modes) if (!m.palette[md] && !(m.tokens.all && m.tokens.all.bg) && !(m.tokens[md] && m.tokens[md].bg)) errors.push('no_colours_' + md);
    return errors.length ? { ok: false, errors, warnings } : { ok: true, theme: m, warnings };
  }

  // The file people share: the sanitised manifest in a stable shape, with the app's marker.
  function exportTheme(m) {
    const o = { fabrotheme: 1, v: 1, id: m.id.replace(/^u-/, ''), name: m.name, author: m.author || '', base: m.base };
    if (m.desc) o.desc = m.desc;
    if (m.palette && Object.keys(m.palette).length) o.palette = m.palette;
    if (m.tokens && Object.keys(m.tokens).length) o.tokens = m.tokens;
    if (m.fonts && Object.keys(m.fonts).length) o.fonts = m.fonts;
    if (m.texture) o.texture = m.texture;
    if (m.motion && m.motion !== 'default') o.motion = m.motion;
    if (m.layout) o.layout = m.layout;
    return JSON.stringify(o, null, 2) + '\n';
  }

  // ───────── compile: manifest → CSS text for the active theme ─────────
  const decl = (obj) => Object.keys(obj).map((k) => `--${k}: ${obj[k]};`).join(' ');
  const trailer = (m, mode) => {
    const fonts = {}; for (const k of Object.keys(m.fonts || {})) fonts[FONT_KEYS[k]] = m.fonts[k];
    return fonts;
  };
  function compile(m) {
    const sel = `[data-skin="${m.id}"]`;
    const modes = m.base === 'both' ? ['light', 'dark'] : [m.base];
    const shared = {};
    for (const k of Object.keys(m.fonts || {})) shared[FONT_KEYS[k]] = m.fonts[k];
    Object.assign(shared, MOTION[m.motion] || {});
    let css = `${sel} { ${decl(shared)} }\n`;
    const textures = {};
    for (const mode of modes) {
      const t = resolveTokens(m, mode);
      if (m.texture) {
        const ink = (t.text) || '#000';
        const img = textureImage(m.texture, m.texture.ink || ink);
        if (img) { t[m.texture.layer === 'over' ? 'texture-over' : 'texture'] = img.image; textures[mode] = img.size; }
      }
      css += `${sel}[data-theme="${mode}"] { ${Object.keys(t).map((k) => `--${k}: ${t[k]};`).join(' ')} color-scheme: ${mode}; }\n`;
    }
    return css;
  }
  // light/dark mode a theme will actually run in, given the user's mode (light|dark|system resolved by the caller)
  const modeFor = (m, wantDark) => (m.base === 'dark' ? 'dark' : m.base === 'light' ? 'light' : wantDark ? 'dark' : 'light');

  return { parseColor, fmt, mix, contrast, ensure, lum, derive, resolveTokens, fixContrast, audit, PAIRS, sanitize, exportTheme, compile, modeFor,
    cleanToken, cleanFont, cleanColor, cleanShadow, cleanEase, textureImage, TOKEN_TYPE, COLORS, MOTION, MAX_BYTES, TEXTURES, LAYOUTS, SEEDS, FONT_KEYS };
});
