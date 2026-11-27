// Screenshots for the website (site/img/v1/*.webp, light and dark) + their sizes in site/src/dims.json.
// Practical views: a long task with its steps, a page read with sources, connectors, computer use, Fabro Code,
// the update bar, Fabro Anywhere on a phone. Until the new interface is in the app, the desktop views come
// from the mockup (maquettes/fabro-ui.html); Fabro Anywhere is the real app (site/dist/app, built first).
// Run: node site/build.js && node scripts/site-shots.js
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site', 'img', 'v1');
const DIMS = path.join(ROOT, 'site', 'src', 'dims.json');
const DIST = path.join(ROOT, 'site', 'dist');
const MOCK = 'file://' + path.join(ROOT, 'maquettes', 'fabro-ui.html');

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let dims = {}; try { dims = JSON.parse(fs.readFileSync(DIMS, 'utf8')); } catch {}
  const browser = await chromium.launch();
  const conv = await browser.newPage();
  async function save(name, png) {
    const r = await conv.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      return { url: c.toDataURL('image/webp', 0.86), w: img.width, h: img.height };
    }, png.toString('base64'));
    fs.writeFileSync(path.join(OUT, name + '.webp'), Buffer.from(r.url.split(',')[1], 'base64'));
    dims[`v1/${name}.webp`] = [r.w, r.h];
  }

  // ── desktop views (mockup) ──
  const p = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  await p.goto(MOCK); await p.addStyleTag({ content: '#demo{display:none!important}#app{inset:0!important}*{animation-play-state:paused!important}.caret{animation:none!important}' });
  await p.waitForTimeout(600);
  for (const th of ['light', 'dark']) {
    await p.evaluate((th) => { document.documentElement.dataset.theme = th; drawAll(); go('chat'); }, th);
    // hero: the chat with a long task running
    await p.evaluate(() => { document.querySelector('#slots').style.display = 'none'; document.querySelector('#chatScroll').scrollTop = 0; tint(); });
    await p.waitForTimeout(250);
    await save(`chat-${th}`, await p.screenshot());
    await save(`task-${th}`, await p.locator('.task').screenshot());
    // a page read with its sources (the paragraph, the picture, the next lines)
    const box = await p.evaluate(() => { const b = document.querySelector('.msg.ai .body'); const t = document.querySelector('.task').getBoundingClientRect(); const r = b.getBoundingClientRect(); return { x: r.x - 16, y: t.bottom + 4, w: r.width + 32 }; });
    await p.evaluate(() => { document.querySelector('#chatScroll').scrollTop = 330; document.querySelector('#v-chat .dock').style.display = 'none'; tint(); }); await p.waitForTimeout(200);
    const b2 = await p.evaluate(() => { const r = document.querySelector('.msg.ai .body figure').getBoundingClientRect(); return { y: r.top - 100, h: r.height + 190 }; });
    await save(`reader-${th}`, await p.screenshot({ clip: { x: box.x, y: Math.max(0, b2.y), width: box.w, height: Math.min(b2.h, 760) } }));
    await p.evaluate(() => { document.querySelector('#slots').style.display = ''; document.querySelector('#v-chat .dock').style.display = ''; });
    // computer use: the stop pill and the AI's screen
    await p.evaluate(() => { document.querySelector('#chatScroll').scrollTop = 0; document.querySelector('#dCU').click(); document.querySelector('#stop').style.opacity = 1; });
    await p.waitForTimeout(900);
    await save(`cu-${th}`, await p.screenshot());
    await p.evaluate(() => stopAI());
    // connectors in one click
    await p.evaluate(() => { go('settings'); document.querySelector('#stabs [data-t="c"]').click(); const b = document.querySelectorAll('.mcp .add'); b[0].className = 'add ok'; b[0].textContent = 'Ajouté'; b[4].className = 'add ing'; b[4].textContent = '…'; const m = document.querySelector('.search .mono'); if (m) m.remove(); });
    await save(`mcp-${th}`, await p.screenshot({ clip: await p.evaluate(() => { const r = document.querySelector('.settings .col').getBoundingClientRect(); return { x: r.x, y: 40, width: r.width, height: 560 }; }) }));
    // Fabro Code with its mascot
    await p.evaluate(() => { go('code'); }); await p.waitForTimeout(700);
    await save(`code-${th}`, await p.screenshot({ clip: await p.evaluate(() => { const r = document.querySelector('#v-code').getBoundingClientRect(); return { x: r.x, y: 0, width: Math.min(r.width, 1100), height: 820 }; }) }));
    // the update bar
    await p.evaluate(() => { go('update'); }); await p.waitForTimeout(500);
    await p.evaluate(() => { clearInterval(ut); document.querySelector('#upd').classList.remove('err'); document.querySelector('#up').style.width = '64%'; document.querySelector('#upct').textContent = '64 %'; });
    await save(`update-${th}`, await p.screenshot({ clip: await p.evaluate(() => { const r = document.querySelector('#upd').getBoundingClientRect(); return { x: r.x - 120, y: r.y - 90, width: r.width + 240, height: r.height + 180 }; }) }));
    await p.evaluate(() => { go('chat'); });
  }

  // ── Fabro Anywhere on a phone (the real app) ──
  const srv = await serve(DIST); const base = `http://127.0.0.1:${srv.address().port}/app/`;
  for (const th of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
    await ctx.addInitScript((th) => { localStorage.setItem('fa-theme', th); }, th);
    const ph = await ctx.newPage();
    await ph.goto(base); await ph.waitForFunction(() => window.__fa); await ph.waitForTimeout(300);
    await ph.evaluate(() => {
      const { S, renderAll } = window.__fa; const t0 = Date.now() - 6 * 60000;
      S.link = { pcName: 'PC-Salon' }; S.conn = { state: 'on', info: {} }; S.pcTools = [];
      const c = { id: 'demo', title: 'Week-end à Lyon', createdAt: t0, updatedAt: t0, leafId: 'a1', nodes: [
        { id: 'u1', role: 'user', content: 'Qu’est-ce qu’on peut faire à Lyon ce week-end avec deux enfants ? Pas trop cher.', createdAt: t0, parentId: null },
        { id: 'a1', role: 'assistant', parentId: 'u1', createdAt: t0 + 40000, model: 'gpt-oss 120B', toolsOn: 'PC-Salon', steps: [
          { id: 's1', name: 'web_search', status: 'done', args: { query: 'Lyon week-end enfants novembre' }, view: { sources: [{ url: 'https://www.lyon-france.com/agenda', title: 'Agenda' }, { url: 'https://www.museedesconfluences.fr', title: 'Musée des Confluences' }, { url: 'https://www.parcdelatetedor.fr', title: 'Parc de la Tête d’Or' }] } },
          { id: 's2', name: 'fetch_url', status: 'done', args: { url: 'https://www.lyon-france.com/agenda' } },
          { id: 's3', name: 'fetch_url', status: 'done', args: { url: 'https://www.museedesconfluences.fr' } }],
          content: 'Trois idées qui tiennent dans un petit budget :\n\n- **Parc de la Tête d’Or** : zoo et serres gratuits, prévois 2 à 3 heures [3].\n- **Musée des Confluences** : gratuit pour les moins de 18 ans, l’atelier du samedi est à réserver [2].\n- **Marché de la Croix-Rousse** le dimanche matin, puis la descente par les traboules [1].\n\nS’il pleut, le musée est le plus sûr. Tu veux que je regarde les horaires du dimanche ?' }] };
      S.convs.set(c.id, c); S.cur = c.id; renderAll();
    });
    await ph.waitForTimeout(400);
    await save(`phone-${th}`, await ph.screenshot());
    await ctx.close();
  }
  srv.close();
  fs.writeFileSync(DIMS, JSON.stringify(Object.fromEntries(Object.entries(dims).filter(([k]) => k.startsWith('v1/')).sort()), null, 1));
  await browser.close();
  console.log('site shots:', fs.readdirSync(OUT).length, 'files');
})().catch((e) => { console.error(e); process.exit(1); });
