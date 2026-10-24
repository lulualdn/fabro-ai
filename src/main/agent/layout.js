// Designed PDFs and artifacts the AI can look at and fix: create_pdf (HTML + CSS → PDF), inspect_document
// (pages as a picture + layout problems), read_artifact / edit_artifact (line-by-line edits; a PDF made from
// an artifact is regenerated after each edit and shown again).
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const agent = require('./index');
const files = require('./files');
const db = require('../db');

const SIZES = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6], slides: [338.7, 190.5] };
const safeName = (s) => String(s || 'Document').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'Document';

// The page every create_pdf starts from: good defaults the AI can override with its own CSS.
// Pages are built with the Fabro Kit (body.doc: A4 sheets, print sizes, themes, components); a full <html>
// document the AI wrote is used as is (with the kit if it asks for it).
function pageHtml({ title, html, css = '', size = 'A4', landscape = false, margin = 15, theme = 'fabro' }) {
  const kit = require('../kit');
  if (/<html[\s>]/i.test(html)) return kit.inject(html, { mode: /class\s*=\s*["'][^"']*\b(doc|deck)\b/.test(html) ? null : 'doc' });
  const esc = (x) => String(x || '').replace(/</g, '&lt;');
  if (size === 'slides') return kit.inject(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>${css ? `<style>${css}</style>` : ''}</head><body class="deck" data-theme="${esc(theme)}">${html}</body></html>`, { force: true, theme });
  const pageSize = { Letter: 'letter', Legal: 'legal' }[size] || size;
  return kit.inject(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>${css ? `<style>${css}</style>` : ''}</head><body class="doc${landscape ? ' landscape' : ''}" data-theme="${esc(theme)}" data-page="${esc(pageSize)}">${html}</body></html>`, { force: true, theme });
}
function legacyPageHtml({ title, html, css = '', size = 'A4', landscape = false, margin = 15 }) {
  if (/<html[\s>]/i.test(html)) return html;
  const [w, h] = SIZES[size] || SIZES.A4;
  const pw = landscape ? Math.max(w, h) : w, ph = landscape ? Math.min(w, h) : h;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${String(title || '').replace(/</g, '&lt;')}</title><style>
@page { size: ${pw}mm ${ph}mm; margin: ${size === 'slides' ? 0 : margin}mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10.5pt/1.5 "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif; color: #1f1e1b; }
h1, h2, h3 { line-height: 1.2; margin: 0 0 .4em; break-after: avoid; } h1 { font-size: 24pt; } h2 { font-size: 16pt; margin-top: 1em; } h3 { font-size: 12.5pt; }
p { margin: 0 0 .6em; orphans: 3; widows: 3; }
table { width: 100%; border-collapse: collapse; margin: .6em 0; break-inside: auto; } tr { break-inside: avoid; }
th, td { border-bottom: 1px solid #ddd; padding: 5px 7px; text-align: left; vertical-align: top; } th { background: #f2f0ea; }
img, svg { max-width: 100%; }
.page-break { break-after: page; height: 0; }
.no-break { break-inside: avoid; }
${size === 'slides' ? `section, .slide { width: ${pw}mm; height: ${ph}mm; padding: 14mm 18mm; break-after: page; overflow: hidden; position: relative; }` : ''}
${css}
</style></head><body>${html}</body></html>`;
}

// Print HTML to PDF and collect layout problems seen in the page itself.
async function printHtml(html, { landscape = false } = {}) {
  const w = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { sandbox: true, javascript: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await w.webContents.executeJavaScript('Promise.race([Promise.resolve(window.fabroKitReady || (document.fonts ? document.fonts.ready : true)), new Promise((r) => setTimeout(r, 8000))])', true).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const issues = await w.webContents.executeJavaScript(`(() => {
      const out = [], seen = new Set();
      const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
      for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && el.clientWidth > 0) { const n = name(el); if (!seen.has('o' + n)) { seen.add('o' + n); out.push('content cut horizontally in ' + n); } }
        if (el.tagName === 'IMG' && (!el.complete || !el.naturalWidth)) out.push('image not loaded: ' + (el.getAttribute('src') || '').slice(0, 80));
        const fs = parseFloat(cs.fontSize); if (fs && fs < 7.5 && el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) { const n = name(el); if (!seen.has('f' + n)) { seen.add('f' + n); out.push('very small text (' + fs.toFixed(1) + 'px) in ' + n); } }
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 4) out.push('the page is wider than the paper (something has a fixed width that is too large)');
      return out.slice(0, 12);
    })()`, true).catch(() => []);
    const pdf = await w.webContents.printToPDF({ landscape, printBackground: true, preferCSSPageSize: true });
    return { pdf, issues };
  } finally { w.destroy(); }
}

// PDF bytes → page count, a contact sheet image, nearly empty pages (pdf.js in a hidden window).
async function renderPdf(buf, { maxPages = 8, pages = null, width = null, keep = false } = {}) {
  const w = new BrowserWindow({ show: false, width: 800, height: 800, webPreferences: { sandbox: false, contextIsolation: true } });
  try {
    await w.loadFile(path.join(__dirname, '..', 'render', 'pdfview.html'));
    for (let i = 0; i < 50 && !(await w.webContents.executeJavaScript('!!window.ready', true)); i++) await new Promise((r) => setTimeout(r, 100));
    return await w.webContents.executeJavaScript(`renderPdf(${JSON.stringify(Buffer.from(buf).toString('base64'))}, ${maxPages}, ${width || (maxPages > 4 ? 420 : 560)}, ${JSON.stringify(pages || null)}, ${!!keep})`, true);
  } finally { w.destroy(); }
}

function report({ file, pages, blank, issues, artifactId, shown }) {
  const lines = [`PDF: ${file} — ${pages} page(s)${shown < pages ? ` (first ${shown} shown)` : ''}.`];
  if (blank && blank.length) lines.push(`Nearly empty page(s): ${blank.join(', ')}.`);
  for (const i of issues || []) lines.push('Layout problem: ' + i);
  if (!(blank && blank.length) && !(issues || []).length) lines.push('No automatic layout problem found — still look at the picture.');
  if (artifactId) lines.push(`Source: artifact ${artifactId} (read_artifact / edit_artifact to change it; the PDF is regenerated).`);
  lines.push('Look at the pages in the picture and judge them like a designer before telling the user it is done.');
  return lines.join('\n');
}
async function buildPdf(art, ctx) {
  const src = art.pdf || {};
  const html = art.versions[art.versions.length - 1].content;
  const { pdf, issues } = await printHtml(html, { landscape: !!src.landscape });
  fs.mkdirSync(path.dirname(src.file), { recursive: true });
  fs.writeFileSync(src.file, pdf);
  if (ctx) files.touched(ctx, src.file, 'created');
  const r = await renderPdf(pdf).catch(() => null);
  return { pdf, issues, r };
}
const resultOf = (art, { pdf, issues, r }, title) => ({
  content: report({ file: art.pdf.file, pages: r ? r.pages : '?', blank: r && r.blank, issues, artifactId: art.id, shown: r ? r.shown : 0 }),
  image: r && r.sheet,
  view: { kind: 'document', path: art.pdf.file, format: 'pdf', title, artifactId: art.id, size: pdf.length, pages: r ? r.pages : undefined, shot: r && r.sheet },
});

function findArtifact(ref, ctx) {
  if (!ref) return null;
  const byId = db.getArtifact(ref); if (byId) return byId;
  const list = db.listArtifacts();
  const want = String(ref).toLowerCase();
  const pick = (l) => l.find((a) => (a.title || '').toLowerCase() === want) || l.find((a) => (a.title || '').toLowerCase().includes(want));
  const hit = pick(list.filter((a) => ctx && a.convId === ctx.convId)) || pick(list);
  return hit ? db.getArtifact(hit.id) : null;
}

agent.register({
  name: 'create_pdf', category: 'documents', risk: 'write', core: true,
  description: 'Create a designed PDF from HTML using the Fabro Kit (call design_guide first for the matching example: report, cv, letter, invoice, flyer, menu, certificate, slides). Each <section class="page"> is one A4 page; without them the content flows over pages. Returns a picture of the pages and layout problems: fix them with edit_artifact.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title (also the file name)' },
      html: { type: 'string', description: 'Body HTML (or a full <html> document)' },
      css: { type: 'string', description: 'Extra CSS (optional)' },
      page_size: { type: 'string', enum: ['A4', 'A3', 'A5', 'Letter', 'Legal', 'slides'], description: 'Default A4; slides = 16:9, one <section> per slide' },
      landscape: { type: 'boolean' },
      margin_mm: { type: 'number', description: 'Page margin in mm (default 15)' },
      theme: { type: 'string', enum: ['fabro', 'ocean', 'forest', 'sunset', 'midnight', 'luxe', 'mono', 'candy', 'paper', 'tech', 'corporate'], description: 'Fabro Kit theme (colours + fonts). Default fabro.' },
      folder: { type: 'string', description: 'Where to save (default: Documents/Fabro)' },
    },
    required: ['title', 'html'],
  },
  summarize: (a) => `${a.title}.pdf`,
  async run(a, ctx) {
    const dir = a.folder ? files.resolvePath(a.folder, ctx) : files.defaultOut();
    fs.mkdirSync(dir, { recursive: true });
    if (a.folder) await files.access(path.join(dir, 'x'), ctx, true);
    let file = path.join(dir, `${safeName(a.title)}.pdf`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${safeName(a.title)} (${i}).pdf`);
    const size = a.page_size === 'slides' ? 'slides' : (SIZES[a.page_size] ? a.page_size : 'A4');
    const landscape = size === 'slides' ? true : !!a.landscape;
    const baked = await require('../kit').bake(String(a.html || '')).catch(() => ({ html: String(a.html || '') }));
    const html = pageHtml({ title: a.title, html: baked.html, css: a.css || '', size, landscape: size === 'slides' ? false : landscape, margin: Number.isFinite(+a.margin_mm) ? Math.max(0, Math.min(40, +a.margin_mm)) : 15, theme: a.theme || 'fabro' });
    const art = db.saveArtifact({ id: 'art-' + Date.now().toString(36), convId: ctx.convId || null, type: 'html', title: a.title, pdf: { file, landscape: size === 'slides' ? false : landscape }, versions: [{ content: html, at: Date.now(), by: 'ai' }] });
    const out = await buildPdf(art, ctx);
    return resultOf(art, out, a.title);
  },
});

