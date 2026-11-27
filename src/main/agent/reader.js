// Reading the web for real.
//   read_page: renders the page in a hidden browser window (JavaScript runs, like for a person), keeps the readable
//              part (article/main, headings, lists, tables, links, image captions), reads PDFs with pdf.js, and pages
//              long texts (page 1, 2…) instead of cutting at 14 000 characters like fetch_url.
//   research:  one search, then 5 to 8 pages read in parallel, cut into passages, ranked against the question
//              (embeddings when a local embedding model is installed, word overlap otherwise), returned with [n]
//              sources for a cited summary.
// Page content is data, never instructions (untrusted: wrapped before the model sees it).
const agent = require('./index');

const PAGE = 10000; // characters per page of reading
const cache = new Map(); // url → { at, title, text, images, pdf }

async function fetchPdf(url, buf) {
  const { getDocument } = await require('../pdfjs').load();
  const doc = await getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, 300); p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    out.push(`[page ${p}]\n` + c.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n'));
  }
  return { title: url.split('/').pop(), text: out.join('\n\n'), images: [], pdf: doc.numPages };
}

// Runs in the page: the readable part as light Markdown.
const EXTRACT = `(() => {
  const drop = 'script,style,noscript,svg,iframe,form,nav,footer,aside,header,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],.cookie,.cookies,#cookie,.consent,.newsletter,.advert,.ads,.ad';
  const pick = () => { const c = [...document.querySelectorAll('article,main,[role=main],#content,.content,.post,.article')].filter((e) => e.innerText.length > 400); return c.sort((a, b) => b.innerText.length - a.innerText.length)[0] || document.body; };
  const root = pick().cloneNode(true); root.querySelectorAll(drop).forEach((e) => e.remove());
  const out = []; const imgs = [];
  const walk = (n) => {
    if (n.nodeType === 3) { const t = n.textContent.replace(/\\s+/g, ' '); if (t.trim()) out.push(t); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (/^H[1-6]$/.test(tag)) { out.push('\\n\\n' + '#'.repeat(+tag[1]) + ' ' + n.innerText.trim() + '\\n'); return; }
    if (tag === 'LI') { out.push('\\n- '); n.childNodes.forEach(walk); return; }
    if (tag === 'TR') { out.push('\\n| ' + [...n.children].map((c) => c.innerText.trim().replace(/\\|/g, '/')).join(' | ') + ' |'); return; }
    if (tag === 'IMG') { const src = n.currentSrc || n.src; if (src && /^https?:/.test(src) && (n.naturalWidth || 0) > 120) { imgs.push({ src, alt: n.alt || '' }); if (n.alt) out.push(' [image: ' + n.alt + '] '); } return; }
    if (tag === 'A' && n.href && /^https?:/.test(n.href) && n.innerText.trim()) { out.push('[' + n.innerText.trim() + '](' + n.href + ')'); return; }
    if (tag === 'BR') { out.push('\\n'); return; }
    const block = /^(P|DIV|SECTION|BLOCKQUOTE|PRE|UL|OL|TABLE|FIGURE|FIGCAPTION|DL|DD|DT)$/.test(tag);
    if (block) out.push('\\n\\n');
    n.childNodes.forEach(walk);
    if (block) out.push('\\n');
  };
  walk(root);
  const text = out.join('').replace(/[ \\t]+/g, ' ').replace(/ *\\n */g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { title: document.title, text, images: imgs.slice(0, 40), url: location.href };
})()`;

