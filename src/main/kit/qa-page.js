/* Runs inside the rendered artifact (Electron for Fabro, Chromium in tests): finds what a designer would
   reject. Returns [{ level: 'error'|'warn', msg }]. `opts`: { width, phone, kind: 'web'|'doc'|'deck'|'svg' }.
   Errors are things that are visibly broken (the AI must fix them); warnings are worth a look. */
function fabroQa(opts) {
  const out = []; const seen = new Set();
  const add = (level, msg) => { if (!seen.has(msg)) { seen.add(msg); out.push({ level, msg }); } };
  const W = innerWidth, D = document;
  const vis = (el) => { if (el.closest('details:not([open])') && !el.closest('summary')) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((x) => x && !/^(in|reveal|fk-)/.test(x)).slice(0, 2) : []; if (c.length) s += '.' + c.join('.'); return s; };
  const snippet = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  const all = [...D.body.querySelectorAll('*')].filter((el) => !/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|BR|svg|path|g|defs|title)$/i.test(el.tagName));
  const texts = all.filter((el) => ownText(el) && vis(el)).slice(0, 700);

  // 1. wider than the screen (the classic phone problem)
  if (opts.kind === 'web' && D.documentElement.scrollWidth > W + 2) {
    const wide = all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > W + 2 && r.width > 0 && getComputedStyle(el).position !== 'fixed'; });
    const top = wide.filter((el) => !wide.includes(el.parentElement)).slice(0, 3);
    add('error', `At ${W}px wide the page is ${D.documentElement.scrollWidth}px: it scrolls sideways${opts.phone ? ' on phones' : ''}. Too wide: ${top.map((el) => `${name(el)} (${Math.round(el.getBoundingClientRect().width)}px)`).join(', ') || 'unknown'}. Use max-width:100%, flex-wrap, kit grids (.grid, .grid-2…) instead of fixed widths.`);
  }
  // 2. cut-off content: pages, slides, boxes that hide what doesn't fit
  if (opts.kind === 'doc') D.querySelectorAll('.page.fixed, .page.cover, .page.cv, .page.poster').forEach((p, i) => { if (p.scrollHeight > p.clientHeight + 4) add('error', `Page ${[...D.querySelectorAll('.page')].indexOf(p) + 1} has too much content: ${Math.round((p.scrollHeight - p.clientHeight) / 3.78)} mm is cut at the bottom. Shorten it, or move the end to a new <section class="page">.`); });
  if (opts.kind === 'deck') D.querySelectorAll('.slide').forEach((s, i) => { if (s.scrollHeight > s.clientHeight + 4 || s.scrollWidth > s.clientWidth + 4) add('error', `Slide ${i + 1} overflows (${s.scrollHeight}px tall for 720px): too much text — split it into two slides or cut words.`); });
  for (const el of all) {
    if (!vis(el)) continue; const cs = getComputedStyle(el);
    if (/hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.clientHeight >= 10 && !el.matches('.page, .slide, .hero, body, html, .card, .media, img') && ownText(el) && el.innerText.trim().length > 3)
      add('error', `Text cut off in ${name(el)} (“${snippet(el)}…”): its box is too small for the text.`);
  }
  // 3. text on top of text
  const boxes = texts.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((b) => b.r.width * b.r.height > 40);
  let overl = 0;
  for (let i = 0; i < boxes.length && overl < 3; i++) for (let j = i + 1; j < boxes.length && overl < 3; j++) {
    const a = boxes[i], b = boxes[j]; if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const x = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)), y = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
    if (x * y > 0.35 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) { overl++; add('error', `Texts overlap: “${snippet(a.el)}” and “${snippet(b.el)}” (${name(a.el)} / ${name(b.el)}). Check absolute positions, negative margins or fixed heights.`); }
  }
  // 4. contrast (WCAG): text colour against the real background behind it
  const rgb = (s) => { const m = String(s).match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let col = null; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = rgb(cs.backgroundColor); if (c && c[3] > 0.5) { col = c; break; } } return col || [255, 255, 255, 1]; };
  const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const lows = [];
  for (const el of texts) {
    const cs = getComputedStyle(el); const fg = rgb(cs.color); if (!fg || fg[3] < 0.3) continue; const bg = bgOf(el); if (!bg) continue;
    const o = +cs.opacity < 1 ? +cs.opacity : 1; const f = fg.map((v, k) => (k < 3 ? v * fg[3] * o + bg[k] * (1 - fg[3] * o) : 1));
    const L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.6 && +cs.fontWeight >= 600);
    if (ratio < (big ? 2.6 : 3.6)) lows.push({ el, ratio, f, bg });
  }
  lows.sort((a, b) => a.ratio - b.ratio).slice(0, 4).forEach((x) => add('error', `Hard to read: “${snippet(x.el)}” (${name(x.el)}) — contrast ${x.ratio.toFixed(1)}:1, text ${hex(x.f)} on ${hex(x.bg)}. Make the text darker/lighter or change the background.`));
  // 5. images
  const imgs = [...D.images]; const broken = imgs.filter((i) => (i.getAttribute('src') || i.currentSrc) && i.complete && !i.naturalWidth);
  if (broken.length) add('error', `${broken.length} image(s) don't load: ${broken.slice(0, 3).map((i) => (i.getAttribute('src') || '').slice(0, 70)).join(', ')}. Use <img data-photo="2-4 words"> and Fabro finds a real photo, or another URL.`);
  const empty = imgs.filter((i) => !i.getAttribute('src') && i.dataset.photo); if (empty.length) add('warn', `${empty.length} photo(s) (data-photo) have no picture yet (offline or nothing found for “${empty[0].dataset.photo}”): try simpler words.`);
  const noAlt = imgs.filter((i) => !i.hasAttribute('alt')).length; if (noAlt) add('warn', `${noAlt} image(s) without alt text (accessibility).`);
  const stretched = imgs.filter((i) => i.naturalWidth && vis(i) && getComputedStyle(i).objectFit === 'fill' && Math.abs((i.width / i.height) - (i.naturalWidth / i.naturalHeight)) > 0.25 * (i.naturalWidth / i.naturalHeight)).slice(0, 2);
  stretched.forEach((i) => add('warn', `Stretched image ${name(i)}: add object-fit: cover (or keep its proportions).`));
  // 6. content quality
  const txt = (D.body.innerText || '').trim();
  if (txt.length < 30 && opts.kind !== 'svg' && !D.querySelector('button, input, select, textarea, canvas, svg, img, video, iframe')) add('error', 'The page is (nearly) empty.');
  if (/lorem ipsum|dolor sit amet|\bTODO\b|\[(your|insert|votre|ins[ée]rer)[^\]]*\]|placeholder text/i.test(txt)) add('error', 'Placeholder text left in the page (lorem ipsum / TODO / [your …]): write the real content.');
  const sheets = [...D.styleSheets].length + D.querySelectorAll('[style]').length;
  if (!sheets) add('error', 'No styling at all: start the page with <body data-theme="…"> to use the Fabro Kit, or add CSS.');
  if (opts.kind === 'web' && !D.querySelector('h1')) add('warn', 'No <h1> heading: give the page one main title.');
  D.querySelectorAll('i[data-icon]').forEach((i) => { if (getComputedStyle(i).display === 'none') add('warn', `Unknown icon “${i.dataset.icon}”: use another name (e.g. star, check, mail, phone, pin, calendar, chart, rocket, user, globe, zap, shield, heart).`); });
  D.querySelectorAll('[data-chart]').forEach((c) => { if (/invalid JSON/.test(c.textContent)) add('error', `Chart with invalid data-chart JSON in ${name(c)}.`); });
  // 7. phones: tiny text, tiny buttons
  if (opts.phone) {
    const tiny = texts.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 11.5 && el.innerText.trim().length > 12);
    if (tiny.length) add('warn', `${tiny.length} text(s) smaller than 12px on phones, e.g. “${snippet(tiny[0])}”.`);
    const taps = [...D.querySelectorAll('a, button, [role=button], input, select')].filter((el) => vis(el) && !el.closest('p, li, td') && (() => { const r = el.getBoundingClientRect(); return r.height < 30 || r.width < 30; })());
    if (taps.length > 2) add('warn', `${taps.length} buttons/links smaller than 30px on phones (hard to tap), e.g. ${name(taps[0])}.`);
  }
  // 8. documents: pages nobody wants
  if (opts.kind === 'doc') D.querySelectorAll('.page').forEach((p, i) => { if ((p.innerText || '').trim().length < 15 && !p.querySelector('img, svg, .chart')) add('error', `Page ${i + 1} is empty.`); });
  return out;
}
if (typeof module !== 'undefined') module.exports = { fabroQa };
