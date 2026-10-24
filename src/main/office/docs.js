// Fabro Docs ⇄ Word (.docx) and OpenDocument Text (.odt).
// Shared document model:
//   { page: { w, h, margin } (mm), blocks: [
//       { t: 'p', style: 'title'|'h1'|'h2'|'h3'|null, list: 'ul'|'ol'|null, align, shade, runs: [{ text, b, i, u, s, size (pt), color, font, br }] },
//       { t: 'table', widths: [pt…], rows: [[{ shade, runs, align, b }]] },
//       { t: 'img', data: Buffer, mime, w, h (pt), align },
//       { t: 'break' } ] }
const { zip, unzip, esc, unesc, attr, elements, first } = require('./zipio');

const hex = (c) => (c ? String(c).replace('#', '').toUpperCase().slice(0, 6) : null);
const MM = 56.6929; // twips per mm
const SIZES = { title: 26, h1: 20, h2: 15, h3: 12.5 };

// ───────────── DOCX writer ─────────────
function docxRun(r) {
  if (r.br) return '<w:r><w:br/></w:r>';
  const pr = [r.font && `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`, r.b && '<w:b/>', r.i && '<w:i/>', r.s && '<w:strike/>', r.u && '<w:u w:val="single"/>', r.color && `<w:color w:val="${hex(r.color)}"/>`, r.size && `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`, r.bg && `<w:shd w:val="clear" w:color="auto" w:fill="${hex(r.bg)}"/>`].filter(Boolean).join('');
  return String(r.text ?? '').split('\n').map((t, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');
}
function docxPara(p) {
  const style = p.style === 'title' ? 'Title' : /^h[1-3]$/.test(p.style || '') ? `Heading${p.style[1]}` : null;
  const pr = [style && `<w:pStyle w:val="${style}"/>`, p.list && `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${p.list === 'ol' ? 2 : 1}"/></w:numPr>`, p.shade && `<w:shd w:val="clear" w:color="auto" w:fill="${hex(p.shade)}"/>`, p.align && p.align !== 'left' && `<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/>`].filter(Boolean).join('');
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${(p.runs || []).map(docxRun).join('')}</w:p>`;
}
function writeDocx(model) {
  const media = {}; let rid = 10, imgN = 0;
  const rels = [];
  const body = model.blocks.map((b) => {
    if (b.t === 'break') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (b.t === 'img') {
      const ext = /png/.test(b.mime) ? 'png' : 'jpeg', name = `image${++imgN}.${ext}`, id = `rId${++rid}`;
      media[`word/media/${name}`] = b.data; rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const cx = Math.round(b.w * 12700), cy = Math.round(b.h * 12700);
      return `<w:p>${b.align && b.align !== 'left' ? `<w:pPr><w:jc w:val="${b.align}"/></w:pPr>` : ''}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgN}" name="Picture ${imgN}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imgN}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
    if (b.t === 'table') {
      const total = Math.round((model.page.w - 2 * model.page.margin) * MM), n = Math.max(1, ...b.rows.map((r) => r.length));
      const ws = b.widths && b.widths.length === n ? b.widths.map((w) => Math.round(w * 20)) : Array(n).fill(Math.round(total / n));
      return `<w:tbl><w:tblPr><w:tblW w:w="${ws.reduce((a, x) => a + x, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:color="D0CCC4"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${b.rows.map((r) => `<w:tr>${Array.from({ length: n }, (_, j) => r[j] || { runs: [] }).map((c, j) => `<w:tc><w:tcPr><w:tcW w:w="${ws[j]}" w:type="dxa"/>${c.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(c.shade)}"/>` : ''}</w:tcPr>${docxPara({ runs: (c.runs || []).map((x) => ({ ...x, b: x.b || c.b })), align: c.align })}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl><w:p/>`;
    }
    return docxPara(b);
  }).join('');
  const W = Math.round(model.page.w * MM), H = Math.round(model.page.h * MM), M = Math.round(model.page.margin * MM);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="${W}" w:h="${H}"${W > H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${M}" w:right="${M}" w:bottom="${M}" w:left="${M}" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const font = model.font || 'Calibri', accent = hex(model.accent) || '1F1E1B';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/><w:sz w:val="21"/><w:color w:val="${hex(model.color) || '1F1E1B'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${['title', 'h1', 'h2', 'h3'].map((k) => `<w:style w:type="paragraph" w:styleId="${k === 'title' ? 'Title' : 'Heading' + k[1]}"><w:name w:val="${k === 'title' ? 'Title' : 'heading ' + k[1]}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${k === 'h3' ? 160 : 240}" w:after="120"/>${k === 'title' ? '' : `<w:outlineLvl w:val="${+k[1] - 1}"/>`}</w:pPr><w:rPr>${model.headFont ? `<w:rFonts w:ascii="${esc(model.headFont)}" w:hAnsi="${esc(model.headFont)}"/>` : ''}<w:b/><w:color w:val="${k === 'h2' ? accent : hex(model.color) || '1F1E1B'}"/><w:sz w:val="${SIZES[k] * 2}"/></w:rPr></w:style>`).join('')}
</w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.join('')}</Relationships>`,
    'word/document.xml': doc, 'word/styles.xml': styles, 'word/numbering.xml': numbering, ...media,
  });
}

