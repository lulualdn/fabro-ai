'use strict';
/* Artifacts: documents, slides, web pages, SVG drawings and code the AI creates.
   Shown as cards in the chat, opened in the side panel, editable (text + colors), versioned, exportable. */

const ART_TYPES = { markdown: 'file', document: 'filePdf', slides: 'slides', html: 'globe', svg: 'brush', code: 'code' };
const typeIcon = (t) => ART_TYPES[t] || 'file';
const htmlSlides = (c) => /^\s*(<!doctype|<html|<body|<section)/i.test(String(c || '')); // slides written as HTML (Fabro Kit deck)

// ───────────────────────────── card picture ─────────────────────────────
// Each artifact gets its own soft pastel and a picture of its first page (rendered by the computer, cached).
const PASTELS = ['#fde2e4', '#dfe7fd', '#e2f0e8', '#fff1c1', '#ece2fb', '#ffe4d1', '#d8f0f6', '#f9e0f0'];
const artTint = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PASTELS[h % PASTELS.length]; };
const CODE_EXT = { python: 'PY', py: 'PY', javascript: 'JS', js: 'JS', typescript: 'TS', ts: 'TS', lua: 'LUA', luau: 'LUAU', rust: 'RS', go: 'GO', java: 'JAVA', cpp: 'C++', c: 'C', csharp: 'C#', cs: 'C#', bash: 'SH', sh: 'SH', powershell: 'PS1', json: 'JSON', css: 'CSS', sql: 'SQL', php: 'PHP', ruby: 'RB', html: 'HTML' };
function artThumb(id, type, v, lang = '', live = false) {
  const tint = artTint(id || type);
  if (type === 'code') return `<div class="art-thumb is-code" style="--tint:${tint}"><span class="at-file">${icon('fileCode', 30)}<b>${esc(CODE_EXT[String(lang).toLowerCase()] || 'CODE')}</b></span></div>`;
  if (live || !id) return `<div class="art-thumb is-live" style="--tint:${tint}">${spinner(22)}</div>`;
  const key = `${id}:${v}`; const src = (S.thumbs || {})[key];
  return `<div class="art-thumb t-${esc(type)}" style="--tint:${tint}" ${src ? '' : `data-thumb="${esc(id)}" data-v="${v}"`}>${src ? `<img src="${src}" alt="">` : `<span class="at-skel">${icon(typeIcon(type), 22)}</span>`}</div>`;
}
S.thumbs = S.thumbs || {};
function hydrateThumbs(root = document) {
  for (const el of root.querySelectorAll('.art-thumb[data-thumb]:not([data-loading])')) {
    el.dataset.loading = '1';
    const id = el.dataset.thumb, v = +el.dataset.v, key = `${id}:${v}`;
    api.artifacts.thumb(id, v).then((src) => {
      if (!src) { el.querySelector('.at-skel') && el.classList.add('no-img'); return; }
      S.thumbs[key] = src;
      for (const x of document.querySelectorAll(`.art-thumb[data-thumb="${CSS.escape(id)}"][data-v="${v}"]`)) { x.removeAttribute('data-thumb'); x.innerHTML = `<img src="${src}" alt="">`; }
    }).catch(() => {});
  }
}
new MutationObserver(() => { if (document.querySelector('.art-thumb[data-thumb]:not([data-loading])')) hydrateThumbs(); }).observe(document.documentElement, { childList: true, subtree: true });

// A card for an artifact (chat, agent steps): picture on its pastel, title, kind, version, check status.
function artCardFor({ id, type, title, v = 0, lang = '', live = false, lines = null, check = null }) {
  const label = t('artType_' + type);
  const chk = check === 'checking' ? `<span class="ac-chk run">${spinner(12)} ${esc(t('artChecking'))}</span>`
    : check === 'fixing' ? `<span class="ac-chk run">${spinner(12)} ${esc(t('artFixing'))}</span>`
    : check === 'ok' ? `<span class="ac-chk ok">${icon('check', 12)} ${esc(t('artChecked'))}</span>`
    : typeof check === 'number' && check > 0 ? `<span class="ac-chk bad">${icon('warning', 12)} ${esc(t('artProblems', { n: check }))}</span>` : '';
  return `<div class="art-card ${live ? 'live' : ''}" ${id && !live ? `data-action="art-open" data-id="${esc(id)}" data-v="${v}"` : ''}>
    ${artThumb(id, type, v, lang, live)}
    <div class="ac-text"><b>${esc(title || label)}</b><small>${icon(typeIcon(type), 12)} ${esc(label)}${v > 0 ? ` · v${v + 1}` : ''}${lines ? ` · ${esc(t('lines', { n: lines }))}` : ''}${live ? ' · ' + esc(t('artWriting')) : ''}</small>
      ${chk}${id && !live ? `<span class="ac-open">${esc(t('open'))} ${icon('expand', 13)}</span>` : ''}</div>
  </div>`;
}

