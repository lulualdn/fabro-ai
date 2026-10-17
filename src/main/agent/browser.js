// Built-in browser for the agent: isolated WebContentsViews (own cookies/session, separate from the
// user's browsers) shown live in the agent workspace, with tabs. Built for an AI: SearXNG search,
// readable-page extraction, find-in-page, element ids, cookie banners dismissed, ads/trackers blocked.
// The user can take control at any time.
const { WebContentsView } = require('electron');
const agent = require('./index');
const store = require('../store');

let host = null, emit = () => {};
let bounds = { x: 0, y: 0, width: 0, height: 0 }, shown = false;
let userControl = false;
const tabs = []; // { id, view }
let active = -1, nextId = 1;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const bs = () => store.getSettings().browser || {};

const cur = () => tabs[active] && tabs[active].view;
function state() {
  const v = cur();
  if (!v) return { open: false, userControl, tabs: [] };
  const wc = v.webContents;
  return {
    open: true, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(), zoom: wc.getZoomFactor(), userControl,
    tabs: tabs.map((t, i) => ({ id: t.id, title: t.view.webContents.getTitle() || t.view.webContents.getURL(), url: t.view.webContents.getURL(), active: i === active, loading: t.view.webContents.isLoading() })),
  };
}
let pubT = null;
const publish = () => { clearTimeout(pubT); pubT = setTimeout(() => emit('browser:state', state()), 30); };

// Light ad / tracker blocklist: faster pages, less noise for the model.
const ADS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|google-analytics\.com|googletagservices\.com|adnxs\.com|taboola\.com|outbrain\.com|criteo\.(com|net)|amazon-adsystem\.com|scorecardresearch\.com|hotjar\.com|quantserve\.com|moatads\.com|pubmatic\.com|rubiconproject\.com|openx\.net|casalemedia\.com|smartadserver\.com|teads\.tv|adsrvr\.org|yieldmo\.com|zedo\.com|mgid\.com|revcontent\.com|ads-twitter\.com|facebook\.net)$/i;
let sessionReady = false;
function setupSession(ses) {
  if (sessionReady) return; sessionReady = true;
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    if (bs().blockAds === false || d.resourceType === 'mainFrame') return cb({});
    let h = ''; try { h = new URL(d.url).hostname; } catch {}
    cb({ cancel: ADS.test(h) });
  });
  ses.on('will-download', (e, item) => {
    // Downloads only when the user allowed it for this action (guardrail).
    if (!pendingDownloadOk) { e.preventDefault(); emit('browser:blocked', { kind: 'download', file: item.getFilename() }); }
  });
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen'].includes(perm)));
}

function newTab(url, focus = true) {
  const view = new WebContentsView({ webPreferences: { partition: 'persist:fabro-browser', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  view.setBackgroundColor('#ffffff');
  host.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  setupSession(wc.session);
  wc.setUserAgent(UA);
  wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) newTab(u, true); return { action: 'deny' }; });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, publish);
  wc.on('did-stop-loading', () => { if (bs().autoConsent !== false) wc.executeJavaScript(CONSENT, true).catch(() => {}); });
  const t = { id: nextId++, view };
  tabs.push(t);
  if (focus) activate(tabs.length - 1);
  if (url) wc.loadURL(url).catch(() => {});
  publish();
  return t;
}
function activate(i) {
  if (i < 0 || i >= tabs.length) return;
  tabs.forEach((t, k) => { if (k !== i) t.view.setVisible(false); });
  active = i;
  tabs[i].view.setBounds(bounds); tabs[i].view.setVisible(shown);
  publish();
}
function closeTab(i) {
  const t = tabs[i]; if (!t) return;
  try { host.contentView.removeChildView(t.view); } catch {}
  try { t.view.webContents.close(); } catch {}
  tabs.splice(i, 1);
  if (!tabs.length) { active = -1; publish(); return; }
  activate(Math.min(i, tabs.length - 1));
}
function ensure() { if (!cur()) newTab(null, true); return cur(); }
let pendingDownloadOk = false;