// ───────────── DOCX reader ─────────────
function readDocx(buf) {
  const z = unzip(buf), doc = (z['word/document.xml'] || '').toString();
  const rels = {}; for (const r of elements((z['word/_rels/document.xml.rels'] || '').toString(), 'Relationship')) rels[attr(r, 'Id')] = attr(r, 'Target');
  const styles = (z['word/styles.xml'] || '').toString(), styleMap = {};
  for (const s of elements(styles, 'w:style')) { const id = attr(s, 'w:styleId'), name = (attr(first(s, 'w:name') || '', 'w:val') || '').toLowerCase(); const lvl = attr(first(s, 'w:outlineLvl') || '', 'w:val'); styleMap[id] = name === 'title' || /^titre$/.test(name) ? 'title' : /heading\s*([1-3])|titre\s*([1-3])/.test(name) ? 'h' + (name.match(/([1-3])/) || [])[1] : lvl != null && +lvl < 3 ? 'h' + (+lvl + 1) : null; }
  const runProps = (rpr) => !rpr ? {} : { b: /<w:b(\s|\/>)/.test(rpr) && !/<w:b w:val="(0|false)"/.test(rpr), i: /<w:i(\s|\/>)/.test(rpr) && !/<w:i w:val="(0|false)"/.test(rpr), u: /<w:u\s+w:val="(?!none)/.test(rpr), s: /<w:strike(\s|\/>)/.test(rpr), color: (rpr.match(/<w:color w:val="([0-9A-Fa-f]{6})"/) || [])[1] && '#' + rpr.match(/<w:color w:val="([0-9A-Fa-f]{6})"/)[1], size: (rpr.match(/<w:sz w:val="(\d+)"/) || [])[1] / 2 || undefined, font: (rpr.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/) || [])[1], bg: (rpr.match(/<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1] && '#' + rpr.match(/<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/)[1] };
  const para = (p) => {
    const ppr = first(p, 'w:pPr') || '';
    const style = styleMap[(ppr.match(/<w:pStyle w:val="([^"]+)"/) || [])[1]] || null;
    const runs = [];
    for (const r of elements(p, 'w:r')) {
      const props = runProps(first(r, 'w:rPr'));
      const blip = r.match(/r:embed="([^"]+)"/);
      if (blip && rels[blip[1]]) { const ext = r.match(/<wp:extent cx="(\d+)" cy="(\d+)"/); const f = 'word/' + rels[blip[1]].replace(/^\//, ''); if (z[f]) runs.push({ img: { data: z[f], mime: /png$/i.test(f) ? 'image/png' : 'image/jpeg', w: ext ? +ext[1] / 12700 : 200, h: ext ? +ext[2] / 12700 : 150 } }); continue; }
      let text = ''; for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) text += m[1] != null ? unesc(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n';
      if (/<w:br w:type="page"/.test(r)) runs.push({ pagebreak: true });
      if (text) runs.push({ text, ...props });
    }
    const jc = (ppr.match(/<w:jc w:val="(\w+)"/) || [])[1];
    return { t: 'p', style, list: /<w:numPr>/.test(ppr) ? 'ul' : null, align: jc === 'both' ? 'justify' : jc === 'center' || jc === 'right' ? jc : null, shade: (ppr.match(/<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1] ? '#' + ppr.match(/<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/)[1] : null, runs };
  };
  const blocks = [];
  const bodyXml = (doc.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || '';
  for (const m of bodyXml.matchAll(/<w:(p|tbl)(?=[\s>])[\s\S]*?<\/w:\1>|<w:p\/>/g)) {
    // tables can contain paragraphs: take top-level ones only
    if (m[1] === 'tbl') {
      const tbl = elements(bodyXml.slice(m.index), 'w:tbl')[0];
      const rows = elements(tbl, 'w:tr').map((tr) => elements(tr, 'w:tc').map((tc) => { const ps = elements(tc, 'w:p').map(para); const runs = ps.flatMap((p, i) => (i ? [{ br: true }, ...p.runs] : p.runs)).filter((r) => !r.img); const sh = (tc.match(/<w:tcPr>[\s\S]*?<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1]; return { runs, shade: sh ? '#' + sh : null, align: ps[0] && ps[0].align }; }));
      blocks.push({ t: 'table', rows });
      continue;
    }
    if (m[0] === '<w:p/>') { blocks.push({ t: 'p', runs: [] }); continue; }
    const p = para(m[0]);
    for (const r of p.runs.filter((x) => x.img)) blocks.push({ t: 'img', ...r.img, align: p.align });
    if (p.runs.some((r) => r.pagebreak)) blocks.push({ t: 'break' });
    p.runs = p.runs.filter((r) => !r.img && !r.pagebreak);
    blocks.push(p);
  }
  const sect = (doc.match(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/) || []), mar = doc.match(/<w:pgMar w:top="(\d+)"[^>]*w:left="(\d+)"/);
  return { page: { w: sect[1] ? +sect[1] / MM : 210, h: sect[2] ? +sect[2] / MM : 297, margin: mar ? +mar[2] / MM : 20 }, blocks };
}
// ───────────── ODT writer ─────────────
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.3"';
function odfStyles() {
  const map = new Map(), list = [];
  const get = (family, props) => { const key = family + JSON.stringify(props); if (!map.has(key)) { const name = `${family[0].toUpperCase()}${map.size + 1}`; map.set(key, name); list.push({ name, family, props }); } return map.get(key); };
  const xml = () => list.map(({ name, family, props }) => `<style:style style:name="${name}" style:family="${family}"${props.parent ? ` style:parent-style-name="${props.parent}"` : ''}>${props.para ? `<style:paragraph-properties ${props.para}/>` : ''}${props.textp ? `<style:text-properties ${props.textp}/>` : ''}${props.cell ? `<style:table-cell-properties ${props.cell}/>` : ''}${props.col ? `<style:table-column-properties ${props.col}/>` : ''}${props.graphic ? `<style:graphic-properties ${props.graphic}/>` : ''}${props.drawPage ? `<style:drawing-page-properties ${props.drawPage}/>` : ''}</style:style>`).join('');
  return { get, xml };
}
const odfText = (r) => [r.b && 'fo:font-weight="bold"', r.i && 'fo:font-style="italic"', r.u && 'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"', r.s && 'style:text-line-through-style="solid"', r.color && `fo:color="${r.color}"`, r.size && `fo:font-size="${r.size}pt"`, r.font && `style:font-name="${esc(r.font)}" fo:font-family="${esc(r.font)}"`, r.bg && `fo:background-color="${r.bg}"`].filter(Boolean).join(' ');
const odfSpan = (S, r) => {
  if (r.br) return '<text:line-break/>';
  const t = String(r.text ?? '').split('\n').map((x) => esc(x).replace(/\t/g, '<text:tab/>').replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)).join('<text:line-break/>');
  const tp = odfText(r); return tp ? `<text:span text:style-name="${S.get('text', { textp: tp })}">${t}</text:span>` : t;
};
function writeOdt(model) {
  const S = odfStyles(), pics = {}; let n = 0;
  const para = (p, extra = '') => {
    const lvl = /^h([1-3])$/.exec(p.style || ''), base = p.style === 'title' ? 'Title' : lvl ? `Heading_20_${lvl[1]}` : 'Standard';
    const props = [p.align && p.align !== 'left' && `fo:text-align="${p.align === 'right' ? 'end' : p.align}"`, p.shade && `fo:background-color="${p.shade}"`, extra].filter(Boolean).join(' ');
    const st = props ? S.get('paragraph', { parent: base, para: props }) : base;
    const inner = (p.runs || []).map((r) => odfSpan(S, r)).join('');
    return lvl ? `<text:h text:style-name="${st}" text:outline-level="${lvl[1]}">${inner}</text:h>` : `<text:p text:style-name="${st}">${inner}</text:p>`;
  };
  let out = '', listOpen = null;
  const closeList = () => { if (listOpen) { out += '</text:list>'; listOpen = null; } };
  for (const b of model.blocks) {
    if (b.t === 'p' && b.list) { if (listOpen !== b.list) { closeList(); out += `<text:list text:style-name="${b.list === 'ol' ? 'LNum' : 'LBul'}">`; listOpen = b.list; } out += `<text:list-item>${para({ ...b, list: null })}</text:list-item>`; continue; }
    closeList();
    if (b.t === 'break') out += `<text:p text:style-name="${S.get('paragraph', { parent: 'Standard', para: 'fo:break-before="page"' })}"/>`;
    else if (b.t === 'img') { const name = `Pictures/img${++n}.${/png/.test(b.mime) ? 'png' : 'jpg'}`; pics[name] = b.data; out += `<text:p text:style-name="${b.align === 'center' ? S.get('paragraph', { parent: 'Standard', para: 'fo:text-align="center"' }) : 'Standard'}"><draw:frame draw:name="img${n}" text:anchor-type="as-char" svg:width="${(b.w / 72 * 2.54).toFixed(3)}cm" svg:height="${(b.h / 72 * 2.54).toFixed(3)}cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`; }
    else if (b.t === 'table') {
      const ncol = Math.max(1, ...b.rows.map((r) => r.length));
      out += `<table:table table:name="Table${++n}"><table:table-column table:number-columns-repeated="${ncol}"/>${b.rows.map((r) => `<table:table-row>${Array.from({ length: ncol }, (_, j) => r[j] || { runs: [] }).map((c) => `<table:table-cell table:style-name="${S.get('table-cell', { cell: `fo:padding="0.1cm" fo:border="0.5pt solid #d0ccc4"${c.shade ? ` fo:background-color="${c.shade}"` : ''}` })}" office:value-type="string">${para({ runs: (c.runs || []).map((x) => ({ ...x, b: x.b || c.b })), align: c.align })}</table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`;
    } else out += para(b);
  }
  closeList();
  const font = model.font || 'Liberation Sans';
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:automatic-styles>${S.xml()}</office:automatic-styles><office:body><office:text>${out}</office:text></office:body></office:document-content>`;
  const W = model.page.w, H = model.page.h, M = model.page.margin;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODF_NS}><office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.21cm" fo:line-height="115%"/><style:text-properties style:font-name="${esc(font)}" fo:font-family="${esc(font)}" fo:font-size="10.5pt" fo:color="${model.color || '#1f1e1b'}"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
${['Title', 'Heading_20_1', 'Heading_20_2', 'Heading_20_3'].map((nm, i) => `<style:style style:name="${nm}" style:display-name="${nm.replace(/_20_/g, ' ')}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard"${i ? ` style:default-outline-level="${i}"` : ''}><style:paragraph-properties fo:margin-top="${i === 3 ? 0.28 : 0.42}cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold" fo:font-size="${[26, 20, 15, 12.5][i]}pt"${model.headFont ? ` fo:font-family="${esc(model.headFont)}"` : ''}${i === 2 && model.accent ? ` fo:color="${model.accent}"` : ''}/></style:style>`).join('')}
<text:list-style style:name="LBul"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="LNum"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-number></text:list-style>
</office:styles><office:automatic-styles><style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="${W}mm" fo:page-height="${H}mm" style:print-orientation="${W > H ? 'landscape' : 'portrait'}" fo:margin-top="${M}mm" fo:margin-bottom="${M}mm" fo:margin-left="${M}mm" fo:margin-right="${M}mm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL"/></office:master-styles></office:document-styles>`;
  return odfPackage('application/vnd.oasis.opendocument.text', content, styles, pics);
}
function odfPackage(mime, content, styles, pics = {}) {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${Object.keys(pics).map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${/png$/.test(p) ? 'image/png' : 'image/jpeg'}"/>`).join('')}</manifest:manifest>`;
  return zip({ mimetype: mime, 'content.xml': content, 'styles.xml': styles, 'META-INF/manifest.xml': manifest, ...pics });
}

// ───────────── ODF style reading (shared by ODT/ODP/ODS) ─────────────
function odfStyleTable(xmls) {
  const t = {};
  for (const xml of xmls) for (const s of elements(xml, 'style:style')) {
    const name = attr(s, 'style:name'), tp = first(s, 'style:text-properties') || '', pp = first(s, 'style:paragraph-properties') || '', cp = first(s, 'style:table-cell-properties') || '', gp = first(s, 'style:graphic-properties') || '', dp = first(s, 'style:drawing-page-properties') || '';
    const size = attr(tp, 'fo:font-size');
    t[name] = { parent: attr(s, 'style:parent-style-name'), display: attr(s, 'style:display-name'), b: /bold|[6-9]00/.test(attr(tp, 'fo:font-weight') || '') || undefined, i: attr(tp, 'fo:font-style') === 'italic' || undefined, u: (attr(tp, 'style:text-underline-style') || 'none') !== 'none' || undefined, color: attr(tp, 'fo:color') || undefined, size: size && /pt$/.test(size) ? parseFloat(size) : undefined, font: attr(tp, 'fo:font-family') || attr(tp, 'style:font-name') || undefined, bg: attr(tp, 'fo:background-color') || undefined, align: attr(pp, 'fo:text-align') || undefined, shade: attr(pp, 'fo:background-color') || attr(cp, 'fo:background-color') || undefined, fill: attr(gp, 'draw:fill-color') || attr(dp, 'draw:fill-color') || undefined, fillKind: attr(gp, 'draw:fill') || attr(dp, 'draw:fill') || undefined, outline: attr(s, 'style:default-outline-level') };
  }
  const resolve = (name, seen = 0) => { const s = t[name]; if (!s || seen > 8) return {}; const p = s.parent ? resolve(s.parent, seen + 1) : {}; const o = { ...p }; for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && k !== 'parent') o[k] = v; return o; };
  return resolve;
}
const odfAlign = (a) => (a === 'center' ? 'center' : a === 'end' || a === 'right' ? 'right' : a === 'justify' ? 'justify' : null);
// runs of an ODF paragraph (text:p / text:h)
function odfRuns(xml, style) {
  const inner = xml.replace(/^<[^>]+>/, '').replace(/<\/text:[ph]>$/, '');
  const runs = [];
  const walk = (s, props) => {
    const re = /<text:span\b([^>]*)>([\s\S]*?)<\/text:span>|<text:s(?:\s+text:c="(\d+)")?\s*\/>|<text:tab\s*\/>|<text:line-break\s*\/>|<text:a\b[^>]*>([\s\S]*?)<\/text:a>|<[^>]+>|([^<]+)/g; let m;
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) { const st = style(attr(`<x${m[1]}>`, 'text:style-name')); walk(m[2], { ...props, ...pick(st) }); }
      else if (m[0].startsWith('<text:s')) runs.push({ text: ' '.repeat(+(m[3] || 1)), ...props });
      else if (m[0].startsWith('<text:tab')) runs.push({ text: '\t', ...props });
      else if (m[0].startsWith('<text:line-break')) runs.push({ text: '\n', ...props });
      else if (m[4] !== undefined) walk(m[4], props);
      else if (m[5] !== undefined) runs.push({ text: unesc(m[5]), ...props });
    }
  };
  walk(inner, {});
  return runs;
}
const pick = (s) => { const o = {}; for (const k of ['b', 'i', 'u', 'color', 'size', 'font', 'bg']) if (s[k] !== undefined) o[k] = s[k]; return o; };

function readOdt(buf) {
  const z = unzip(buf), content = (z['content.xml'] || '').toString(), stylesXml = (z['styles.xml'] || '').toString();
  const style = odfStyleTable([stylesXml, content]);
  const body = (content.match(/<office:text\b[^>]*>([\s\S]*)<\/office:text>/) || [])[1] || '';
  const blocks = [];
  const para = (x, list = null) => {
    const sn = attr(x, 'text:style-name'), st = style(sn);
    const lvl = x.startsWith('<text:h') ? +(attr(x, 'text:outline-level') || 1) : null;
    const disp = (st.display || sn || '').toLowerCase();
    const sty = /title/.test(disp) && !lvl ? 'title' : lvl ? 'h' + Math.min(3, lvl) : null;
    const frames = [...x.matchAll(/<draw:frame\b[^>]*svg:width="([\d.]+)(cm|in|mm|pt)"[^>]*svg:height="([\d.]+)(cm|in|mm|pt)"[\s\S]*?xlink:href="([^"]+)"[\s\S]*?<\/draw:frame>/g)];
    for (const f of frames) { const pt = (v, u) => +v * ({ cm: 28.3465, mm: 2.83465, in: 72, pt: 1 }[u]); if (z[f[5]]) blocks.push({ t: 'img', data: z[f[5]], mime: /png$/i.test(f[5]) ? 'image/png' : 'image/jpeg', w: pt(f[1], f[2]), h: pt(f[3], f[4]), align: odfAlign(st.align) }); }
    const runs = odfRuns(x.replace(/<draw:frame\b[\s\S]*?<\/draw:frame>/g, ''), style);
    if (runs.length || !frames.length) blocks.push({ t: 'p', style: sty, list, align: odfAlign(st.align), shade: st.shade && st.shade !== 'transparent' ? st.shade : null, runs: runs.map((r) => ({ ...pick(st), ...r })) });
  };
  const re = /<text:(p|h)\b[^>]*\/>|<text:(p|h)\b[\s\S]*?<\/text:\2>|<text:list\b[\s\S]*?<\/text:list>|<table:table\b[\s\S]*?<\/table:table>/g; let m;
  while ((m = re.exec(body))) {
    const x = m[0];
    if (x.startsWith('<text:list')) { const full = elements(body.slice(m.index), 'text:list')[0]; re.lastIndex = m.index + full.length; const numbered = /LNum|Numbering|num/i.test(attr(full, 'text:style-name') || ''); for (const it of elements(full, 'text:list-item')) for (const p of it.match(/<text:(p|h)\b[\s\S]*?<\/text:\1>/g) || []) para(p, numbered ? 'ol' : 'ul'); continue; }
    if (x.startsWith('<table:table')) { const full = elements(body.slice(m.index), 'table:table')[0]; re.lastIndex = m.index + full.length; blocks.push({ t: 'table', rows: elements(full, 'table:table-row').map((r) => elements(r, 'table:table-cell').map((c) => { const st = style(attr(c, 'table:style-name')); const ps = c.match(/<text:(p|h)\b[\s\S]*?<\/text:\1>/g) || []; return { shade: st.shade, runs: ps.flatMap((p, i) => (i ? [{ br: true }, ...odfRuns(p, style)] : odfRuns(p, style))) }; })) }); continue; }
    para(x);
  }
  const pl = (stylesXml.match(/<style:page-layout-properties\b[^>]*>/) || [''])[0];
  const mm = (v) => { const m2 = /([\d.]+)(cm|mm|in|pt)/.exec(v || ''); return m2 ? +m2[1] * ({ cm: 10, mm: 1, in: 25.4, pt: 0.3528 }[m2[2]]) : null; };
  return { page: { w: mm(attr(pl, 'fo:page-width')) || 210, h: mm(attr(pl, 'fo:page-height')) || 297, margin: mm(attr(pl, 'fo:margin-left')) || 20 }, blocks };
}

module.exports = { writeDocx, readDocx, writeOdt, readOdt, odfStyles, odfStyleTable, odfRuns, odfText, odfSpan, odfPackage, odfAlign, ODF_NS, pick, hex };
