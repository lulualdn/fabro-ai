// The Fabro Calc page shown in the artifact viewer: a real spreadsheet grid (formulas, formats, styles),
// editable when the viewer allows it (changes go to the app by postMessage and become a new version).
const fs = require('fs');
const path = require('path');
const ENGINE = fs.readFileSync(path.join(__dirname, 'calc.js'), 'utf8');

function calcPage(content, { title = '', editable = true } = {}) {
  const data = JSON.stringify(String(content || '')).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="fabro-kit" content="none"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title>
<style>
:root{--line:#dcd8cf;--head:#f3f1ec;--sel:#2f6fdb;--fg:#1f1e1b;--bg:#fff;--muted:#7a756b}
@media (prefers-color-scheme:dark){:root{--line:#3a3d44;--head:#25272c;--fg:#e9e6df;--bg:#1b1d21;--muted:#9a958b}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.3 system-ui,'Segoe UI',sans-serif}
.bar{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:5}
.bar .ref{width:64px;font-weight:600;color:var(--muted)}.bar input.fx{flex:1;min-width:160px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
.bar button,.bar select,.bar label{font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.bar input[type=color]{width:20px;height:18px;padding:0;border:0;background:none}
.wrap{overflow:auto;height:calc(100% - 82px)}table{border-collapse:separate;border-spacing:0;table-layout:fixed}
th,td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:24px}
th{background:var(--head);color:var(--muted);font-weight:500;position:sticky;top:0;z-index:2;text-align:center}th.rh{position:sticky;left:0;z-index:3;width:44px}
td.num{text-align:right}td.err{color:#d0342c}td.sel{outline:2px solid var(--sel);outline-offset:-2px}td.inrange{background:rgba(47,111,219,.12)!important}
td input{width:100%;border:0;outline:0;font:inherit;background:transparent;color:inherit;padding:0}
.tabs{display:flex;gap:2px;padding:4px 8px;border-top:1px solid var(--line);background:var(--head);position:fixed;bottom:0;left:0;right:0}
.tabs button{border:0;background:none;padding:4px 10px;border-radius:6px;color:var(--fg);font:inherit;cursor:pointer}.tabs button.on{background:var(--bg);font-weight:600}
</style></head><body>
<div class="bar"><span class="ref" id="ref">A1</span><input class="fx" id="fx" spellcheck="false" placeholder="Valeur ou =formule">
${editable ? `<button data-s="b" title="Gras"><b>B</b></button><button data-s="i" title="Italique"><i>I</i></button>
<label title="Couleur du texte">A<input type="color" data-s="color" value="#1f1e1b"></label><label title="Fond">▧<input type="color" data-s="bg" value="#fff3c4"></label>
<select data-s="fmt" title="Format"><option value="">Format</option><option value="0">0</option><option value="0.00">0,00</option><option value="# ##0.00 €">€</option><option value="0%">%</option><option value="0.0%">0,0 %</option><option value="date">Date</option></select>
<select data-s="align" title="Alignement"><option value="">Align.</option><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select>
<button id="addrow" title="Ajouter une ligne">+ ligne</button><button id="addcol" title="Ajouter une colonne">+ col</button>` : ''}</div>
<div class="wrap" id="wrap"></div><div class="tabs" id="tabs"></div>
<script>${ENGINE}</script>
<script>
const C = window.FabroCalc, EDIT = ${editable ? 'true' : 'false'};
let wb = C.normalize(${data}), si = 0, sel = { r: 0, c: 0 }, anchor = null, editing = null;
const sh = () => wb.sheets[si];
function save() { if (EDIT) parent.postMessage({ fabroCalc: 'save', content: JSON.stringify(wb) }, '*'); }
function cell(r, c) { const row = sh().rows[r] || []; return row[c] ?? ''; }
function setCell(r, c, v) { const rows = sh().rows; while (rows.length <= r) rows.push([]); const row = rows[r]; while (row.length <= c) row.push(''); row[c] = v === '' ? '' : (/^-?\\d+([.,]\\d+)?$/.test(String(v).trim()) ? +String(v).trim().replace(',', '.') : v); }
function range() { if (!anchor) return [sel.r, sel.c, sel.r, sel.c]; return [Math.min(anchor.r, sel.r), Math.min(anchor.c, sel.c), Math.max(anchor.r, sel.r), Math.max(anchor.c, sel.c)]; }
function render() {
  const book = new C.Workbook(wb), vals = book.computed(si), s = sh();
  const nr = Math.max(s.rows.length + 5, 30), nc = Math.max(...s.rows.map((r) => r.length), 0) + 3, NC = Math.max(nc, 8);
  const [r0, c0, r1, c1] = range();
  let h = '<table><colgroup><col style="width:44px">' + Array.from({ length: NC }, (_, c) => '<col style="width:' + (s.cols[c] || 90) + 'px">').join('') + '</colgroup><tr><th class="rh"></th>' + Array.from({ length: NC }, (_, c) => '<th>' + C.colName(c) + '</th>').join('') + '</tr>';
  for (let r = 0; r < nr; r++) {
    h += '<tr><th class="rh">' + (r + 1) + '</th>';
    for (let c = 0; c < NC; c++) {
      const v = vals[r] ? vals[r][c] : '', st = C.styleOf(s, r, c), shown = C.format(v ?? '', st.fmt);
      const css = [st.b && 'font-weight:700', st.i && 'font-style:italic', st.color && 'color:' + st.color, st.bg && 'background:' + st.bg, st.align && 'text-align:' + st.align, st.size && 'font-size:' + st.size + 'pt'].filter(Boolean).join(';');
      const cls = [typeof v === 'number' && 'num', typeof v === 'string' && v[0] === '#' && 'err', r === sel.r && c === sel.c && 'sel', r >= r0 && r <= r1 && c >= c0 && c <= c1 && (r0 !== r1 || c0 !== c1) && 'inrange'].filter(Boolean).join(' ');
      h += '<td data-r="' + r + '" data-c="' + c + '"' + (cls ? ' class="' + cls + '"' : '') + (css ? ' style="' + css + '"' : '') + '>' + String(shown).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td>';
    }
    h += '</tr>';
  }
  const wrap = document.getElementById('wrap'), st = wrap.scrollTop, sl = wrap.scrollLeft;
  wrap.innerHTML = h + '</table>'; wrap.scrollTop = st; wrap.scrollLeft = sl;
  document.getElementById('ref').textContent = C.ref(sel.r, sel.c);
  const fx = document.getElementById('fx'); if (document.activeElement !== fx) fx.value = cell(sel.r, sel.c);
  document.getElementById('tabs').innerHTML = wb.sheets.map((x, i) => '<button data-sheet="' + i + '" class="' + (i === si ? 'on' : '') + '">' + x.name.replace(/</g, '&lt;') + '</button>').join('') + (EDIT ? '<button data-sheet="new">+</button>' : '');
}
function commit(v) { setCell(sel.r, sel.c, v); editing = null; render(); save(); }
document.addEventListener('mousedown', (e) => { const td = e.target.closest('td[data-r]'); if (!td || editing) return; const p = { r: +td.dataset.r, c: +td.dataset.c }; if (e.shiftKey) { anchor = anchor || { ...sel }; sel = p; } else { anchor = null; sel = p; } render(); });
document.addEventListener('dblclick', (e) => { const td = e.target.closest('td[data-r]'); if (!td || !EDIT) return; startEdit(cell(sel.r, sel.c)); });
function startEdit(init) { const td = document.querySelector('td.sel'); if (!td || !EDIT) return; editing = true; td.innerHTML = '<input id="ci">'; const i = document.getElementById('ci'); i.value = init; i.focus(); i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(i.value); sel.r++; render(); } else if (e.key === 'Escape') { editing = null; render(); } else if (e.key === 'Tab') { e.preventDefault(); commit(i.value); sel.c++; render(); } }); i.addEventListener('blur', () => { if (editing) commit(i.value); }); }
document.addEventListener('keydown', (e) => {
  if (editing || e.target.id === 'fx') return;
  const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] }[e.key];
  if (mv) { e.preventDefault(); if (e.shiftKey && e.key.startsWith('Arrow')) anchor = anchor || { ...sel }; else anchor = null; sel = { r: Math.max(0, sel.r + mv[0]), c: Math.max(0, sel.c + mv[1]) }; render(); return; }
  if (!EDIT) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { const [r0, c0, r1, c1] = range(); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) setCell(r, c, ''); render(); save(); return; }
  if (e.key === 'F2') { startEdit(cell(sel.r, sel.c)); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); startEdit(e.key); }
});
const fx = document.getElementById('fx');
fx.addEventListener('keydown', (e) => { if (e.key === 'Enter' && EDIT) { commit(fx.value); fx.blur(); } });
document.getElementById('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-sheet]'); if (!b) return; if (b.dataset.sheet === 'new') { wb.sheets.push({ name: 'Feuille ' + (wb.sheets.length + 1), rows: [[]], cols: [], style: {}, merge: [], freeze: 0 }); si = wb.sheets.length - 1; save(); } else si = +b.dataset.sheet; sel = { r: 0, c: 0 }; anchor = null; render(); });
function styleRange(k, v) { const [r0, c0, r1, c1] = range(); const s = sh(); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const key = C.ref(r, c), cur = s.style[key] || {}; const on = k === 'b' || k === 'i' ? !C.styleOf(s, r0, c0)[k] : v; if (on === '' || on === false) delete cur[k]; else cur[k] = k === 'b' || k === 'i' ? 1 : on; if (Object.keys(cur).length) s.style[key] = cur; else delete s.style[key]; } render(); save(); }
document.querySelectorAll('[data-s]').forEach((el) => { const k = el.dataset.s; if (el.tagName === 'BUTTON') el.addEventListener('click', () => styleRange(k)); else el.addEventListener('change', () => { styleRange(k, el.value); if (el.tagName === 'SELECT') el.value = ''; }); });
const ar = document.getElementById('addrow'); if (ar) ar.onclick = () => { sh().rows.splice(sel.r + 1, 0, []); render(); save(); };
const ac = document.getElementById('addcol'); if (ac) ac.onclick = () => { sh().rows.forEach((r) => { if (r.length > sel.c) r.splice(sel.c + 1, 0, ''); }); render(); save(); };
window.addEventListener('message', (e) => { if (e.data && e.data.fabroCalc === 'load') { wb = C.normalize(e.data.content); render(); } });
render();
</script></body></html>`;
}

module.exports = { calcPage };
