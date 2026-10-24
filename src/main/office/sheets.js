// Fabro Calc ⇄ Excel (.xlsx) and OpenDocument Spreadsheet (.ods). Model: see calc.js.
const { zip, unzip, esc, unesc, attr, elements, first } = require('./zipio');
const { odfStyles, odfStyleTable, odfPackage, ODF_NS, hex } = require('./docs');
const calc = require('./calc');

const isFormula = (v) => typeof v === 'string' && v[0] === '=' && v.length > 1;
const pxToChars = (px) => Math.max(4, Math.round(((+px || 90) - 5) / 7 * 100) / 100);
const charsToPx = (w) => Math.round(+w * 7 + 5);

// ───────────── XLSX writer ─────────────
function excelFmt(f) { return String(f || '').replace(/ /g, ' '); }
function writeXlsx(wbIn) {
  const book = new calc.Workbook(wbIn), wb = book.wb;
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], numFmts = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfKey = new Map();
  const xfOf = (st) => {
    if (!st || !Object.keys(st).length) return 0;
    const k = JSON.stringify(st); if (xfKey.has(k)) return xfKey.get(k);
    const font = `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}<sz val="${st.size || 11}"/>${st.color ? `<color rgb="FF${hex(st.color)}"/>` : ''}<name val="${esc(st.font || 'Calibri')}"/></font>`;
    let fi = fonts.indexOf(font); if (fi < 0) { fonts.push(font); fi = fonts.length - 1; }
    let fl = 0; if (st.bg) { const f = `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex(st.bg)}"/><bgColor indexed="64"/></patternFill></fill>`; fl = fills.indexOf(f); if (fl < 0) { fills.push(f); fl = fills.length - 1; } }
    let nf = 0; if (st.fmt) { nf = 164 + numFmts.indexOf(st.fmt); if (nf < 164) { numFmts.push(st.fmt); nf = 163 + numFmts.length; } }
    xfs.push(`<xf numFmtId="${nf}" fontId="${fi}" fillId="${fl}" borderId="0" xfId="0"${fi ? ' applyFont="1"' : ''}${fl ? ' applyFill="1"' : ''}${nf ? ' applyNumberFormat="1"' : ''}${st.align ? ` applyAlignment="1"><alignment horizontal="${st.align}"/></xf>` : '/>'}`);
    xfKey.set(k, xfs.length - 1); return xfs.length - 1;
  };
  const sheets = wb.sheets.map((sh, si) => {
    const vals = book.computed(si);
    const w = Math.max(1, ...sh.rows.map((r) => r.length));
    const rows = sh.rows.map((row, r) => `<row r="${r + 1}">${Array.from({ length: w }, (_, c) => {
      const raw = row[c], st = calc.styleOf(sh, r, c), s = xfOf(st), ref = calc.ref(r, c);
      if ((raw === '' || raw == null) && !s) return '';
      const sa = s ? ` s="${s}"` : '';
      if (isFormula(raw)) { const v = vals[r][c]; return typeof v === 'number' ? `<c r="${ref}"${sa}><f>${esc(raw.slice(1))}</f><v>${v}</v></c>` : `<c r="${ref}"${sa} t="str"><f>${esc(raw.slice(1))}</f><v>${esc(v)}</v></c>`; }
      const v = vals[r][c];
      if (typeof v === 'number') return `<c r="${ref}"${sa}><v>${v}</v></c>`;
      if (raw === '' || raw == null) return `<c r="${ref}"${sa}/>`;
      return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = sh.cols.length ? `<cols>${sh.cols.map((px, i) => (px ? `<col min="${i + 1}" max="${i + 1}" width="${pxToChars(px)}" customWidth="1"/>` : '')).join('')}</cols>` : '';
    const pane = sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pane}${cols}<sheetData>${rows}</sheetData>${sh.merge.length ? `<mergeCells count="${sh.merge.length}">${sh.merge.map((m) => `<mergeCell ref="${esc(m)}"/>`).join('')}</mergeCells>` : ''}</worksheet>`;
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(excelFmt(f))}"/>`).join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wb.sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
  };
  sheets.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = x; });
  return zip(files);
}