// ───────────────────────────── parsing ─────────────────────────────
// <artifact type="markdown|slides|html|svg|code" title="…" lang="py">…</artifact>
function parseAttrs(s) { const o = {}; for (const m of String(s).matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) o[m[1].toLowerCase()] = m[2]; return o; }
function splitArtifacts(content) {
  const out = [];
  let rest = String(content || ''), idx = 0;
  for (;;) {
    const open = rest.match(/<artifact\b([^>]*)>/i);
    if (!open) { if (rest) out.push({ kind: 'text', text: rest }); break; }
    if (open.index) out.push({ kind: 'text', text: rest.slice(0, open.index) });
    const after = rest.slice(open.index + open[0].length);
    const close = after.search(/<\/artifact>/i);
    const attrs = parseAttrs(open[1]);
    const body = (close < 0 ? after : after.slice(0, close)).replace(/^\n+/, '').replace(/\s+$/, '');
    out.push({ kind: 'artifact', i: idx++, type: normType(attrs.type, body), title: attrs.title || '', lang: attrs.lang || attrs.language || '', body, open: close < 0 });
    if (close < 0) break;
    rest = after.slice(close + '</artifact>'.length);
  }
  return out;
}
function normType(t, body) { // same rules as the computer side (kit/chatcheck.js)
  t = String(t || '').toLowerCase();
  if (/slide|deck|present/.test(t)) return 'slides';
  if (/svg|draw/.test(t)) return 'svg';
  if (/^(document|doc|pdf|print|report|cv|letter|invoice|flyer|poster|menu)/.test(t)) return 'document';
  if (/html|page|web|site|app/.test(t)) return 'html';
  if (/code|script|program/.test(t)) return 'code';
  if (/^\s*<svg/i.test(body)) return 'svg';
  if (/^\s*(<!doctype|<html)/i.test(body)) return /<body[^>]*class\s*=\s*["'][^"']*\bdoc\b/i.test(body) ? 'document' : 'html';
  return 'markdown';
}
const hasArtifacts = (m) => /<artifact\b/i.test(m.content || '');

// Card shown in the conversation in place of the artifact.
function artCard(m, seg) {
  const ref = (m.artifacts || [])[seg.i];
  const live = !!(m.pending && (seg.open || !ref));
  const check = m.artCheck && (m.pending || m.artCheck.status === 'ok') ? m.artCheck.status : null;
  return artCardFor({ id: ref && ref.id, type: seg.type, title: seg.title, v: ref ? ref.v : 0, lang: seg.lang, live, lines: seg.body.split('\n').length, check });
}

function renderWithArtifacts(m) {
  return splitArtifacts(m.content).map((seg) => seg.kind === 'text'
    ? (seg.text.trim() ? `<div class="md">${md(seg.text, m.id + ':' + Math.random().toString(36).slice(2, 6))}</div>` : '')
    : artCard(m, seg)).join('');
}

// After an answer: save each finished artifact (same title in this conversation → new version).
async function saveArtifactsFrom(m) {
  if (!hasArtifacts(m) || !S.conv || S.conv.ephemeral) return;
  const segs = splitArtifacts(m.content).filter((s) => s.kind === 'artifact');
  const existing = (await api.artifacts.list()).filter((a) => a.convId === S.conv.id);
  m.artifacts = [];
  for (const seg of segs) {
    const title = seg.title || t('artType_' + seg.type);
    const found = existing.find((a) => a.title.toLowerCase() === title.toLowerCase() && a.type === seg.type);
    let a = found ? await api.artifacts.get(found.id) : null;
    if (a) a.versions.push({ content: seg.body, at: Date.now(), by: 'ai', msgId: m.id });
    else a = { id: 'art-' + uid(), convId: S.conv.id, type: seg.type, title, lang: seg.lang, versions: [{ content: seg.body, at: Date.now(), by: 'ai', msgId: m.id }], style: seg.type === 'slides' ? { ...DECK_THEMES[0] } : null };
    a = await api.artifacts.save(a);
    m.artifacts[seg.i] = { id: a.id, v: a.versions.length - 1 };
  }
  const el = $(`#m-${CSS.escape(m.id)} .a-body`); if (el) el.innerHTML = assistantBody(m);
  persist();
  const first = m.artifacts[0];
  if (first && S.settings.autoOpenArtifacts !== false) openArtifact(first.id, first.v);
}

// ───────────────────────────── slides ─────────────────────────────
const DECK_THEMES = [
  { name: 'Ivoire', bg: '#fbfaf7', fg: '#1f1e1b', accent: '#cf6a3c' },
  { name: 'Nuit', bg: '#12161d', fg: '#f3f1ee', accent: '#ff5e42' },
  { name: 'Corail', bg: '#ff5e42', fg: '#ffffff', accent: '#14161b' },
  { name: 'Ardoise', bg: '#e9edf2', fg: '#17202b', accent: '#2f6fdb' },
  { name: 'Forêt', bg: '#0f2a22', fg: '#eef5ef', accent: '#7fd4a5' },
];
const splitSlides = (src) => String(src).split(/\n-{3,}\n|\n\*\*\*\n/).map((s) => s.trim()).filter(Boolean);
// Automatic layout from what a Markdown slide contains, so even a small model's plain bullets look designed:
// opening title, section break, one big number, a quote, text + picture, or 2-4 bold-led points as cards.
function slideLayout(src, i) {
  const s = String(src || '').trim(); const lines = s.split('\n').filter((l) => l.trim());
  const heads = lines.filter((l) => /^#{1,3}\s/.test(l)); const body = lines.filter((l) => !/^#{1,3}\s/.test(l));
  if (/!\[[^\]]*\]\([^)]+\)/.test(s)) return 'l-split';
  if (body.length && /^>\s?/.test(body[0]) && body.filter((l) => /^>/.test(l)).length >= body.length - 1) return 'l-quote';
  if (i === 0 && /^#\s/.test(lines[0] || '')) return 'l-title';
  if (heads.length && body.length <= 1 && (body[0] || '').length < 90) return /^#\s/.test(lines[0] || '') ? 'l-title' : 'l-section';
  if (/^\*\*\s*[\d][\d\s.,]*\s?(%|€|\$|k|K|M|Md|x|×|h|min|ans|years)?\s*\*\*/.test(body[0] || '') && body.length <= 2) return 'l-big';
  const items = body.filter((l) => /^\s*[-*]\s/.test(l));
  if (items.length >= 2 && items.length <= 4 && items.length === body.length && items.every((l) => /^\s*[-*]\s+\*\*/.test(l))) return 'l-cards';
  return '';
}
const SLIDE_LAYOUT_CSS = `.slide-in.l-title{justify-content:flex-end;padding-bottom:9%;background:radial-gradient(circle at 88% 12%,color-mix(in srgb,var(--sa) 32%,transparent),transparent 55%)}
.slide-in.l-title h1{font-size:8cqw;max-width:14ch}.slide-in.l-title p{color:color-mix(in srgb,var(--sf) 70%,transparent);font-size:2.6cqw}
.slide-in.l-section{background:var(--sa);color:var(--sb)}.slide-in.l-section h1,.slide-in.l-section h2{color:var(--sb);font-size:7cqw;max-width:15ch}.slide-in.l-section p{color:color-mix(in srgb,var(--sb) 80%,transparent)}
.slide-in.l-big{align-items:center;text-align:center}.slide-in.l-big p:first-of-type strong:first-child{display:block;font:600 16cqw/1 var(--serif,Georgia,serif);letter-spacing:-.04em;color:var(--sa)}
.slide-in.l-quote blockquote{border:0;margin:0;padding:0;font:500 4.6cqw/1.25 var(--serif,Georgia,serif)}.slide-in.l-quote blockquote::before{content:"“";display:block;font-size:12cqw;line-height:.6;color:var(--sa)}.slide-in.l-quote blockquote p{color:var(--sf)}
.slide-in.l-split{display:grid;grid-template-columns:1fr 1fr;gap:5%;align-items:center}.slide-in.l-split img{width:100%;height:78cqh;max-height:100%;object-fit:cover;border-radius:2cqw}.slide-in.l-split p:has(img){grid-column:2;grid-row:1/span 9;margin:0}
.slide-in.l-cards ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));grid-auto-flow:column;gap:2cqw}.slide-in.l-cards li{background:color-mix(in srgb,var(--sf) 6%,transparent);border:1px solid color-mix(in srgb,var(--sf) 14%,transparent);border-radius:1.6cqw;padding:2.4cqw;margin:0;font-size:2.3cqw}.slide-in.l-cards li strong:first-child{display:block;font-size:3cqw;margin-bottom:.4em}
.slide-in>h2:first-child{position:relative;padding-top:2.2cqw}.slide-in:not(.l-section)>h2:first-child::before{content:"";position:absolute;top:0;left:0;width:6cqw;height:.6cqw;border-radius:1cqw;background:var(--sa)}`;
{ const st = document.createElement('style'); st.id = 'slide-layouts'; st.textContent = SLIDE_LAYOUT_CSS; document.head.appendChild(st); }
function slideHtml(src, i, style, editable = false) {
  const lay = editable ? '' : slideLayout(src, i);
  return `<div class="slide" data-i="${i}" style="--sb:${esc(style.bg)};--sf:${esc(style.fg)};--sa:${esc(style.accent)}">
    <div class="slide-in md ${lay} ${editable ? 'editable' : ''}" ${editable ? 'contenteditable="true" spellcheck="true"' : ''}>${DOMPurify.sanitize(marked.parse(src))}</div>
    ${lay === 'l-title' ? '' : `<span class="slide-n">${i + 1}</span>`}</div>`;
}

// ───────────────────────────── HTML → Markdown (for rich editing) ─────────────────────────────
function htmlToMd(root) {
  const inline = (n) => [...n.childNodes].map((c) => {
    if (c.nodeType === 3) return c.textContent.replace(/ /g, ' ');
    if (c.nodeType !== 1) return '';
    const tag = c.tagName.toLowerCase(), inner = inline(c);
    const color = c.style && c.style.color, bgc = c.style && c.style.backgroundColor;
    if (tag === 'br') return '  \n';
    if (!inner.trim() && tag !== 'img') return inner;
    let out = inner;
    if (tag === 'strong' || tag === 'b') out = `**${inner}**`;
    else if (tag === 'em' || tag === 'i') out = `*${inner}*`;
    else if (tag === 's' || tag === 'del' || tag === 'strike') out = `~~${inner}~~`;
    else if (tag === 'code') out = '`' + c.textContent + '`';
    else if (tag === 'a') out = `[${inner}](${c.getAttribute('href') || ''})`;
    else if (tag === 'img') return `![${c.getAttribute('alt') || ''}](${c.getAttribute('src') || ''})`;
    else if (tag === 'mark') out = `<mark>${inner}</mark>`;
    const fc = color || (tag === 'font' && c.getAttribute('color'));
    if (fc || bgc) out = `<span style="${fc ? `color:${rgbHex(fc)};` : ''}${bgc ? `background:${rgbHex(bgc)};` : ''}">${out}</span>`;
    return out;
  }).join('');
  const block = (n, depth = 0) => [...n.childNodes].map((c) => {
    if (c.nodeType === 3) return c.textContent.trim() ? c.textContent.trim() + '\n\n' : '';
    if (c.nodeType !== 1) return '';
    const tag = c.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(+tag[1]) + ' ' + inline(c).trim() + '\n\n';
    if (tag === 'p' || tag === 'div') { const t = inline(c).trim(); return t ? t + '\n\n' : (c.querySelector('p,ul,ol,h1,h2,h3,table,pre') ? block(c, depth) : ''); }
    if (tag === 'ul' || tag === 'ol') return [...c.children].filter((li) => li.tagName === 'LI').map((li, i) => {
      const nested = [...li.children].filter((x) => /^(UL|OL)$/.test(x.tagName));
      const clone = li.cloneNode(true); clone.querySelectorAll('ul,ol').forEach((x) => x.remove());
      return `${'  '.repeat(depth)}${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(clone).trim()}\n` + nested.map((x) => block({ childNodes: [x] }, depth + 1)).join('');
    }).join('') + (depth ? '' : '\n');
    if (tag === 'pre') { const code = c.querySelector('code'); const lang = (code && (code.className.match(/language-(\w+)/) || [])[1]) || ''; return '```' + lang + '\n' + c.textContent.replace(/\n$/, '') + '\n```\n\n'; }
    if (tag === 'blockquote') return block(c).trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
    if (tag === 'hr') return '---\n\n';
    if (tag === 'table') {
      const rows = [...c.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => inline(td).trim().replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      return [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n') + '\n\n';
    }
    return inline(c).trim() ? inline(c).trim() + '\n\n' : '';
  }).join('');
  return block(root).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function rgbHex(c) { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : c; }

// Markdown → DOCX blocks (headings, paragraphs, lists, code, bold/italic/colors).
function mdToBlocks(src) {
  const blocks = [];
  const runs = (tokens, fmt = {}) => (tokens || []).flatMap((tk) => {
    if (tk.type === 'strong') return runs(tk.tokens, { ...fmt, b: true });
    if (tk.type === 'em') return runs(tk.tokens, { ...fmt, i: true });
    if (tk.type === 'codespan') return [{ text: decodeEnt(tk.text), code: true, ...fmt }];
    if (tk.type === 'link') return runs(tk.tokens, fmt);
    if (tk.type === 'html') { const m = tk.raw.match(/color:\s*(#[0-9a-f]{3,6})/i); if (m) fmt.__color = m[1]; else if (/^<\/span/i.test(tk.raw)) delete fmt.__color; return []; }
    if (tk.type === 'br') return [{ text: '\n', ...fmt }];
    if (tk.tokens) return runs(tk.tokens, fmt);
    return [{ text: decodeEnt(tk.text || tk.raw || ''), ...fmt, color: fmt.__color }];
  });
  for (const tk of marked.lexer(src)) {
    if (tk.type === 'heading') blocks.push({ type: 'h' + Math.min(3, tk.depth), runs: runs(tk.tokens) });
    else if (tk.type === 'paragraph') blocks.push({ type: 'p', runs: runs(tk.tokens) });
    else if (tk.type === 'list') for (const it of tk.items) blocks.push({ type: tk.ordered ? 'oli' : 'li', runs: runs((it.tokens[0] && it.tokens[0].tokens) || it.tokens) });
    else if (tk.type === 'code') blocks.push({ type: 'code', runs: [{ text: tk.text }] });
    else if (tk.type === 'blockquote') blocks.push({ type: 'p', runs: runs(tk.tokens.flatMap((x) => x.tokens || []), { i: true }) });
    else if (tk.type === 'table') { blocks.push({ type: 'p', runs: [{ text: tk.header.map((h) => h.text).join('  |  '), b: true }] }); for (const r of tk.rows) blocks.push({ type: 'p', runs: [{ text: r.map((c) => c.text).join('  |  ') }] }); }
  }
  return blocks;
}
const decodeEnt = (s) => { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; };

// ───────────────────────────── viewer ─────────────────────────────
S.artCache = {};
async function openArtifact(id, v, opts = {}) {
  const a = await api.artifacts.get(id);
  if (!a) return toast(t('artMissing'), 'err');
  S.artCache[id] = a;
  S.viewer = { type: 'artifact', id, v: v ?? a.versions.length - 1, tab: 'preview', editing: false, ...opts };
  renderViewer();
}
const curArt = () => S.viewer && S.viewer.type === 'artifact' ? S.artCache[S.viewer.id] : null;

function artifactViewer() {
  const a = curArt(); const v = S.viewer;
  const ver = a.versions[v.v] || a.versions[a.versions.length - 1];
  const n = a.versions.length;
  const hasCode = a.type !== 'code';
  const editable = true;
  let body = '';
  if (v.editing) body = artEditor(a, ver);
  else if (v.tab === 'code' || a.type === 'code') body = `<div class="v-code"><pre><code class="hljs">${highlight(ver.content, a.type === 'code' ? a.lang : a.type === 'slides' || a.type === 'markdown' ? 'markdown' : a.type === 'svg' ? 'xml' : 'html').split('\n').map((l, i) => `<span class="ln" data-n="${i + 1}">${l || ' '}</span>`).join('\n')}</code></pre></div>`;
  else if (a.type === 'markdown') body = `<div class="v-doc md art-doc">${md(ver.content, 'art')}</div>`;
  else if (a.type === 'slides' && !htmlSlides(ver.content)) body = `<div class="deck">${splitSlides(ver.content).map((s, i) => slideHtml(s, i, a.style || DECK_THEMES[0])).join('')}</div>`;
  else body = `<iframe class="art-frame" sandbox="allow-scripts allow-forms allow-modals allow-popups" src="fabro-art://${esc(a.id)}/?v=${v.v}"></iframe>`;
  const tabs = hasCode && !v.editing ? `<div class="seg sm">${['preview', 'code'].map((k) => `<button class="${v.tab === k ? 'on' : ''}" data-action="art-tab" data-tab="${k}">${esc(t('artTab_' + k))}</button>`).join('')}</div>` : '';
  return `<div class="v-head art-head">
      <span class="ah-ico">${icon(typeIcon(a.type), 16)}</span>
      <span class="v-title" title="${esc(a.title)}">${esc(a.title)}</span>
      ${n > 1 ? `<span class="branch-nav"><button class="icon-btn xs" data-action="art-ver" data-dir="-1" ${v.v <= 0 ? 'disabled' : ''}>${icon('back', 13)}</button><span class="bn-n">v${v.v + 1}/${n}</span><button class="icon-btn xs" data-action="art-ver" data-dir="1" ${v.v >= n - 1 ? 'disabled' : ''}>${icon('forward', 13)}</button></span>` : ''}
      <div class="v-tools">${tabs}
        ${v.editing ? `<button class="btn sm" data-action="art-cancel">${esc(t('cancel'))}</button><button class="btn sm primary" data-action="art-save">${icon('check', 14)} ${esc(t('save'))}</button>`
          : `${editable ? `<button class="icon-btn sm" data-action="art-edit" title="${esc(t('artEdit'))}">${icon('edit', 16)}</button>` : ''}
             ${a.type === 'slides' && !htmlSlides(ver.content) ? `<button class="icon-btn sm" data-action="art-present" title="${esc(t('artPresent'))}">${icon('play', 16)}</button>` : ''}
             <button class="icon-btn sm" data-action="viewer-copy" title="${esc(t('copy'))}">${icon('copy', 16)}</button>
             <button class="icon-btn sm" data-action="art-export" title="${esc(t('artExport'))}">${icon('download', 16)}</button>`}
        <button class="icon-btn sm" data-action="viewer-close" title="${esc(t('close'))}">${icon('x', 17)}</button></div></div>
    ${v.v < n - 1 && !v.editing ? `<div class="art-old">${icon('info', 14)} ${esc(t('artOldVersion', { v: v.v + 1 }))} <button class="link-btn" data-action="art-restore">${esc(t('artRestore'))}</button></div>` : ''}
    <div class="v-body art-body">${body}</div>`;
}

const TEXT_COLORS = ['#1f1e1b', '#cf6a3c', '#d0342c', '#e8a23a', '#3f8f5a', '#2f6fdb', '#7b4fd6', '#8a857b'];
function richToolbar() {
  return `<div class="rt-bar">
    <button class="rt" data-cmd="bold" title="B"><b>B</b></button><button class="rt" data-cmd="italic"><i>I</i></button><button class="rt" data-cmd="strikeThrough"><s>S</s></button>
    <span class="rt-sep"></span>
    <button class="rt" data-cmd="formatBlock" data-arg="h1">H1</button><button class="rt" data-cmd="formatBlock" data-arg="h2">H2</button><button class="rt" data-cmd="formatBlock" data-arg="p">¶</button>
    <button class="rt" data-cmd="insertUnorderedList">•</button><button class="rt" data-cmd="insertOrderedList">1.</button>
    <span class="rt-sep"></span>
    ${TEXT_COLORS.map((c) => `<button class="rt-color" data-cmd="foreColor" data-arg="${c}" style="--c:${c}" title="${c}"></button>`).join('')}
    <label class="rt-color custom" title="${esc(t('artCustomColor'))}"><input type="color" data-cmd="foreColor"></label>
    <button class="rt" data-cmd="hiliteColor" data-arg="#ffe9a8" title="${esc(t('artHighlight'))}"><span class="hl">ab</span></button>
    <button class="rt" data-cmd="removeFormat" title="${esc(t('artClearFormat'))}">⨯</button>
  </div>`;
}
function artEditor(a, ver) {
  if (a.type === 'markdown') return `${richToolbar()}<div class="v-doc md art-doc editable" contenteditable="true" spellcheck="true" id="art-rich">${md(ver.content, 'art-edit')}</div>`;
  if (a.type === 'slides') {
    const st = a.style || DECK_THEMES[0];
    return `${richToolbar()}<div class="deck-theme">${DECK_THEMES.map((th, i) => `<button class="dt ${th.bg === st.bg && th.fg === st.fg ? 'on' : ''}" data-action="deck-theme" data-i="${i}" style="--sb:${th.bg};--sf:${th.fg};--sa:${th.accent}" title="${esc(th.name)}"><span>Aa</span></button>`).join('')}
      <label>${esc(t('artBg'))}<input type="color" value="${esc(st.bg)}" data-deck="bg"></label><label>${esc(t('artText'))}<input type="color" value="${esc(st.fg)}" data-deck="fg"></label><label>${esc(t('artAccent'))}<input type="color" value="${esc(st.accent)}" data-deck="accent"></label></div>
      <div class="deck editing" id="art-deck">${splitSlides(ver.content).map((s, i) => slideHtml(s, i, st, true)).join('')}</div>
      <button class="btn sm add-slide" data-action="slide-add">${icon('plus', 14)} ${esc(t('artAddSlide'))}</button>`;
  }
  return `<textarea class="art-src" id="art-src" spellcheck="false">${esc(ver.content)}</textarea>`;
}
function editorContent(a) {
  if (a.type === 'markdown') return htmlToMd($('#art-rich'));
  if (a.type === 'slides') return $$('#art-deck .slide-in').map((el) => htmlToMd(el).trim()).filter(Boolean).join('\n\n---\n\n') + '\n';
  return $('#art-src').value;
}
async function saveArtifactVersion(content, by = 'user') {
  const a = curArt();
  a.versions.push({ content, at: Date.now(), by });
  S.artCache[a.id] = await api.artifacts.save(a);
  S.viewer.v = a.versions.length - 1; S.viewer.editing = false;
  renderViewer();
}

// ───────────────────────────── export ─────────────────────────────
function docHtml(a, content, style) {
  const css = `body{font:15px/1.6 "Segoe UI",system-ui,sans-serif;color:#1f1e1b;max-width:760px;margin:40px auto;padding:0 24px}h1,h2,h3{font-family:Georgia,serif;line-height:1.2}code{background:#f2f0ea;padding:1px 5px;border-radius:4px}pre{background:#f2f0ea;padding:12px;border-radius:8px;white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}`;
  if (a.type === 'slides' && htmlSlides(content)) return /<body/i.test(content) ? content : `<!doctype html><html><head><meta charset="utf-8"></head><body class="deck">${content}</body></html>`;
  if (a.type === 'document') return /<body/i.test(content) ? content : `<!doctype html><html><head><meta charset="utf-8"></head><body class="doc">${content}</body></html>`;
  if (a.type === 'slides') {
    const st = style || DECK_THEMES[0];
    // printed deck: same slides, same automatic layouts as in the app
    return `<!doctype html><meta charset="utf-8"><style>@page{size:13.333in 7.5in;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .slide{position:relative;width:13.333in;height:7.5in;overflow:hidden;background:var(--sb);color:var(--sf);break-after:page;container-type:size}
      .slide-in{position:absolute;inset:0;padding:7% 8%;display:flex;flex-direction:column;justify-content:center;font-size:3cqw;line-height:1.4}
      .slide-in h1{font:600 6.5cqw/1.08 Georgia,serif;margin:0 0 .3em}.slide-in h2{font:600 4.6cqw/1.12 Georgia,serif;margin:0 0 .45em;color:var(--sa)}.slide-in strong{color:var(--sa)}.slide-in li{margin:.25em 0}.slide-in li::marker{color:var(--sa)}
      .slide-n{position:absolute;right:2.4%;bottom:3%;font-size:1.6cqw;opacity:.55}${SLIDE_LAYOUT_CSS}</style>${splitSlides(content).map((s, i) => slideHtml(s, i, st)).join('')}`;
  }
  if (a.type === 'markdown') return `<!doctype html><meta charset="utf-8"><title>${esc(a.title)}</title><style>${css}</style>${DOMPurify.sanitize(marked.parse(content))}`;
  if (a.type === 'svg') return `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;height:100vh}</style>${content}`;
  return content;
}
const EXT = { python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', lua: 'lua', luau: 'luau', rust: 'rs', go: 'go', java: 'java', cpp: 'cpp', c: 'c', csharp: 'cs', cs: 'cs', bash: 'sh', sh: 'sh', powershell: 'ps1', json: 'json', css: 'css', sql: 'sql', php: 'php', ruby: 'rb' };
function openExportMenu(anchor) {
  const a = curArt(); const r = anchor.getBoundingClientRect();
  const opts = a.type === 'markdown' ? [['docx', 'Word (.docx)'], ['pdf', 'PDF'], ['md', 'Markdown (.md)'], ['html', 'HTML']]
    : a.type === 'slides' ? (htmlSlides(a.versions[S.viewer.v].content) ? [['pdf', 'PDF'], ['html', 'HTML']] : [['pdf', 'PDF'], ['html', 'HTML'], ['md', 'Markdown (.md)']])
    : a.type === 'document' ? [['pdf', 'PDF'], ['html', 'HTML']]
    : a.type === 'html' ? [['html', 'HTML'], ['pdf', 'PDF']]
    : a.type === 'svg' ? [['svg', 'SVG'], ['pdf', 'PDF']]
    : [['code', `${t('artType_code')} (.${EXT[(a.lang || '').toLowerCase()] || 'txt'})`]];
  $('#popover-root').innerHTML = `<div class="pop-backdrop" data-action="close-pop"></div>
    <div class="popover" style="right:${Math.max(12, innerWidth - r.right)}px; top:${r.bottom + 6}px; min-width:220px">
      <div class="pm-sec">${esc(t('artExport'))}</div>
      ${opts.map(([k, l]) => `<button class="pm-item" data-action="art-export-as" data-fmt="${k}">${icon('download', 15)}<span class="pm-text"><b>${esc(l)}</b></span></button>`).join('')}
    </div>`;
}
async function exportAs(fmt) {
  const a = curArt(); const ver = a.versions[S.viewer.v]; const c = ver.content;
  closePopover();
  let r;
  if (fmt === 'docx') r = await api.exporter.save({ name: a.title, format: 'docx', blocks: mdToBlocks(c) });
  else if (fmt === 'pdf') r = await api.exporter.save({ name: a.title, format: 'pdf', html: docHtml(a, c, a.style), landscape: a.type === 'slides' });
  else if (fmt === 'html') r = await api.exporter.save({ name: a.title, format: 'html', content: docHtml(a, c, a.style) });
  else if (fmt === 'code') r = await api.exporter.save({ name: a.title, format: 'file', ext: EXT[(a.lang || '').toLowerCase()] || 'txt', content: c });
  else r = await api.exporter.save({ name: a.title, format: fmt, content: c });
  if (r) toast(t('artExported'));
}

// ───────────────────────────── presenter ─────────────────────────────
function present(start = 0) {
  const a = curArt(); const slides = splitSlides(a.versions[S.viewer.v].content); const st = a.style || DECK_THEMES[0];
  let i = start;
  const el = document.createElement('div');
  el.className = 'presenter';
  const draw = () => { el.innerHTML = `${slideHtml(slides[i], i, st)}<div class="pr-bar"><span>${i + 1} / ${slides.length}</span><button class="icon-btn sm" data-pr="x">${icon('x', 16)}</button></div>`; };
  const key = (e) => { if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) { i = Math.min(slides.length - 1, i + 1); draw(); } if (['ArrowLeft', 'PageUp'].includes(e.key)) { i = Math.max(0, i - 1); draw(); } if (e.key === 'Escape') close(); e.stopPropagation(); };
  const close = () => { document.removeEventListener('keydown', key, true); el.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-pr=x]')) return close(); i = Math.min(slides.length - 1, i + 1); draw(); });
  document.addEventListener('keydown', key, true);
  draw(); document.body.appendChild(el);
  el.requestFullscreen && el.requestFullscreen().catch(() => {});
}

// ───────────────────────────── gallery page ─────────────────────────────
async function loadArtifacts() { S.artList = await api.artifacts.list().catch(() => []); if (S.mode === 'artifacts') renderView(); }
function renderArtifactsPage() {
  if (!S.artList) { loadArtifacts(); return `<div class="page"><div class="muted">${esc(t('loading'))}</div></div>`; }
  const f = S.artFilter || 'all', q = (S.artQuery || '').toLowerCase();
  const list = S.artList.filter((a) => (f === 'all' || a.type === f) && (!q || a.title.toLowerCase().includes(q) || a.preview.toLowerCase().includes(q)));
  const counts = S.artList.reduce((o, a) => { o[a.type] = (o[a.type] || 0) + 1; return o; }, {});
  return `<div class="page art-page">
    <header class="pg-head"><div class="pg-ico">${icon('shapes', 22)}</div><div><h1>${esc(t('nav_artifacts'))}</h1><p>${esc(t('artLead'))}</p></div></header>
    <div class="art-filters">${['all', 'document', 'html', 'slides', 'svg', 'markdown', 'code'].filter((k) => k === 'all' || counts[k]).map((k) => `<button class="chip-btn ${f === k ? 'on' : ''}" data-action="art-filter" data-f="${k}">${k === 'all' ? esc(t('all')) : `${icon(typeIcon(k), 13)} ${esc(t('artType_' + k))}`} <small>${k === 'all' ? S.artList.length : counts[k]}</small></button>`).join('')}
      <span class="grow"></span><label class="sb-search art-search">${icon('search', 15)}<input id="art-q" type="search" value="${esc(S.artQuery || '')}" placeholder="${esc(t('artSearch'))}"></label></div>
    ${list.length ? `<div class="art-grid">${list.map((a, i) => `<div class="art-tile t-${a.type}" style="--i:${i}" data-action="art-open" data-id="${esc(a.id)}">
        <div class="at-prev">${artThumb(a.id, a.type, Math.max(0, (a.versions || 1) - 1), a.lang || '')}<span class="at-type">${icon(typeIcon(a.type), 14)}</span></div>
        <div class="at-meta"><b>${esc(a.title)}</b><small>${esc(t('artType_' + a.type))} · ${esc(new Date(a.updated).toLocaleDateString(S.lang, { day: 'numeric', month: 'short' }))}${a.versions > 1 ? ` · ${a.versions} versions` : ''}</small></div>
        <button class="icon-btn xs at-del" data-action="art-delete" data-id="${esc(a.id)}" title="${esc(t('delete'))}">${icon('trash', 13)}</button>
      </div>`).join('')}</div>` : `<div class="empty-note">${esc(S.artList.length ? t('noResults') : t('artEmpty'))}</div>`}
  </div>`;
}

// ───────────────────────────── actions ─────────────────────────────
Object.assign(actions, {
  'art-open': (el, e) => { if (e && e.target.closest('[data-action=art-delete]')) return; openArtifact(el.dataset.id, el.dataset.v != null ? +el.dataset.v : undefined); },
  'art-tab': (el) => { S.viewer.tab = el.dataset.tab; renderViewer(); },
  'art-ver': (el) => { const a = curArt(); S.viewer.v = Math.max(0, Math.min(a.versions.length - 1, S.viewer.v + (+el.dataset.dir))); renderViewer(); },
  'art-edit': () => { S.viewer.editing = true; renderViewer(); },
  'art-cancel': () => { S.viewer.editing = false; renderViewer(); },
  'art-save': () => saveArtifactVersion(editorContent(curArt())),
  'art-restore': () => saveArtifactVersion(curArt().versions[S.viewer.v].content),
  'art-export': (el) => openExportMenu(el),
  'art-export-as': (el) => exportAs(el.dataset.fmt),
  'art-present': () => present(0),
  'deck-theme': async (el) => { const a = curArt(); a.style = { ...DECK_THEMES[+el.dataset.i] }; const keep = $$('#art-deck .slide-in').map((x) => x.innerHTML); S.artCache[a.id] = await api.artifacts.save(a); renderViewer(); $$('#art-deck .slide-in').forEach((x, i) => { if (keep[i] != null) x.innerHTML = keep[i]; }); },
  'slide-add': () => { const deck = $('#art-deck'); const a = curArt(); const i = deck.children.length; deck.insertAdjacentHTML('beforeend', slideHtml(`## ${t('artNewSlide')}\n\n- …`, i, a.style || DECK_THEMES[0], true)); deck.lastElementChild.scrollIntoView({ behavior: 'smooth' }); },
  'art-filter': (el) => { S.artFilter = el.dataset.f; renderView(); },
  'art-delete': async (el, e) => { e.stopPropagation(); if (!confirm(t('artDeleteConfirm'))) return; await api.artifacts.delete(el.dataset.id); if (S.viewer && S.viewer.id === el.dataset.id) closeViewer(); loadArtifacts(); },
  'code-preview': async (el) => { const c = S.code.get(el.closest('.code-card').dataset.key); if (!c) return; const url = await api.exporter.preview(c.code); S.viewer = { type: 'htmlpreview', url, title: t('artPreview'), code: c.code }; renderViewer(); },
  'code-keep': async (el) => {
    const c = S.code.get(el.closest('.code-card').dataset.key); if (!c) return;
    const type = /^(html?)$/i.test(c.lang) ? 'html' : /^svg$/i.test(c.lang) ? 'svg' : 'code';
    const a = await api.artifacts.save({ id: 'art-' + uid(), convId: S.conv && S.conv.id, type, title: t('artType_' + type) + ' · ' + (S.conv && S.conv.title || ''), lang: c.lang, versions: [{ content: c.code, at: Date.now(), by: 'user' }] });
    toast(t('artKept')); openArtifact(a.id);
  },
});

function bindArtEditor() {
  const exec = (cmd, arg) => { document.execCommand('styleWithCSS', false, true); document.execCommand(cmd, false, arg); };
  $$('.rt-bar [data-cmd]').forEach((b) => {
    if (b.tagName === 'INPUT') { b.addEventListener('input', () => exec('foreColor', b.value)); return; }
    b.addEventListener('mousedown', (e) => { e.preventDefault(); const a = b.dataset.arg; exec(b.dataset.cmd, b.dataset.cmd === 'formatBlock' ? `<${a}>` : a); });
  });
  $$('[data-deck]').forEach((inp) => inp.addEventListener('input', () => {
    const a = curArt(); a.style = { ...(a.style || DECK_THEMES[0]), [inp.dataset.deck]: inp.value };
    $$('#art-deck .slide').forEach((s) => { s.style.setProperty('--sb', a.style.bg); s.style.setProperty('--sf', a.style.fg); s.style.setProperty('--sa', a.style.accent); });
  }));
  const src = $('#art-src'); if (src) src.focus();
}

document.addEventListener('input', (e) => { if (e.target.id === 'art-q') { S.artQuery = e.target.value; const pos = e.target.selectionStart; renderView(); const n = $('#art-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });

// The AI edited an artifact (edit_artifact): refresh it if it's open.
{
  const _onChatArt = onChatEvent;
  onChatEvent = function (ev) {
    _onChatArt(ev);
    if (ev && ev.type === 'artifact_updated' && S.viewer && S.viewer.type === 'artifact' && S.viewer.id === ev.id && !S.viewer.editing) {
      api.artifacts.get(ev.id).then((a) => { if (!a) return; S.artCache[a.id] = a; S.viewer.v = a.versions.length - 1; renderViewer(); }).catch(() => {});
    }
  };
}
