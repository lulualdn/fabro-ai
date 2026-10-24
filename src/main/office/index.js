// Fabro Docs / Slides / Calc ⇄ Office (docx, pptx, xlsx) and OpenDocument (odt, odp, ods).
// - export: a Fabro artifact (HTML document, HTML deck, Calc workbook) → any of the 6 formats
// - import: an Office/OpenDocument file → an artifact. Documents and decks keep the original file: the AI edits
//   its text in place (the layout is the original one), and the preview is rebuilt from it.
const fs = require('fs');
const path = require('path');
const { unzip, zip, esc, unesc } = require('./zipio');
const docs = require('./docs');
const slides = require('./slides');
const sheets = require('./sheets');
const calc = require('./calc');

const KIND = { docx: 'document', odt: 'document', pptx: 'slides', odp: 'slides', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet' };
const FORMATS = { document: ['docx', 'odt'], slides: ['pptx', 'odp'], sheet: ['xlsx', 'ods', 'csv'] };

// ───────────── HTML (rendered) → models ─────────────
// Runs inside the page: walks what is visible and returns blocks / positioned boxes with real computed styles.
const WALK = function (mode) {
  const rgb = (c) => { const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); if (!m || (m[4] !== undefined && +m[4] < 0.1)) return null; return '#' + [m[1], m[2], m[3]].map((x) => (+x | 0).toString(16).padStart(2, '0')).join(''); };
  const BLOCK = /^(block|flex|grid|list-item|table|flow-root|table-row|table-cell|table-row-group|table-header-group)$/;
  const hidden = (el) => { const cs = getComputedStyle(el); return cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || el.id === 'fabro-kit-js' || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/.test(el.tagName) || el.classList.contains('fk-credits'); };
  const isBlock = (el) => BLOCK.test(getComputedStyle(el).display) || /^(P|H[1-6]|LI|DIV|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|TABLE|FIGURE|BLOCKQUOTE|PRE)$/.test(el.tagName) && getComputedStyle(el).display !== 'inline';
  const hasBlockChild = (el) => [...el.children].some((c) => !hidden(c) && (isBlock(c) || c.tagName === 'IMG' && c.getBoundingClientRect().width > 60));
  const runsOf = (el) => {
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, ' '); if (!t.trim() && !(out.length && t === ' ')) return; const cs = getComputedStyle(n.parentElement); out.push({ text: t, b: +cs.fontWeight >= 600 || undefined, i: cs.fontStyle === 'italic' || undefined, u: /underline/.test(cs.textDecorationLine) || undefined, s: /line-through/.test(cs.textDecorationLine) || undefined, size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2, color: rgb(cs.color) || undefined, font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || undefined }); return; }
      if (n.nodeType !== 1 || hidden(n)) return;
      if (n.tagName === 'BR') { out.push({ text: '\n' }); return; }
      if (/^(SVG|IMG|I)$/i.test(n.tagName) && !n.textContent.trim()) return;
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); }
    const toUpper = getComputedStyle(el).textTransform === 'uppercase'; if (toUpper) out.forEach((r) => { r.text = r.text.toUpperCase(); });
    return out.filter((r) => r.text);
  };
  const imgData = (el, w, h) => { try { const c = document.createElement('canvas'); const s = Math.min(2, 1600 / Math.max(1, w)); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s)); const g = c.getContext('2d'); if (el.tagName === 'IMG') { const fit = getComputedStyle(el).objectFit; if (fit === 'cover' && el.naturalWidth) { const r = Math.max(c.width / el.naturalWidth, c.height / el.naturalHeight), iw = el.naturalWidth * r, ih = el.naturalHeight * r; g.drawImage(el, (c.width - iw) / 2, (c.height - ih) / 2, iw, ih); } else g.drawImage(el, 0, 0, c.width, c.height); } else g.drawImage(el, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.88); } catch { return null; } };
  const bgImage = async (el, w, h) => { const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/); if (!m) return null; const im = new Image(); im.src = m[1]; try { await im.decode(); } catch { return null; } const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); const g = c.getContext('2d'); const r = Math.max(c.width / im.naturalWidth, c.height / im.naturalHeight), iw = im.naturalWidth * r, ih = im.naturalHeight * r; g.drawImage(im, (c.width - iw) / 2, (c.height - ih) / 2, iw, ih); const ov = getComputedStyle(el, '::before').backgroundImage; if (/gradient/.test(ov)) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, c.width, c.height); } return c.toDataURL('image/jpeg', 0.86); };
  const svgData = async (el, w, h) => { try { const s = new XMLSerializer().serializeToString(el); const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.includes('xmlns=') ? s : s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')); await im.decode(); const c = document.createElement('canvas'); c.width = Math.round(w * 2); c.height = Math.round(h * 2); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/png'); } catch { return null; } };
  const align = (el) => { const a = getComputedStyle(el).textAlign; return a === 'center' ? 'center' : a === 'right' || a === 'end' ? 'right' : a === 'justify' ? 'justify' : null; };

  if (mode === 'doc') {
    return (async () => {
      const blocks = [], body = document.body;
      const shadeOf = (el) => { for (let e = el; e && e !== body && !e.classList.contains('page'); e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c !== '#ffffff') return c; } return null; };
      const visit = async (el) => {
        if (hidden(el)) return;
        const r = el.getBoundingClientRect(), tag = el.tagName;
        if (el.classList.contains('page-break') || getComputedStyle(el).breakBefore === 'page') blocks.push({ t: 'break' });
        if (tag === 'IMG' || tag === 'CANVAS' || (tag.toLowerCase() === 'svg' && r.width > 80)) { if (r.width < 24) return; const d = tag.toLowerCase() === 'svg' ? await svgData(el, r.width, r.height) : imgData(el, r.width, r.height); if (d) blocks.push({ t: 'img', data: d, w: r.width * 0.75, h: r.height * 0.75, align: align(el.parentElement) }); return; }
        if (tag === 'TABLE') { blocks.push({ t: 'table', rows: [...el.rows].map((tr) => [...tr.cells].map((td) => ({ runs: runsOf(td), shade: rgb(getComputedStyle(td).backgroundColor) || rgb(getComputedStyle(tr).backgroundColor), align: align(td) }))), widths: el.rows[0] ? [...el.rows[0].cells].map((c) => c.getBoundingClientRect().width * 0.75) : null }); return; }
        if (getComputedStyle(el).backgroundImage.includes('url(') && r.width > 200 && r.height > 80) { const d = await bgImage(el, r.width, r.height); if (d) blocks.push({ t: 'img', data: d, w: r.width * 0.75, h: Math.min(r.height, 500) * 0.75 }); }
        if (!hasBlockChild(el)) {
          const runs = runsOf(el); if (!runs.length) return;
          const h = /^H([1-6])$/.exec(tag);
          const big = !h && parseFloat(getComputedStyle(el).fontSize) >= 28;
          blocks.push({ t: 'p', style: h ? (h[1] === '1' ? 'title' : 'h' + Math.min(3, +h[1] - 1)) : big ? 'h1' : null, list: tag === 'LI' ? (el.parentElement.tagName === 'OL' ? 'ol' : 'ul') : null, align: align(el), shade: shadeOf(el), runs });
          return;
        }
        for (const c of el.children) await visit(c);
      };
      for (const c of body.children) await visit(c);
      const page = document.body.dataset.page || 'A4', land = document.body.classList.contains('landscape');
      const sizes = { A4: [210, 297], A5: [148, 210], letter: [215.9, 279.4], A3: [297, 420] };
      const [w, h] = sizes[page] || sizes.A4;
      const cs = getComputedStyle(body);
      return { page: { w: land ? h : w, h: land ? w : h, margin: 15 }, font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), color: rgb(cs.color), accent: rgb(cs.getPropertyValue('--accent')) || (cs.getPropertyValue('--accent') || '').trim() || null, blocks };
    })();
  }
  // deck
  return (async () => {
    const list = [...document.querySelectorAll('.slide, .fslide')].filter((s) => !s.parentElement.closest('.slide, .fslide'));
    const out = [];
    for (const s of list) {
      const R = s.getBoundingClientRect(), k = 1280 / R.width; const box = (r) => ({ x: (r.left - R.left) * k, y: (r.top - R.top) * k, w: r.width * k, h: r.height * k });
      const items = [];
      const sbg = await bgImage(s, R.width, R.height); if (sbg) items.push({ t: 'img', x: 0, y: 0, w: 1280, h: R.height * k, data: sbg });
      const visit = async (el) => {
        if (hidden(el)) return;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el), tag = el.tagName;
        if (tag === 'IMG' || tag === 'CANVAS' || (tag.toLowerCase() === 'svg' && r.width > 28)) { const d = tag.toLowerCase() === 'svg' ? await svgData(el, r.width, r.height) : imgData(el, r.width, r.height); if (d) items.push({ t: 'img', ...box(r), data: d }); return; }
        const fill = rgb(cs.backgroundColor), line = parseFloat(cs.borderTopWidth) >= 1 ? rgb(cs.borderTopColor) : null;
        if (cs.backgroundImage.includes('url(')) { const d = await bgImage(el, r.width, r.height); if (d) items.push({ t: 'img', ...box(r), data: d }); }
        else if (fill || line) items.push({ t: 'shape', ...box(r), fill, line, radius: parseFloat(cs.borderTopLeftRadius) * k || 0 });
        if ((tag === 'UL' || tag === 'OL') && [...el.children].every((li) => !hasBlockChild(li))) { items.push({ t: 'text', ...box(r), paras: [...el.children].filter((li) => !hidden(li)).map((li) => ({ align: align(li), list: tag === 'OL' ? 'ol' : 'ul', runs: runsOf(li).map((x) => ({ ...x, size: x.size * k })) })) }); return; }
        if (!hasBlockChild(el)) { const runs = runsOf(el).map((x) => ({ ...x, size: Math.round(x.size * k * 2) / 2 })); if (runs.length) items.push({ t: 'text', ...box(r), w: box(r).w * 1.04 + 4, valign: cs.display.includes('flex') && cs.alignItems === 'center' ? 'middle' : 'top', paras: [{ align: align(el), runs }] }); return; }
        for (const c of el.children) await visit(c);
      };
      for (const c of s.children) await visit(c);
      out.push({ bg: rgb(getComputedStyle(s).backgroundColor) || rgb(getComputedStyle(document.body).backgroundColor) || '#ffffff', items });
    }
    const r0 = list[0] ? list[0].getBoundingClientRect() : { width: 1280, height: 720 };
    return { w: 1280, h: Math.round(720 * (r0.height / r0.width) / (720 / 1280)) || 720, slides: out };
  })();
};
const dataToBuf = (d) => { const m = /^data:([^;]+);base64,(.*)$/.exec(d || ''); return m ? { mime: m[1], data: Buffer.from(m[2], 'base64') } : null; };
async function walkHtml(html, mode) {
  const { BrowserWindow } = require('electron');
  const kit = require('../kit');
  const page = kit.inject(html, { mode: mode === 'doc' ? 'doc' : 'deck', force: true });
  const tmp = path.join(require('os').tmpdir(), `fabro-office-${process.pid}-${Date.now().toString(36)}.html`);
  fs.writeFileSync(tmp, page);
  const w = new BrowserWindow({ show: false, width: mode === 'doc' ? 900 : 1280, height: 900, webPreferences: { sandbox: true, javascript: true, offscreen: false } });
  try {
    await w.loadFile(tmp, { hash: 'fk-static' });
    await w.webContents.executeJavaScript('Promise.race([Promise.resolve(window.fabroKitReady || true), new Promise((r) => setTimeout(r, 8000))])', true).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const m = await w.webContents.executeJavaScript(`(${WALK.toString()})(${JSON.stringify(mode)})`, true);
    const fix = (it) => { if (it.data && typeof it.data === 'string') { const b = dataToBuf(it.data); if (!b) return null; it.data = b.data; it.mime = b.mime; } return it; };
    if (mode === 'doc') m.blocks = m.blocks.map(fix).filter(Boolean);
    else m.slides.forEach((s) => { s.items = s.items.map(fix).filter(Boolean); });
    return m;
  } finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
}

