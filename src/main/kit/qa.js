// Visual check of an artifact, the way a designer would look at it: the page is rendered for real (desktop +
// phone for web pages, printed pages for documents and decks), photographed, and inspected for what is visibly
// broken (see qa-page.js). Used by the check_artifact tool, after every artifact edit, and automatically after
// an artifact is written in chat. Returns { ok, errors, warnings, image (jpeg data URL), text (report) }.
const { BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kit = require('./index');
const { fabroQa } = require('./qa-page');

const dbg = (...a) => { if (process.env.FABRO_QA_DEBUG) console.log('[qa]', ...a); };
const kindOf = (html, type) => {
  const body = (String(html).match(/<body[^>]*>/i) || [''])[0];
  if (type === 'document' || /\bclass\s*=\s*["'][^"']*\bdoc\b/.test(body)) return 'doc';
  if (type === 'slides' || /\bclass\s*=\s*["'][^"']*\bdeck\b/.test(body)) return 'deck';
  if (type === 'svg' || /^\s*<svg[\s>]/i.test(html)) return 'svg';
  return 'web';
};

async function shoot(file, { width, height, kind, phone, maxH = 2400 }) {
  const w = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { sandbox: true, javascript: true, backgroundThrottling: false } });
  const consoleErrors = [];
  w.webContents.on('console-message', (...a) => { const e = a[0]; const level = typeof e === 'object' && e && 'level' in e ? e.level : a[1]; const msg = typeof e === 'object' && e && 'message' in e ? e.message : a[2]; if (level === 'error' || level === 3) consoleErrors.push(String(msg).slice(0, 200)); });
  try {
    // (no device emulation: enabling it before the first load crashes Electron; a 390px window lays out like a phone)
    dbg('load', width); await w.loadFile(file, { hash: 'fk-static' }); dbg('loaded', width);
    await w.webContents.executeJavaScript('Promise.race([Promise.resolve(window.fabroKitReady || true), new Promise((r) => setTimeout(r, 8000))])', true).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const issues = await w.webContents.executeJavaScript(`(${fabroQa.toString()})(${JSON.stringify({ width, phone, kind })})`, true).catch((e) => [{ level: 'warn', msg: 'Check failed: ' + e.message }]);
    for (const m of consoleErrors.filter((x) => !/favicon|ERR_BLOCKED_BY|Failed to load resource/i.test(x)).slice(0, 3)) issues.push({ level: 'error', msg: `JavaScript error: ${m}` });
    const full = await w.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)', true).catch(() => height);
    const H = Math.max(height, Math.min(maxH, full));
    if (H !== height) { w.setContentSize(width, H); await new Promise((r) => setTimeout(r, 250)); }
    dbg('capture', width, H); const img = await w.webContents.capturePage({ x: 0, y: 0, width, height: H }); dbg('captured');
    return { issues, img, fullHeight: full };
  } finally { w.destroy(); }
}

// Two (or more) pictures side by side, one JPEG for the model.
async function compose(parts, totalWidth = 1100) {
  const ok = parts.filter((p) => p.img && !p.img.isEmpty());
  if (!ok.length) return null;
  if (ok.length === 1) { const im = ok[0].img; const s = im.getSize(); return (s.width > totalWidth ? im.resize({ width: totalWidth }) : im).toJPEG(78); }
  const gap = 16, sumW = ok.reduce((a, p) => a + p.img.getSize().width, 0), scale = (totalWidth - gap * (ok.length - 1)) / sumW;
  const imgs = ok.map((p) => { const s = p.img.getSize(); return { url: p.img.resize({ width: Math.round(s.width * scale) }).toDataURL(), w: Math.round(s.width * scale), h: Math.round(s.height * scale), label: p.label }; });
  const H = Math.max(...imgs.map((i) => i.h)) + 26; dbg('compose', totalWidth, H, imgs.map((i) => i.url.length));
  const w = new BrowserWindow({ show: false, width: totalWidth, height: H, useContentSize: true, webPreferences: { sandbox: true } });
  try {
    const html = `<!doctype html><body style="margin:0;background:#2a2c31;display:flex;gap:${gap}px;align-items:flex-start;font:12px system-ui;color:#ccc">${imgs.map((i) => `<figure style="margin:0"><figcaption style="height:22px;padding:4px 2px">${i.label}</figcaption><img src="${i.url}" width="${i.w}" height="${i.h}" style="display:block"></figure>`).join('')}</body>`;
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 200));
    return (await w.webContents.capturePage({ x: 0, y: 0, width: totalWidth, height: H })).toJPEG(78);
  } finally { w.destroy(); }
}

