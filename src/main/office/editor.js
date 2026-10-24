// Visual editing of an artifact page: every element of the source gets a number (data-fe), the page is shown
// with a small editor script (select, drag to move, double-click to type), and the changes come back as
// operations on those numbers, applied to the SOURCE (not to the rendered page, which the kit has transformed).
const SKIP = /^(script|style|link|meta|title|head|html|br|wbr|template|noscript)$/i;
const VOID = /^(img|br|hr|input|meta|link|source|wbr|area|col|embed|track|param)$/i;

// Number the elements of <body> in source order. Same input → same numbers.
function annotate(html) {
  const s = String(html); const bodyAt = s.search(/<body[\s>]/i);
  let out = '', i = 0, n = 0;
  const re = /<(script|style|textarea)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<([a-zA-Z][\w-]*)(\s[^<>]*?)?(\/?)>/g; let m;
  re.lastIndex = Math.max(0, bodyAt);
  out = s.slice(0, Math.max(0, bodyAt)); i = Math.max(0, bodyAt);
  while ((m = re.exec(s))) {
    out += s.slice(i, m.index); i = re.lastIndex;
    if (m[1] || !m[2] || m[0].startsWith('<!--') || SKIP.test(m[2]) || m[2].toLowerCase() === 'body') { out += m[0]; continue; }
    out += `<${m[2]} data-fe="${++n}"${m[3] || ''}${m[4]}>`;
  }
  return out + s.slice(i);
}
const strip = (html) => String(html).replace(/\sdata-fe="\d+"/g, '');