function setBounds(b) {
  bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
  shown = !!b.visible && bounds.width > 20 && bounds.height > 20;
  const v = cur(); if (!v) return;
  v.setBounds(bounds);
  v.setVisible(shown);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(wc, timeout = 20000) {
  const t0 = Date.now();
  await wait(150);
  while (wc.isLoading() && Date.now() - t0 < timeout) await wait(150);
  await wait(300);
}
function blockIfUser() { if (userControl) throw Object.assign(new Error('The user has taken control of the browser. Wait for them to hand it back.'), { code: 'USER_CONTROL' }); }

// Cookie / consent banners: prefer "reject" / "only necessary", else close; never "accept all" silently.
const CONSENT = `(() => {
  const words = /^(tout refuser|refuser tout|refuser|continuer sans accepter|reject all|reject|decline|only necessary|necessary only|use necessary cookies only|nur notwendige|alle ablehnen|ablehnen|rechazar todo|rechazar|solo necesarias)$/i;
  const roots = [document, ...[...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)].slice(0, 40);
  for (const r of roots) for (const b of r.querySelectorAll('button,[role=button],a')) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
    if (t.length < 40 && words.test(t)) { const box = b.getBoundingClientRect(); if (box.width && box.height) { b.click(); return t; } }
  }
  return null;
})()`;

const READ = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > -40 && r.top < innerHeight * 2.5; };
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[contenteditable=true],summary,label[for]';
  document.querySelectorAll('[data-fabro-id]').forEach((e) => e.removeAttribute('data-fabro-id'));
  const els = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (n >= 180 || !vis(el)) continue;
    const id = ++n; el.setAttribute('data-fabro-id', String(id));
    const lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const label = (el.getAttribute('aria-label') || lab || el.innerText || el.placeholder || el.title || el.getAttribute('alt') || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
    const o = { id, tag: el.tagName.toLowerCase(), label };
    if (el.type && el.tagName !== 'BUTTON') o.type = el.type;
    if (el.getAttribute('role')) o.role = el.getAttribute('role');
    if (el.href) o.href = String(el.href).slice(0, 140);
    if (el.disabled) o.disabled = true;
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'password' && el.value && !['checkbox', 'radio', 'submit', 'button'].includes(el.type)) o.value = String(el.value).slice(0, 60);
    if (el.type === 'checkbox' || el.type === 'radio') o.checked = el.checked;
    if (el.getAttribute('aria-checked')) o.checked = el.getAttribute('aria-checked') === 'true';
    if (el.getAttribute('aria-expanded')) o.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.tagName === 'SELECT') { o.value = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''; o.options = [...el.options].slice(0, 25).map((x) => x.text.trim()).join(' | '); }
    els.push(o);
  }
  const main = document.querySelector('main, article, [role=main]') || document.body;
  const text = (main ? main.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 9000);
  const dialog = [...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]')].filter(vis).map((d) => d.innerText.slice(0, 300)).join(' | ');
  return { url: location.href, title: document.title, text, dialog, elements: els, scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight } };
})()`;

// Readable page as Markdown (headings, lists, tables, links), for research.
const EXTRACT = `(() => {
  const root = document.querySelector('article, main, [role=main], #content, .content, #main') || document.body;
  const skip = /^(script|style|noscript|svg|nav|footer|header|form|iframe|template|aside|button|select)$/i;
  const out = []; const links = [];
  const inline = (n) => {
    if (n.nodeType === 3) return n.nodeValue.replace(/\\s+/g, ' ');
    if (n.nodeType !== 1 || skip.test(n.tagName)) return '';
    const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return '';
    const t = [...n.childNodes].map(inline).join('');
    if (n.tagName === 'A' && n.href && /^https?:/.test(n.href) && t.trim()) { links.push(n.href); return '[' + t.trim() + '](' + n.href + ')'; }
    if (/^(B|STRONG)$/.test(n.tagName) && t.trim()) return '**' + t.trim() + '** ';
    if (n.tagName === 'CODE') return '\`' + t + '\`';
    if (n.tagName === 'BR') return '\\n';
    if (n.tagName === 'IMG' && n.alt) return '[image: ' + n.alt + ']';
    return t;
  };
  const block = (n, depth) => {
    if (n.nodeType !== 1 || skip.test(n.tagName)) return;
    const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return;
    const tg = n.tagName;
    if (/^H[1-6]$/.test(tg)) { out.push('\\n' + '#'.repeat(+tg[1]) + ' ' + n.innerText.trim()); return; }
    if (tg === 'P' || tg === 'BLOCKQUOTE' || tg === 'FIGCAPTION' || tg === 'DD' || tg === 'DT') { const t = inline(n).trim(); if (t) out.push((tg === 'BLOCKQUOTE' ? '> ' : '') + t); return; }
    if (tg === 'PRE') { out.push('\`\`\`\\n' + n.innerText.slice(0, 4000) + '\\n\`\`\`'); return; }
    if (tg === 'UL' || tg === 'OL') { [...n.children].filter((c) => c.tagName === 'LI').forEach((li, i) => { const t = inline(li).trim(); if (t) out.push('  '.repeat(depth) + (tg === 'OL' ? (i + 1) + '. ' : '- ') + t.slice(0, 600)); }); return; }
    if (tg === 'TABLE') { const rows = [...n.rows].slice(0, 60).map((r) => '| ' + [...r.cells].map((c) => c.innerText.trim().replace(/\\s+/g, ' ').replace(/\\|/g, '/').slice(0, 80)).join(' | ') + ' |'); if (rows.length) { const cols = (rows[0].match(/\\|/g) || []).length - 1; rows.splice(1, 0, '|' + ' --- |'.repeat(Math.max(1, cols))); out.push(rows.join('\\n')); } return; }
    const kids = [...n.children];
    if (!kids.length || kids.every((k) => /^(A|SPAN|B|STRONG|EM|I|CODE|SMALL|BR|IMG|SUP|SUB|MARK|TIME|ABBR)$/.test(k.tagName))) { const t = inline(n).trim(); if (t) out.push(t); return; }
    kids.forEach((k) => block(k, depth + (tg === 'LI' ? 1 : 0)));
  };
  block(root, 0);
  const md = out.join('\\n\\n').replace(/\\n{3,}/g, '\\n\\n');
  const meta = (k) => (document.querySelector('meta[name="' + k + '"],meta[property="' + k + '"]') || {}).content || '';
  return { url: location.href, title: document.title, description: meta('description') || meta('og:description'), author: meta('author'), date: meta('article:published_time') || (document.querySelector('time[datetime]') || {}).dateTime || '', md, links: links.length };
})()`;

async function read() {
  const wc = ensure().webContents;
  const r = await wc.executeJavaScript(READ, true);
  const flags = (e) => [e.value != null && e.value !== '' ? `value="${e.value}"` : '', e.checked != null ? (e.checked ? 'checked' : 'unchecked') : '', e.expanded != null ? (e.expanded ? 'expanded' : 'collapsed') : '', e.disabled ? 'disabled' : '', e.options ? `options: ${e.options}` : ''].filter(Boolean).join(', ');
  const list = r.elements.map((e) => `[${e.id}] ${e.tag}${e.type ? `:${e.type}` : ''}${e.role ? `(${e.role})` : ''} ${e.label}${e.href ? ` → ${e.href}` : ''}${flags(e) ? ` (${flags(e)})` : ''}`).join('\n');
  const st = state();
  return {
    content: `URL: ${r.url}\nTitle: ${r.title}\nTabs: ${st.tabs.length} (active ${active + 1})\nScroll: ${r.scroll.y}/${r.scroll.height} (viewport ${r.scroll.viewport})${r.dialog ? `\nOpen dialog: ${r.dialog}` : ''}\n\nInteractive elements (use their [id]):\n${list}\n\nPage text:\n${r.text}\n\n(For the full readable text of a long page, use browser_extract.)`,
    view: { kind: 'page', url: r.url, title: r.title, elements: r.elements.length },
  };
}

async function elementInfo(id) {
  const wc = ensure().webContents;
  return wc.executeJavaScript(`(() => { const el = document.querySelector('[data-fabro-id="${Number(id)}"]'); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), autocomplete: (el.autocomplete || '').toLowerCase(), name: (el.name || '').toLowerCase(),
      label: (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().slice(0, 120), form: !!el.form }; })()`, true);
}
async function clickAt(x, y) {
  const wc = ensure().webContents;
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}
const KEYMAP = { enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', space: 'Space', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End' };
function pressKey(combo) {
  const wc = ensure().webContents;
  const parts = String(combo).split('+').map((s) => s.trim());
  const key = parts.pop();
  const modifiers = parts.map((m) => ({ ctrl: 'control', control: 'control', cmd: 'meta', meta: 'meta', alt: 'alt', shift: 'shift' }[m.toLowerCase()] || m.toLowerCase()));
  const keyCode = KEYMAP[key.toLowerCase()] || key;
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta')) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
const isSecretField = (i) => i && (i.type === 'password' || /password|current-password|new-password|cc-|one-time-code/.test(i.autocomplete) || /pass(word)?|mdp|cvv|cvc|card/.test(i.name));

// CSS selector → an element id usable by the other tools (the element is tagged like browser_read does).
async function idFor(selector) {
  const r = await ensure().webContents.executeJavaScript(`(() => { let el; try { el = document.querySelector(${JSON.stringify(String(selector))}); } catch { return 'bad'; } if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (!el.dataset.fabroId) { window.__fabroSel = (window.__fabroSel || 9000) + 1; el.dataset.fabroId = String(window.__fabroSel); } return +el.dataset.fabroId; })()`, true);
  if (r === 'bad') throw new Error(`Invalid CSS selector: ${selector}`);
  if (r == null) throw new Error(`No element matches ${selector}`);
  await wait(120);
  return r;
}
const withSel = async (a) => { if (a.selector && a.id == null) a.id = await idFor(a.selector); return a; };
async function shot() {
  const wc = ensure().webContents;
  let img = await wc.capturePage();
  const size = img.getSize();
  if (size.width > 1280) img = img.resize({ width: 1280 });
  return 'data:image/jpeg;base64,' + img.toJPEG(72).toString('base64');
}
function normUrl(u) { let url = String(u).trim(); if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url; if (!/^https?:/i.test(url)) throw new Error('Only http(s) pages'); return url; }
async function go(url) { const wc = ensure().webContents; emit('browser:focus', {}); await wc.loadURL(url).catch(() => {}); await settle(wc); }

// Search page for the address bar / browser_search: SearXNG when available, DuckDuckGo otherwise.
async function searchPage(q) {
  const searxng = require('../searxng');
  const s = store.getSettings().search || {};
  if ((s.engine || 'searxng') === 'searxng' && (s.searxngUrl || searxng.installed())) { try { return await searxng.homeUrl(s, q); } catch {} }
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

const common = { category: 'browser', untrusted: true };
agent.register({ ...common, name: 'browser_search', risk: 'net', core: true, keywords: ['cherche', 'recherche', 'search', 'trouve', 'find'],
  description: 'Search the web with SearXNG (many engines at once) and show the results page in Fabro’s browser. Returns numbered results with snippets, plus direct answers/infobox when available. Then open the best results with browser_open (or browser_extract after opening).',
  parameters: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: ['general', 'news', 'science', 'it', 'images', 'videos', 'map'] }, time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'] }, page: { type: 'integer' } }, required: ['query'] },
  summarize: (a) => a.query,
  async run(a, ctx) {
    const tools = require('../tools');
    const r = await tools.webSearch(String(a.query).slice(0, 300), { needDeps: ctx.needDeps }, { category: a.category, time: a.time_range, page: a.page });
    if (!userControl) { const url = r.pageUrl || await searchPage(a.query); const wc = ensure().webContents; emit('browser:focus', {}); wc.loadURL(url).catch(() => {}); }
    return tools.searchResult(r, a.query, ctx);
  } });
agent.register({ ...common, name: 'browser_open', risk: 'net', core: true, keywords: ['site', 'web', 'page', 'navigat', 'browser', 'navigateur', 'clique', 'click', 'formulaire', 'form', 'connecte', 'login'],
  description: 'Open a URL in Fabro’s built-in browser (visible to the user) and return the page text and its interactive elements with [id]s. new_tab=true keeps the current page open in another tab.',
  parameters: { type: 'object', properties: { url: { type: 'string' }, new_tab: { type: 'boolean' } }, required: ['url'] },
  summarize: (a) => a.url,
  async run(a) {
    blockIfUser();
    const url = normUrl(a.url);
    if (a.new_tab && cur()) newTab(null, true);
    await go(url);
    return read();
  } });
agent.register({ ...common, name: 'browser_read', risk: 'read', categoryCore: true,
  description: 'Read the current page again: text and interactive elements with [id]s, their values and states (after scrolling, typing or waiting).',
  parameters: { type: 'object', properties: {} }, summarize: () => state().url || '', async run() { return read(); } });
agent.register({ ...common, name: 'browser_extract', risk: 'read', categoryCore: true,
  description: 'Get the full readable content of the current page as Markdown (headings, lists, tables, links) — best for articles, docs and research. Long pages come in parts: pass part=2, 3…',
  parameters: { type: 'object', properties: { part: { type: 'integer' } } }, summarize: () => state().url || '',
  async run(a) {
    const r = await ensure().webContents.executeJavaScript(EXTRACT, true);
    const size = 12000; const parts = Math.max(1, Math.ceil(r.md.length / size)); const p = Math.min(Math.max(1, a.part || 1), parts);
    const head = `# ${r.title}\nURL: ${r.url}${r.author ? `\nAuthor: ${r.author}` : ''}${r.date ? `\nDate: ${r.date}` : ''}${r.description ? `\nSummary: ${r.description}` : ''}\nPart ${p}/${parts}\n\n`;
    return { content: head + r.md.slice((p - 1) * size, p * size), view: { kind: 'extract', url: r.url, title: r.title, part: p, parts } };
  } });
