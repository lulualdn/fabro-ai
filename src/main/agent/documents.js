// Document creation: Word, PDF, slides (PDF), spreadsheets (XLSX/CSV), Markdown, HTML.
// Files go to the chosen folder (default ~/Documents/Fabro) and documents also appear in Artifacts.
const fs = require('fs');
const path = require('path');
const agent = require('./index');
const files = require('./files');
const exporter = require('../export');
const db = require('../db');

let marked = null;
function md(src) {
  if (!marked) { try { marked = require('marked').marked; } catch { marked = { parse: (s) => `<pre>${String(s).replace(/</g, '&lt;')}</pre>` }; } }
  return marked.parse(String(src || ''));
}

// Markdown → DOCX blocks (same shape the renderer builds).
function blocksFrom(src) {
  const out = [];
  const inline = (t) => {
    const runs = []; const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<span style="color:\s*(#[0-9a-f]{3,6})[^"]*">([\s\S]*?)<\/span>)/gi;
    let last = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > last) runs.push({ text: t.slice(last, m.index) });
      const x = m[0];
      if (x.startsWith('**')) runs.push({ text: x.slice(2, -2), b: true });
      else if (x.startsWith('*')) runs.push({ text: x.slice(1, -1), i: true });
      else if (x.startsWith('`')) runs.push({ text: x.slice(1, -1), code: true });
      else runs.push({ text: m[3].replace(/<[^>]+>/g, ''), color: m[2] });
      last = m.index + x.length;
    }
    if (last < t.length) runs.push({ text: t.slice(last) });
    return runs.map((r) => ({ ...r, text: r.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') }));
  };
  const lines = String(src).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); out.push({ type: 'code', runs: [{ text: code.join('\n') }] }); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { out.push({ type: 'h' + Math.min(3, h[1].length), runs: inline(h[2]) }); continue; }
    const li = l.match(/^\s*[-*+]\s+(.*)$/); if (li) { out.push({ type: 'li', runs: inline(li[1]) }); continue; }
    const oli = l.match(/^\s*\d+[.)]\s+(.*)$/); if (oli) { out.push({ type: 'oli', runs: inline(oli[1]) }); continue; }
    if (/^\s*\|/.test(l)) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) out.push({ type: 'p', runs: [{ text: l.split('|').slice(1, -1).map((c) => c.trim()).join('  |  ') }] }); continue; }
    if (l.trim()) out.push({ type: 'p', runs: inline(l.trim()) });
  }
  return out;
}