// Where an annotated element starts and ends.
function extent(s, id) {
  const at = s.indexOf(` data-fe="${id}"`); if (at < 0) return null;
  const start = s.lastIndexOf('<', at), tagEnd = s.indexOf('>', at), name = s.slice(start + 1).match(/^[\w-]+/)[0];
  if (VOID.test(name) || s[tagEnd - 1] === '/') return { start, tagEnd: tagEnd + 1, innerStart: tagEnd + 1, innerEnd: tagEnd + 1, end: tagEnd + 1, name };
  const re = new RegExp(`<(/?)${name}(?=[\\s>/])[^>]*>`, 'gi'); re.lastIndex = tagEnd + 1; let depth = 1, m;
  while ((m = re.exec(s))) { if (m[1]) depth--; else if (!m[0].endsWith('/>')) depth++; if (!depth) return { start, tagEnd: tagEnd + 1, innerStart: tagEnd + 1, innerEnd: m.index, end: re.lastIndex, name }; }
  return { start, tagEnd: tagEnd + 1, innerStart: tagEnd + 1, innerEnd: s.length, end: s.length, name };
}
const cssParse = (st) => { const o = {}; for (const d of String(st || '').split(';')) { const k = d.indexOf(':'); if (k > 0) o[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim(); } return o; };
const cssJoin = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}:${v}`).join(';');
function setStyle(tag, props) {
  const m = tag.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  const st = Object.assign(cssParse(m ? m[2] : ''), props);
  for (const k of Object.keys(props)) if (props[k] === null || props[k] === '') delete st[k];
  const css = cssJoin(st).replace(/"/g, '&quot;');
  if (m) return css ? tag.replace(m[0], ` style="${css}"`) : tag.replace(m[0], '');
  return css ? tag.replace(/\s*(\/?)>$/, ` style="${css}"$1>`) : tag;
}
const setAttr = (tag, name, val) => { const re = new RegExp(`\\s${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i'); const a = ` ${name}="${String(val).replace(/"/g, '&quot;')}"`; return re.test(tag) ? tag.replace(re, a) : tag.replace(/\s*(\/?)>$/, `${a}$1>`); };
const cleanHtml = (h) => String(h).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(["'])[\s\S]*?\1/gi, '').replace(/\scontenteditable="[^"]*"/gi, '').replace(/\sclass="fe-[^"]*"/g, '');

// ops: [{ id, op: 'text', html } | { id, op: 'style', props } | { id, op: 'src', url } | { id, op: 'delete' }]
function applyOps(html, ops) {
  let s = annotate(html); const applied = [];
  for (const o of ops) {
    const x = extent(s, o.id); if (!x) continue;
    if (o.op === 'delete') { s = s.slice(0, x.start) + s.slice(x.end); applied.push(o); continue; }
    let tag = s.slice(x.start, x.tagEnd);
    if (o.op === 'text') { s = s.slice(0, x.innerStart) + cleanHtml(o.html) + s.slice(x.innerEnd); applied.push(o); continue; }
    if (o.op === 'style') tag = setStyle(tag, o.props || {});
    if (o.op === 'src') tag = /^<img\b/i.test(tag) ? setAttr(tag.replace(/\sdata-photo\s*=\s*(["'])[\s\S]*?\1/i, ''), 'src', o.url) : setStyle(tag.replace(/\sdata-photo\s*=\s*(["'])[\s\S]*?\1/i, ''), { '--img': `url('${o.url}')`, 'background-image': `url('${o.url}')`, 'background-size': 'cover', 'background-position': 'center' });
    s = s.slice(0, x.start) + tag + s.slice(x.tagEnd); applied.push(o);
  }
  return { html: strip(s), applied: applied.length };
}
// what the AI needs to know about selected elements: their source
function describe(html, ids) {
  const s = annotate(html);
  return ids.map((id) => { const x = extent(s, id); return x ? strip(s.slice(x.start, x.end)).slice(0, 1200) : null; }).filter(Boolean);
}

// The script added to the page in edit mode.
const EDITOR_JS = `(() => {
  const st = document.createElement('style');
  st.textContent = '[data-fe]{cursor:default}.fe-hover{outline:1px dashed #2f6fdb!important;outline-offset:2px}.fe-sel{outline:2px solid #2f6fdb!important;outline-offset:2px}[contenteditable=true]{outline:2px solid #e8a23a!important;cursor:text}';
  document.head.appendChild(st);
  let sel = [], drag = null, editing = null;
  const post = (m) => parent.postMessage({ fe: true, ...m }, '*');
  const info = (el) => { const cs = getComputedStyle(el); const img = el.tagName === 'IMG' || /url\\(/.test(cs.backgroundImage); return { id: +el.dataset.fe, tag: el.tagName.toLowerCase(), text: (el.innerText || el.alt || '').trim().slice(0, 160), img, color: cs.color, bg: cs.backgroundColor, font: cs.fontFamily, size: parseFloat(cs.fontSize), bold: +cs.fontWeight >= 600, italic: cs.fontStyle === 'italic', align: cs.textAlign }; };
  const send = () => post({ type: 'select', items: sel.map(info) });
  const target = (e) => e.target.closest && e.target.closest('[data-fe]');
  document.addEventListener('mouseover', (e) => { const t = target(e); document.querySelectorAll('.fe-hover').forEach((x) => x.classList.remove('fe-hover')); if (t && !editing) t.classList.add('fe-hover'); }, true);
  document.addEventListener('click', (e) => { if (editing && editing.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); }, true);
  document.addEventListener('mousedown', (e) => {
    if (editing && editing.contains(e.target)) return;
    if (editing) finishText();
    const t = target(e); if (!t) { sel.forEach((x) => x.classList.remove('fe-sel')); sel = []; send(); return; }
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (sel.includes(t)) { t.classList.remove('fe-sel'); sel = sel.filter((x) => x !== t); } else { sel.push(t); t.classList.add('fe-sel'); } }
    else if (!sel.includes(t)) { sel.forEach((x) => x.classList.remove('fe-sel')); sel = [t]; t.classList.add('fe-sel'); }
    send();
    const base = sel.map((el) => { const m = (el.style.translate || '0px 0px').split(' '); return { el, x: parseFloat(m[0]) || 0, y: parseFloat(m[1] || m[0]) || 0 }; });
    drag = { sx: e.clientX, sy: e.clientY, base, moved: false };
  }, true);
  document.addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; if (!drag.moved && Math.hypot(dx, dy) < 4) return; drag.moved = true; for (const b of drag.base) b.el.style.translate = Math.round(b.x + dx) + 'px ' + Math.round(b.y + dy) + 'px'; });
  document.addEventListener('mouseup', () => { if (drag && drag.moved) for (const b of drag.base) post({ type: 'op', op: { id: +b.el.dataset.fe, op: 'style', props: { translate: b.el.style.translate } } }); drag = null; });
  document.addEventListener('dblclick', (e) => { const t = target(e); if (!t || t.tagName === 'IMG') return; editing = t; t.contentEditable = 'true'; t.focus(); post({ type: 'editing', id: +t.dataset.fe }); }, true);
  function finishText() { const t = editing; editing = null; if (!t) return; t.contentEditable = 'false'; t.removeAttribute('contenteditable'); const c = t.cloneNode(true); c.querySelectorAll('[data-icon] > svg, [data-chart] > *').forEach((x) => x.remove()); c.querySelectorAll('[data-fe]').forEach((x) => { x.classList.remove('fe-sel', 'fe-hover'); if (!x.className) x.removeAttribute('class'); }); post({ type: 'op', op: { id: +t.dataset.fe, op: 'text', html: c.innerHTML } }); }
  document.addEventListener('keydown', (e) => { if (editing) { if (e.key === 'Escape') finishText(); return; } if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); post({ type: 'askDelete' }); } });
  window.addEventListener('message', (e) => {
    const m = e.data || {}; if (!m.fe) return;
    if (m.type === 'style') for (const el of sel) { for (const [k, v] of Object.entries(m.props)) el.style.setProperty(k, v); post({ type: 'op', op: { id: +el.dataset.fe, op: 'style', props: m.props } }); }
    if (m.type === 'delete') { for (const el of sel) { post({ type: 'op', op: { id: +el.dataset.fe, op: 'delete' } }); el.remove(); } sel = []; send(); }
    if (m.type === 'src') for (const el of sel) { if (el.tagName === 'IMG') { el.src = m.preview; el.removeAttribute('srcset'); } else { el.style.setProperty('--img', 'url(' + m.preview + ')'); el.style.backgroundImage = 'url(' + m.preview + ')'; el.style.backgroundSize = 'cover'; } post({ type: 'op', op: { id: +el.dataset.fe, op: 'src', url: m.url } }); }
    if (m.type === 'clear') { sel.forEach((x) => x.classList.remove('fe-sel')); sel = []; send(); }
  });
})();`;

module.exports = { annotate, applyOps, describe, strip, EDITOR_JS };
