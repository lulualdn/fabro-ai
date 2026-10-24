// Fabro Slides ⇄ PowerPoint (.pptx) and OpenDocument Presentation (.odp).
// Slide model: { w, h (px, 96 dpi), slides: [{ bg, items: [
//   { t: 'shape', x, y, w, h, fill, radius, line },
//   { t: 'text', x, y, w, h, fill, valign: 'top'|'middle'|'bottom', paras: [{ align, list, runs: [{ text, b, i, u, size (pt), color, font }] }] },
//   { t: 'img', x, y, w, h, data: Buffer, mime } ] }] }
const { zip, unzip, esc, unesc, attr, elements, first } = require('./zipio');
const { odfStyles, odfStyleTable, odfRuns, odfText, odfSpan, odfPackage, odfAlign, ODF_NS, pick, hex } = require('./docs');

const EMU = 9525; // per px
const e = (px) => Math.round((+px || 0) * EMU);

// ───────────── PPTX writer ─────────────
function pptxRuns(p) {
  return (p.runs || []).map((r) => {
    if (r.br || r.text === '\n') return '<a:br/>';
    const at = [r.size && `sz="${Math.round(r.size * 100)}"`, r.b && 'b="1"', r.i && 'i="1"', r.u && 'u="sng"'].filter(Boolean).join(' ');
    return `<a:r><a:rPr lang="fr-FR" ${at} dirty="0">${r.color ? `<a:solidFill><a:srgbClr val="${hex(r.color)}"/></a:solidFill>` : ''}${r.font ? `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>` : ''}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
  }).join('');
}
function pptxSlide(s, rels) {
  let id = 2;
  const items = s.items.map((it) => {
    const xf = `<a:xfrm><a:off x="${e(it.x)}" y="${e(it.y)}"/><a:ext cx="${e(it.w)}" cy="${e(it.h)}"/></a:xfrm>`;
    if (it.t === 'img') { const rid = rels.img(it); return `<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`; }
    const geom = it.radius ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((it.radius / Math.max(1, Math.min(it.w, it.h))) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
    const fill = it.fill ? `<a:solidFill><a:srgbClr val="${hex(it.fill)}"/></a:solidFill>` : '<a:noFill/>';
    const line = it.line ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${hex(it.line)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
    if (it.t === 'shape') return `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf}${geom}${fill}${line}</p:spPr></p:sp>`;
    const paras = (it.paras || []).map((p) => `<a:p><a:pPr${p.align && p.align !== 'left' ? ` algn="${p.align === 'center' ? 'ctr' : p.align === 'right' ? 'r' : 'just'}"` : ''}${p.list ? ' marL="285750" indent="-285750"' : ''}>${p.list ? (p.list === 'ol' ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : '<a:buFont typeface="Arial"/><a:buChar char="•"/>') : '<a:buNone/>'}</a:pPr>${pptxRuns(p)}<a:endParaRPr lang="fr-FR" dirty="0"/></a:p>`).join('') || '<a:p><a:endParaRPr lang="fr-FR"/></a:p>';
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xf}${geom}${fill}${line}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${it.valign === 'middle' ? 'ctr' : it.valign === 'bottom' ? 'b' : 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${s.bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(s.bg)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : ''}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${items}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fabro"><a:themeElements><a:clrScheme name="Fabro"><a:dk1><a:srgbClr val="1F1E1B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2B2A26"/></a:dk2><a:lt2><a:srgbClr val="F4F1EA"/></a:lt2><a:accent1><a:srgbClr val="BF4F25"/></a:accent1><a:accent2><a:srgbClr val="2F6FDB"/></a:accent2><a:accent3><a:srgbClr val="3F8F5A"/></a:accent3><a:accent4><a:srgbClr val="E8A23A"/></a:accent4><a:accent5><a:srgbClr val="7B4FD6"/></a:accent5><a:accent6><a:srgbClr val="D0342C"/></a:accent6><a:hlink><a:srgbClr val="2F6FDB"/></a:hlink><a:folHlink><a:srgbClr val="7B4FD6"/></a:folHlink></a:clrScheme><a:fontScheme name="Fabro"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Fabro"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
function writePptx(model) {
  const files = {}, media = {}; let mediaN = 0;
  const W = e(model.w || 1280), H = e(model.h || 720);
  const slideIds = model.slides.map((_, i) => i + 1);
  model.slides.forEach((s, i) => {
    const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'];
    const xml = pptxSlide(s, { img: (it) => { const ext = /png/.test(it.mime) ? 'png' : 'jpeg', name = `image${++mediaN}.${ext}`; media[`ppt/media/${name}`] = it.data; const rid = `rId${rels.length + 1}`; rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`); return rid; } });
    files[`ppt/slides/slide${i + 1}.xml`] = xml;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
  });
  const R = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideIds.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${R('rId1', 'officeDocument', 'ppt/presentation.xml')}</Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds.map((n) => `<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="fr-FR"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${R('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml')}${slideIds.map((n) => R(`rId${n + 1}`, 'slide', `slides/slide${n}.xml`)).join('')}${R(`rId${slideIds.length + 2}`, 'theme', 'theme/theme1.xml')}</Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${R('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')}${R('rId2', 'theme', '../theme/theme1.xml')}</Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${R('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')}</Relationships>`,
    'ppt/theme/theme1.xml': THEME,
    ...files, ...media,
  });
}

