// Built-in browser for the agent: an isolated WebContentsView (own cookies/session, separate
// from the user's browsers) shown live in the agent workspace. The user can take control any time.
const { WebContentsView } = require('electron');
const agent = require('./index');

let host = null, view = null, emit = () => {};
let bounds = { x: 0, y: 0, width: 0, height: 0 }, shown = false;
let userControl = false;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function state() {
  if (!view) return { open: false, userControl };
  const wc = view.webContents;
  return { open: true, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(), zoom: wc.getZoomFactor(), userControl };
}
const publish = () => emit('browser:state', state());

function ensure() {
  if (view) return view;
  view = new WebContentsView({ webPreferences: { partition: 'persist:fabro-browser', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  view.setBackgroundColor('#ffffff');
  host.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  wc.setUserAgent(UA);
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) wc.loadURL(url); return { action: 'deny' }; });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, publish);
  wc.session.on('will-download', (e, item) => {
    // Downloads only when the user allowed it for this action (guardrail).
    if (!pendingDownloadOk) { e.preventDefault(); emit('browser:blocked', { kind: 'download', file: item.getFilename() }); }
  });
  wc.session.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  publish();
  return view;
}
let pendingDownloadOk = false;

function setBounds(b) {
  bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
  shown = !!b.visible && bounds.width > 20 && bounds.height > 20;
  if (!view) return;
  view.setBounds(bounds);
  view.setVisible(shown);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(wc, timeout = 20000) {
  const t0 = Date.now();
  await wait(150);
  while (wc.isLoading() && Date.now() - t0 < timeout) await wait(150);
  await wait(250);
}
function blockIfUser() { if (userControl) throw Object.assign(new Error('The user has taken control of the browser. Wait for them to hand it back.'), { code: 'USER_CONTROL' }); }

const READ = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > -40 && r.top < innerHeight * 2.5; };
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=true],summary,label[for]';
  document.querySelectorAll('[data-fabro-id]').forEach((e) => e.removeAttribute('data-fabro-id'));
  const els = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (n >= 160 || !vis(el)) continue;
    const id = ++n; el.setAttribute('data-fabro-id', String(id));
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.getAttribute('alt') || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
    const o = { id, tag: el.tagName.toLowerCase(), label };
    if (el.type && el.tagName !== 'BUTTON') o.type = el.type;
    if (el.getAttribute('role')) o.role = el.getAttribute('role');
    if (el.href) o.href = String(el.href).slice(0, 140);
    if (el.disabled) o.disabled = true;
    els.push(o);
  }
  const main = document.querySelector('main, article, [role=main]') || document.body;
  const text = (main ? main.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 9000);
  return { url: location.href, title: document.title, text, elements: els, scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight } };
})()`;

async function read() {
  const wc = ensure().webContents;
  const r = await wc.executeJavaScript(READ, true);
  const list = r.elements.map((e) => `[${e.id}] ${e.tag}${e.type ? `:${e.type}` : ''}${e.role ? `(${e.role})` : ''} ${e.label}${e.href ? ` → ${e.href}` : ''}${e.disabled ? ' (disabled)' : ''}`).join('\n');
  return {
    content: `URL: ${r.url}\nTitle: ${r.title}\nScroll: ${r.scroll.y}/${r.scroll.height} (viewport ${r.scroll.viewport})\n\nInteractive elements (use their [id]):\n${list}\n\nPage text:\n${r.text}`,
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

async function shot() {
  const wc = ensure().webContents;
  let img = await wc.capturePage();
  const size = img.getSize();
  if (size.width > 1280) img = img.resize({ width: 1280 });
  return 'data:image/jpeg;base64,' + img.toJPEG(72).toString('base64');
}

const common = { category: 'browser', untrusted: true };
agent.register({ ...common, name: 'browser_open', risk: 'net', core: true, keywords: ['site', 'web', 'page', 'navigat', 'browser', 'navigateur', 'clique', 'click', 'formulaire', 'form', 'connecte', 'login'],
  description: 'Open a URL in Fabro’s built-in browser (visible to the user) and return the page text and its interactive elements with [id]s. Use it for tasks on websites; for simply reading a page prefer fetch_url.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  summarize: (a) => a.url,
  async run(a) {
    blockIfUser();
    let url = String(a.url).trim(); if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
    if (!/^https?:/i.test(url)) throw new Error('Only http(s) pages');
    const wc = ensure().webContents; emit('browser:focus', {});
    await wc.loadURL(url).catch(() => {}); await settle(wc);
    return read();
  } });
agent.register({ ...common, name: 'browser_read', risk: 'read', categoryCore: true,
  description: 'Read the current page again: text and interactive elements with [id]s (after scrolling, typing or waiting).',
  parameters: { type: 'object', properties: {} }, summarize: () => state().url || '', async run() { return read(); } });
agent.register({ ...common, name: 'browser_click', risk: 'net', categoryCore: true,
  description: 'Click an element by its [id] from browser_read (or at x,y in the viewport). Purchases, sending, publishing, deleting or downloading always ask the user first.',
  parameters: { type: 'object', properties: { id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' } } },
  summarize: (a) => (a.id != null ? `#${a.id}` : `${a.x},${a.y}`),
  async guard(a) { if (a.id == null) return null; const i = await elementInfo(a.id); if (!i) return { refuse: `element ${a.id} not found — call browser_read again` }; return agent.SENSITIVE.test(i.label) || (i.type === 'submit' && i.form) ? { confirm: `click « ${i.label || i.tag} »` } : null; },
  async run(a, ctx) {
    blockIfUser();
    const wc = ensure().webContents;
    let x = a.x, y = a.y, label = '';
    if (a.id != null) { const i = await elementInfo(a.id); if (!i) throw new Error(`Element ${a.id} not found — call browser_read again`); x = i.x; y = i.y; label = i.label; }
    pendingDownloadOk = !!ctx.lastConfirmed;
    await clickAt(Math.round(x), Math.round(y)); await settle(wc, 12000);
    pendingDownloadOk = false;
    const r = await read(); r.view = { ...r.view, kind: 'click', label }; return r;
  } });