// ───────────── XLSX reader ─────────────
const BUILTIN_FMT = { 9: '0%', 10: '0.00%', 2: '0.00', 4: '# ##0.00', 3: '# ##0', 14: 'date', 22: 'date' };
function readXlsx(buf) {
  const z = unzip(buf), s = (f) => (z[f] ? z[f].toString() : '');
  const shared = elements(s('xl/sharedStrings.xml'), 'si').map((si) => [...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unesc(m[1])).join(''));
  const st = s('xl/styles.xml');
  const fmts = {}; for (const f of elements(st, 'numFmt')) fmts[attr(f, 'numFmtId')] = attr(f, 'formatCode');
  const fonts = elements(first(st, 'fonts') || '', 'font').map((f) => ({ b: /<b\/>|<b val="1"/.test(f) || undefined, i: /<i\/>/.test(f) || undefined, color: (f.match(/<color rgb="(?:FF)?([0-9A-Fa-f]{6})"/) || [])[1] ? '#' + f.match(/<color rgb="(?:FF)?([0-9A-Fa-f]{6})"/)[1] : undefined, size: +(f.match(/<sz val="([\d.]+)"/) || [])[1] || undefined }));
  const fills = elements(first(st, 'fills') || '', 'fill').map((f) => { const m = f.match(/patternType="solid"[\s\S]*?<fgColor rgb="(?:FF)?([0-9A-Fa-f]{6})"/); return m ? '#' + m[1] : null; });
  const xfs = elements(first(st, 'cellXfs') || '', 'xf').map((x) => { const font = fonts[+attr(x, 'fontId') || 0] || {}, nf = +attr(x, 'numFmtId') || 0; const o = { ...font, bg: fills[+attr(x, 'fillId') || 0] || undefined, fmt: fmts[nf] || BUILTIN_FMT[nf] || undefined, align: attr(first(x, 'alignment') || '', 'horizontal') || undefined }; if (o.size === 11) delete o.size; for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; });
  const rels = {}; for (const r of elements(s('xl/_rels/workbook.xml.rels'), 'Relationship')) rels[attr(r, 'Id')] = attr(r, 'Target');
  const sheets = elements(s('xl/workbook.xml'), 'sheet').map((sh) => {
    const target = rels[attr(sh, 'r:id')] || ''; const xml = s(target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
    const rows = [], style = {};
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = calc.colNum(c[1]), row = +c[2] - 1, at = c[3], inner = c[4] || '';
      const t = (at.match(/t="(\w+)"/) || [])[1], si = +(at.match(/s="(\d+)"/) || [])[1] || 0;
      const f = (inner.match(/<f[^>]*>([^<]*)<\/f>/) || [])[1], v = (inner.match(/<v>([^<]*)<\/v>/) || [])[1];
      let val = '';
      if (f) val = '=' + unesc(f);
      else if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unesc(m[1])).join('');
      else if (t === 'str' || t === 'e') val = unesc(v || '');
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null) val = +v;
      (rows[row] ||= [])[col] = val;
      if (si && xfs[si] && Object.keys(xfs[si]).length) style[calc.ref(row, col)] = xfs[si];
    }
    for (let i = 0; i < rows.length; i++) { rows[i] = rows[i] || []; for (let j = 0; j < rows[i].length; j++) if (rows[i][j] === undefined) rows[i][j] = ''; }
    const cols = []; for (const cl of elements(xml, 'col')) { const w = +attr(cl, 'width'); for (let i = +attr(cl, 'min'); i <= Math.min(+attr(cl, 'max'), 60); i++) cols[i - 1] = charsToPx(w); }
    for (let i = 0; i < cols.length; i++) if (!cols[i]) cols[i] = 90;
    const pane = xml.match(/<pane[^>]*ySplit="(\d+)"[^>]*state="frozen"/);
    return { name: attr(sh, 'name'), rows, cols, style, merge: elements(xml, 'mergeCell').map((m) => attr(m, 'ref')), freeze: pane ? +pane[1] : 0 };
  });
  return { sheets };
}