// ───────────── models → HTML (preview of imported files) ─────────────
const kit = () => require('../kit');
const imgSrc = (it) => kit().saveImg(it.data) || `data:${it.mime || 'image/png'};base64,${Buffer.from(it.data).toString('base64')}`;
const runCss = (r, scale = null) => [r.b && 'font-weight:700', r.i && 'font-style:italic', (r.u || r.s) && `text-decoration:${[r.u && 'underline', r.s && 'line-through'].filter(Boolean).join(' ')}`, r.color && `color:${r.color}`, r.size && (scale ? `font-size:${(r.size * 1.3333 / scale * 100).toFixed(3)}cqw` : `font-size:${r.size}pt`), r.font && `font-family:'${String(r.font).replace(/'/g, '')}'`, r.bg && `background:${r.bg}`].filter(Boolean).join(';');
const runsHtml = (runs, scale) => (runs || []).map((r) => (r.br ? '<br>' : `<span${runCss(r, scale) ? ` style="${runCss(r, scale)}"` : ''}>${esc(r.text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;')}</span>`)).join('');
function docToHtml(m, title = '') {
  let body = '', list = null;
  const close = () => { if (list) { body += `</${list}>`; list = null; } };
  for (const b of m.blocks) {
    if (b.t === 'p' && b.list) { if (list !== b.list) { close(); body += `<${b.list}>`; list = b.list; } body += `<li${b.align ? ` style="text-align:${b.align}"` : ''}>${runsHtml(b.runs)}</li>`; continue; }
    close();
    if (b.t === 'break') body += '<div class="pb"></div>';
    else if (b.t === 'img') body += `<p style="text-align:${b.align || 'left'}"><img src="${imgSrc(b)}" style="width:${b.w}pt;max-width:100%;height:auto"></p>`;
    else if (b.t === 'table') body += `<table>${b.rows.map((r) => `<tr>${r.map((c) => `<td style="${c.shade ? `background:${c.shade};` : ''}${c.align ? `text-align:${c.align}` : ''}">${runsHtml(c.runs)}</td>`).join('')}</tr>`).join('')}</table>`;
    else { const tag = b.style === 'title' ? 'h1' : b.style === 'h1' ? 'h2' : b.style === 'h2' ? 'h3' : b.style === 'h3' ? 'h4' : 'p'; body += `<${tag} style="${b.align ? `text-align:${b.align};` : ''}${b.shade ? `background:${b.shade};padding:4pt 6pt;` : ''}">${runsHtml(b.runs) || '&nbsp;'}</${tag}>`; }
  }
  close();
  const { w, h, margin } = m.page;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="fabro-kit" content="none"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
@page{size:${w}mm ${h}mm;margin:${margin}mm}
html{background:#e9e7e2}body{margin:0;padding:24px 12px;font:10.5pt/1.4 Calibri,Carlito,'Segoe UI',sans-serif;color:#1f1e1b}
.sheet{box-sizing:border-box;width:${w}mm;max-width:100%;min-height:${h}mm;margin:0 auto 24px;padding:${margin}mm;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12)}
h1{font-size:26pt;margin:0 0 8pt}h2{font-size:20pt;margin:14pt 0 6pt}h3{font-size:15pt;margin:12pt 0 6pt}h4{font-size:12.5pt;margin:10pt 0 4pt}p{margin:0 0 6pt}
table{border-collapse:collapse;width:100%;margin:6pt 0}td{border:.5pt solid #d0ccc4;padding:3pt 5pt;vertical-align:top}ul,ol{margin:0 0 6pt;padding-left:22pt}
.pb{height:0}
@media print{html{background:#fff}body{padding:0}.sheet{box-shadow:none;width:auto;min-height:0;padding:0;margin:0}.pb{break-after:page}}
</style></head><body><div class="sheet">${body.split('<div class="pb"></div>').join('</div><div class="pb"></div><div class="sheet">')}</div></body></html>`;
}
function deckToHtml(m, title = '') {
  const W = m.w || 1280, H = m.h || 720, pc = (v, t) => `${((v / t) * 100).toFixed(3)}%`;
  const slidesHtml = m.slides.map((s, i) => `<section class="fslide" data-n="${i + 1}" style="background:${s.bg || '#fff'}">${s.items.map((it) => {
    const pos = `left:${pc(it.x, W)};top:${pc(it.y, H)};width:${pc(it.w, W)};height:${pc(it.h, H)}`;
    if (it.t === 'img') return `<img class="fi" src="${imgSrc(it)}" style="${pos}">`;
    if (it.t === 'shape') return `<div class="fs" style="${pos};${it.fill ? `background:${it.fill};` : ''}${it.line ? `border:1px solid ${it.line};` : ''}${it.radius ? `border-radius:${((it.radius / W) * 100).toFixed(3)}cqw` : ''}"></div>`;
    return `<div class="ft ${it.valign || 'top'}" style="${pos};${it.fill ? `background:${it.fill}` : ''}">${(it.paras || []).map((p) => `<p class="${p.list ? 'li ' + p.list : ''}" style="${p.align ? `text-align:${p.align}` : ''}">${runsHtml(p.runs, W) || '&nbsp;'}</p>`).join('')}</div>`;
  }).join('')}</section>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="fabro-kit" content="none"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
@page{size:${W}px ${H}px;margin:0}
html{background:#2a2c31}body{margin:0;padding:24px 12px;font-family:Calibri,Carlito,'Segoe UI',sans-serif;color:#1f1e1b}
.fslide{position:relative;width:min(100%,1100px);aspect-ratio:${W}/${H};margin:0 auto 24px;overflow:hidden;container-type:inline-size;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.fslide>*{position:absolute;box-sizing:border-box;margin:0}.fi{object-fit:cover}
.ft{display:flex;flex-direction:column;line-height:1.15;font-size:${(18 * 1.3333 / W * 100).toFixed(3)}cqw;overflow:visible}.ft.middle{justify-content:center}.ft.bottom{justify-content:flex-end}
.ft p{margin:0 0 .35em}.ft p.li{padding-left:1.1em;position:relative}.ft p.li::before{content:'•';position:absolute;left:0}.ft p.li.ol{counter-increment:n}.ft p.li.ol::before{content:counter(n) '.'}
@media print{html,body{background:none;padding:0}.fslide{width:${W}px;margin:0;box-shadow:none;break-after:page}}
</style></head><body>${slidesHtml}</body></html>`;
}

// ───────────── import ─────────────
function readModel(buf, ext) {
  ext = ext.toLowerCase();
  if (ext === 'docx') return docs.readDocx(buf);
  if (ext === 'odt') return docs.readOdt(buf);
  if (ext === 'pptx') return slides.readPptx(buf);
  if (ext === 'odp') return slides.readOdp(buf);
  if (ext === 'xlsx') return sheets.readXlsx(buf);
  if (ext === 'ods') return sheets.readOds(buf);
  if (ext === 'csv' || ext === 'tsv') return calc.fromCsv(buf.toString('utf8'));
  throw new Error(`Unsupported format: ${ext}`);
}
function previewOf(buf, ext, title) {
  const kind = KIND[ext], m = readModel(buf, ext);
  if (kind === 'sheet') return JSON.stringify(m, null, 1);
  return kind === 'document' ? docToHtml(m, title) : deckToHtml(m, title);
}
const pkgDir = (id) => { const d = path.join(require('electron').app.getPath('userData'), 'office', id); fs.mkdirSync(d, { recursive: true }); return d; };
function storePkg(id, n, ext, buf) { const name = `v${n}.${ext}`; fs.writeFileSync(path.join(pkgDir(id), name), buf); return name; }
function loadPkg(art, v = null) { const ver = art.versions[v ?? art.versions.length - 1]; if (!ver || !ver.pkg || !art.office) return null; try { return fs.readFileSync(path.join(pkgDir(art.id), ver.pkg)); } catch { return null; } }
// Code and text files become code/markdown/html artifacts; documents keep their original file.
const CODE_EXT = { js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', py: 'python', lua: 'lua', luau: 'lua', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', sh: 'bash', ps1: 'powershell', sql: 'sql', css: 'css', json: 'json', xml: 'xml', yml: 'yaml', yaml: 'yaml', kt: 'kotlin', swift: 'swift', toml: 'toml', ini: 'ini' };
function importFile(file, { id, convId = null } = {}) {
  const ext = path.extname(file).slice(1).toLowerCase(), title = path.basename(file).replace(/\.[^.]+$/, '');
  const buf = fs.readFileSync(file);
  id = id || 'art-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const base = { id, convId, title, source: file, versions: [] };
  if (KIND[ext] === 'sheet') return { ...base, type: 'sheet', versions: [{ content: JSON.stringify(readModel(buf, ext)), at: Date.now(), by: 'user' }] };
  if (KIND[ext]) { const pkg = storePkg(id, 1, ext, buf); return { ...base, type: KIND[ext], office: { ext }, versions: [{ content: previewOf(buf, ext, title), pkg, at: Date.now(), by: 'user' }] }; }
  const text = buf.toString('utf8');
  if (/^html?$/.test(ext)) return { ...base, type: 'html', versions: [{ content: text, at: Date.now(), by: 'user' }] };
  if (ext === 'svg') return { ...base, type: 'svg', versions: [{ content: text, at: Date.now(), by: 'user' }] };
  if (/^(md|markdown|txt)$/.test(ext)) return { ...base, type: 'markdown', versions: [{ content: text, at: Date.now(), by: 'user' }] };
  if (CODE_EXT[ext]) return { ...base, type: 'code', lang: CODE_EXT[ext], versions: [{ content: text, at: Date.now(), by: 'user' }] };
  throw new Error(`Can't open .${ext} as an artifact (documents: docx odt pptx odp xlsx ods csv; pages, code, Markdown, SVG).`);
}

// ───────────── export ─────────────
async function exportArtifact(art, fmt, v = null) {
  const ver = art.versions[v ?? art.versions.length - 1], content = ver.content;
  fmt = fmt.toLowerCase();
  // same format as the imported original: the file itself (layout untouched)
  if (art.office && art.office.ext === fmt) { const b = loadPkg(art, v); if (b) return b; }
  if (art.type === 'sheet') { const wb = calc.normalize(content); if (fmt === 'xlsx') return sheets.writeXlsx(wb); if (fmt === 'ods') return sheets.writeOds(wb); if (fmt === 'csv') { const b = new calc.Workbook(wb); return Buffer.from(b.computed(0).map((r) => r.map((x) => (/[",;\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n'), 'utf8'); } }
  if (art.type === 'document' || art.type === 'markdown' || art.type === 'html') {
    if (fmt !== 'docx' && fmt !== 'odt') throw new Error(`A document exports as docx or odt (not ${fmt}).`);
    const model = art.office && loadPkg(art, v) ? readModel(loadPkg(art, v), art.office.ext) : await walkHtml(art.type === 'markdown' ? mdPage(content) : content, 'doc');
    return fmt === 'docx' ? docs.writeDocx(model) : docs.writeOdt(model);
  }
  if (art.type === 'slides') {
    if (fmt !== 'pptx' && fmt !== 'odp') throw new Error(`A deck exports as pptx or odp (not ${fmt}).`);
    const model = art.office && loadPkg(art, v) ? readModel(loadPkg(art, v), art.office.ext) : await walkHtml(/<section|class=["'][^"']*slide/.test(content) ? content : mdDeck(content), 'deck');
    return fmt === 'pptx' ? slides.writePptx(model) : slides.writeOdp(model);
  }
  throw new Error(`Can't export a ${art.type} artifact as ${fmt}.`);
}
function mdPage(md) { let marked; try { marked = require('marked').marked; } catch { marked = { parse: (s) => `<pre>${esc(s)}</pre>` }; } return `<!doctype html><html><head><meta charset="utf-8"></head><body class="doc">${marked.parse(String(md))}</body></html>`; }
function mdDeck(md) { let marked; try { marked = require('marked').marked; } catch { marked = { parse: (s) => `<pre>${esc(s)}</pre>` }; } return `<!doctype html><html><head><meta charset="utf-8"></head><body class="deck">${String(md).split(/\n-{3,}\n/).map((s) => `<section class="slide">${marked.parse(s)}</section>`).join('')}</body></html>`; }

// ───────────── layout-preserving text edits of an imported file ─────────────
// Paragraphs and their text pieces, in reading order, for docx / pptx / odt / odp.
function paraParts(z, ext) {
  if (ext === 'docx') return [{ part: 'word/document.xml', p: /<w:p\b(?:[^>]*[^/])?>[\s\S]*?<\/w:p>/g, t: /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g }];
  if (ext === 'pptx') return Object.keys(z).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]).map((part) => ({ part, p: /<a:p>[\s\S]*?<\/a:p>|<a:p\b[^>]*[^/]>[\s\S]*?<\/a:p>/g, t: /(<a:t>)([^<]*)(<\/a:t>)/g }));
  return [{ part: 'content.xml', p: /<text:(p|h)\b(?:[^>]*[^/])?>[\s\S]*?<\/text:\1>/g, t: /(>)([^<]+)(<)/g, odf: true }];
}
function paragraphs(z, ext) {
  const out = [];
  for (const spec of paraParts(z, ext)) {
    const xml = z[spec.part].toString();
    for (const m of xml.matchAll(spec.p)) {
      const px = m[0], nodes = [];
      if (spec.odf) {
        // text pieces of an ODF paragraph: character data, <text:s/> spaces, tabs, line breaks
        const re = /(<text:s(?:\s+text:c="(\d+)")?\s*\/>)|(<text:tab\s*\/>)|(<text:line-break\s*\/>)|>([^<]+)</g; let t;
        while ((t = re.exec(px))) {
          if (t[1]) nodes.push({ s: t.index, e: t.index + t[1].length, text: ' '.repeat(+(t[2] || 1)), raw: true });
          else if (t[3]) nodes.push({ s: t.index, e: t.index + t[3].length, text: '\t', raw: true });
          else if (t[4]) nodes.push({ s: t.index, e: t.index + t[4].length, text: '\n', raw: true });
          else { nodes.push({ s: t.index + 1, e: t.index + 1 + t[5].length, text: unesc(t[5]) }); re.lastIndex = t.index + 1 + t[5].length; }
        }
      } else for (const t of px.matchAll(spec.t)) nodes.push({ s: t.index + t[1].length, e: t.index + t[1].length + t[2].length, text: unesc(t[2]) });
      out.push({ part: spec.part, start: m.index, end: m.index + px.length, xml: px, nodes, text: nodes.map((n) => n.text).join(''), slide: ext === 'pptx' ? +spec.part.match(/(\d+)\.xml/)[1] : null });
    }
  }
  if (ext === 'odp') { let slide = 0; const xml = z['content.xml'].toString(); const pages = [...xml.matchAll(/<draw:page\b/g)].map((m) => m.index); for (const p of out) { while (slide < pages.length && pages[slide] <= p.start) slide++; p.slide = slide; } }
  return out;
}
function outline(buf, ext) {
  const z = unzip(buf), ps = paragraphs(z, ext).filter((p) => p.text.trim());
  let last = null; const lines = [];
  for (const p of ps) { if (p.slide != null && p.slide !== last) { lines.push(`── slide ${p.slide} ──`); last = p.slide; } lines.push(p.text); }
  return lines.join('\n');
}
// Replace text inside the original file. The formatting of the first touched piece is kept for the new text.
function editPackage(buf, ext, edits) {
  const z = unzip(buf), done = [];
  const order = Object.keys(z);
  for (const [i, ed] of edits.entries()) {
    const old = String(ed.old_text ?? ''), nt = String(ed.new_text ?? '');
    if (!old) return { error: `Edit ${i + 1}: give old_text (exact text from read_artifact).` };
    const ps = paragraphs(z, ext);
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    // within one paragraph
    // a whole paragraph first ("un" must not hit "univers"), then a piece of one
    let hit = ps.find((p) => p.text === old) || ps.find((p) => norm(p.text) === norm(old)) || ps.find((p) => new RegExp(`(^|[^\\p{L}\\p{N}])${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(p.text)) || ps.find((p) => p.text.includes(old));
    let at = hit ? (hit.text === old ? 0 : hit.text.indexOf(old)) : -1, len = old.length;
    if (hit && at < 0) { const j = norm(hit.text) === norm(old) ? 0 : -1; if (j === 0) { at = 0; len = hit.text.length; } }
    if (!hit) { hit = ps.find((p) => norm(p.text).includes(norm(old))); if (hit) { const n = norm(old); const map = []; let s = ''; for (let k = 0; k < hit.text.length; k++) { const ch = hit.text[k]; if (/\s/.test(ch)) { if (s && !s.endsWith(' ')) { s += ' '; map.push(k); } } else { s += ch; map.push(k); } } const lead = s.length - s.trimStart().length; const j = s.trimStart().indexOf(n) + lead; if (j >= lead) { at = map[j]; len = map[j + n.length - 1] - at + 1; } else hit = null; } }
    if (!hit) {
      // across paragraphs (old_text with line breaks)
      const lines = old.split('\n').map(norm).filter(Boolean);
      const k = ps.findIndex((p, idx) => lines.every((l, j) => ps[idx + j] && norm(ps[idx + j].text) === l));
      if (k < 0 || lines.length < 2) return { error: `Edit ${i + 1}: text not found in the document. Copy it exactly from read_artifact.` };
      // whole paragraphs replaced: first one gets the new text, the others are removed
      const group = ps.slice(k, k + lines.length), part = group[0].part;
      let xml = z[part].toString();
      const firstNew = setParaText(group[0], nt, ext);
      for (const g of group.slice(1).reverse()) if (g.part === part) xml = xml.slice(0, g.start) + xml.slice(g.end);
      xml = xml.slice(0, group[0].start) + firstNew + xml.slice(group[0].end);
      z[part] = Buffer.from(xml); done.push(i + 1); continue;
    }
    const whole = at === 0 && len === hit.text.length || norm(hit.text) === norm(old);
    let xml = z[hit.part].toString();
    let rep;
    if (whole && nt === '') rep = ''; // delete the paragraph
    else if (whole && nt.includes('\n')) rep = nt.split('\n').map((line) => setParaText(hit, line, ext)).join(''); // new paragraphs, same style
    else rep = replaceInPara(hit, at, len, nt, ext);
    xml = xml.slice(0, hit.start) + rep + xml.slice(hit.end);
    z[hit.part] = Buffer.from(xml); done.push(i + 1);
  }
  const files = {}; for (const k of order) files[k] = z[k];
  return { buf: zip(files), done };
}
const encT = (t, ext) => (ext === 'odt' || ext === 'odp' ? esc(t).replace(/\t/g, '<text:tab/>').replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`) : esc(t));
function lineBreak(ext, px, node) {
  if (ext === 'docx') return '</w:t><w:br/><w:t xml:space="preserve">';
  if (ext === 'pptx') { const before = px.slice(0, node.s); const r = before.lastIndexOf('<a:r>'); const rpr = (before.slice(r).match(/<a:rPr[\s\S]*?(?:<\/a:rPr>|\/>)/) || [''])[0]; return `</a:t></a:r><a:br>${rpr.replace(/^<a:rPr/, '<a:rPr').replace(/<a:rPr([^>]*)\/>/, '<a:rPr$1/>')}</a:br><a:r>${rpr}<a:t>`; }
  return '<text:line-break/>';
}
function replaceInPara(p, at, len, nt, ext) {
  let px = p.xml, pos = 0; const end = at + len; const edits = [];
  for (const n of p.nodes) {
    const ns = pos, ne = pos + n.text.length; pos = ne;
    if (ne <= at || ns >= end) continue;
    const pre = n.text.slice(0, Math.max(0, at - ns)), post = n.text.slice(Math.max(0, end - ns));
    const isFirst = ns <= at && at < ne || (at === ns);
    const text = (isFirst && !edits.some((e) => e.first) ? pre + nt : pre) + post;
    edits.push({ n, text, first: isFirst && !edits.some((e) => e.first) });
  }
  if (!edits.length) return px;
  for (const { n, text } of edits.reverse()) {
    let enc = text.split('\n').map((t) => encT(t, ext)).join(n.raw ? '' : lineBreak(ext, px, n));
    if (n.raw) enc = (ext === 'odt' || ext === 'odp') ? text.split('\n').map((t) => encT(t, ext)).join('<text:line-break/>') : enc;
    px = px.slice(0, n.s) + enc + px.slice(n.e);
  }
  if (ext === 'docx') px = px.replace(/<w:t>(?=[\s\S])/g, '<w:t xml:space="preserve">');
  return px;
}
function setParaText(p, text, ext) {
  if (!p.nodes.length) return p.xml;
  // first piece gets the text, the other pieces are emptied
  let px = p.xml;
  const real = p.nodes.filter((n) => !n.raw);
  const target = real[0] || p.nodes[0];
  for (const n of [...p.nodes].reverse()) {
    const t = n === target ? text.split('\n').map((x) => encT(x, ext)).join(n.raw ? '<text:line-break/>' : lineBreak(ext, px, n)) : '';
    px = px.slice(0, n.s) + t + px.slice(n.e);
  }
  if (ext === 'docx') px = px.replace(/<w:t>/g, '<w:t xml:space="preserve">');
  return px;
}

module.exports = { KIND, FORMATS, importFile, exportArtifact, previewOf, readModel, docToHtml, deckToHtml, walkHtml, outline, editPackage, storePkg, loadPkg, calc };
