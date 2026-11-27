// Fabro Anywhere on a phone, a real question to Fabro Cloud (English UI), light then dark.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const DIST = require('path').join(__dirname, '..', '..') + '/site/dist'; const [OUT, prompt] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${srv.address().port}/app/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('requestfinished', async (rq) => { if (/pollinations|llm7|ovh/.test(rq.url()) && rq.method() === 'POST') { const rs = await rq.response(); let body = ''; try { body = (await rs.text()).slice(-300); } catch {} const pd = rq.postData() || ''; console.log('REQ', rq.url().slice(0, 50), rs.status(), pd.length, JSON.parse(pd).tools ? 'tools' : 'notools', body.replace(/\n/g, ' ').slice(-200)); } }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base); await p.waitForFunction(() => window.__fa); await p.waitForTimeout(800);
  await p.fill('textarea', prompt); await p.click('[data-act=send]');
  for (let i = 0; i < 90; i++) { await p.waitForTimeout(2000); const busy = await p.evaluate(() => { const c = __fa.S.convs.get(__fa.S.cur); const n = c && c.nodes && c.nodes[c.nodes.length - 1]; return !n || n.pending; }); if (!busy && i > 1) break; }
  const last = await p.evaluate(() => { const c = __fa.S.convs.get(__fa.S.cur); const n = c.nodes[c.nodes.length - 1]; return { content: (n.content || '').slice(0, 600), error: n.error, steps: (n.steps || []).map((s) => s.name) }; });
  console.log(JSON.stringify(last)); console.log('errors', JSON.stringify(errs));
  for (const th of ['light', 'dark']) {
    await p.evaluate((th) => { localStorage.setItem('fa-theme', th); document.documentElement.dataset.theme = th; }, th); await p.waitForTimeout(400);
    await p.evaluate(() => { const sc = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (sc) sc.scrollTop = 0; });
    await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/phone-${th}.png` });
  }
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