agent.register({ ...common, name: 'browser_find', risk: 'read', categoryCore: true,
  description: 'Find text in the current page: returns each match with its surrounding text and scrolls to the first one.',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, summarize: (a) => a.text,
  async run(a) {
    const q = JSON.stringify(String(a.text).toLowerCase());
    const r = await ensure().webContents.executeJavaScript(`(() => { const q = ${q}; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const hits = []; let first = null, n;
      while ((n = w.nextNode()) && hits.length < 25) { const t = n.nodeValue; const i = t.toLowerCase().indexOf(q); if (i < 0) continue; const el = n.parentElement; if (!el || !el.getClientRects().length) continue; first = first || el;
        const ctx = (el.closest('p,li,td,div,section') || el).innerText.replace(/\\s+/g, ' '); const j = ctx.toLowerCase().indexOf(q); hits.push(ctx.slice(Math.max(0, j - 140), j + q.length + 140)); }
      if (first) first.scrollIntoView({ block: 'center' }); return hits; })()`, true);
    return { content: r.length ? `${r.length} match(es):\n${r.map((h, i) => `${i + 1}. …${h}…`).join('\n')}` : 'Not found on this page.', view: { kind: 'find', n: r.length } };
  } });
agent.register({ ...common, name: 'browser_click', risk: 'net', categoryCore: true,
  description: 'Click an element by its [id] from browser_read or a CSS `selector` (or at x,y in the viewport). Purchases, sending, publishing, deleting or downloading always ask the user first.',
  parameters: { type: 'object', properties: { id: { type: 'integer' }, selector: { type: 'string', description: 'CSS selector, instead of id' }, x: { type: 'number' }, y: { type: 'number' } } },
  summarize: (a) => (a.id != null ? `#${a.id}` : `${a.x},${a.y}`),
  async guard(a) { await withSel(a); if (a.id == null) return null; const i = await elementInfo(a.id); if (!i) return { refuse: `element ${a.id} not found — call browser_read again` }; return agent.SENSITIVE.test(i.label) || (i.type === 'submit' && i.form) ? { confirm: `click « ${i.label || i.tag} »` } : null; },
  async run(a, ctx) { await withSel(a);
    blockIfUser();
    let x = a.x, y = a.y, label = '';
    if (a.id != null) { const i = await elementInfo(a.id); if (!i) throw new Error(`Element ${a.id} not found — call browser_read again`); x = i.x; y = i.y; label = i.label; }
    pendingDownloadOk = !!ctx.lastConfirmed;
    const before = tabs.length;
    await clickAt(Math.round(x), Math.round(y)); await settle(ensure().webContents, 12000);
    pendingDownloadOk = false;
    const r = await read(); r.view = { ...r.view, kind: 'click', label };
    if (tabs.length > before) r.content = '(The click opened a new tab, now active.)\n' + r.content;
    return r;
  } });
