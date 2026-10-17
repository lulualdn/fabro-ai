const { chromium } = require('/home/claude/fabro-ai/node_modules/playwright-core');
const fs = require('fs'); const path = require('path');
const [dir, V, outDir, only] = process.argv.slice(2);
(async () => {
  const takes = {}; for (const n of ['ask', 'doc', 'slides', 'offline']) { const f = path.join(dir, n, 'take.json'); if (fs.existsSync(f)) takes[n] = JSON.parse(fs.readFileSync(f, 'utf8')); }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--allow-file-access-from-files'] });
  const W = V === 'L' ? 1920 : 1080, H = V === 'L' ? 1080 : 1920;
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.addInitScript(`window.VARIANT=${JSON.stringify(V)};window.TAKES=${JSON.stringify(takes)};`);
  await p.goto('file://' + path.resolve(dir, 'film.html'));
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  const dur = await p.evaluate(() => window.DURATION);
  fs.mkdirSync(outDir, { recursive: true });
  const times = only ? only.split(',').map(Number) : Array.from({ length: Math.ceil(dur * 30) }, (_, i) => i / 30);
  let n = 0;
  for (const t of times) {
    await p.evaluate((t) => window.setT(t), t);
    await p.evaluate(() => Promise.all([...document.images].filter((i) => i.src && !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))));
    await p.screenshot({ path: path.join(outDir, only ? `t${t}.jpg` : `f${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  console.log('frames', times.length, 'dur', dur.toFixed(1)); await b.close();
})();
