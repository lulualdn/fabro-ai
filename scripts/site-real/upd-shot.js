// The real installer page (installer/ui/index.src.html) in update mode, as the Rust host drives it.
const { chromium } = require('playwright'); const fs = require('fs');
const [OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 440, height: 112 }, deviceScaleFactor: 2 });
  await p.addInitScript(() => { window.ipc = { postMessage: () => {} }; });
  const icons = fs.readFileSync(require('path').join(__dirname, '..', '..') + '/src/renderer/icons.js', 'utf8'); const mark = icons.split("FABRO_MARK = '")[1].split("'")[0];
  await p.setContent(fs.readFileSync(require('path').join(__dirname, '..', '..') + '/installer/ui/index.src.html', 'utf8').split('{{MARK}}').join(mark).split('{{TRAIL}}').join('')); // as installer/build.rs does
  await p.evaluate(() => { window.ipc = { postMessage: () => {} };
    window.__fabro({ type: 'init', lang: 'en', installed: { location: 'C:\\Users\\Lulu\\AppData\\Local\\Programs\\Fabro', version: '0.9.4' }, update: true, defaultDir: '' });
    window.__fabro({ type: 'release', version: '1.0.0', size: 148000000 });
    window.__fabro({ type: 'progress', done: 94700000, total: 148000000, speed: 11800000 });
  });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