// ───────────── PPTX reader ─────────────
function readPptx(buf) {
  const z = unzip(buf), s = (f) => (z[f] ? z[f].toString() : '');
  const pres = s('ppt/presentation.xml'), sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const W = sz ? +sz[1] / EMU : 1280, H = sz ? +sz[2] / EMU : 720;
  const relsOf = (part) => { const dir = part.replace(/[^/]+$/, ''), f = dir + '_rels/' + part.slice(dir.length) + '.rels', o = {}; for (const r of elements(s(f), 'Relationship')) { const t = attr(r, 'Target'); o[attr(r, 'Id')] = { type: attr(r, 'Type').split('/').pop(), target: /^\//.test(t) ? t.slice(1) : resolvePath(dir, t) }; } return o; };
  const presRels = relsOf('ppt/presentation.xml');
  const order = [...pres.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((m) => presRels[m[1]] && presRels[m[1]].target).filter(Boolean);
  // theme colours
  const themePart = Object.values(relsOf(Object.values(presRels).find((r) => r.type === 'slideMaster')?.target || 'ppt/slideMasters/slideMaster1.xml')).find((r) => r.type === 'theme');
  const theme = s(themePart ? themePart.target : 'ppt/theme/theme1.xml'), scheme = {};
  for (const k of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink']) { const m = theme.match(new RegExp(`<a:${k}>[\\s\\S]*?(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"`)); if (m) scheme[k] = '#' + m[1]; }
  const MAP = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
  const color = (x) => { if (!x) return null; const m = x.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/); if (m) return '#' + m[1]; const c = x.match(/<a:schemeClr val="(\w+)"/); return c ? scheme[MAP[c[1]] || c[1]] || null : null; };
  const fillOf = (sp) => { const f = first(sp, 'a:solidFill'); return f && !/<a:noFill/.test((sp.match(/<p:spPr>[\s\S]*?<\/p:spPr>/) || [''])[0].slice(0, 400)) ? color(f) : null; };
  // placeholder positions inherited from layout / master
  const phPos = (part) => { const o = {}; for (const sp of elements(s(part), 'p:sp')) { const ph = first(sp, 'p:ph'); const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/); if (ph && off) { const key = attr(ph, 'type') || 'body', idx = attr(ph, 'idx'); const v = { x: +off[1] / EMU, y: +off[2] / EMU, w: +off[3] / EMU, h: +off[4] / EMU, size: (sp.match(/<a:defRPr[^>]*sz="(\d+)"/) || [])[1] / 100 || null }; if (idx) o['i' + idx] = v; o[key] = o[key] || v; } } return o; };
  const slides = order.map((part) => {
    const xml = s(part), rels = relsOf(part);
    const layout = Object.values(rels).find((r) => r.type === 'slideLayout'), lp = layout ? phPos(layout.target) : {};
    const master = layout ? Object.values(relsOf(layout.target)).find((r) => r.type === 'slideMaster') : null, mp = master ? phPos(master.target) : {};
    const bgXml = first(xml, 'p:bg') || (layout && first(s(layout.target), 'p:bg')) || (master && first(s(master.target), 'p:bg')) || '';
    const items = [];
    const bgImg = bgXml.match(/r:embed="([^"]+)"/);
    const walk = (tree, ox = 0, oy = 0) => {
      for (const m of tree.matchAll(/<p:(sp|pic|grpSp)\b[\s\S]*?<\/p:\1>/g)) {
        const el = m[0];
        if (m[1] === 'grpSp') { walk(el.replace(/^<p:grpSp>[\s\S]*?<\/p:grpSpPr>/, ''), ox, oy); continue; }
        const off = el.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/);
        const ph = first(el, 'p:ph'); const key = ph ? attr(ph, 'type') || 'body' : null, idx = ph ? attr(ph, 'idx') : null;
        const inh = ph ? (idx && (lp['i' + idx] || mp['i' + idx])) || lp[key] || mp[key] || (key === 'ctrTitle' ? lp.title || mp.title : null) : null;
        const box = off ? { x: +off[1] / EMU + ox, y: +off[2] / EMU + oy, w: +off[3] / EMU, h: +off[4] / EMU } : inh ? { x: inh.x, y: inh.y, w: inh.w, h: inh.h } : null;
        if (!box) continue;
        if (m[1] === 'pic') { const b = el.match(/r:embed="([^"]+)"/); const r = b && rels[b[1]]; if (r && z[r.target]) items.push({ t: 'img', ...box, data: z[r.target], mime: /png$/i.test(r.target) ? 'image/png' : 'image/jpeg' }); continue; }
        const spPr = (el.match(/<p:spPr[\s\S]*?<\/p:spPr>|<p:spPr\/>/) || [''])[0];
        const fill = /<a:solidFill>/.test(spPr) ? color(first(spPr, 'a:solidFill')) : null;
        const blip = spPr.match(/r:embed="([^"]+)"/); if (blip && rels[blip[1]] && z[rels[blip[1]].target]) items.push({ t: 'img', ...box, data: z[rels[blip[1]].target], mime: 'image/png' });
        const tx = first(el, 'p:txBody');
        const defSize = (inh && inh.size) || (key === 'title' || key === 'ctrTitle' ? 40 : ph ? 24 : 18);
        const paras = tx ? elements(tx, 'a:p').map((p) => {
          const ppr = first(p, 'a:pPr') || '', al = attr(ppr, 'algn');
          const runs = [];
          for (const r of p.matchAll(/<a:(r|fld)\b[\s\S]*?<\/a:\1>|<a:br\b[^>]*\/?>(?:<\/a:br>)?/g)) {
            if (r[0].startsWith('<a:br')) { runs.push({ text: '\n' }); continue; }
            const rpr = first(r[0], 'a:rPr') || '', t = (r[0].match(/<a:t>([\s\S]*?)<\/a:t>/) || [])[1];
            if (t == null) continue;
            runs.push({ text: unesc(t), b: attr(rpr, 'b') === '1' || undefined, i: attr(rpr, 'i') === '1' || undefined, u: (attr(rpr, 'u') || 'none') !== 'none' || undefined, size: attr(rpr, 'sz') ? +attr(rpr, 'sz') / 100 : defSize, color: color(first(rpr, 'a:solidFill') || '') || undefined, font: attr(first(rpr, 'a:latin') || '', 'typeface') || undefined });
          }
          return { align: al === 'ctr' ? 'center' : al === 'r' ? 'right' : al === 'just' ? 'justify' : null, list: /<a:buChar|<a:buAutoNum/.test(ppr) || (key === 'body' && !/<a:buNone/.test(ppr) && runs.length) ? (/buAutoNum/.test(ppr) ? 'ol' : 'ul') : null, runs };
        }) : [];
        const anchor = (tx && (tx.match(/<a:bodyPr[^>]*anchor="(\w+)"/) || [])[1]) || (key === 'ctrTitle' ? 'b' : key === 'title' ? 'ctr' : 't');
        if (fill || /<a:ln\b(?![^>]*\/>)[\s\S]*?<a:solidFill>/.test(spPr)) items.push({ t: 'shape', ...box, fill, radius: /roundRect/.test(spPr) ? Math.min(box.w, box.h) * 0.1 : 0 });
        if (paras.some((p) => p.runs.some((r) => r.text.trim()))) items.push({ t: 'text', ...box, valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top', paras });
      }
    };
    const tree = first(xml, 'p:spTree') || '';
    walk(tree);
    if (bgImg) { const r = rels[bgImg[1]]; if (r && z[r.target]) items.unshift({ t: 'img', x: 0, y: 0, w: W, h: H, data: z[r.target], mime: 'image/jpeg' }); }
    return { bg: color(first(bgXml, 'a:solidFill') || '') || scheme.lt1 || '#ffffff', items };
  });
  return { w: W, h: H, slides };
}
function resolvePath(dir, t) { const parts = (dir + t).split('/'); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); }

// ───────────── ODP writer ─────────────
const cm = (px) => `${((+px || 0) / 96 * 2.54).toFixed(3)}cm`;
function writeOdp(model) {
  const S = odfStyles(), pics = {}; let n = 0;
  const pages = model.slides.map((s, i) => {
    const dp = S.get('drawing-page', { drawPage: s.bg ? `draw:fill="solid" draw:fill-color="${s.bg}" presentation:background-visible="true"` : 'draw:fill="none"' });
    const items = s.items.map((it) => {
      const geo = `svg:x="${cm(it.x)}" svg:y="${cm(it.y)}" svg:width="${cm(it.w)}" svg:height="${cm(it.h)}"`;
      if (it.t === 'img') { const name = `Pictures/img${++n}.${/png/.test(it.mime) ? 'png' : 'jpg'}`; pics[name] = it.data; return `<draw:frame draw:style-name="${S.get('graphic', { graphic: 'draw:stroke="none" draw:fill="none"' })}" ${geo}><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`; }
      const gs = S.get('graphic', { graphic: `draw:stroke="${it.line ? 'solid' : 'none'}"${it.line ? ` svg:stroke-color="${it.line}"` : ''} draw:fill="${it.fill ? 'solid' : 'none'}"${it.fill ? ` draw:fill-color="${it.fill}"` : ''} draw:textarea-vertical-align="${it.valign === 'middle' ? 'middle' : it.valign === 'bottom' ? 'bottom' : 'top'}" fo:padding="0cm" fo:min-height="0cm" draw:auto-grow-height="false"` });
      if (it.t === 'shape') return `<draw:rect draw:style-name="${gs}" ${geo}${it.radius ? ` draw:corner-radius="${cm(it.radius)}"` : ''}/>`;
      const paras = (it.paras || []).map((p) => {
        const ps = S.get('paragraph', { para: `fo:text-align="${p.align === 'center' ? 'center' : p.align === 'right' ? 'end' : p.align === 'justify' ? 'justify' : 'start'}" fo:margin-top="0cm" fo:margin-bottom="0.1cm"` });
        const inner = (p.runs || []).map((r) => odfSpan(S, r)).join('');
        return p.list ? `<text:list><text:list-item><text:p text:style-name="${ps}">${inner}</text:p></text:list-item></text:list>` : `<text:p text:style-name="${ps}">${inner}</text:p>`;
      }).join('');
      return `<draw:frame draw:style-name="${gs}" ${geo}><draw:text-box>${paras}</draw:text-box></draw:frame>`;
    }).join('');
    return `<draw:page draw:name="page${i + 1}" draw:style-name="${dp}" draw:master-page-name="Default">${items}</draw:page>`;
  }).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:automatic-styles>${S.xml()}<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet></text:list-style></office:automatic-styles><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODF_NS}><office:styles><style:default-style style:family="graphic"><style:text-properties fo:font-family="Liberation Sans" fo:font-size="18pt"/></style:default-style></office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${cm(model.w || 1280)}" fo:page-height="${cm(model.h || 720)}" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles></office:document-styles>`;
  return odfPackage('application/vnd.oasis.opendocument.presentation', content, styles, pics);
}