agent.register({ ...common, name: 'browser_type', risk: 'net', categoryCore: true,
  description: 'Type text into a field by [id] (clears it first unless append=true). Set submit=true to press Enter after. Never used for passwords or card numbers: the user types those themselves.',
  parameters: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, append: { type: 'boolean' }, submit: { type: 'boolean' } }, required: ['id', 'text'] },
  summarize: (a) => `#${a.id}: ${String(a.text).slice(0, 80)}`,
  async guard(a) { const i = await elementInfo(a.id); if (!i) return { refuse: `element ${a.id} not found — call browser_read again` }; if (isSecretField(i)) return { refuse: 'Fabro never types passwords, codes or card numbers. Ask the user to type it in the browser panel themselves.' }; return a.submit && agent.SENSITIVE.test(i.label) ? { confirm: 'submit' } : null; },
  async run(a) {
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
agent.register({ ...common, name: 'browser_key', risk: 'net', categoryCore: true,
  description: 'Press a key or shortcut in the page: Enter, Tab, Escape, ArrowDown, PageDown, Ctrl+A…',
  parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  summarize: (a) => a.key,
  async run(a) { blockIfUser(); pressKey(a.key); await settle(ensure().webContents, 8000); return { content: `Pressed ${a.key}. Call browser_read to see the result.`, view: { kind: 'key', key: a.key } }; } });
agent.register({ ...common, name: 'browser_scroll', risk: 'read', categoryCore: true,
  description: 'Scroll the page: direction down/up (by about one screen, or `amount` in pixels), or to an element [id].',
  parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] }, amount: { type: 'integer' }, id: { type: 'integer' } } },
  summarize: (a) => a.id != null ? `#${a.id}` : (a.direction || 'down'),
  async run(a) {
    blockIfUser();
    const wc = ensure().webContents;
    const js = a.id != null ? `document.querySelector('[data-fabro-id="${Number(a.id)}"]')?.scrollIntoView({block:'center'})`
      : a.direction === 'top' ? 'scrollTo(0,0)' : a.direction === 'bottom' ? 'scrollTo(0,document.documentElement.scrollHeight)'
      : `scrollBy(0, ${(a.direction === 'up' ? -1 : 1) * (a.amount || 'innerHeight*0.85')})`;
    await wc.executeJavaScript(js); await wait(350);
    return read();
  } });
agent.register({ ...common, name: 'browser_zoom', risk: 'read',
  description: 'Zoom the page (1 = 100 %, 1.5 = 150 %).', keywords: ['zoom'],
  parameters: { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] },
  summarize: (a) => `${Math.round(a.factor * 100)} %`,
  async run(a) { ensure().webContents.setZoomFactor(Math.max(0.3, Math.min(3, a.factor))); publish(); return { content: `Zoom ${Math.round(a.factor * 100)} %`, view: { kind: 'zoom' } }; } });
agent.register({ ...common, name: 'browser_screenshot', risk: 'read', categoryCore: true,
  description: 'Take a screenshot of the visible page (for layouts, images, canvases). Only useful with models that see images.',
  parameters: { type: 'object', properties: {} }, summarize: () => state().url || '',
  async run() { const image = await shot(); return { content: 'Screenshot of the current page attached.', image, view: { kind: 'screenshot', image } }; } });
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
  ensure();
  const wc = view.webContents;
  if (action === 'take') userControl = true;
  if (action === 'release') userControl = false;
  if (action === 'back') wc.navigationHistory.goBack();
  if (action === 'forward') wc.navigationHistory.goForward();
  if (action === 'reload') wc.reload();
  if (action === 'go' && arg) { let u = String(arg).trim(); if (!/^[a-z]+:\/\//i.test(u)) u = /\s|^[^.]+$/.test(u) ? `https://duckduckgo.com/?q=${encodeURIComponent(u)}` : 'https://' + u; wc.loadURL(u).catch(() => {}); }
  if (action === 'clear') { await wc.session.clearStorageData(); }
  publish();
  return state();
}

module.exports = { init, setBounds, state, control };