async function render(url) {
  const { BrowserWindow, session } = require('electron');
  const ses = session.fromPartition('reader', { cache: true });
  const w = new BrowserWindow({ show: false, width: 1280, height: 1600, webPreferences: { session: ses, sandbox: true, contextIsolation: true, javascript: true, images: true, offscreen: false, backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([w.loadURL(url, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' }), new Promise((_, ko) => setTimeout(() => ko(new Error('page too slow (25 s)')), 25000))]);
    // let scripts finish and lazy content appear: two scrolls, a short wait
    await w.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight / 2); new Promise((r) => setTimeout(r, 700)).then(() => window.scrollTo(0, document.body.scrollHeight))').catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    return await w.webContents.executeJavaScript(EXTRACT);
  } finally { if (!w.isDestroyed()) w.destroy(); }
}

async function load(url) {
  const hit = cache.get(url); if (hit && Date.now() - hit.at < 10 * 60000) return hit;
  const { net } = require('electron');
  let r = null;
  if (/\.pdf(\?|#|$)/i.test(url)) r = await net.fetch(url, { redirect: 'follow' }).catch(() => null);
  else { const h = await net.fetch(url, { method: 'HEAD', redirect: 'follow' }).catch(() => null); if (h && /pdf/i.test(h.headers.get('content-type') || '')) r = await net.fetch(url, { redirect: 'follow' }).catch(() => null); }
  let page;
  if (r && r.ok) page = await fetchPdf(url, Buffer.from(await r.arrayBuffer()));
  else {
    try { page = await render(url); }
    catch (e) { const f = await require('../tools').fetchUrl(url); page = { title: f.title, text: f.text, images: [], fallback: String(e.message || e) }; }
  }
  const out = { at: Date.now(), url, ...page };
  cache.set(url, out); if (cache.size > 60) cache.delete(cache.keys().next().value);
  return out;
}

agent.register({
  name: 'read_page', category: 'web', risk: 'net', untrusted: true, noMcpWrap: true,
  description: 'Read a web page or online PDF fully, as a person sees it (JavaScript runs). Long texts come in pages of ~10 000 characters: page 1, then 2… Lists the images of the page. Prefer it to fetch_url.',
  example: 'read_page({ url: "https://example.com/article", page: 2 })',
  fallback: 'fetch_url for plain text, or research to read several pages at once',
  parameters: { type: 'object', properties: { url: { type: 'string' }, page: { type: 'number', description: 'Page of the text, from 1' } }, required: ['url'] },
  summarize: (a) => a.url,
  async run(a) {
    const url = String(a.url || '').trim(); if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');
    const p = await load(url);
    const pages = Math.max(1, Math.ceil(p.text.length / PAGE)); const n = Math.min(pages, Math.max(1, Math.round(Number(a.page) || 1)));
    const imgs = n === 1 && p.images.length ? `\n\nImages on the page:\n${p.images.slice(0, 15).map((i) => `- ${i.alt || '(no caption)'} ${i.src}`).join('\n')}` : '';
    return {
      content: `${p.title || url}\n${url}\nPage ${n}/${pages}${p.pdf ? ` · PDF, ${p.pdf} pages` : ''}${p.fallback ? ' · (simple read: ' + p.fallback + ')' : ''}\n\n${p.text.slice((n - 1) * PAGE, n * PAGE)}${n < pages ? `\n\n(More: read_page with page ${n + 1})` : ''}${imgs}`,
      view: { kind: 'fetch', url, title: p.title || url, page: n, pages, chars: p.text.length, sources: [{ url, title: p.title || url }] },
    };
  },
});

// ───────────────────────────── research ─────────────────────────────
const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
function passages(text, size = 900) {
  const out = []; let cur = '';
  for (const para of String(text).split(/\n{2,}/)) {
    if ((cur + '\n\n' + para).length > size && cur) { out.push(cur.trim()); cur = ''; }
    cur += (cur ? '\n\n' : '') + para;
    while (cur.length > size * 1.6) { out.push(cur.slice(0, size).trim()); cur = cur.slice(size); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((p) => p.length > 80);
}
async function rank(question, items) {
  try {
    const rag = require('../rag');
    const q = await rag.embed([question], 'query');
    if (q && q[0]) {
      const v = await rag.embed(items.map((x) => x.text.slice(0, 1500)), 'doc');
      if (v) return items.map((x, i) => ({ ...x, s: v[i].reduce((s, y, k) => s + y * q[0][k], 0) })).sort((a, b) => b.s - a.s);
    }
  } catch {}
  const qw = new Set(words(question)); const df = new Map();
  for (const x of items) for (const w of new Set(words(x.text))) df.set(w, (df.get(w) || 0) + 1);
  return items.map((x) => { const ws = words(x.text); let s = 0; for (const w of ws) if (qw.has(w)) s += Math.log(1 + items.length / (df.get(w) || 1)); return { ...x, s: s / Math.sqrt(ws.length + 20) }; }).sort((a, b) => b.s - a.s);
}

agent.register({
  name: 'research', category: 'web', risk: 'net', untrusted: true, noMcpWrap: true, keywords: ['recherche', 'research', 'compare', 'comparatif', 'sources', 'study', 'étude', 'avis', 'review'],
  description: 'Research a question on the web: searches, reads 5 to 8 pages fully, keeps the passages that answer best and gives them with numbered sources. Then write a summary that cites [n]. Use for anything that needs several sources.',
  example: 'research({ question: "meilleur vélo cargo pour deux enfants à moins de 2000 euros", pages: 6 })',
  fallback: 'web_search then read_page on the best results',
  parameters: { type: 'object', properties: { question: { type: 'string' }, pages: { type: 'number', description: '5 to 8 (default 6)' }, query: { type: 'string', description: 'Search words if different from the question' } }, required: ['question'] },
  summarize: (a) => a.question,
  async run(a, ctx) {
    const tools = require('../tools');
    const n = Math.max(3, Math.min(8, Math.round(Number(a.pages) || 6)));
    const r = await tools.webSearch(String(a.query || a.question).slice(0, 300), ctx, { count: 15 });
    const seen = new Set();
    const urls = (r.results || []).map((x) => x.url).filter((u) => { try { const h = new URL(u).hostname; if (seen.has(h) || /youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com/.test(h)) return false; seen.add(h); return true; } catch { return false; } }).slice(0, n);
    if (!urls.length) throw new Error('No results to read. Try other words.');
    const read = []; let i = 0;
    const worker = async () => { while (i < urls.length) { const u = urls[i++]; ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, text: u, pct: Math.round(i / urls.length * 100) }); try { const p = await load(u); if (p.text && p.text.length > 200) read.push(p); } catch {} } };
    await Promise.all([worker(), worker(), worker()]);
    if (!read.length) throw new Error('None of the pages could be read.');
    const sources = read.map((p) => ({ url: p.url, title: p.title || p.url }));
    const items = read.flatMap((p, k) => passages(p.text).slice(0, 60).map((text) => ({ src: k + 1, text })));
    const best = (await rank(String(a.question), items)).slice(0, 14);
    let budget = 11000; const picked = [];
    for (const b of best) { if (budget - b.text.length < 0) continue; budget -= b.text.length; picked.push(b); }
    return {
      content: `Question: ${a.question}\n\nSources read:\n${sources.map((s, k) => `[${k + 1}] ${s.title} · ${s.url}`).join('\n')}\n\nBest passages:\n${picked.map((p) => `[${p.src}] ${p.text}`).join('\n\n')}\n\nWrite the answer from these passages only, cite each claim as [n], say what the sources disagree on, and what they don't say.`,
      view: { kind: 'research', question: a.question, read: read.length, sources },
    };
  },
});

module.exports = { load, render };
