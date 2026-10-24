/* Fabro Kit runtime: icons (<i data-icon="rocket">), charts from data (<figure class="chart" data-chart='{…}'>),
   reveal-on-scroll, mobile navigation, A4 documents and 16:9 decks (screen scaling + print page size), the
   theme's fonts, photo credits. window.fabroKitReady resolves when the page is ready to be captured or printed. */
(function () {
  'use strict';
  if (window.__fabroKit) return; window.__fabroKit = true;
  const D = document, B = () => D.body;
  const STATIC = /fk-static/.test(location.hash) || window.__FK_STATIC || matchMedia('print').matches; // captures and PDFs: everything visible at once
  const ICONS = window.__FK_ICONS || {};
  const ALIAS = { email: 'mail', envelope: 'mail', 'arrow-right': 'right', arrow: 'right', 'chevron-right': 'right', 'chevron-down': 'down', close: 'x', menu: 'menu', burger: 'menu', settings: 'settings', gear: 'settings', location: 'pin', map: 'pin', 'map-pin': 'pin', time: 'calendar', clock: 'calendar', heart: 'star', like: 'star', photo: 'image', picture: 'image', doc: 'file', document: 'file', money: 'chart', graph: 'chart', idea: 'bulb', lightbulb: 'bulb', security: 'shield', lock: 'lock', fast: 'zap', speed: 'zap', bolt: 'zap', lightning: 'zap', cloud: 'cloud', team: 'user', users: 'user', person: 'user', phone: 'phone', call: 'phone', home: 'home', house: 'home', world: 'globe', web: 'globe', launch: 'rocket', growth: 'chart', check: 'check', 'check-circle': 'success', ok: 'success', warning: 'warning', alert: 'warning', info: 'info', search: 'search', star: 'star', code: 'code', terminal: 'terminal', book: 'book', learn: 'book', play: 'play', video: 'video', music: 'waveform', mic: 'mic', camera: 'camera', link: 'link', share: 'share', download: 'download', upload: 'upload', calendar: 'calendar', chat: 'chat', message: 'chat', key: 'key', wifi: 'wifi', server: 'server', database: 'server', layers: 'layers', puzzle: 'puzzle', tools: 'wrench', wrench: 'wrench', sparkle: 'sparkle', magic: 'sparkle', ai: 'sparkle', table: 'table', tree: 'tree', leaf: 'tree', eye: 'eye', bell: 'bell', archive: 'archive', box: 'box', package: 'box', cpu: 'cpu', brain: 'brain', agent: 'agent', robot: 'agent', flask: 'flask', science: 'flask', bug: 'bug', plan: 'plan', folder: 'folder', edit: 'edit', pen: 'edit', trash: 'trash', filter: 'filter', plus: 'plus', refresh: 'refresh', power: 'power', sun: 'sun', moon: 'moon', language: 'language', qr: 'qr' };
  const MENU = ['0 0 24 24', '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>'];
  const svgOf = (name) => {
    const n = String(name || '').trim().toLowerCase();
    const d = n === 'menu' ? MENU : ICONS[n] || ICONS[ALIAS[n]];
    if (!d) return null;
    return `<svg class="fk-icon" viewBox="${d[0]}" fill="currentColor" aria-hidden="true">${d[1]}</svg>`;
  };
  function icons(root = D) {
    for (const el of root.querySelectorAll('i[data-icon]:not([data-fk])')) {
      el.dataset.fk = '1';
      const s = svgOf(el.dataset.icon);
      if (s) el.innerHTML = s; else el.style.display = 'none'; // unknown icon: nothing rather than an empty box
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-hidden', 'true');
    }
  }

  // ── charts: <figure class="chart" data-chart='{"type":"bar","labels":[…],"data":[…],"unit":"€"}'> ──
  const PAL = ['var(--accent)', 'var(--accent-2)', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#0ea5e9', '#94a3b8'];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function chart(el) {
    let spec; try { spec = JSON.parse(el.getAttribute('data-chart')); } catch { el.innerHTML = '<p style="color:#c00">Chart: invalid JSON in data-chart</p>'; return; }
    const type = String(spec.type || 'bar').toLowerCase();
    const labels = (spec.labels || []).map(String);
    let series = spec.series || [{ name: spec.name || '', data: spec.data || spec.values || [] }];
    series = series.map((s, i) => ({ name: s.name || '', data: (s.data || s.values || []).map(Number), color: s.color || PAL[i % PAL.length] }));
    const unit = spec.unit || '', pre = spec.prefix || '';
    const nf = new Intl.NumberFormat(D.documentElement.lang || undefined, { maximumFractionDigits: 1 });
    const fmt = (v) => pre + nf.format(v) + (unit ? (unit.length > 1 || /[a-z%]/i.test(unit) ? ' ' : '') + unit : '');
    const T = (x, y, t, a = 'middle', extra = '') => `<text x="${x}" y="${y}" text-anchor="${a}" style="fill:var(--muted);font:12px var(--font)" ${extra}>${esc(t)}</text>`;
    let svg = '', legend = series.length > 1 ? series.map((s) => [s.name, s.color]) : null;
    if (type === 'pie' || type === 'donut') {
      const data = series[0].data, total = data.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      const R = 110, r = type === 'donut' ? 64 : 0, cx = 130, cy = 130; let a0 = -Math.PI / 2;
      const arcs = data.map((v, i) => {
        const a1 = a0 + Math.max(0, v) / total * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
        const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
        const d = data.length === 1 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0` + (r ? `M${cx - r},${cy}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0` : '')
          : r ? `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${big} 0 ${x3},${y3}Z` : `M${cx},${cy}L${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}Z`;
        a0 = a1; return `<path d="${d}" style="fill:${PAL[i % PAL.length]};stroke:var(--surface);stroke-width:2" fill-rule="evenodd"><title>${esc(labels[i])}: ${esc(fmt(v))}</title></path>`;
      }).join('');
      const center = r ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" style="fill:var(--text);font:600 24px var(--font-head)">${esc(spec.center || fmt(total))}</text>${spec.centerLabel ? T(cx, cy + 20, spec.centerLabel) : ''}` : '';
      svg = `<div class="pie"><svg viewBox="0 0 260 260" role="img" aria-label="${esc(spec.title || 'chart')}">${arcs}${center}</svg></div>`;
      legend = labels.map((l, i) => [`${l} · ${Math.round(Math.max(0, data[i]) / total * 100)} %`, PAL[i % PAL.length]]);
    } else if (type === 'hbar') {
      const data = series[0].data, max = Math.max(...data, 0) || 1, rowH = 34, W = 640, L = 150;
      svg = `<svg viewBox="0 0 ${W} ${labels.length * rowH + 10}" role="img" aria-label="${esc(spec.title || 'chart')}">` + labels.map((l, i) => {
        const w = (W - L - 80) * Math.max(0, data[i]) / max, y = i * rowH + 6;
        return `${T(L - 12, y + 17, l, 'end')}<rect x="${L}" y="${y}" width="${Math.max(2, w)}" height="22" rx="5" style="fill:${series[0].color}"/>${T(L + w + 8, y + 16, fmt(data[i]), 'start', 'style="fill:var(--text);font:600 12px var(--font)"')}`;
      }).join('') + '</svg>';
    } else {
      const W = 640, H = 300, L = 54, R = 16, top = 16, bot = 34, n = labels.length || Math.max(...series.map((s) => s.data.length));
      const all = series.flatMap((s) => s.data); let max = Math.max(...all, 0), min = Math.min(...all, 0);
      const step = (() => { const raw = (max - min) / 4 || 1, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw); })();
      max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
      const y = (v) => top + (H - top - bot) * (1 - (v - min) / (max - min || 1));
      let g = '';
      for (let v = min; v <= max + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" ${v ? 'stroke-dasharray="3 4"' : ''}/>${T(L - 8, y(v) + 4, fmt(+v.toFixed(6)), 'end')}`;
      const cw = (W - L - R) / Math.max(1, n);
      labels.forEach((l, i) => { g += T(L + cw * i + cw / 2, H - 10, l.length > 12 ? l.slice(0, 11) + '…' : l); });
      if (type === 'line' || type === 'area') {
        series.forEach((s) => {
          const pts = s.data.map((v, i) => [L + cw * i + cw / 2, y(v)]);
          if (type === 'area') g += `<path d="M${pts[0][0]},${y(Math.max(min, 0))}L${pts.map((p) => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${y(Math.max(min, 0))}Z" style="fill:${s.color};opacity:.14"/>`;
          g += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" style="stroke:${s.color};stroke-width:3;stroke-linejoin:round;stroke-linecap:round"/>`;
          g += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" style="fill:var(--surface);stroke:${s.color};stroke-width:2.5"><title>${esc(labels[i])}: ${esc(fmt(s.data[i]))}</title></circle>`).join('');
        });
      } else {
        const k = series.length, bw = Math.min(46, (cw * .7) / k);
        series.forEach((s, j) => s.data.forEach((v, i) => {
          const x = L + cw * i + (cw - bw * k) / 2 + j * bw, y0 = y(Math.max(0, v)), h = Math.abs(y(v) - y(0));
          g += `<rect x="${x + 1}" y="${y0}" width="${bw - 2}" height="${Math.max(1, h)}" rx="4" style="fill:${s.color}"><title>${esc(labels[i])}: ${esc(fmt(v))}</title></rect>`;
          if (k === 1 && n <= 12) g += T(x + bw / 2, y0 - 6, fmt(v), 'middle', 'style="fill:var(--text);font:600 11.5px var(--font)"');
        }));
      }
      svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || 'chart')}">${g}</svg>`;
    }
    const leg = legend ? `<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:13px">${legend.map(([n, c]) => `<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></i>${esc(n)}</span>`).join('')}</div>` : '';
    const title = spec.title && !el.querySelector('figcaption') ? `<div class="chart-title">${esc(spec.title)}</div>` : '';
    const cap = el.querySelector('figcaption'); el.innerHTML = title + svg + leg; if (cap) el.prepend(cap);
    el.classList.add('chart');
  }

  // ── fonts of the theme (Google Fonts when online; system fonts otherwise) ──
  const GF = ['Inter', 'Fraunces', 'Manrope', 'DM Sans', 'DM Serif Display', 'Poppins', 'Space Grotesk', 'Lato', 'Playfair Display', 'Nunito', 'Fredoka', 'Source Serif 4', 'Libre Baskerville', 'IBM Plex Sans', 'JetBrains Mono', 'Montserrat', 'Raleway', 'Work Sans', 'Outfit', 'Sora', 'Lora', 'Merriweather', 'Roboto', 'Open Sans', 'Bricolage Grotesque', 'Instrument Serif', 'Cormorant Garamond', 'Archivo', 'Plus Jakarta Sans', 'Syne', 'Caveat', 'Pacifico', 'Bebas Neue', 'Oswald', 'Quicksand', 'Rubik', 'Karla', 'EB Garamond', 'Josefin Sans', 'Abril Fatface', 'Unbounded', 'Righteous'];
  function fonts() {
    const cs = getComputedStyle(B());
    const fams = new Set();
    for (const v of [cs.getPropertyValue('--font'), cs.getPropertyValue('--font-head'), cs.fontFamily]) for (const f of String(v).split(',')) { const n = f.trim().replace(/^["']|["']$/g, ''); if (GF.includes(n)) fams.add(n); }
    for (const el of D.querySelectorAll('[style*="font-family"], h1, h2')) { const n = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''); if (GF.includes(n)) fams.add(n); }
    if (!fams.size || D.querySelector('link[href*="fonts.googleapis.com"]')) return Promise.resolve();
    const l = D.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + [...fams].map((f) => 'family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700').join('&') + '&display=swap';
    D.head.appendChild(l);
    return new Promise((res) => { l.onload = () => (D.fonts ? D.fonts.ready.then(res) : res()); l.onerror = res; setTimeout(res, 2500); });
  }

  // ── documents and decks ──
  function pageCss(css) { const st = D.createElement('style'); st.textContent = css; D.head.appendChild(st); }
  function fit(sel, w) { const z = Math.min(1, (innerWidth - 24) / w); D.documentElement.style.setProperty('--fk-zoom', String(z)); }
  const SIZES = { A4: [210, 297], A3: [297, 420], A5: [148, 210], LETTER: [215.9, 279.4], LEGAL: [215.9, 355.6] };
  function docMode() {
    const b = B(); const land = b.classList.contains('landscape') || /landscape/i.test(b.dataset.orientation || '');
    let [pw, ph] = SIZES[String(b.dataset.page || 'A4').toUpperCase()] || SIZES.A4; if (land) [pw, ph] = [ph, pw];
    D.documentElement.style.setProperty('--page-w', pw + 'mm'); D.documentElement.style.setProperty('--page-h', ph + 'mm');
    if (!b.querySelector(':scope > .page')) { // no explicit pages: one flowing page that the printer splits
      const wrap = D.createElement('div'); wrap.className = 'page flow';
      for (const n of [...b.childNodes]) if (!(n.nodeType === 1 && /^(SCRIPT|STYLE|TEMPLATE)$/.test(n.tagName))) wrap.appendChild(n);
      b.prepend(wrap);
    }
    const flowOnly = ![...b.querySelectorAll(':scope > .page')].some((p) => !p.classList.contains('flow'));
    pageCss(`@page { size: ${pw}mm ${ph}mm; margin: ${flowOnly ? '16mm 18mm' : '0'}; }
      @media print { .doc .page.flow { padding: ${flowOnly ? '0' : '18mm'}; min-height: 0; } }
      @media screen { .doc .page { zoom: var(--fk-zoom, 1); } }`);
    const w = pw * 3.7795 + 40; fit('.page', w); addEventListener('resize', () => fit('.page', w));
  }
  function deckMode() {
    const b = B();
    for (const s of b.querySelectorAll(':scope > section')) s.classList.add('slide');
    [...b.querySelectorAll(':scope > .slide')].forEach((s, i) => { if (!s.querySelector('.slide-n') && !s.classList.contains('title')) s.insertAdjacentHTML('beforeend', `<span class="slide-n">${i + 1}</span>`); });
    pageCss('@page { size: 1280px 720px; margin: 0; } @media screen { .deck .slide { zoom: var(--fk-zoom, 1); } }');
    fit('.slide', 1280 + 32); addEventListener('resize', () => fit('.slide', 1312));
  }

  function nav() {
    for (const n of D.querySelectorAll('.nav')) {
      const links = n.querySelector('.links, ul'); if (!links || n.querySelector('.nav-toggle')) continue;
      const btn = D.createElement('button'); btn.className = 'nav-toggle'; btn.setAttribute('aria-label', 'Menu'); btn.innerHTML = svgOf('menu');
      btn.onclick = () => n.classList.toggle('open');
      links.parentNode.insertBefore(btn, links);
      links.addEventListener('click', (e) => { if (e.target.closest('a')) n.classList.remove('open'); });
    }
  }
  function reveal() {
    const els = D.querySelectorAll('.reveal');
    if (STATIC || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px' });
    els.forEach((e) => io.observe(e));
    addEventListener('beforeprint', () => els.forEach((e) => e.classList.add('in')));
  }
  function images() {
    for (const img of D.querySelectorAll('img')) {
      const bad = () => img.classList.add('fk-missing');
      if (img.complete && img.getAttribute('src') && !img.naturalWidth) bad(); else img.addEventListener('error', bad);
    }
    // photo credits (photos found by Fabro carry data-credit)
    const credits = [...new Set([...D.querySelectorAll('img[data-credit]')].map((i) => i.dataset.credit))].filter(Boolean);
    if (credits.length && !D.querySelector('.fk-credits') && !B().classList.contains('deck')) {
      const c = D.createElement('div'); c.className = 'fk-credits'; c.textContent = (D.documentElement.lang || '').startsWith('fr') ? 'Photos : ' + credits.join(' · ') : 'Photos: ' + credits.join(' · ');
      const lastPage = B().classList.contains('doc') ? [...B().querySelectorAll(':scope > .page')].pop() : null;
      (lastPage || B()).appendChild(c);
    }
  }
  const imgsLoaded = () => Promise.all([...D.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); setTimeout(r, 6000); }))));

  function start() {
    const b = B(); if (!b) return;
    if (!D.querySelector('meta[name=viewport]')) { const m = D.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width, initial-scale=1'; D.head.appendChild(m); }
    icons(); D.querySelectorAll('[data-chart]').forEach(chart);
    if (b.classList.contains('doc')) docMode();
    if (b.classList.contains('deck')) deckMode();
    nav(); reveal(); images();
    const f = fonts();
    window.fabroKitReady = Promise.all([f, imgsLoaded()]).then(() => new Promise((r) => requestAnimationFrame(() => r(true))));
    window.fabroKit = { icons, chart, refresh: () => { icons(); D.querySelectorAll('[data-chart]').forEach(chart); } };
  }
  window.fabroKitReady = new Promise((res) => {
    const go = () => { try { start(); } catch (e) { console.error('Fabro Kit', e); } Promise.resolve(window.fabroKitReady).then(res, res); };
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', go); else go();
  });
})();