agent.register({ ...common, name: 'browser_type', risk: 'net', categoryCore: true,
  description: 'Type text into a field by [id] or CSS `selector` (clears it first unless append=true). Set submit=true to press Enter after. Never used for passwords or card numbers: the user types those themselves.',
  parameters: { type: 'object', properties: { id: { type: 'integer' }, selector: { type: 'string', description: 'CSS selector, instead of id' }, text: { type: 'string' }, append: { type: 'boolean' }, submit: { type: 'boolean' } }, required: ['text'] },
  summarize: (a) => `#${a.id}: ${String(a.text).slice(0, 80)}`,
  async guard(a) { await withSel(a); const i = await elementInfo(a.id); if (!i) return { refuse: `element ${a.id} not found — call browser_read again` }; if (isSecretField(i)) return { refuse: 'Fabro never types passwords, codes or card numbers. Ask the user to type it in the browser panel themselves.' }; return a.submit && agent.SENSITIVE.test(i.label) ? { confirm: 'submit' } : null; },
  async run(a) { await withSel(a);
    blockIfUser();
    const wc = ensure().webContents;
    const i = await elementInfo(a.id); if (!i) throw new Error('Element not found');
    await clickAt(Math.round(i.x), Math.round(i.y));
    if (!a.append) await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-fabro-id="${Number(a.id)}"]'); if (!el) return; if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } else if (el.isContentEditable) el.textContent = ''; })()`);
    await wc.insertText(String(a.text));
    if (a.submit) { pressKey('Enter'); await settle(wc, 15000); }
    else await wait(200);
    const r = await read(); r.view = { ...r.view, kind: 'type', label: i.label }; return r;
  } });
