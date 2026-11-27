// PNG captures → site/img/v1/<name>-<theme>.webp + site/src/dims.json
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const [SH] = process.argv.slice(2);
const ROOT = path.join(__dirname, '..', '..'); const OUT = path.join(ROOT, 'site/img/v1'); const DIMS = path.join(ROOT, 'site/src/dims.json');
const map = {};
for (const n of ['chat', 'task', 'reader', 'code', 'mcp', 'phone']) for (const th of ['light', 'dark']) map[`${n}-${th}`] = `${SH}/${n}-${th}.png`;
for (const th of ['light', 'dark']) { map[`cu-${th}`] = `${SH}/cu-osm.png`; map[`update-${th}`] = `${SH}/update-raw.png`; }
(async () => {
  const dims = JSON.parse(fs.readFileSync(DIMS, 'utf8'));
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, src] of Object.entries(map)) {
    const r = await p.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      return { url: c.toDataURL('image/webp', 0.86), w: img.width, h: img.height };
    }, fs.readFileSync(src).toString('base64'));
    fs.writeFileSync(path.join(OUT, name + '.webp'), Buffer.from(r.url.split(',')[1], 'base64'));
    dims[`v1/${name}.webp`] = [r.w, r.h];
    console.log(name, r.w, r.h);
  }
  fs.writeFileSync(DIMS, JSON.stringify(Object.fromEntries(Object.entries(dims).sort()), null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
