// Files of any kind: attachments land in the workspace (Documents/Fabro/Workspace — the AI has full control
// there), convert_file turns them into data the model can read (PDF/Word/Excel → text, audio/video →
// transcript, PDF → page images), and pdf_find_text / pdf_edit change a PDF while keeping its layout.
const fs = require('fs');
const path = require('path');
const agent = require('./index');
const files = require('./files');

const workspace = () => path.join(files.defaultOut(), 'Workspace');
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|mp4|mov|mkv|wma)$/i;
const DOC = /\.(pdf|docx|xlsx|xls|pptx|odt|ods|odp|rtf|html?|txt|md|csv|json|xml)$/i;
const safe = (s) => String(s || 'file').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100) || 'file';
const unique = (dir, name) => { const ext = path.extname(name), base = path.basename(name, ext); let f = path.join(dir, name); for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${base} (${i})${ext}`); return f; };

// An attachment from the composer: copied into the workspace, with a first look at its content.
async function ingest({ path: src, name, data }) {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(workspace(), day); fs.mkdirSync(dir, { recursive: true });
  const file = unique(dir, safe(name || (src && path.basename(src))));
  if (src && fs.existsSync(src)) fs.copyFileSync(src, file); else fs.writeFileSync(file, Buffer.from(data));
  const size = fs.statSync(file).size;
  const out = { path: file, name: path.basename(file), size, ext: path.extname(file).slice(1).toLowerCase() };
  try {
    if (/\.pdf$/i.test(file)) {
      const r = await require('./layout').renderPdf(fs.readFileSync(file), { maxPages: 1, width: 360 });
      out.pages = r.pages; out.thumb = r.first;
    }
    if (DOC.test(file) && size < 60e6) { const t = String(await require('../rag').extract(file) || ''); out.text = t.slice(0, 12000); out.chars = t.length; }
  } catch (e) { out.note = String(e.message || e).slice(0, 200); }
  out.kind = AUDIO.test(file) ? 'audio' : 'file';
  return out;
}

agent.register({
  name: 'convert_file', category: 'files', risk: 'read', core: true, keywords: ['pdf', 'word', 'docx', 'audio', 'transcribe', 'excel', 'convert'],
  description: 'Turn a file into something you can read: PDF/Word/Excel/PowerPoint/HTML → text (`to: "text"`, page by page for PDFs), audio or video → transcript with timestamps (`to: "transcript"`), PDF → page images saved as PNG (`to: "images"`) to look at the layout. Results are also saved next to the file.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, to: { type: 'string', enum: ['text', 'transcript', 'images'] }, pages: { type: 'array', items: { type: 'integer' }, description: 'For images: which pages (default first 10)' }, lang: { type: 'string', description: 'Transcript language (fr, en…), optional' } }, required: ['path'] },
  summarize: (a) => `${path.basename(a.path || '')} → ${a.to || 'text'}`,
  async run(a, ctx) {
    const f = files.resolvePath(a.path, ctx); await files.access(f, ctx, false);
    if (!fs.existsSync(f)) return { error: `No file at ${f}` };
    const to = a.to || (AUDIO.test(f) ? 'transcript' : 'text');
    const base = f.replace(/\.[^.\\/]+$/, '');
    if (to === 'transcript') {
      const voice = require('../voice');
      if (!voice.status().runtime) { if (!ctx.needDeps || !(await ctx.needDeps('voice'))) return { error: 'Transcription needs the voice runtime (the user declined to install it).' }; }
      const r = await voice.transcribeFile(f, { lang: a.lang });
      const ts = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      const txt = r.segments.map((s) => `[${ts(s.start)}] ${s.text}`).join('\n');
      fs.writeFileSync(base + '.transcript.txt', txt); files.touched(ctx, base + '.transcript.txt', 'created');
      return { content: `Transcript of ${path.basename(f)} (${r.duration} s, ${r.language}) → ${base}.transcript.txt\n\n${txt.slice(0, 20000)}${txt.length > 20000 ? '\n… (read the .txt for the rest)' : ''}` };
    }
    if (to === 'images') {
      if (!/\.pdf$/i.test(f)) return { error: 'Page images are made from PDF files.' };
      const pages = Array.isArray(a.pages) && a.pages.length ? a.pages.map(Number) : null;
      const r = await require('./layout').renderPdf(fs.readFileSync(f), { pages, maxPages: 10, width: 1100, keep: true });
      const dir = base + ' (pages)'; fs.mkdirSync(dir, { recursive: true });
      const saved = r.each.map((d, i) => { const p = path.join(dir, `page-${String(r.list[i]).padStart(3, '0')}.png`); fs.writeFileSync(p, Buffer.from(d.split(',')[1], 'base64')); return p; });
      return { content: `${r.pages} page(s); saved ${saved.length} image(s) in ${dir}:\n${saved.join('\n')}`, image: r.sheet, view: { kind: 'shot', image: r.sheet } };
    }
    const text = String(await require('../rag').extract(f) || '');
    if (!text.trim()) return { content: `No text found in ${path.basename(f)} (a scan or an image?). Look at it with convert_file to: "images".` };
    fs.writeFileSync(base + '.txt', text); files.touched(ctx, base + '.txt', 'created');
    return { content: `${path.basename(f)} → ${base}.txt (${text.length} chars)\n\n${text.slice(0, 24000)}${text.length > 24000 ? '\n… (use read_file on the .txt for the rest)' : ''}` };
  },
});

// Text runs of a PDF with their position (PDF points, origin bottom-left) — pdf.js.
async function textRuns(file) {
  const { getDocument } = await require('../pdfjs').load();
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const c = await page.getTextContent();
    for (const it of c.items) {
      if (!it.str) continue;
      const [a, b, , d, x, y] = it.transform; const size = Math.hypot(a, b) || Math.abs(d);
      out.push({ page: p, str: it.str, x, y, w: it.width, h: it.height || size, size, font: (c.styles[it.fontName] || {}).fontFamily || it.fontName });
    }
  }
  await doc.destroy();
  return out;
}
function findRuns(runs, needle, page) {
  const hits = []; const q = String(needle);
  for (const r of runs) {
    if (page && r.page !== page) continue;
    let i = r.str.indexOf(q);
    while (i >= 0) { const cw = r.w / Math.max(1, r.str.length); hits.push({ page: r.page, x: r.x + cw * i, y: r.y, w: cw * q.length, h: r.size, size: r.size, font: r.font, line: r.str }); i = r.str.indexOf(q, i + 1); }
  }
  return hits;
}

agent.register({
  name: 'pdf_find_text', category: 'files', risk: 'read', core: true, keywords: ['pdf'],
  description: 'Find text in a PDF and get where it is (page, x, y, width, height, font size, in PDF points from the bottom-left), to edit the PDF precisely with pdf_edit.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' }, page: { type: 'integer' } }, required: ['path', 'text'] },
  summarize: (a) => `${path.basename(a.path || '')} · “${a.text}”`,
  async run(a, ctx) {
    const f = files.resolvePath(a.path, ctx); await files.access(f, ctx, false);
    const hits = findRuns(await textRuns(f), a.text, a.page);
    if (!hits.length) return { content: `“${a.text}” not found (the text may be split differently, or the PDF is a scan). Try a shorter part, or look at the page with inspect_document.` };
    return { content: hits.slice(0, 40).map((h) => `page ${h.page} · x ${h.x.toFixed(1)} y ${h.y.toFixed(1)} · w ${h.w.toFixed(1)} h ${h.h.toFixed(1)} · ${h.size.toFixed(1)} pt · ${h.font} · line: “${h.line}”`).join('\n') };
  },
});

// Best effort: blank the old words in the page's text layer too (literal (…) strings in the content stream),
// so copying text from the PDF doesn't give the old value. Hex/CID-encoded text can't be changed this way.
function scrubText(doc, pageIndex, find) {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
  const page = doc.getPage(pageIndex); const ref = page.node.get(PDFName.of('Contents'));
  const refs = ref instanceof PDFArray ? ref.asArray() : [ref]; let n = 0;
  const esc = String(find).replace(/[\\()]/g, (c) => '\\' + c);
  for (const r of refs) {
    const stream = doc.context.lookup(r); if (!(stream instanceof PDFRawStream)) continue;
    let src; try { src = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'); } catch { continue; }
    if (!src.includes(esc)) continue;
    const blank = ' '.repeat(Buffer.from(find, 'latin1').length);
    const out = src.split(esc).join(blank); n += src.split(esc).length - 1;
    doc.context.assign(r, doc.context.flateStream(Buffer.from(out, 'latin1')));
  }
  return n;
}
const hexRgb = (h, rgb) => { const m = String(h || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : null; };
agent.register({
  name: 'pdf_edit', category: 'files', risk: 'write', core: true, keywords: ['pdf', 'edit', 'merge', 'rotate'],
  description: 'Change an existing PDF and keep its layout. Operations (in order): replace_text {find, text, page?, color?, background?} (covers the old words and writes the new ones at the same place and size), add_text {page, x, y, text, size?, color?, font? helvetica|times|courier|bold}, cover {page, x, y, w, h, color?}, add_image {page, x, y, w, h, image (png/jpg path)}, delete_pages {pages}, rotate {pages, degrees}, merge {paths} (append other PDFs). Coordinates in PDF points from the bottom-left (see pdf_find_text). Saves a new file (or `output`) and shows the changed pages: check them.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, output: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } } },
    required: ['path', 'ops'],
  },
  summarize: (a) => `${path.basename(a.path || '')} · ${(a.ops || []).map((o) => o.op).join(', ')}`,
  async run(a, ctx) {
    const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
    const f = files.resolvePath(a.path, ctx); await files.access(f, ctx, false);
    const doc = await PDFDocument.load(fs.readFileSync(f), { ignoreEncryption: true });
    const fonts = {};
    const font = async (name) => { const k = { times: StandardFonts.TimesRoman, courier: StandardFonts.Courier, bold: StandardFonts.HelveticaBold }[String(name || '').toLowerCase()] || StandardFonts.Helvetica; return fonts[k] || (fonts[k] = await doc.embedFont(k)); };
    const pick = (fontName) => /times/i.test(fontName) || (/serif/i.test(fontName) && !/sans/i.test(fontName)) ? 'times' : /courier|mono/i.test(fontName) ? 'courier' : /bold|black|heavy/i.test(fontName) ? 'bold' : 'helvetica';
    let runs = null; const touched = new Set(); const log = [];
    for (const [i, o] of (a.ops || []).entries()) {
      const pg = (n) => { const p = doc.getPage((n || 1) - 1); if (!p) throw new Error(`op ${i + 1}: no page ${n}`); touched.add(n || 1); return p; };
      if (o.op === 'replace_text') {
        runs = runs || await textRuns(f);
        const hits = findRuns(runs, o.find, o.page);
        if (!hits.length) return { error: `op ${i + 1}: “${o.find}” not found${o.page ? ` on page ${o.page}` : ''}. Use pdf_find_text with a shorter part.` };
        const scrubbed = new Set(); let hidden = 0;
        for (const h of hits) { if (!scrubbed.has(h.page)) { scrubbed.add(h.page); try { hidden += scrubText(doc, h.page - 1, o.find); } catch {} } }
        for (const h of hits) {
          const p = pg(h.page); const fnt = await font(o.font || pick(h.font));
          p.drawRectangle({ x: h.x - 0.5, y: h.y - h.size * 0.25, width: h.w + 1, height: h.size * 1.2, color: hexRgb(o.background, rgb) || rgb(1, 1, 1) });
          p.drawText(String(o.text), { x: h.x, y: h.y, size: h.size, font: fnt, color: hexRgb(o.color, rgb) || rgb(0, 0, 0) });
          if (fnt.widthOfTextAtSize(String(o.text), h.size) > h.w * 1.25) log.push(`op ${i + 1}: the new text is wider than the old one on page ${h.page} — check it does not overlap.`);
        }
        log.push(`replaced ${hits.length} occurrence(s) of “${o.find}”${hidden ? '' : ' (drawn over the old words; the old text may still be selectable in the PDF\'s text layer)'}`);
      } else if (o.op === 'add_text') {
        const p = pg(o.page); p.drawText(String(o.text || ''), { x: +o.x, y: +o.y, size: +o.size || 11, font: await font(o.font), color: hexRgb(o.color, rgb) || rgb(0, 0, 0) }); log.push(`text added on page ${o.page}`);
      } else if (o.op === 'cover') {
        const p = pg(o.page); p.drawRectangle({ x: +o.x, y: +o.y, width: +o.w, height: +o.h, color: hexRgb(o.color, rgb) || rgb(1, 1, 1) }); log.push(`area covered on page ${o.page}`);
      } else if (o.op === 'add_image') {
        const ip = files.resolvePath(o.image, ctx); await files.access(ip, ctx, false); const bytes = fs.readFileSync(ip);
        const img = /\.png$/i.test(ip) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const p = pg(o.page); p.drawImage(img, { x: +o.x, y: +o.y, width: +o.w || img.width, height: +o.h || img.height }); log.push(`image added on page ${o.page}`);
      } else if (o.op === 'delete_pages') {
        for (const n of [...(o.pages || [])].map(Number).sort((x, y) => y - x)) doc.removePage(n - 1); log.push(`deleted page(s) ${(o.pages || []).join(', ')}`);
      } else if (o.op === 'rotate') {
        for (const n of o.pages || []) { const p = pg(+n); p.setRotation(degrees(((p.getRotation().angle || 0) + (+o.degrees || 90)) % 360)); } log.push('rotated');
      } else if (o.op === 'merge') {
        for (const m of o.paths || []) { const mp = files.resolvePath(m, ctx); await files.access(mp, ctx, false); const other = await PDFDocument.load(fs.readFileSync(mp), { ignoreEncryption: true }); const pages = await doc.copyPages(other, other.getPageIndices()); pages.forEach((p) => doc.addPage(p)); } log.push(`merged ${(o.paths || []).length} file(s)`);
      } else return { error: `op ${i + 1}: unknown operation “${o.op}”` };
    }
    const outFile = a.output ? files.resolvePath(a.output, ctx) : unique(path.dirname(f), path.basename(f, '.pdf') + ' (modifié).pdf');
    await files.access(outFile, ctx, true);
    const bytes = await doc.save(); fs.writeFileSync(outFile, bytes); files.touched(ctx, outFile, 'created');
    const show = [...touched].filter((n) => n <= doc.getPageCount()).slice(0, 4);
    const r = await require('./layout').renderPdf(bytes, { pages: show.length ? show : [1], maxPages: 4, width: show.length === 1 ? 1000 : 520 }).catch(() => null);
    return { content: `${log.join('\n')}\nSaved ${outFile} (${doc.getPageCount()} pages). Look at the changed page(s) in the picture; fix with another pdf_edit if needed.`, image: r && r.sheet, view: { kind: 'document', path: outFile, format: 'pdf', title: path.basename(outFile), size: bytes.length, shot: r && r.sheet } };
  },
});

module.exports = { ingest, workspace, textRuns };