agent.register({ ...common, name: 'browser_select', risk: 'net', categoryCore: true,
  description: 'Choose an option in a <select> by [id], by its visible text or value.',
  parameters: { type: 'object', properties: { id: { type: 'integer' }, selector: { type: 'string', description: 'CSS selector, instead of id' }, option: { type: 'string' } }, required: ['option'] },
  summarize: (a) => `#${a.id}: ${a.option}`,
  async run(a) { await withSel(a);
    blockIfUser();
    const ok = await ensure().webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-fabro-id="${Number(a.id)}"]'); if (!el || el.tagName !== 'SELECT') return 'not a select';
      const o = ${JSON.stringify(String(a.option).toLowerCase())}; const opt = [...el.options].find((x) => x.text.trim().toLowerCase() === o || x.value.toLowerCase() === o) || [...el.options].find((x) => x.text.toLowerCase().includes(o));
      if (!opt) return 'option not found'; el.value = opt.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`, true);
    if (ok !== 'ok') throw new Error(ok);
    await wait(300); return read();
  } });
agent.register({ ...common, name: 'browser_key', risk: 'net', categoryCore: true,
  description: 'Press a key or shortcut in the page: Enter, Tab, Escape, ArrowDown, PageDown, Ctrl+A…',
  parameters: { type: 'object', properties: { key: { type: 'string' }, selector: { type: 'string', description: 'Focus this element first (CSS selector)' } }, required: ['key'] },
  summarize: (a) => a.key,
  async run(a) { if (a.selector) { const id = await idFor(a.selector); await ensure().webContents.executeJavaScript(`document.querySelector('[data-fabro-id="${id}"]').focus()`, true).catch(() => {}); } blockIfUser(); pressKey(a.key); await settle(ensure().webContents, 8000); return { content: `Pressed ${a.key}. Call browser_read to see the result.`, view: { kind: 'key', key: a.key } }; } });
agent.register({ ...common, name: 'browser_scroll', risk: 'read', categoryCore: true,
  description: 'Scroll the page: direction down/up (by about one screen, or `amount` in pixels), or to an element [id].',
  parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] }, amount: { type: 'integer' }, id: { type: 'integer' } } },
  summarize: (a) => a.id != null ? `#${a.id}` : (a.direction || 'down'),
  async run(a) {
    blockIfUser();
    const wc = ensure().webContents;
    const js = a.id != null ? `document.querySelector('[data-fabro-id="${Number(a.id)}"]')?.scrollIntoView({block:'center'})`
      : a.direction === 'top' ? 'scrollTo(0,0)' : a.direction === 'bottom' ? 'scrollTo(0,document.documentElement.scrollHeight)'
      : `scrollBy(0, ${(a.direction === 'up' ? -1 : 1) * (Number(a.amount) || 'innerHeight*0.85')})`;
    await wc.executeJavaScript(js); await wait(350);
    return read();
  } });