// ───────────── ODS (formulas use [.A1] references) ─────────────
const toOdfFormula = (f) => 'of:=' + f.slice(1).replace(/(?:'([^']+)'|([A-Za-z_][\w.]*))!(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?|(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w(])/g, (m, qs, s, a1, b1, a2, b2) => (a1 ? `[$'${qs || s}'.${a1}${b1 ? `:.${b1}` : ''}]` : `[.${a2}${b2 ? `:.${b2}` : ''}]`)).replace(/,/g, ';');
const fromOdfFormula = (f) => '=' + String(f).replace(/^(of:)?=/, '').replace(/\[\$?'?([^'.\]]*?)'?\.(\$?[A-Z]{1,3}\$?\d+)(?::\.?(\$?[A-Z]{1,3}\$?\d+))?\]/g, (m, sh, a, b) => `${sh ? `'${sh}'!` : ''}${a}${b ? ':' + b : ''}`).replace(/;/g, ',');
function writeOds(wbIn) {
  const book = new calc.Workbook(wbIn), wb = book.wb, S = odfStyles();
  const tables = wb.sheets.map((sh, si) => {
    const vals = book.computed(si), w = Math.max(1, ...sh.rows.map((r) => r.length));
    const cols = Array.from({ length: w }, (_, i) => `<table:table-column table:style-name="${S.get('table-column', { col: `style:column-width="${(((sh.cols[i] || 90) / 96) * 2.54).toFixed(3)}cm"` })}"/>`).join('');
    const rows = sh.rows.map((row, r) => `<table:table-row>${Array.from({ length: w }, (_, c) => {
      const raw = row[c], v = vals[r][c], st = calc.styleOf(sh, r, c);
      const tp = [st.b && 'fo:font-weight="bold"', st.i && 'fo:font-style="italic"', st.color && `fo:color="${st.color}"`, st.size && `fo:font-size="${st.size}pt"`].filter(Boolean).join(' ');
      const cp = [st.bg && `fo:background-color="${st.bg}"`].filter(Boolean).join(' '), pp = st.align ? `fo:text-align="${st.align === 'right' ? 'end' : st.align === 'center' ? 'center' : 'start'}"` : '';
      const sn = tp || cp || pp ? ` table:style-name="${S.get('table-cell', { textp: tp || undefined, cell: cp || undefined, para: pp || undefined })}"` : '';
      const f = isFormula(raw) ? ` table:formula="${esc(toOdfFormula(raw))}"` : '';
      const shown = esc(calc.format(v, st.fmt));
      if (typeof v === 'number') return `<table:table-cell${sn}${f} office:value-type="${/%/.test(st.fmt || '') ? 'percentage' : 'float'}" office:value="${v}"><text:p>${shown}</text:p></table:table-cell>`;
      if (v === '' || v == null) return `<table:table-cell${sn}/>`;
      return `<table:table-cell${sn}${f} office:value-type="string"><text:p>${esc(v)}</text:p></table:table-cell>`;
    }).join('')}</table:table-row>`).join('');
    return `<table:table table:name="${esc(sh.name)}">${cols}${rows}</table:table>`;
  }).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:automatic-styles>${S.xml()}</office:automatic-styles><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODF_NS}><office:styles><style:default-style style:family="table-cell"><style:text-properties fo:font-family="Liberation Sans" fo:font-size="10pt"/></style:default-style></office:styles></office:document-styles>`;
  return odfPackage('application/vnd.oasis.opendocument.spreadsheet', content, styles);
}
function readOds(buf) {
  const z = unzip(buf), content = (z['content.xml'] || '').toString(), style = odfStyleTable([(z['styles.xml'] || '').toString(), content]);
  const sheets = elements(content, 'table:table').map((tb) => {
    const rows = [], st = {}, cols = [];
    for (const c of elements(tb, 'table:table-column')) { const n = Math.min(60, +(attr(c, 'table:number-columns-repeated') || 1)); const s = (content.match(new RegExp(`style:name="${attr(c, 'table:style-name')}"[\\s\\S]*?style:column-width="([\\d.]+)(cm|in|mm)"`)) || []); const w = s[1] ? +s[1] * ({ cm: 37.795, in: 96, mm: 3.7795 }[s[2]]) : 90; for (let i = 0; i < n && cols.length < 60; i++) cols.push(Math.round(w)); }
    let r = 0;
    for (const row of elements(tb, 'table:table-row')) {
      const rep = Math.min(+(attr(row, 'table:number-rows-repeated') || 1), 1);
      const out = []; let c = 0;
      for (const cell of row.match(/<table:(?:covered-)?table-cell\b[^>]*\/>|<table:(?:covered-)?table-cell\b[\s\S]*?<\/table:(?:covered-)?table-cell>/g) || []) {
        const tag = cell.match(/^<[^>]+>/)[0], n = Math.min(+(attr(tag, 'table:number-columns-repeated') || 1), 200);
        const f = attr(tag, 'table:formula'), vt = attr(tag, 'office:value-type'), vv = attr(tag, 'office:value');
        const text = (cell.match(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g) || []).map((p) => unesc(p.replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (m, k) => ' '.repeat(+(k || 1))).replace(/<[^>]+>/g, ''))).join('\n');
        const val = f ? fromOdfFormula(f) : vt === 'float' || vt === 'percentage' || vt === 'currency' ? +vv : vt === 'boolean' ? (attr(tag, 'office:boolean-value') === 'true' ? 'TRUE' : 'FALSE') : text;
        const s = style(attr(tag, 'table:style-name'));
        for (let k = 0; k < n; k++) { out[c] = val; const o = {}; if (s.b) o.b = 1; if (s.i) o.i = 1; if (s.color && s.color !== '#000000') o.color = s.color; if (s.shade && s.shade !== 'transparent') o.bg = s.shade; if (vt === 'percentage') o.fmt = '0%'; if (Object.keys(o).length && val !== '') st[calc.ref(r, c)] = o; c++; }
      }
      while (out.length && (out[out.length - 1] === '' || out[out.length - 1] == null)) out.pop();
      for (let k = 0; k < rep; k++) rows[r++] = out.map((x) => x ?? '');
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return { name: attr(tb, 'table:name'), rows, cols: cols.slice(0, Math.max(...rows.map((x) => x.length), 1)), style: st, merge: [], freeze: 0 };
  });
  return { sheets };
}

module.exports = { writeXlsx, readXlsx, writeOds, readOds, toOdfFormula, fromOdfFormula };