const CSS = 'body{font:15px/1.6 "Segoe UI",system-ui,sans-serif;color:#1f1e1b;max-width:760px;margin:40px auto;padding:0 24px}h1,h2,h3{font-family:Georgia,serif;line-height:1.2}code{background:#f2f0ea;padding:1px 5px;border-radius:4px}pre{background:#f2f0ea;padding:12px;border-radius:8px;white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}';
const docHtml = (title, src) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${CSS}</style>${md(src)}`;
function slidesHtml(src, theme = {}) {
  const st = { bg: '#fbfaf7', fg: '#1f1e1b', accent: '#cf6a3c', ...theme };
  const slides = String(src).split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean);
  return `<!doctype html><meta charset="utf-8"><style>@page{size:13.333in 7.5in;margin:0}body{margin:0;font-family:"Segoe UI",system-ui,sans-serif}.s{width:13.333in;height:7.5in;box-sizing:border-box;padding:.8in 1in;background:${st.bg};color:${st.fg};page-break-after:always;display:flex;flex-direction:column;justify-content:center;font-size:24px}.s h1{font:600 54px/1.1 Georgia,serif;margin:0 0 .3em}.s h2{font:600 40px/1.15 Georgia,serif;margin:0 0 .4em;color:${st.accent}}.s strong{color:${st.accent}}</style>${slides.map((s) => `<section class="s">${md(s)}</section>`).join('')}`;
}

// Minimal XLSX (inline strings + numbers), first row bold.
const x = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const col = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function xlsx(rows, sheet = 'Feuille1') {
  const data = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    const ref = `${col(j)}${i + 1}`;
    if (typeof v === 'number' || (/^-?\d+([.,]\d+)?$/.test(String(v).trim()) && String(v).trim().length < 16)) return `<c r="${ref}"${i === 0 ? ' s="1"' : ''}><v>${String(v).trim().replace(',', '.')}</v></c>`;
    if (String(v).startsWith('=')) return `<c r="${ref}"><f>${x(String(v).slice(1))}</f></c>`;
    return `<c r="${ref}" t="inlineStr"${i === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${x(v ?? '')}</t></is></c>`;
  }).join('')}</row>`).join('');
  const widths = (rows[0] || []).map((_, j) => `<col min="${j + 1}" max="${j + 1}" width="${Math.min(60, Math.max(10, ...rows.map((r) => String(r[j] ?? '').length + 2)))}" customWidth="1"/>`).join('');
  return exporter.zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheet).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${widths ? `<cols>${widths}</cols>` : ''}<sheetData>${data}</sheetData></worksheet>`,
  });
}
const csv = (rows) => rows.map((r) => r.map((v) => /[",;\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')).join(',')).join('\n');

const safeName = (s) => String(s || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Document';

agent.register({
  name: 'create_document', category: 'documents', risk: 'write', core: true,
  description: 'Create a file the user can open: Word (docx), PDF, slides (pdf from Markdown slides separated by ---), spreadsheet (xlsx or csv from rows), Markdown or HTML. Give Markdown in `content` for documents and slides, or `rows` (first row = headers) for spreadsheets.',
  parameters: { type: 'object', properties: {
    format: { type: 'string', enum: ['docx', 'pdf', 'slides', 'xlsx', 'csv', 'md', 'html'] },
    title: { type: 'string' }, content: { type: 'string', description: 'Markdown (or HTML for format html)' },
    rows: { type: 'array', items: { type: 'array', items: {} }, description: 'Spreadsheet rows' },
    folder: { type: 'string', description: 'Optional destination folder (default: Documents/Fabro)' },
  }, required: ['format', 'title'] },
  summarize: (a) => `${a.title}.${a.format === 'slides' ? 'pdf' : a.format}`,
  async run(a, ctx) {
    const dir = a.folder ? files.resolvePath(a.folder) : files.defaultOut();
    fs.mkdirSync(dir, { recursive: true });
    if (a.folder) await files.access(path.join(dir, 'x'), ctx, true);
    const ext = a.format === 'slides' ? 'pdf' : a.format;
    let file = path.join(dir, `${safeName(a.title)}.${ext}`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${safeName(a.title)} (${i}).${ext}`);
    let data;
    if (a.format === 'docx') data = exporter.toDocx(blocksFrom(a.content));
    else if (a.format === 'pdf') data = await exporter.toPdf(docHtml(a.title, a.content));
    else if (a.format === 'slides') data = await exporter.toPdf(slidesHtml(a.content), { landscape: true });
    else if (a.format === 'xlsx') data = xlsx(a.rows || [], a.title);
    else if (a.format === 'csv') data = Buffer.from('﻿' + csv(a.rows || []), 'utf8');
    else if (a.format === 'html') data = Buffer.from(/<html|<!doctype/i.test(a.content || '') ? a.content : docHtml(a.title, a.content), 'utf8');
    else data = Buffer.from(String(a.content || ''), 'utf8');
    fs.writeFileSync(file, data);
    files.touched(ctx, file, 'created');
    // Documents and slides also land in Artifacts so they can be edited and re-exported.
    let artifactId = null;
    if (['docx', 'pdf', 'md', 'slides'].includes(a.format) && a.content) {
      const art = db.saveArtifact({ id: 'art-' + Date.now().toString(36), convId: ctx.convId || null, type: a.format === 'slides' ? 'slides' : 'markdown', title: a.title, versions: [{ content: a.content, at: Date.now(), by: 'ai' }] });
      artifactId = art.id;
    }
    return { content: `Created ${file}`, view: { kind: 'document', path: file, format: a.format, title: a.title, artifactId, size: data.length } };
  },
});

module.exports = { blocksFrom, xlsx, csv, slidesHtml, docHtml };
