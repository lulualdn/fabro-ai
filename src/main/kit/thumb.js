// Small pictures of artifacts (first screen of a web page, page 1 of a document, slide 1, the drawing) for the
// artifact cards in the chat and in the Artifacts page. Cached per artifact version, on disk.
const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kit = require('./index');

const dir = () => path.join(app.getPath('userData'), 'thumbs');
const fileOf = (id, v) => path.join(dir(), `${String(id).replace(/[^\w-]/g, '_')}-${v}.jpg`);
const pending = new Map();
// at most two pictures rendered at once (an Artifacts page can ask for dozens)
let running = 0; const queue = [];
const limit = (fn) => new Promise((res, rej) => { const go = () => { running++; fn().then(res, rej).finally(() => { running--; const n = queue.shift(); if (n) n(); }); }; if (running < 2) go(); else queue.push(go); });

function htmlFor(a, content) {
  if (a.type === 'svg') return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#fff;display:grid;place-items:center}svg{width:70%;height:70%}</style></head><body>${content}</body></html>`;
  if (a.type === 'markdown') {
    let md = null; try { md = require('marked').marked; } catch {}
    const body = md ? md.parse(String(content || '')) : `<pre>${String(content).replace(/</g, '&lt;')}</pre>`;
    return kit.inject(`<!doctype html><html><head><meta charset="utf-8"></head><body class="doc" data-theme="paper">${body}</body></html>`, { force: true });
  }
  if (a.type === 'slides' && !/<section/i.test(content)) {
    const docs = require('../agent/documents');
    return docs.slidesHtml(content, a.style || {});
  }
  const mode = a.type === 'document' ? 'doc' : a.type === 'slides' ? 'deck' : null;
  return kit.inject(String(content || ''), { mode, force: !!mode });
}

async function render(a, v) {
  const content = (a.versions[v] || a.versions[a.versions.length - 1] || {}).content || '';
  const html = htmlFor(a, content);
  const kind = a.type === 'document' || /<body[^>]*class\s*=\s*["'][^"']*\bdoc\b/i.test(html) ? 'doc' : a.type === 'slides' ? 'deck' : 'web';
  const [W, H] = kind === 'doc' ? [820, 1160] : kind === 'deck' ? [1312, 760] : [1280, 800];
  const tmp = path.join(os.tmpdir(), `fabro-thumb-${process.pid}-${Date.now().toString(36)}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { sandbox: true, javascript: true, backgroundThrottling: false } });
  try {
    await w.loadFile(tmp, { hash: 'fk-static' });
    await w.webContents.insertCSS('::-webkit-scrollbar { display: none !important; } html { scrollbar-width: none; }').catch(() => {});
    await w.webContents.executeJavaScript('Promise.race([Promise.resolve(window.fabroKitReady || true), new Promise((r) => setTimeout(r, 6000))])', true).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    // what to frame: the first page / slide, or the top of the page
    const rect = await w.webContents.executeJavaScript(`(() => { const el = document.querySelector('.doc .page, .deck .slide, body > section.slide, body > section.s'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top + scrollY)), width: Math.round(Math.min(r.width, innerWidth)), height: Math.round(r.height) }; })()`, true).catch(() => null);
    let img;
    if (rect && rect.width > 50) {
      const want = kind === 'doc' ? Math.round(rect.width * 0.75) : rect.height; // a document card shows the top ¾ of page 1
      img = await w.webContents.capturePage({ x: rect.x, y: rect.y, width: rect.width, height: Math.min(want, H - rect.y) });
    } else img = await w.webContents.capturePage({ x: 0, y: 0, width: W, height: Math.round(W * 0.625) });
    const out = img.resize({ width: 480 }).toJPEG(80);
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(fileOf(a.id, v), out);
    return 'data:image/jpeg;base64,' + out.toString('base64');
  } finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
}

// Data URL of the picture (null for code: cards show a file icon).
async function thumb(a, v = null) {
  if (!a || !a.versions || !a.versions.length || a.type === 'code') return null;
  const ver = v == null ? a.versions.length - 1 : Math.max(0, Math.min(a.versions.length - 1, v));
  const f = fileOf(a.id, ver);
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64'); } catch {}
  const key = `${a.id}:${ver}`;
  if (!pending.has(key)) pending.set(key, limit(() => render(a, ver)).catch(() => null).finally(() => setTimeout(() => pending.delete(key), 1000)));
  return pending.get(key);
}

module.exports = { thumb };
