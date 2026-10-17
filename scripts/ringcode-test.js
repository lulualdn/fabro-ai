// The circular pairing code, read back from pictures like a phone camera would see them: the code is drawn
// (light and dark themes), then rotated, scaled, moved off-centre, tilted, blurred, darkened, noised,
// mirrored, and decoded with decodeRingCode. Run: node scripts/ringcode-test.js [outDir]
const { chromium } = require('playwright-core');
const path = require('path'); const fs = require('fs');
const assert = require('assert');

(async () => {
  const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
  const browser = await chromium.launch(exe ? { executablePath: exe } : {}).catch(() => chromium.launch({ channel: 'chrome' }));
  const page = await browser.newPage();
  // a secure origin, so WebCrypto is available
  await page.route('https://fabro.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://fabro.test/');
  await page.addScriptTag({ path: path.join(__dirname, '..', 'src', 'anywhere', 'core.js') });
  const mark = fs.readFileSync(path.join(__dirname, '..', 'build', 'fabro-mark.svg'), 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/fill="[^"]*"/g, '');
  const res = await page.evaluate(async (mark) => {
    const A = window.FabroAnywhere;
    const out = [];
    const load = (svg) => new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const cases = [
      { name: 'straight', rot: 0, scale: 1, dx: 0, dy: 0 },
      { name: 'rotated 37°', rot: 37, scale: 0.95, dx: 0, dy: 0 },
      { name: 'rotated 200°, small', rot: 200, scale: 0.7, dx: 0.04, dy: -0.03 },
      { name: 'big, off-centre', rot: 95, scale: 1.18, dx: -0.06, dy: 0.05 },
      { name: 'tilted (ellipse)', rot: 12, scale: 0.9, sx: 1.08, sy: 0.93 },
      { name: 'blurred + dark + noise', rot: 300, scale: 0.85, blur: 1.6, dim: 0.55, noise: 26 },
      { name: 'dark theme', rot: 140, scale: 0.9, dark: true },
      { name: 'dark theme, noisy', rot: 250, scale: 1.05, dark: true, noise: 30, blur: 1.2 },
      { name: 'mirrored (front camera)', rot: 70, scale: 0.9, mirror: true },
      { name: 'low resolution', rot: 15, scale: 0.9, size: 240 },
    ];
    for (const c of cases) {
      const id = await A.genKeys();
      const payload = { flags: 7, fp: await A.fingerprint(id.pub), secret: A.rand(10) };
      const data = A.packPayload(payload);
      const ink = c.dark ? '#f3f1ee' : '#1f1e1b', bg = c.dark ? '#12161d' : '#f6f5f1';
      const img = await load(A.ringCodeSVG(data, { ink, accent: '#ff5e42', mark, size: 600 }));
      const S = c.size || 720;
      const cv = document.createElement('canvas'); cv.width = S; cv.height = Math.round(S * 1.33);
      const g = cv.getContext('2d');
      g.fillStyle = c.dark ? '#0b0d11' : '#c9c4b8'; g.fillRect(0, 0, cv.width, cv.height); // desk around the screen
      g.save();
      g.translate(cv.width / 2 + (c.dx || 0) * S, cv.height / 2 + (c.dy || 0) * S);
      if (c.mirror) g.scale(-1, 1);
      g.rotate(((c.rot || 0) * Math.PI) / 180);
      g.scale((c.sx || 1), (c.sy || 1));
      const d = 0.8 * S * (c.scale || 1); // the code fills the guide circle at scale 1
      g.fillStyle = bg; g.fillRect(-d * 0.62, -d * 0.62, d * 1.24, d * 1.24); // the screen
      if (c.blur) g.filter = `blur(${c.blur}px)`;
      g.drawImage(img, -d / 2, -d / 2, d, d);
      g.restore();
      const im = g.getImageData(0, 0, cv.width, cv.height);
      if (c.dim || c.noise) for (let i = 0; i < im.data.length; i += 4) for (let k = 0; k < 3; k++) {
        let v = im.data[i + k] * (c.dim || 1) + (c.noise ? (Math.random() - 0.5) * 2 * c.noise : 0);
        im.data[i + k] = Math.max(0, Math.min(255, v));
      }
      // the app crops the centre square of the camera frame (the viewfinder)
      const side = Math.min(cv.width, cv.height), ox = (cv.width - side) / 2, oy = (cv.height - side) / 2;
      const sq = document.createElement('canvas'); sq.width = side; sq.height = side;
      sq.getContext('2d').putImageData(im, -ox, -oy);
      const frame = sq.getContext('2d').getImageData(0, 0, side, side);
      const t0 = performance.now();
      const r = A.decodeRingCode(frame, 0.8);
      out.push({ name: c.name, ok: !!r && A.hex(r.data27) === A.hex(data), ms: Math.round(performance.now() - t0), score: r ? +r.score.toFixed(2) : 0, png: c.name === 'blurred + dark + noise' || c.name === 'dark theme' ? sq.toDataURL() : null });
    }
    return out;
  }, mark);
  const dir = process.argv[2];
  for (const r of res) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(26)} ${String(r.ms).padStart(4)} ms  score ${r.score}`);
    if (dir && r.png) fs.writeFileSync(path.join(dir, r.name.replace(/\W+/g, '-') + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
  }
  await browser.close();
  assert.ok(res.every((r) => r.ok), 'every picture decodes');
  console.log('ringcode-test: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