// ───────────── ODP reader ─────────────
const px = (v) => { const m = /(-?[\d.]+)(cm|mm|in|pt|px)?/.exec(v || ''); return m ? +m[1] * ({ cm: 37.795, mm: 3.7795, in: 96, pt: 1.3333, px: 1 }[m[2] || 'px']) : 0; };
function readOdp(buf) {
  const z = unzip(buf), content = (z['content.xml'] || '').toString(), stylesXml = (z['styles.xml'] || '').toString();
  const style = odfStyleTable([stylesXml, content]);
  const pl = (stylesXml.match(/<style:page-layout-properties\b[^>]*>/) || [''])[0];
  const W = px(attr(pl, 'fo:page-width')) || 1280, H = px(attr(pl, 'fo:page-height')) || 720;
  const slides = elements(content, 'draw:page').map((pg) => {
    const ps = style(attr(pg, 'draw:style-name'));
    const items = [];
    for (const m of pg.matchAll(/<draw:(frame|rect|custom-shape)\b[\s\S]*?(?:<\/draw:\1>|\/>)/g)) {
      const el = m[0], tag = el.match(/^<[^>]+>/)[0];
      const box = { x: px(attr(tag, 'svg:x')), y: px(attr(tag, 'svg:y')), w: px(attr(tag, 'svg:width')), h: px(attr(tag, 'svg:height')) };
      const st = style(attr(tag, 'draw:style-name') || attr(tag, 'presentation:style-name'));
      const img = el.match(/<draw:image\b[^>]*xlink:href="([^"]+)"/);
      if (img && z[img[1]]) { items.push({ t: 'img', ...box, data: z[img[1]], mime: /png$/i.test(img[1]) ? 'image/png' : 'image/jpeg' }); continue; }
      if (st.fill && st.fillKind !== 'none') items.push({ t: 'shape', ...box, fill: st.fill, radius: px(attr(tag, 'draw:corner-radius')) });
      const isTitle = /title/.test(attr(tag, 'presentation:class') || '');
      const paras = (el.match(/<text:(p|h)\b[\s\S]*?<\/text:\1>/g) || []).map((p) => { const pst = style(attr(p, 'text:style-name')); return { align: odfAlign(pst.align), list: /<text:list-item>[\s\S]*$/.test(el.slice(0, el.indexOf(p))) && /<\/text:list-item>/.test(el.slice(el.indexOf(p))) ? 'ul' : null, runs: odfRuns(p, style).map((r) => ({ size: isTitle ? 36 : 20, ...pick(st), ...pick(pst), ...r })) }; });
      if (paras.some((p) => p.runs.some((r) => r.text.trim()))) items.push({ t: 'text', ...box, valign: isTitle ? 'middle' : 'top', paras });
    }
    return { bg: ps.fill || '#ffffff', items };
  });
  return { w: W, h: H, slides };
}

module.exports = { writePptx, readPptx, writeOdp, readOdp };