agent.register({
  name: 'inspect_document', category: 'documents', risk: 'read', core: true,
  description: 'Look at a document: a PDF file, or an artifact (id or title). Returns a picture of the pages and layout problems (cut content, empty pages, tiny text). Use it to check your own documents before saying they are done.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'A .pdf file' }, artifact: { type: 'string', description: 'Artifact id or title' }, pages: { type: 'array', items: { type: 'integer' }, description: 'Only these pages (1-based), e.g. to look closely at one page' }, zoom: { type: 'boolean', description: 'Bigger pictures (for small details)' } } },
  summarize: (a) => a.path ? path.basename(a.path) : a.artifact,
  async run(a, ctx) {
    if (a.path) {
      const f = files.resolvePath(a.path, ctx);
      await files.access(f, ctx, false);
      if (!/\.pdf$/i.test(f)) return { error: 'inspect_document reads PDF files; for an artifact pass `artifact`.' };
      const buf = fs.readFileSync(f);
      const one = Array.isArray(a.pages) && a.pages.length;
      const r = await renderPdf(buf, { pages: one ? a.pages.map(Number) : null, maxPages: one ? 4 : 8, width: a.zoom || (one && a.pages.length === 1) ? 1000 : null });
      return { content: report({ file: f, pages: r.pages, blank: r.blank, issues: [], shown: r.shown }) + (one ? `\nShown: page(s) ${r.list.join(', ')}.` : ''), image: r.sheet, view: { kind: 'shot', image: r.sheet, path: f } };
    }
    const art = findArtifact(a.artifact, ctx);
    if (!art) return { error: `No artifact "${a.artifact}". Give its id or exact title.` };
    if (art.pdf && art.pdf.file) { const out = await buildPdf(art, null); return resultOf(art, out, art.title); }
    // other artifacts: print them the way they would be exported
    const docs = require('./documents');
    const content = art.versions[art.versions.length - 1].content;
    const html = art.type === 'html' ? content : art.type === 'slides' ? docs.slidesHtml(content) : docs.docHtml(art.title, content);
    const { pdf, issues } = await printHtml(html, { landscape: art.type === 'slides' });
    const r = await renderPdf(pdf);
    return { content: report({ file: `(artifact “${art.title}”, as exported)`, pages: r.pages, blank: r.blank, issues, artifactId: art.id, shown: r.shown }), image: r.sheet, view: { kind: 'shot', image: r.sheet } };
  },
});

