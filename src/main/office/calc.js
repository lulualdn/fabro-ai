// Fabro Calc: the spreadsheet model and its formula engine. Runs in the main process (export, reading values
// for the AI) and inside the Calc page (this file is inlined there), so no dependencies.
// Workbook JSON: { sheets: [{ name, rows: [[value|"=formula", …], …], cols: [widthPx…], style: { "A1"|"A"|"1": {b,i,color,bg,align,fmt,size} }, merge: ["A1:C1"], freeze: 1 }] }
(function (root) {
  const colName = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colNum = (s) => { let n = 0; for (const c of s.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
  const parseRef = (r) => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(r); return m ? { c: colNum(m[1]), r: +m[2] - 1 } : null; };
  const ref = (r, c) => colName(c) + (r + 1);

  function normalize(wb) {
    if (typeof wb === 'string') { try { wb = JSON.parse(wb); } catch { wb = fromCsv(wb); } }
    if (Array.isArray(wb)) wb = { sheets: [{ name: 'Feuille 1', rows: wb }] };
    if (!wb || !Array.isArray(wb.sheets) || !wb.sheets.length) wb = { sheets: [{ name: 'Feuille 1', rows: [[]] }] };
    wb.sheets = wb.sheets.map((s, i) => ({ name: String(s.name || `Feuille ${i + 1}`), rows: Array.isArray(s.rows) ? s.rows.map((r) => (Array.isArray(r) ? r : [r])) : [], cols: Array.isArray(s.cols) ? s.cols : [], style: s.style && typeof s.style === 'object' ? s.style : {}, merge: Array.isArray(s.merge) ? s.merge : [], freeze: s.freeze | 0 }));
    return wb;
  }
  function fromCsv(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter((l, i, a) => l || i < a.length - 1);
    const sep = (lines[0] || '').split(';').length > (lines[0] || '').split(',').length ? ';' : (lines[0] || '').includes('\t') ? '\t' : ',';
    const rows = lines.map((l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((v) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? +v : v)); });
    return { sheets: [{ name: 'Feuille 1', rows }] };
  }

  // ── formulas ──
  function tokenize(src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      const rest = src.slice(i);
      if ((m = /^(?:'([^']+)'|([A-Za-z_][\w. ]*?))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/.exec(rest))) { t.push({ k: 'ref', sheet: m[1] || m[2], v: m[3] }); i += m[0].length; continue; }
      if ((m = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?(?![\w(])/.exec(rest))) { t.push({ k: 'ref', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?%?/.exec(rest))) { t.push({ k: 'num', v: m[0].endsWith('%') ? parseFloat(m[0]) / 100 : parseFloat(m[0]) }); i += m[0].length; continue; }
      if (c === '"') { let s = ''; i++; while (i < src.length) { if (src[i] === '"' && src[i + 1] === '"') { s += '"'; i += 2; } else if (src[i] === '"') { i++; break; } else s += src[i++]; } t.push({ k: 'str', v: s }); continue; }
      if ((m = /^[A-Za-z_][\w.]*(?=\s*\()/.exec(rest))) { t.push({ k: 'fn', v: m[0].toUpperCase() }); i += m[0].length; continue; }
      if ((m = /^(TRUE|FALSE|VRAI|FAUX)\b/i.exec(rest))) { t.push({ k: 'num', v: /^(TRUE|VRAI)$/i.test(m[0]) ? 1 : 0, bool: true }); i += m[0].length; continue; }
      if ((m = /^(<=|>=|<>|[-+*/^&=<>(),;:])/.exec(rest))) { t.push({ k: 'op', v: m[0] === ';' ? ',' : m[0] }); i += m[0].length; continue; }
      throw new Error('#NAME?');
    }
    return t;
  }
  const FR = { SOMME: 'SUM', MOYENNE: 'AVERAGE', NB: 'COUNT', NBVAL: 'COUNTA', SI: 'IF', ARRONDI: 'ROUND', SOMME_SI: 'SUMIF', 'SOMME.SI': 'SUMIF', NB_SI: 'COUNTIF', 'NB.SI': 'COUNTIF', RECHERCHEV: 'VLOOKUP', SIERREUR: 'IFERROR', ET: 'AND', OU: 'OR', NON: 'NOT', AUJOURDHUI: 'TODAY', MAINTENANT: 'NOW', CONCATENER: 'CONCATENATE', NBCAR: 'LEN', MAJUSCULE: 'UPPER', MINUSCULE: 'LOWER', 'MOYENNE.SI': 'AVERAGEIF', PRODUIT: 'PRODUCT' };
  const flat = (a) => (Array.isArray(a) ? a.flat(Infinity) : [a]);
  const nums = (args) => args.flatMap(flat).filter((x) => typeof x === 'number');
  const err = (e) => typeof e === 'string' && e[0] === '#';
  const crit = (c) => { const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(c)); const op = m[1] || '=', v = m[2] === '' ? '' : isNaN(+m[2]) ? m[2].toLowerCase() : +m[2]; return (x) => { const xv = typeof x === 'string' ? x.toLowerCase() : x; return op === '=' ? xv == v : op === '<>' ? xv != v : op === '<' ? xv < v : op === '>' ? xv > v : op === '<=' ? xv <= v : xv >= v; }; };
  const FN = {
    SUM: (a) => nums(a).reduce((s, x) => s + x, 0), PRODUCT: (a) => nums(a).reduce((s, x) => s * x, 1),
    AVERAGE: (a) => { const n = nums(a); if (!n.length) throw new Error('#DIV/0!'); return n.reduce((s, x) => s + x, 0) / n.length; },
    MIN: (a) => (nums(a).length ? Math.min(...nums(a)) : 0), MAX: (a) => (nums(a).length ? Math.max(...nums(a)) : 0),
    COUNT: (a) => nums(a).length, COUNTA: (a) => a.flatMap(flat).filter((x) => x !== '' && x != null).length,
    IF: (a) => (truthy(a[0]) ? a[1] : a[2] ?? 0), IFERROR: (a) => (err(a[0]) ? a[1] : a[0]),
    AND: (a) => (a.flatMap(flat).every(truthy) ? 1 : 0), OR: (a) => (a.flatMap(flat).some(truthy) ? 1 : 0), NOT: (a) => (truthy(a[0]) ? 0 : 1),
    ROUND: (a) => { const p = 10 ** (a[1] | 0); return Math.round(num(a[0]) * p) / p; }, ABS: (a) => Math.abs(num(a[0])), SQRT: (a) => Math.sqrt(num(a[0])), POWER: (a) => num(a[0]) ** num(a[1]), MOD: (a) => num(a[0]) % num(a[1]), INT: (a) => Math.floor(num(a[0])),
    CONCAT: (a) => a.flatMap(flat).join(''), CONCATENATE: (a) => a.flatMap(flat).join(''), LEN: (a) => String(a[0] ?? '').length, UPPER: (a) => String(a[0] ?? '').toUpperCase(), LOWER: (a) => String(a[0] ?? '').toLowerCase(),
    TODAY: () => Math.floor(Date.now() / 864e5) + 25569, NOW: () => Date.now() / 864e5 + 25569,
    SUMIF: (a) => { const r = flat(a[0]), s = a[2] ? flat(a[2]) : r, f = crit(a[1]); return r.reduce((t, x, i) => t + (f(x) && typeof s[i] === 'number' ? s[i] : 0), 0); },
    AVERAGEIF: (a) => { const r = flat(a[0]), s = a[2] ? flat(a[2]) : r, f = crit(a[1]); const v = r.map((x, i) => (f(x) ? s[i] : null)).filter((x) => typeof x === 'number'); if (!v.length) throw new Error('#DIV/0!'); return v.reduce((t, x) => t + x, 0) / v.length; },
    COUNTIF: (a) => flat(a[0]).filter(crit(a[1])).length,
    VLOOKUP: (a) => { const tbl = a[1], k = a[0], c = (a[2] | 0) - 1, exact = a[3] === 0 || a[3] === false; for (const row of tbl) if (exact ? row[0] == k : row[0] == k || (typeof k === 'string' && String(row[0]).toLowerCase() === k.toLowerCase())) return row[c]; throw new Error('#N/A'); },
  };
  const truthy = (x) => (typeof x === 'string' ? x !== '' && x.toUpperCase() !== 'FALSE' : !!x);
  const num = (x) => { if (err(x)) throw new Error(x); if (x === '' || x == null) return 0; const n = typeof x === 'number' ? x : +String(x).replace(',', '.'); if (isNaN(n)) throw new Error('#VALUE!'); return n; };

  function Workbook(wb) {
    this.wb = normalize(wb); this.cache = new Map();
  }
  Workbook.prototype.sheet = function (name) { if (name == null) return this.wb.sheets[0]; const n = String(name).toLowerCase(); return this.wb.sheets.find((s) => s.name.toLowerCase() === n) || null; };
  Workbook.prototype.raw = function (sh, r, c) { const row = sh.rows[r]; return row ? row[c] ?? '' : ''; };
  Workbook.prototype.value = function (sh, r, c, stack = new Set()) {
    const key = `${sh.name}!${r},${c}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const raw = this.raw(sh, r, c);
    let v;
    if (typeof raw === 'string' && raw[0] === '=' && raw.length > 1) {
      if (stack.has(key)) return '#REF!';
      stack.add(key);
      try { v = this.evalFormula(raw.slice(1), sh, stack); if (Array.isArray(v)) v = flat(v)[0] ?? 0; if (typeof v === 'number' && !isFinite(v)) v = '#DIV/0!'; } catch (e) { v = /^#/.test(e.message) ? e.message : '#ERROR'; }
      stack.delete(key);
    } else if (typeof raw === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(raw)) v = +raw.replace(',', '.');
    else v = raw;
    this.cache.set(key, v); return v;
  };
  Workbook.prototype.range = function (sh, txt, stack) {
    const [a, b] = txt.split(':'), p = parseRef(a), q = b ? parseRef(b) : p;
    if (!p || !q) throw new Error('#REF!');
    if (!b) return this.value(sh, p.r, p.c, stack);
    const out = [];
    for (let r = Math.min(p.r, q.r); r <= Math.max(p.r, q.r); r++) { const row = []; for (let c = Math.min(p.c, q.c); c <= Math.max(p.c, q.c); c++) row.push(this.value(sh, r, c, stack)); out.push(row); }
    return out;
  };
  Workbook.prototype.evalFormula = function (src, sh, stack) {
    const t = tokenize(src); let i = 0;
    const peek = () => t[i], next = () => t[i++], isOp = (v) => t[i] && t[i].k === 'op' && t[i].v === v;
    const self = this;
    function cmp() { let l = cat(); while (t[i] && t[i].k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t[i].v)) { const o = next().v, r = cat(); const a = typeof l === 'string' ? l.toLowerCase() : l, b = typeof r === 'string' ? r.toLowerCase() : r; l = (o === '=' ? a == b : o === '<>' ? a != b : o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : a >= b) ? 1 : 0; } return l; }
    function cat() { let l = add(); while (isOp('&')) { next(); l = String(scal(l)) + String(scal(add())); } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const o = next().v, r = mul(); l = o === '+' ? num(scal(l)) + num(scal(r)) : num(scal(l)) - num(scal(r)); } return l; }
    function mul() { let l = pow(); while (isOp('*') || isOp('/')) { const o = next().v, r = pow(); if (o === '/' && num(scal(r)) === 0) throw new Error('#DIV/0!'); l = o === '*' ? num(scal(l)) * num(scal(r)) : num(scal(l)) / num(scal(r)); } return l; }
    function pow() { let l = un(); while (isOp('^')) { next(); l = num(scal(l)) ** num(scal(un())); } return l; }
    function un() { if (isOp('-')) { next(); return -num(scal(un())); } if (isOp('+')) { next(); return un(); } return prim(); }
    const scal = (v) => (Array.isArray(v) ? flat(v)[0] ?? 0 : v);
    function prim() {
      const k = next(); if (!k) throw new Error('#ERROR');
      if (k.k === 'num' || k.k === 'str') return k.v;
      if (k.k === 'ref') { const s = k.sheet ? self.sheet(k.sheet) : sh; if (!s) throw new Error('#REF!'); return self.range(s, k.v, stack); }
      if (k.k === 'op' && k.v === '(') { const v = cmp(); if (!isOp(')')) throw new Error('#ERROR'); next(); return v; }
      if (k.k === 'fn') {
        const name = FR[k.v] || k.v; next(); const args = [];
        if (!isOp(')')) { do { if (isOp(',')) { next(); args.push(''); continue; } args.push(cmp()); } while (isOp(',') && next()); }
        if (!isOp(')')) throw new Error('#ERROR'); next();
        const f = FN[name]; if (!f) throw new Error('#NAME?');
        const flatErr = args.flatMap(flat).find(err); if (flatErr && name !== 'IFERROR') throw new Error(flatErr);
        return f(args);
      }
      throw new Error('#ERROR');
    }
    const v = cmp(); if (i < t.length) throw new Error('#ERROR'); return v;
  };
  Workbook.prototype.computed = function (sheetIdx = 0) {
    this.cache.clear(); const sh = this.wb.sheets[sheetIdx]; const w = Math.max(0, ...sh.rows.map((r) => r.length));
    return sh.rows.map((row, r) => Array.from({ length: w }, (_, c) => this.value(sh, r, c)));
  };
  // style of a cell: column, then row, then cell
  function styleOf(sh, r, c) { const s = sh.style || {}; return Object.assign({}, s[colName(c)], s[String(r + 1)], s[ref(r, c)]); }
  function format(v, fmt) {
    if (typeof v !== 'number' || !fmt) return v === '' || v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10).replace('.', ',') : String(v);
    if (/^d|date|jj|yyyy|aaaa/i.test(fmt)) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toLocaleDateString('fr-FR'); }
    const pct = /%/.test(fmt), dec = ((fmt.match(/[.,](0+)/) || [])[1] || '').length, thousands = /#[ ,. ]##/.test(fmt) || /# ?##0/.test(fmt);
    let n = pct ? v * 100 : v; let s = Math.abs(n).toFixed(dec);
    let [ip, fp] = s.split('.'); if (thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    s = (n < 0 ? '-' : '') + ip + (fp ? ',' + fp : '');
    const pre = (fmt.match(/^[^#0]*/) || [''])[0].replace(/"/g, ''), post = (fmt.match(/[^#0.,%\s]*\s*%?\s*[^#0.,]*$/) || [''])[0].replace(/"/g, '');
    return (pre + s + (pct ? '%' : '') + post.replace('%', '')).trim();
  }
  const api = { Workbook, normalize, fromCsv, colName, colNum, parseRef, ref, styleOf, format };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FabroCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