function report({ kind, errors, warnings, pages }) {
  const where = kind === 'web' ? 'desktop (1280px) and phone (390px)' : kind === 'doc' ? `${pages || '?'} printed page(s)` : kind === 'deck' ? `${pages || '?'} slide(s)` : 'drawing';
  const lines = [`Visual check — ${where}: ${errors.length ? `${errors.length} problem(s) to fix` : 'no visible problem'}${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`];
  for (const e of errors) lines.push('✗ ' + e);
  for (const w of warnings) lines.push('! ' + w);
  lines.push(errors.length ? 'Fix the ✗ problems, then check again.' : 'Still look at the picture critically (hierarchy, spacing, balance, real content) before calling it done.');
  return lines.join('\n');
}

const dedupe = (arr) => [...new Set(arr)];
async function check(html, { type = null, title = 'artifact' } = {}) {
  const kind = kindOf(html, type);
  let page = String(html || '');
  if (kind === 'svg' && !/<html[\s>]/i.test(page)) page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;display:grid;place-items:center;min-height:100vh}svg{max-width:92vw;max-height:92vh}</style></head><body>${page}</body></html>`;
  page = kit.inject(page, { mode: kind === 'doc' ? 'doc' : kind === 'deck' ? 'deck' : null, force: kind === 'doc' || kind === 'deck' });
  const file = path.join(os.tmpdir(), `fabro-qa-${process.pid}-${Date.now().toString(36)}.html`);
  fs.writeFileSync(file, page);
  try {
    let issues = [], image = null, pages = null;
    if (kind === 'web') {
      const [d, m] = [await shoot(file, { width: 1280, height: 800, kind }), await shoot(file, { width: 390, height: 844, kind, phone: true, maxH: 2600 })];
      issues = [...d.issues.map((x) => ({ ...x, msg: x.msg })), ...m.issues.map((x) => ({ ...x, msg: /phones|390px/.test(x.msg) ? x.msg : x.msg }))];
      image = await compose([{ img: d.img, label: 'Desktop 1280px' + (d.fullHeight > 2400 ? ' (top of the page)' : '') }, { img: m.img, label: 'Phone 390px' }]);
    } else if (kind === 'svg') {
      const d = await shoot(file, { width: 900, height: 700, kind }); issues = d.issues; image = await compose([{ img: d.img, label: 'Drawing' }], 900);
    } else {
      const d = await shoot(file, { width: 1100, height: 900, kind, maxH: 600 }); issues = d.issues;
      const layout = require('../agent/layout');
      const pr = await layout.printHtml(page, { landscape: false }).catch(() => null);
      if (pr) {
        const r = await layout.renderPdf(pr.pdf, { maxPages: kind === 'deck' ? 12 : 8, width: kind === 'deck' ? 360 : null }).catch(() => null);
        if (r) { pages = r.pages; image = r.sheet; if (r.blank && r.blank.length) issues.push({ level: 'error', msg: `Nearly empty page(s): ${r.blank.join(', ')} — usually content that spills a few lines onto a new page, or a page break too many.` }); }
      }
    }
    const errors = dedupe(issues.filter((x) => x.level === 'error').map((x) => x.msg)).slice(0, 10);
    const warnings = dedupe(issues.filter((x) => x.level !== 'error').map((x) => x.msg)).slice(0, 6);
    const img = image && typeof image !== 'string' ? 'data:image/jpeg;base64,' + image.toString('base64') : image;
    return { ok: !errors.length, kind, errors, warnings, pages, image: img, text: report({ kind, errors, warnings, pages }) };
  } finally { fs.rm(file, { force: true }, () => {}); }
}

module.exports = { check, kindOf };