agent.register({
  name: 'read_artifact', category: 'documents', risk: 'read', core: true,
  description: 'Read an artifact (document, page, slides, code) with line numbers, to edit it precisely with edit_artifact.',
  parameters: { type: 'object', properties: { artifact: { type: 'string', description: 'Artifact id or title' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['artifact'] },
  summarize: (a) => a.artifact,
  async run(a, ctx) {
    const art = findArtifact(a.artifact, ctx);
    if (!art) return { error: `No artifact "${a.artifact}".` };
    const lines = art.versions[art.versions.length - 1].content.split('\n');
    const s = Math.max(1, a.start_line | 0 || 1), e = Math.min(lines.length, a.end_line | 0 || s + 399);
    return { content: `Artifact ${art.id} “${art.title}” (${art.type}, version ${art.versions.length}, ${lines.length} lines)${e < lines.length ? ` — lines ${s}-${e}` : ''}\n` + lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(4)}| ${l}`).join('\n') };
  },
});

agent.register({
  name: 'edit_artifact', category: 'documents', risk: 'write', core: true,
  description: 'Change an artifact line by line, without rewriting it: replace exact text, or replace a range of lines (numbers from read_artifact). Saved as a new version; a PDF made from it is regenerated and shown again.',
  parameters: {
    type: 'object',
    properties: {
      artifact: { type: 'string', description: 'Artifact id or title' },
      edits: { type: 'array', description: 'Applied in order', items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } } } },
    },
    required: ['artifact', 'edits'],
  },
  summarize: (a) => `${a.artifact} · ${(a.edits || []).length} edit(s)`,
  async run(a, ctx) {
    const art = findArtifact(a.artifact, ctx);
    if (!art) return { error: `No artifact "${a.artifact}". Use read_artifact with its id or title.` };
    let text = art.versions[art.versions.length - 1].content;
    const done = [];
    for (const [i, ed] of (Array.isArray(a.edits) ? a.edits : []).entries()) {
      const nt = String(ed.new_text ?? '');
      if (ed.old_text != null && ed.old_text !== '') {
        const old = String(ed.old_text).replace(/^\s*\d+\| ?/gm, ''); // line numbers copied from read_artifact
        const at = text.indexOf(old);
        if (at < 0) return { error: `Edit ${i + 1}: text not found. Copy it exactly from read_artifact (without the line numbers).` };
        if (text.indexOf(old, at + 1) >= 0) return { error: `Edit ${i + 1}: this text appears several times; include more surrounding text or use start_line/end_line.` };
        text = text.slice(0, at) + nt + text.slice(at + old.length);
      } else if (ed.start_line) {
        const lines = text.split('\n'); const s = Math.max(1, ed.start_line | 0), e = Math.max(s - 1, Math.min(lines.length, (ed.end_line | 0) || s));
        if (s > lines.length + 1) return { error: `Edit ${i + 1}: line ${s} is past the end (${lines.length} lines).` };
        lines.splice(s - 1, e - s + 1, ...(nt === '' ? [] : nt.split('\n')));
        text = lines.join('\n');
      } else return { error: `Edit ${i + 1}: give old_text, or start_line (and end_line).` };
      done.push(i + 1);
    }
    if (text === art.versions[art.versions.length - 1].content) return { error: 'Nothing changed.' };
    const design = require('./design');
    if (design.visual(art.type) && /data-photo=|data-icon=/.test(text)) text = (await require('../kit').bake(text).catch(() => ({ html: text }))).html;
    art.versions.push({ content: text, at: Date.now(), by: 'ai' });
    db.saveArtifact(art);
    if (ctx.emit) ctx.emit({ type: 'artifact_updated', id: art.id });
    if (art.pdf && art.pdf.file) { const out = await buildPdf(art, ctx); const res = resultOf(art, out, art.title); res.content = `${done.length} edit(s) applied (version ${art.versions.length}).\n` + res.content; return res; }
    if (design.visual(art.type)) return design.checkResult(art, `${done.length} edit(s) applied (version ${art.versions.length}).`); // look again after every change
    return { content: `${done.length} edit(s) applied to “${art.title}” (version ${art.versions.length}).`, view: { kind: 'artifact', title: art.title, artifactId: art.id, type: art.type, v: art.versions.length - 1 } };
  },
});

module.exports = { pageHtml, printHtml, renderPdf, buildPdf, findArtifact };