agent.register({ ...common, name: 'browser_wait', risk: 'read', categoryCore: true,
  description: 'Wait for a condition: some `text` appears, or an element (`selector`) appears or disappears (`state`: visible | hidden); or just `seconds`. Use it after slow loads, uploads, searches.',
  parameters: { type: 'object', properties: { text: { type: 'string' }, selector: { type: 'string' }, state: { type: 'string', enum: ['visible', 'hidden'] }, seconds: { type: 'number', description: 'Timeout (max 60)' } } },
  summarize: (a) => a.text || (a.selector ? `${a.selector} ${a.state || 'visible'}` : `${a.seconds || 2} s`),
  async run(a) {
    const wc = ensure().webContents; const t0 = Date.now(); const lim = Math.min(60, a.seconds || (a.text || a.selector ? 15 : 2)) * 1000;
    if (a.selector) {
      const want = a.state === 'hidden' ? 'false' : 'true', q = JSON.stringify(String(a.selector));
      while (Date.now() - t0 < lim) { const v = await wc.executeJavaScript(`(() => { let el; try { el = document.querySelector(${q}); } catch { return 'bad'; } if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; })()`, true).catch(() => false); if (v === 'bad') throw new Error('Invalid CSS selector'); if (String(v) === want) return read(); await wait(300); }
      const r = await read(); r.content = `${a.selector} still ${a.state === 'hidden' ? 'visible' : 'not visible'} after ${lim / 1000} s.\n` + r.content; return r;
    }
    if (!a.text) { await wait(lim); return read(); }
    const q = JSON.stringify(String(a.text).toLowerCase());
    while (Date.now() - t0 < lim) { if (await wc.executeJavaScript(`document.body && document.body.innerText.toLowerCase().includes(${q})`, true).catch(() => false)) return read(); await wait(400); }
    const r = await read(); r.content = `“${a.text}” did not appear after ${lim / 1000} s.\n` + r.content; return r;
  } });
