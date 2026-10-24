// Artifact exports: PDF (any artifact, via Chromium print), DOCX (documents), raw files.
// Also serves artifact HTML previews on the fabro-art:// protocol (sandboxed iframe).
const { BrowserWindow, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');

// ───────────────────────────── preview protocol ─────────────────────────────
const previews = new Map(); // token → html (unsaved previews from code cards)
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'fabro-art', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);
}
// The HTML a fabro-art:// URL shows (also sent to Fabro Anywhere, which can't load the protocol).
function artHtml(url) {
  const u = new URL(url);
  let html = '';
  if (u.hostname === 'preview') html = previews.get(u.pathname.slice(1)) || '';
  else {
    const a = db.getArtifact(u.hostname);
    const v = Math.max(0, Math.min((a && a.versions.length - 1) || 0, +(u.searchParams.get('v') ?? (a ? a.versions.length - 1 : 0))));
    html = a ? a.versions[v].content : '<p>Not found</p>';
    if (a && a.type === 'sheet') return require('./office/calcpage').calcPage(html, { title: a.title, editable: u.searchParams.get('ro') !== '1' && v === a.versions.length - 1 });
    if (a && u.searchParams.get('edit') === '1' && /^(html|document|slides)$/.test(a.type)) {
      // visual editing: numbered elements + the editor script (see office/editor.js)
      const ed = require('./office/editor');
      html = ed.annotate(html);
      const tag = `<script>${ed.EDITOR_JS}</script>`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tag}</body>`) : html + tag;
    }
    if (a && a.type === 'svg') html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style>${html}`;
  }
  if (!/<html|<!doctype/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  // the Fabro Kit (design system) for pages that use it; documents are A4 sheets, HTML slides a 16:9 deck
  const a = u.hostname !== 'preview' ? db.getArtifact(u.hostname) : null;
  const mode = a && a.type === 'document' ? 'doc' : a && a.type === 'slides' ? 'deck' : null;
  try { html = require('./kit').inject(html, { mode, force: !!mode }); } catch {}
  return html;
}
function handleProtocol() {
  protocol.handle('fabro-art', (req) => {
    const html = artHtml(req.url);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self' file:" } });
  });
}
function setPreview(html) { const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); previews.set(token, String(html)); if (previews.size > 30) previews.delete(previews.keys().next().value); return `fabro-art://preview/${token}`; }

// ───────────────────────────── PDF ─────────────────────────────
async function toPdf(html, { landscape = false } = {}) {
  const kit = require('./kit');
  const usesKit = kit.usesKit(html) || /id=["']fabro-kit["']/.test(html);
  if (usesKit) html = kit.inject(html); else html = kit.resolveImgs(html);
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: true, offscreen: false } });
  try {
    const tmp = require('path').join(require('os').tmpdir(), `fabro-pdf-${process.pid}-${Date.now().toString(36)}.html`);
    fs.writeFileSync(tmp, html);
    try { await w.loadFile(tmp, { hash: 'fk-static' }); } finally { fs.rm(tmp, { force: true }, () => {}); }
    await w.webContents.executeJavaScript('Promise.race([Promise.resolve(window.fabroKitReady || (document.fonts ? document.fonts.ready : true)), new Promise((r) => setTimeout(r, 8000))])', true).catch(() => {});
    await new Promise((r) => setTimeout(r, 300)); // fonts / images
    // Fabro Kit pages carry their own page size (A4 sheets, 16:9 slides): let CSS decide
    if (usesKit) return await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    return await w.webContents.printToPDF({ landscape, printBackground: true, margins: { marginType: landscape ? 'none' : 'default' }, pageSize: landscape ? { width: 13.333, height: 7.5 } : 'A4' });
  } finally { w.destroy(); }
}

// ───────────────────────────── DOCX (minimal, from blocks) ─────────────────────────────
// blocks: [{ type: 'h1'|'h2'|'h3'|'p'|'li'|'oli'|'code', runs: [{ text, b, i, color, code }] }]
const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
function runXml(r) {
  const props = [r.b && '<w:b/>', r.i && '<w:i/>', r.color && `<w:color w:val="${r.color.replace('#', '').slice(0, 6)}"/>`, r.code && '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'].filter(Boolean).join('');
  return String(r.text).split('\n').map((t, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`).join('');
}
function docxXml(blocks) {
  const body = blocks.map((b) => {
    const style = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', li: 'ListBullet', oli: 'ListNumber', code: 'Code' }[b.type];
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${(b.runs || []).map(runXml).join('')}</w:p>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F0EA"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

// Minimal ZIP writer (deflate) — enough for OOXML.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content); const comp = zlib.deflateRawSync(data); const nameB = Buffer.from(name); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameB, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); const n = Object.keys(files).length; end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function toDocx(blocks) {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
    'word/document.xml': docxXml(blocks), 'word/styles.xml': STYLES, 'word/numbering.xml': NUMBERING,
  });
}

// ───────────────────────────── save dialog ─────────────────────────────
const FILTERS = { pdf: ['PDF', 'pdf'], docx: ['Word', 'docx'], md: ['Markdown', 'md'], html: ['HTML', 'html'], svg: ['SVG', 'svg'], txt: ['Text', 'txt'] };
async function save(win, { name, format, content, html, blocks, landscape, ext }) {
  const f = FILTERS[format] || [String(ext || format).toUpperCase(), ext || format];
  const safe = String(name || 'Fabro').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Fabro';
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safe}.${f[1]}`, filters: [{ name: f[0], extensions: [f[1]] }] });
  if (r.canceled || !r.filePath) return null;
  let data;
  if (format === 'pdf') data = await toPdf(html, { landscape });
  else if (format === 'docx') data = toDocx(blocks || []);
  else if (format === 'html') data = Buffer.from(require('./kit').inject(String(content ?? '')), 'utf8'); // a standalone page: the kit goes inside
  else data = Buffer.from(String(content ?? ''), 'utf8');
  fs.writeFileSync(r.filePath, data);
  return r.filePath;
}

module.exports = { registerScheme, handleProtocol, artHtml, setPreview, save, toDocx, zip, toPdf };
