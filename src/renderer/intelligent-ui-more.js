// Fabro Intelligent UI, second set of displays: chart, table, guide, tabs, faq, calc, board, callout,
// proscons, schedule, blanks, grid. Same contract as intelligent-ui.js (a ```fabro-ui JSON block).
(() => {
  if (!window.IUI || !IUI.add) return;
  const { e, inl, arr, num, st, act, head } = IUI.h;
  const COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--ok)', 'var(--warn)', 'var(--err)'];
  const col = (i) => COLORS[i % COLORS.length];
  const fmt = (v, dec) => { const n = Number(v); if (!Number.isFinite(n)) return '–'; return n.toLocaleString(undefined, { maximumFractionDigits: dec == null ? 2 : dec }); };
  const paras = (v) => String(v == null ? '' : v).split(/\n{2,}/).map((p) => `<p>${inl(p).replace(/\n/g, '<br>')}</p>`).join('');

  // ── chart: bar, line, pie ──
  function series(d) {
    let ss = arr(d.series).map((s, i) => ({ name: String((s && s.name) || ''), values: arr(s && s.values).map((v) => num(v)), c: col(i) })).filter((s) => s.values.length).slice(0, 6);
    if (!ss.length && arr(d.values).length) ss = [{ name: '', values: arr(d.values).map((v) => num(v)), c: col(0) }];
    return ss;
  }
  const legend = (items) => (items.length > 1 || (items[0] && items[0].name) ? `<div class="iui-legend">${items.map((s) => `<span><i style="background:${s.c}"></i>${e(s.name)}</span>`).join('')}</div>` : '');
  function chart(d) {
    const kind = String(d.kind || d.chart || d.type || 'bar').toLowerCase(); const unit = d.unit ? ' ' + d.unit : '';
    const ss = series(d); const labels = arr(d.labels).map(String).slice(0, 40);
    if (!ss.length) return head(d);
    if (kind === 'pie' || kind === 'donut') {
      const vals = ss[0].values.slice(0, 12).map((v) => Math.max(0, v)); const total = vals.reduce((a, b) => a + b, 0) || 1;
      let a0 = -Math.PI / 2; const parts = vals.map((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2; const big = a1 - a0 > Math.PI ? 1 : 0;
        const p = (a, r) => `${(60 + r * Math.cos(a)).toFixed(2)} ${(60 + r * Math.sin(a)).toFixed(2)}`;
        const path = v >= total ? `<circle cx="60" cy="60" r="41" fill="none" stroke="${col(i)}" stroke-width="18"/>` : `<path d="M ${p(a0, 50)} A 50 50 0 ${big} 1 ${p(a1, 50)} L ${p(a1, 32)} A 32 32 0 ${big} 0 ${p(a0, 32)} Z" fill="${col(i)}"><title>${e(labels[i] || '')}: ${e(fmt(v))}${e(unit)}</title></path>`;
        a0 = a1; return path;
      }).join('');
      return `${head(d)}<div class="iui-pie"><svg viewBox="0 0 120 120" role="img">${parts}</svg><ul>${vals.map((v, i) => `<li><i style="background:${col(i)}"></i><span>${e(labels[i] || '')}</span><b>${e(fmt(v))}${e(unit)} · ${Math.round((v / total) * 100)} %</b></li>`).join('')}</ul></div>`;
    }
    const n = Math.min(40, Math.max(...ss.map((s) => s.values.length)));
    const all = ss.flatMap((s) => s.values.slice(0, n)); const max = Math.max(0, ...all); const min = Math.min(0, ...all); const span = (max - min) || 1;
    const W = 600, H = 220, L = 44, B = 26, T = 8; const pw = W - L - 8, ph = H - T - B; const y = (v) => T + ph - ((v - min) / span) * ph;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = min + span * f; return `<line x1="${L}" x2="${W - 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="iui-grid"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${e(fmt(v, 1))}</text>`; }).join('');
    const stepL = Math.ceil(n / 12);
    const xl = (i) => L + (pw / n) * (i + 0.5);
    const lab = labels.slice(0, n).map((t, i) => (i % stepL ? '' : `<text x="${xl(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${e(t.length > 12 ? t.slice(0, 11) + '…' : t)}</text>`)).join('');
    let marks;
    if (kind === 'line' || kind === 'area') {
      marks = ss.map((s) => { const pts = s.values.slice(0, n).map((v, i) => `${xl(i).toFixed(1)},${y(v).toFixed(1)}`); return `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${n <= 24 ? s.values.slice(0, n).map((v, i) => `<circle cx="${xl(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${s.c}"><title>${e(labels[i] || '')}: ${e(fmt(v))}${e(unit)}</title></circle>`).join('') : ''}`; }).join('');
    } else {
      const gw = (pw / n) * 0.72; const bw = gw / ss.length;
      marks = ss.map((s, k) => s.values.slice(0, n).map((v, i) => { const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v)); return `<rect x="${(xl(i) - gw / 2 + k * bw).toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}" rx="3" fill="${s.c}"><title>${e(labels[i] || '')}: ${e(fmt(v))}${e(unit)}</title></rect>`; }).join('')).join('');
    }
    return `${head(d)}<svg class="iui-chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${marks}${lab}</svg>${legend(ss)}${d.note ? `<div class="iui-note">${inl(d.note)}</div>` : ''}`;
  }

  // ── table: click a column to sort ──
  function table(d, key) {
    const s = st(key, () => ({ by: -1, dir: 1 })); const cols = arr(d.columns).map(String).slice(0, 10);
    let rows = arr(d.rows).slice(0, 200).map((r) => (Array.isArray(r) ? r : cols.map((c) => (r || {})[c])));
    if (s.by >= 0) rows = rows.slice().sort((a, b) => { const x = a[s.by], y = b[s.by]; const nx = parseFloat(String(x).replace(',', '.')), ny = parseFloat(String(y).replace(',', '.')); return (Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(x).localeCompare(String(y))) * s.dir; });
    return `${head(d)}<div class="iui-tablewrap"><table class="iui-table"><thead><tr>${cols.map((c, i) => `<th><button ${act('sort', i)}>${inl(c)}<span>${s.by === i ? (s.dir > 0 ? '↑' : '↓') : ''}</span></button></th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((_, i) => `<td>${inl(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  // ── guide: one step at a time ──
  function guide(d, key) {
    const items = arr(d.items || d.steps).slice(0, 30); const s = st(key, () => ({ i: 0 })); const i = Math.min(s.i, Math.max(0, items.length - 1)); const it = items[i] || {};
    const o = typeof it === 'string' ? { text: it } : it;
    return `${head(d)}<div class="iui-dots">${items.map((_, k) => `<button ${act('goto', k)} class="${k === i ? 'on' : k < i ? 'done' : ''}" aria-label="${k + 1}">${k + 1}</button>`).join('')}</div>
      <div class="iui-step">${o.title ? `<b>${inl(o.title)}</b>` : ''}${paras(o.text)}${o.tip ? `<div class="iui-note">${inl(o.tip)}</div>` : ''}</div>
      <div class="iui-foot"><button class="btn ghost sm" ${act('goto', i - 1)} ${i <= 0 ? 'disabled' : ''}>${e(t('iui_prev'))}</button><span>${i + 1} / ${items.length}</span><button class="btn ${i >= items.length - 1 ? 'ghost' : 'primary'} sm" ${act('goto', i + 1)} ${i >= items.length - 1 ? 'disabled' : ''}>${e(t('iui_next'))}</button></div>`;
  }

  function tabs(d, key) {
    const items = arr(d.tabs || d.items).slice(0, 8); const s = st(key, () => ({ i: 0 })); const i = Math.min(s.i, Math.max(0, items.length - 1)); const it = items[i] || {};
    const body = it.block ? IUI.child(`${key}:t${i}`, it.block) : '';
    return `${head(d)}<div class="iui-tabs" role="tablist">${items.map((x, k) => `<button role="tab" ${act('goto', k)} class="${k === i ? 'on' : ''}">${inl(x.label || x.title || k + 1)}</button>`).join('')}</div><div class="iui-step">${paras(it.text)}${body}</div>`;
  }

  function faq(d, key) {
    const s = st(key, () => ({ open: {} }));
    return `${head(d)}<div class="iui-faq">${arr(d.items).slice(0, 30).map((x, i) => `<div class="iui-q ${s.open[i] ? 'on' : ''}"><button ${act('toggle', i)} aria-expanded="${!!s.open[i]}"><span>${inl(x.q || x.title)}</span><i>${s.open[i] ? '−' : '+'}</i></button>${s.open[i] ? `<div>${paras(x.a || x.text)}</div>` : ''}</div>`).join('')}</div>`;
  }

  // ── calc: sliders and number fields, results from formulas (no eval: a small parser) ──
  const FN = { min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow, log: Math.log, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan };
  function evalFormula(src, vars) {
    const tk = String(src || '').match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|\*\*|[-+*/%^(),]/g) || []; let p = 0;
    const peek = () => tk[p]; const eat = () => tk[p++];
    const atom = () => {
      const x = eat();
      if (x === '(') { const v = sum(); eat(); return v; }
      if (x === '-') return -atom();
      if (x === '+') return atom();
      if (/^\d/.test(x || '')) return Number(x);
      if (x && peek() === '(' && FN[x.toLowerCase()]) { eat(); const args = []; while (peek() !== ')' && p < tk.length) { args.push(sum()); if (peek() === ',') eat(); } eat(); return FN[x.toLowerCase()](...args); }
      if (x && /^pi$/i.test(x)) return Math.PI;
      if (x && Object.prototype.hasOwnProperty.call(vars, x)) return Number(vars[x]);
      return NaN;
    };
    const power = () => { const b = atom(); if (peek() === '^' || peek() === '**') { eat(); return Math.pow(b, power()); } return b; };
    const prod = () => { let v = power(); while (['*', '/', '%'].includes(peek())) { const o = eat(); const r = power(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
    function sum() { let v = prod(); while (peek() === '+' || peek() === '-') { const o = eat(); const r = prod(); v = o === '+' ? v + r : v - r; } return v; }
    try { return sum(); } catch { return NaN; }
  }
  const calcVals = (d, s) => Object.fromEntries(arr(d.inputs).slice(0, 12).map((x) => [String(x.id), s.v[x.id] != null ? s.v[x.id] : num(x.value)]));
  const calcOut = (d, s) => { const vars = calcVals(d, s); return arr(d.outputs).slice(0, 8).map((o) => { const v = evalFormula(o.formula, vars); vars[o.id || ''] = v; return `<div class="iui-stat"><b>${e(fmt(v, o.decimals))}${o.unit ? ' ' + e(o.unit) : ''}</b><span>${inl(o.label)}</span></div>`; }).join(''); };
  function calc(d, key) {
    const s = st(key, () => ({ v: {} })); const vals = calcVals(d, s);
    return `${head(d)}<div class="iui-inputs">${arr(d.inputs).slice(0, 12).map((x) => { const id = String(x.id); const slider = x.min != null && x.max != null;
      return `<label class="iui-in"><span>${inl(x.label || id)}<b data-out="${e(id)}">${e(fmt(vals[id]))}${x.unit ? ' ' + e(x.unit) : ''}</b></span><input data-iui-in="${e(id)}" data-unit="${e(x.unit || '')}" type="${slider ? 'range' : 'number'}" value="${e(vals[id])}" ${x.min != null ? `min="${e(num(x.min))}"` : ''} ${x.max != null ? `max="${e(num(x.max))}"` : ''} step="${e(num(x.step, slider ? (num(x.max) - num(x.min)) / 100 || 1 : 1) || 'any')}"></label>`; }).join('')}</div>
      <div class="iui-stats iui-outs">${calcOut(d, s)}</div>${d.note ? `<div class="iui-note">${inl(d.note)}</div>` : ''}`;
  }

  function board(d) {
    return `${head(d)}<div class="iui-board">${arr(d.columns).slice(0, 6).map((c, i) => `<div class="iui-lane"><div class="iui-lane-h"><i style="background:${col(i)}"></i>${inl(c.title)}<span>${arr(c.cards).length}</span></div>${arr(c.cards).slice(0, 20).map((x) => { const o = typeof x === 'string' ? { title: x } : x || {}; return `<div class="iui-kcard"><b>${inl(o.title)}</b>${o.text ? `<span>${inl(o.text)}</span>` : ''}${o.tag ? `<em>${inl(o.tag)}</em>` : ''}</div>`; }).join('')}</div>`).join('')}</div>`;
  }

  function callout(d) { const tone = ['info', 'ok', 'warn', 'err'].includes(d.tone) ? d.tone : 'info'; return `<div class="iui-call iui-${tone}">${d.title ? `<b>${inl(d.title)}</b>` : ''}${paras(d.text)}</div>`; }

  function proscons(d) {
    const list = (xs, cls, title, sign) => `<div class="iui-pc ${cls}"><b>${inl(title)}</b><ul>${arr(xs).slice(0, 12).map((x) => `<li><i>${sign}</i><span>${inl(x)}</span></li>`).join('')}</ul></div>`;
    return `${head(d)}<div class="iui-cmp2">${list(d.pros, 'pro', d.prosTitle || t('iui_pros'), '+')}${list(d.cons, 'con', d.consTitle || t('iui_cons'), '−')}</div>${d.verdict ? `<div class="iui-note"><b>${inl(d.verdict)}</b></div>` : ''}`;
  }

  function schedule(d) {
    return `${head(d)}<div class="iui-sched">${arr(d.days).slice(0, 14).map((day) => `<div class="iui-day"><b>${inl(day.day || day.title)}</b>${arr(day.slots || day.items).slice(0, 16).map((x) => { const o = typeof x === 'string' ? { title: x } : x || {}; return `<div class="iui-slot">${o.time ? `<em>${inl(o.time)}</em>` : ''}<span>${inl(o.title)}${o.text ? `<small>${inl(o.text)}</small>` : ''}</span></div>`; }).join('')}</div>`).join('')}</div>`;
  }

  // ── blanks: "The capital of France is {{Paris}}." ──
  const norm = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function blanks(d, key) {
    const s = st(key, () => ({ v: {}, checked: false })); let n = 0; const answers = [];
    const body = e(d.text).replace(/\{\{(.+?)\}\}/g, (_, a) => { const i = n++; answers.push(a); const ok = s.checked ? a.split('|').some((x) => norm(x) === norm(s.v[i])) : null;
      return `<input class="iui-blank ${ok == null ? '' : ok ? 'ok' : 'bad'}" data-iui-in="${i}" value="${e(s.v[i] || '')}" size="${Math.max(4, Math.min(24, a.split('|')[0].length + 1))}" autocomplete="off" autocapitalize="off" spellcheck="false">${ok === false ? `<small class="iui-sol">${e(a.split('|')[0])}</small>` : ''}`; }).replace(/\n/g, '<br>');
    const good = answers.filter((a, i) => a.split('|').some((x) => norm(x) === norm(s.v[i]))).length;
    return `${head(d)}<div class="iui-blanks">${body}</div><div class="iui-foot"><span>${s.checked ? `<b>${e(t('iui_score', { n: good, t: answers.length }))}</b>` : ''}</span><span><button class="btn ghost sm" ${act('breset')}>${e(t('iui_again'))}</button> <button class="btn primary sm" ${act('bcheck')}>${e(t('iui_check'))}</button></span></div>`;
  }

  // ── grid: several displays side by side (a small dashboard) ──
  function grid(d, key) {
    const n = Math.max(1, Math.min(3, num(d.columns, 2)));
    return `${head(d)}<div class="iui-grid-box" style="--iui-cols:${n}">${arr(d.blocks).slice(0, 8).map((b, i) => `<div class="iui-cell" ${b && b.span ? `style="grid-column: span ${Math.min(n, Math.max(1, num(b.span, 1)))}"` : ''}>${IUI.child(`${key}:g${i}`, b)}</div>`).join('')}</div>`;
  }

  IUI.add('chart', chart, null, ['graph', 'plot', 'bar', 'line', 'pie']);
  IUI.add('table', table, { sort: (s, i) => { if (s.by === i) s.dir = -s.dir; else { s.by = i; s.dir = 1; } } }, ['grid-table', 'datatable']);
  IUI.add('guide', guide, { goto: (s, i) => { s.i = Math.max(0, i); } }, ['tutorial', 'howto', 'stepper']);
  IUI.add('tabs', tabs);
  IUI.add('faq', faq, { toggle: (s, i) => { s.open[i] = !s.open[i]; } }, ['accordion']);
  IUI.add('calc', calc, null, ['calculator', 'simulator']);
  IUI.add('board', board, null, ['kanban']);
  IUI.add('callout', callout, null, ['note', 'alert']);
  IUI.add('proscons', proscons, null, ['pros-cons']);
  IUI.add('schedule', schedule, null, ['planning', 'agenda']);
  IUI.add('blanks', blanks, { bcheck: (s) => { s.checked = true; }, breset: (s) => { s.v = {}; s.checked = false; } }, ['fill', 'cloze']);
  IUI.add('grid', grid, null, ['dashboard', 'layout']);

  // typing and sliders: the state follows without redrawing (the field keeps the focus)
  document.addEventListener('input', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-iui-in]'); const box = el && el.closest('.iui[data-iui]'); if (!box) return;
    const s = IUI.state(box.dataset.iui); if (!s || !s.v) return;
    if (box.classList.contains('iui-calc')) {
      s.v[el.dataset.iuiIn] = num(el.value);
      const out = box.querySelector(`[data-out="${CSS.escape(el.dataset.iuiIn)}"]`); if (out) out.textContent = fmt(el.value) + (el.dataset.unit ? ' ' + el.dataset.unit : '');
      const outs = box.querySelector('.iui-outs'); const d = IUI.spec(box.dataset.iui); if (outs && d) outs.innerHTML = calcOut(d, s);
    } else s.v[el.dataset.iuiIn] = el.value;
  });
})();