agent.register({ ...common, name: 'browser_tabs', risk: 'read', categoryCore: true,
  description: 'Manage browser tabs: list them, open a new one (optionally with url), switch to one, or close one (index from list, 1-based).',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'new', 'switch', 'close'] }, index: { type: 'integer' }, url: { type: 'string' } }, required: ['action'] },
  summarize: (a) => `${a.action}${a.index ? ' ' + a.index : ''}${a.url ? ' ' + a.url : ''}`,
  async run(a) {
    if (a.action === 'new') { blockIfUser(); newTab(null, true); if (a.url) { await go(normUrl(a.url)); return read(); } }
    if (a.action === 'switch') { blockIfUser(); activate((a.index || 1) - 1); emit('browser:focus', {}); return read(); }
    if (a.action === 'close') { blockIfUser(); closeTab((a.index || active + 1) - 1); }
    const st = state();
    return { content: st.tabs.map((t, i) => `${i + 1}. ${t.active ? '(active) ' : ''}${t.title} — ${t.url}`).join('\n') || 'No tab open.', view: { kind: 'tabs', n: st.tabs.length } };
  } });
agent.register({ ...common, name: 'browser_zoom', risk: 'read',
  description: 'Zoom the page (1 = 100 %, 1.5 = 150 %).', keywords: ['zoom'],
  parameters: { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] },
  summarize: (a) => `${Math.round(a.factor * 100)} %`,
  async run(a) { ensure().webContents.setZoomFactor(Math.max(0.3, Math.min(3, a.factor))); publish(); return { content: `Zoom ${Math.round(a.factor * 100)} %`, view: { kind: 'zoom' } }; } });
agent.register({ ...common, name: 'browser_screenshot', risk: 'read', categoryCore: true,
  description: 'Take a screenshot of the visible page, or of one element (`selector`), to check a layout, a component or a result visually. Only useful with models that see images.',
  parameters: { type: 'object', properties: { selector: { type: 'string', description: 'Only this element (CSS selector)' } } }, summarize: (a) => a.selector || state().url || '',
  async run(a = {}) {
    if (a.selector) {
      const id = await idFor(a.selector); const wc = ensure().webContents;
      const r = await wc.executeJavaScript(`(() => { const b = document.querySelector('[data-fabro-id="${id}"]').getBoundingClientRect(); return { x: Math.max(0, Math.floor(b.x)), y: Math.max(0, Math.floor(b.y)), width: Math.ceil(b.width), height: Math.ceil(b.height) }; })()`, true);
      if (!r.width || !r.height) throw new Error(`${a.selector} is not visible`);
      const img = await wc.capturePage(r); const image = 'data:image/png;base64,' + img.toPNG().toString('base64');
      return { content: `Screenshot of ${a.selector} (${r.width}×${r.height}) attached.`, image, view: { kind: 'screenshot', image } };
    }
    const image = await shot(); return { content: 'Screenshot of the current page attached.', image, view: { kind: 'screenshot', image } };
  } });
agent.register({ ...common, name: 'browser_back', risk: 'read', categoryCore: true,
  description: 'Go back (or forward=true) in the browser history.', parameters: { type: 'object', properties: { forward: { type: 'boolean' } } },
  summarize: (a) => (a.forward ? '→' : '←'),
  async run(a) { blockIfUser(); const wc = ensure().webContents; if (a.forward) wc.navigationHistory.goForward(); else wc.navigationHistory.goBack(); await settle(wc); return read(); } });
agent.register({ ...common, name: 'browser_script', risk: 'exec', keywords: ['script', 'javascript', 'dom', 'extract'],
  description: 'Run JavaScript in the current page and return its (JSON-serializable) result. For extracting data or actions the other tools can’t do.',
  parameters: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] },
  summarize: (a) => String(a.script).slice(0, 200),
  async run(a) {
    blockIfUser();
    const wc = ensure().webContents;
    const res = await Promise.race([wc.executeJavaScript(`(async () => { ${/\breturn\b/.test(a.script) ? a.script : `return (${a.script})`} })()`, true), wait(15000).then(() => { throw new Error('Script timed out'); })]);
    let out; try { out = JSON.stringify(res, null, 1); } catch { out = String(res); }
    return { content: (out || 'undefined').slice(0, 12000), view: { kind: 'script' } };
  } });

function init(win, emitter) { host = win; emit = emitter; }
async function control(action, arg) {
  if (action === 'newtab') { newTab(await searchPage(''), true); return state(); }
  if (action === 'tab') { activate(tabs.findIndex((t) => t.id === Number(arg))); return state(); }
  if (action === 'closetab') { closeTab(tabs.findIndex((t) => t.id === Number(arg))); return state(); }
  ensure();
  const wc = cur().webContents;
  if (action === 'take') userControl = true;
  if (action === 'release') userControl = false;
  if (action === 'back') wc.navigationHistory.goBack();
  if (action === 'forward') wc.navigationHistory.goForward();
  if (action === 'reload') wc.reload();
  if (action === 'home') wc.loadURL(await searchPage('')).catch(() => {});
  if (action === 'go' && arg) {
    let u = String(arg).trim();
    if (!/^[a-z]+:\/\//i.test(u)) u = /\s|^[^.]+$/.test(u) ? await searchPage(u) : 'https://' + u;
    wc.loadURL(u).catch(() => {});
  }
  if (action === 'clear') { await wc.session.clearStorageData(); }
  publish();
  return state();
}

module.exports = { init, setBounds, state, control, current: () => cur() };
